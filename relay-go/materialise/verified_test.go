package materialise

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/NakliTechie/menagerie/relay-go/fleet"
	"github.com/NakliTechie/menagerie/relay-go/workspace"
)

// Finding 1: port_var was checked against everything ${VAR} can resolve — which
// includes the builtins — so `port_var: "BRANCH"` passed validation and then took
// the "no allocated port" branch forever: permanently unhealthy, on_start never
// run, start command re-run every pass.
func TestSuperviseRejectsABuiltinAsPortVar(t *testing.T) {
	spec := supervisedSpec()
	spec.Workspace.Materialise.Services[0].PortVar = "BRANCH"
	issues := fleet.Validate(spec)
	var found bool
	for _, is := range issues {
		if strings.HasSuffix(is.Path, "/port_var") && is.Code == "undeclared_var" {
			found = true
		}
	}
	if !found {
		t.Fatalf("port_var naming a builtin was accepted; issues = %v", issues)
	}
}

// Finding 3: a stage that fails must leave the record honestly unhealthy, not
// stranded at `materialising` where nothing would ever move it again.
func TestAFailingStageRecordsUnhealthyRatherThanStranding(t *testing.T) {
	repo, home := testRepo(t), t.TempDir()
	e := New(workspace.New(home))
	e.Exec = &RecordingExecutor{Fail: map[string]bool{"boom": true}}
	spec := &fleet.Spec{
		Spec: fleet.SpecVersion, Name: "t", Repo: ".", Topology: "flat",
		Workspace: fleet.Workspace{Isolation: "worktree", Materialise: fleet.Materialise{
			Commands: []fleet.Command{{Run: "boom"}}}},
		Roster: []fleet.Role{{Role: "worker", Agent: "codex", Count: 1}},
	}
	if _, err := e.Run(spec, repo, "w"); err == nil {
		t.Fatal("expected the failing command to surface as an error")
	}
	rec, _ := e.Prov.Load("w")
	if rec.State != workspace.StateUnhealthy {
		t.Errorf("recorded state = %q, want unhealthy (never left at materialising)", rec.State)
	}
	if rec.Reason == "" {
		t.Error("no reason recorded for the failure")
	}
}

// Finding 4: two Supervise calls used to walk a workspace that had never been
// materialised from provisioning -> unhealthy -> ready on one TCP dial. `ready` is
// the state a workspace is handed to an agent in.
func TestSuperviseIgnoresAWorkspaceThatNeverMaterialised(t *testing.T) {
	repo, home := testRepo(t), t.TempDir()
	e := New(workspace.New(home))
	e.Exec, e.Dial, e.Settle = &RecordingExecutor{Fail: map[string]bool{}}, TCPDial, -1
	spec := supervisedSpec()
	spec.Workspace.Materialise.Ports[0].Range = [2]int{5970, 5979}

	rec, err := e.Prov.Provision(spec, repo, "w1") // provisioned, never materialised
	if err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", rec.Ports["DB_PORT"]))
	if err != nil {
		t.Skipf("could not bind: %v", err)
	}
	defer ln.Close()

	for i := 0; i < 2; i++ {
		state, err := e.Supervise(spec, "w1")
		if err != nil {
			t.Fatal(err)
		}
		if state == workspace.StateReady {
			t.Fatalf("call %d promoted a never-materialised workspace to ready", i+1)
		}
	}
	back, _ := e.Prov.Load("w1")
	if back.State == workspace.StateReady {
		t.Errorf("recorded state = ready for a workspace with no files, no commands and no probes")
	}
}

// Finding 7: the returned snapshot was taken before the run, so a
// just-materialised workspace went over the wire as `provisioning`.
func TestResultCarriesThePostRunWorkspaceState(t *testing.T) {
	repo := testRepo(t)
	e := New(workspace.New(t.TempDir()))
	e.Exec, e.Prob = &RecordingExecutor{Fail: map[string]bool{}}, PassProber{}
	spec := &fleet.Spec{
		Spec: fleet.SpecVersion, Name: "t", Repo: ".", Topology: "flat",
		Workspace: fleet.Workspace{Isolation: "worktree", Materialise: fleet.Materialise{
			Commands: []fleet.Command{{Run: "setup"}},
			Hooks:    &fleet.Hooks{OnStart: "announce"}}},
		Roster: []fleet.Role{{Role: "worker", Agent: "codex", Count: 1}},
	}
	res, err := e.Run(spec, repo, "w")
	if err != nil {
		t.Fatal(err)
	}
	if res.Workspace.State != workspace.StateReady {
		t.Errorf("result snapshot state = %q, want ready — it was a pre-run snapshot", res.Workspace.State)
	}
	if res.Workspace.StartedAt == "" {
		t.Error("result snapshot has no started_at although the hook ran and stamped the record")
	}
}

// Finding 9: escape was the one declared field neither interpolated nor
// validated, so ${PORT} in a bootstrap script stayed literal.
func TestEscapeIsInterpolatedAndItsVarsValidated(t *testing.T) {
	repo := testRepo(t)
	e := New(workspace.New(t.TempDir()))
	ex := &RecordingExecutor{Fail: map[string]bool{}}
	e.Exec, e.Prob = ex, PassProber{}
	spec := &fleet.Spec{
		Spec: fleet.SpecVersion, Name: "t", Repo: ".", Topology: "flat",
		Workspace: fleet.Workspace{Isolation: "worktree", Materialise: fleet.Materialise{
			Ports:  []fleet.Port{{Name: "PORT", Range: [2]int{5980, 5989}}},
			Escape: "./bootstrap.sh ${PORT}"}},
		Roster: []fleet.Role{{Role: "worker", Agent: "codex", Count: 1}},
	}
	res, err := e.Run(spec, repo, "w")
	if err != nil {
		t.Fatal(err)
	}
	want := fmt.Sprintf("./bootstrap.sh %d", res.Workspace.Ports["PORT"])
	if ex.Count(want) != 1 {
		t.Errorf("escape ran as %v, want the interpolated %q", ex.Runs, want)
	}

	bad := *spec
	bad.Workspace.Materialise.Escape = "./bootstrap.sh ${NOPE}"
	var flagged bool
	for _, is := range fleet.Validate(&bad) {
		if is.Path == "/workspace/materialise/escape" && is.Code == "undeclared_var" {
			flagged = true
		}
	}
	if !flagged {
		t.Error("an undeclared var in escape was not flagged")
	}
}

// A failed command's combined output must never reach the persisted record: the
// record is on the relay's disk and the handoff forbids secrets there. A setup
// command that echoes a credential while failing used to put it in `reason`.
func TestAFailedCommandsOutputNeverReachesTheRecord(t *testing.T) {
	repo, home := testRepo(t), t.TempDir()
	e := New(workspace.New(home))
	e.Exec = &leakyExecutor{}
	spec := &fleet.Spec{
		Spec: fleet.SpecVersion, Name: "t", Repo: ".", Topology: "flat",
		Workspace: fleet.Workspace{Isolation: "worktree", Materialise: fleet.Materialise{
			Commands: []fleet.Command{{Run: "setup"}}}},
		Roster: []fleet.Role{{Role: "worker", Agent: "codex", Count: 1}},
	}
	if _, err := e.Run(spec, repo, "w"); err == nil {
		t.Fatal("expected the failing command to error")
	}
	rec, _ := e.Prov.Load("w")
	if strings.Contains(rec.Reason, "AKIA") || strings.Contains(rec.Reason, "hunter2") {
		t.Fatalf("the record's reason carries command output: %q", rec.Reason)
	}
	if rec.State != workspace.StateUnhealthy {
		t.Errorf("state = %q, want unhealthy", rec.State)
	}
	// The failure path must also return a fresh snapshot, not the pre-run one.
	raw, _ := os.ReadFile(filepath.Join(home, "workspaces.json"))
	if strings.Contains(string(raw), "AKIA") {
		t.Error("the credential reached workspaces.json on disk")
	}
}

// leakyExecutor fails while printing something credential-shaped, the way a real
// setup command echoing its environment would.
type leakyExecutor struct{}

func (leakyExecutor) Run(dir string, env []string, cmdline string, timeout time.Duration) ([]byte, error) {
	return []byte("connecting with AKIAIOSFODNN7EXAMPLE / hunter2\n"), fmt.Errorf("exit status 1")
}

// A spec must not be able to copy an arbitrary readable file on the relay's box
// into the worktree an agent works in. Enforced in the engine as well as the
// validator, because this is the code that actually opens the file.
func TestEngineRefusesASourceOutsideTheRepoParent(t *testing.T) {
	repo := testRepo(t)
	e := New(workspace.New(t.TempDir()))
	e.Exec, e.Prob = &RecordingExecutor{Fail: map[string]bool{}}, PassProber{}
	for _, src := range []string{"/etc/passwd", "../../../../etc/passwd"} {
		spec := &fleet.Spec{
			Spec: fleet.SpecVersion, Name: "t", Repo: ".", Topology: "flat",
			Workspace: fleet.Workspace{Isolation: "worktree", Materialise: fleet.Materialise{
				Files: []fleet.File{{From: src, To: "leak.txt"}}}},
			Roster: []fleet.Role{{Role: "worker", Agent: "codex", Count: 1}},
		}
		if _, err := e.Run(spec, repo, "w"); err == nil {
			t.Errorf("source %q was accepted — a spec could exfiltrate it into the agent's worktree", src)
		}
	}
	// The documented pattern — a file kept beside the repo — must still work.
	if err := os.WriteFile(filepath.Join(filepath.Dir(repo), "beside.env"), []byte("K=v\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ok := &fleet.Spec{
		Spec: fleet.SpecVersion, Name: "t", Repo: ".", Topology: "flat",
		Workspace: fleet.Workspace{Isolation: "worktree", Materialise: fleet.Materialise{
			Files: []fleet.File{{From: "../beside.env", To: ".env"}}}},
		Roster: []fleet.Role{{Role: "worker", Agent: "codex", Count: 1}},
	}
	if _, err := e.Run(ok, repo, "w2"); err != nil {
		t.Errorf("../beside.env is the handoff's own documented pattern and must work: %v", err)
	}
}

// A probe URL can carry credentials, and the reason is persisted to disk.
func TestAFailedProbeDoesNotPersistItsTarget(t *testing.T) {
	repo, home := testRepo(t), t.TempDir()
	e := New(workspace.New(home))
	e.Exec, e.Prob = &RecordingExecutor{Fail: map[string]bool{}}, FailProber{}
	spec := &fleet.Spec{
		Spec: fleet.SpecVersion, Name: "t", Repo: ".", Topology: "flat",
		Workspace: fleet.Workspace{Isolation: "worktree", Materialise: fleet.Materialise{
			Health: []fleet.Probe{{Probe: "http", URL: "http://svc:s3cr3t@internal/health", TimeoutS: 1}}}},
		Roster: []fleet.Role{{Role: "worker", Agent: "codex", Count: 1}},
	}
	if _, err := e.Run(spec, repo, "w"); err != nil {
		t.Fatal(err)
	}
	rec, _ := e.Prov.Load("w")
	if strings.Contains(rec.Reason, "s3cr3t") {
		t.Errorf("the probe's credentials were persisted in the reason: %q", rec.Reason)
	}
	raw, _ := os.ReadFile(filepath.Join(home, "workspaces.json"))
	if strings.Contains(string(raw), "s3cr3t") {
		t.Error("the probe's credentials reached workspaces.json on disk")
	}
	if rec.ReasonCode != ReasonProbe {
		t.Errorf("reason_code = %q, want %q", rec.ReasonCode, ReasonProbe)
	}
}

// Supervision clears only the verdict it set, and that decision must not depend on
// matching prose — a reworded message or a renamed service used to change it.
func TestSupervisionClearsByCodeNotByProse(t *testing.T) {
	repo, home := testRepo(t), t.TempDir()
	e := New(workspace.New(home))
	e.Exec, e.Dial, e.Settle = &RecordingExecutor{Fail: map[string]bool{}}, TCPDial, -1
	spec := supervisedSpec()
	spec.Workspace.Materialise.Ports[0].Range = [2]int{5990, 5999}

	first, err := e.Run(spec, repo, "w1")
	if err != nil {
		t.Fatal(err)
	}
	rec, _ := e.Prov.Load("w1")
	if rec.ReasonCode != ReasonSupervise {
		t.Fatalf("reason_code = %q, want %q", rec.ReasonCode, ReasonSupervise)
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", first.Workspace.Ports["DB_PORT"]))
	if err != nil {
		t.Skipf("could not bind: %v", err)
	}
	defer ln.Close()

	// Rename the service: the prose changes, the code does not.
	spec.Workspace.Materialise.Services[0].Name = "renamed-db"
	state, err := e.Supervise(spec, "w1")
	if err != nil {
		t.Fatal(err)
	}
	if state != workspace.StateReady {
		t.Errorf("Supervise returned %q after a rename; the verdict is recognised by code, not wording", state)
	}
}

// The validator checks that a destination's ${VAR}s resolve, so writing the
// destination literally made a promise the engine did not keep.
func TestFileDestinationIsInterpolated(t *testing.T) {
	repo := testRepo(t)
	e := New(workspace.New(t.TempDir()))
	fsys := NewRecordingFS(map[string][]byte{filepath.Join(repo, "seed"): []byte("x")})
	e.FS, e.Exec, e.Prob = fsys, &RecordingExecutor{Fail: map[string]bool{}}, PassProber{}
	spec := &fleet.Spec{
		Spec: fleet.SpecVersion, Name: "t", Repo: ".", Topology: "flat",
		Workspace: fleet.Workspace{Isolation: "worktree", Materialise: fleet.Materialise{
			Ports: []fleet.Port{{Name: "PORT", Range: [2]int{6000, 6009}}},
			Files: []fleet.File{{From: "seed", To: "env-${PORT}.txt"}}}},
		Roster: []fleet.Role{{Role: "worker", Agent: "codex", Count: 1}},
	}
	res, err := e.Run(spec, repo, "w")
	if err != nil {
		t.Fatal(err)
	}
	want := fmt.Sprintf("env-%d.txt", res.Workspace.Ports["PORT"])
	var found bool
	for p := range fsys.Writes {
		if strings.HasSuffix(p, want) {
			found = true
		}
	}
	if !found {
		var got []string
		for p := range fsys.Writes {
			got = append(got, filepath.Base(p))
		}
		t.Errorf("wrote %v, want a file named %q — the destination was written literally", got, want)
	}
}

// A lexical bound is not a containment check. A symlink committed inside the repo,
// or dropped beside it, pointed anywhere on the box and the copy read straight
// through it — an SSH key landing in the worktree an agent works in, with the spec
// validating clean. Found by an independent verifier who reproduced it end to end.
func TestSymlinkCannotEscapeTheSourceBound(t *testing.T) {
	base := t.TempDir()
	repo := filepath.Join(base, "a", "b", "repo")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"init", "-q", "-b", "main"}, {"config", "user.email", "t@e.com"},
		{"config", "user.name", "t"}, {"commit", "-q", "--allow-empty", "-m", "root"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	secret := filepath.Join(base, "id_rsa")
	if err := os.WriteFile(secret, []byte("-----BEGIN OPENSSH PRIVATE KEY-----\nSTOLEN\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	for name, link := range map[string]string{
		"symlink inside the repo": filepath.Join(repo, "innocent.txt"),
		"symlink beside the repo": filepath.Join(base, "a", "b", ".env.local"),
	} {
		if err := os.Symlink(secret, link); err != nil {
			t.Skipf("cannot create a symlink: %v", err)
		}
		from := "innocent.txt"
		if name == "symlink beside the repo" {
			from = "../.env.local"
		}
		e := New(workspace.New(t.TempDir()))
		e.Exec, e.Prob = &RecordingExecutor{Fail: map[string]bool{}}, PassProber{}
		spec := &fleet.Spec{
			Spec: fleet.SpecVersion, Name: "t", Repo: ".", Topology: "flat",
			Workspace: fleet.Workspace{Isolation: "worktree", Materialise: fleet.Materialise{
				Files: []fleet.File{{From: from, To: "notes.txt"}}}},
			Roster: []fleet.Role{{Role: "worker", Agent: "codex", Count: 1}},
		}
		res, err := e.Run(spec, repo, "w-"+strings.ReplaceAll(name, " ", "-"))
		if err == nil {
			leaked, _ := os.ReadFile(filepath.Join(res.Workspace.Path, "notes.txt"))
			t.Errorf("%s: accepted, and the worktree now holds %q", name, string(leaked))
		}
		_ = os.Remove(link)
	}
}

// The legacy shape: a record written before reason_code existed carries only the
// prose. Without a fallback, upgrading the relay left every already-unhealthy
// workspace unrecoverable except by a full re-materialise.
func TestSupervisionClearsALegacyRecordWithNoReasonCode(t *testing.T) {
	repo, home := testRepo(t), t.TempDir()
	e := New(workspace.New(home))
	e.Exec, e.Dial, e.Settle = &RecordingExecutor{Fail: map[string]bool{}}, TCPDial, -1
	spec := supervisedSpec()
	spec.Workspace.Materialise.Ports[0].Range = [2]int{6010, 6019}

	first, err := e.Run(spec, repo, "w1")
	if err != nil {
		t.Fatal(err)
	}
	// Rewrite the record the way relay <= 0.6.0 wrote it: prose, no code.
	path := filepath.Join(home, "workspaces.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	ws := doc["workspaces"].(map[string]any)["w1"].(map[string]any)
	delete(ws, "reason_code")
	out, _ := json.Marshal(doc)
	if err := os.WriteFile(path, out, 0o600); err != nil {
		t.Fatal(err)
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", first.Workspace.Ports["DB_PORT"]))
	if err != nil {
		t.Skipf("could not bind: %v", err)
	}
	defer ln.Close()
	state, err := e.Supervise(spec, "w1")
	if err != nil {
		t.Fatal(err)
	}
	if state != workspace.StateReady {
		t.Errorf("Supervise returned %q on a pre-upgrade record; it must recognise the legacy prose", state)
	}
}
