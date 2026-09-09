package fleet

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Every invalid fixture names the path a validator must point at. A fixture that
// fails for the wrong reason is as bad as one that passes: the error path is the
// contract an editor puts its cursor on.
var invalidWantPath = map[string]string{
	"missing-spec.json":                   "/spec",
	"wrong-spec-version.json":             "/spec",
	"missing-name.json":                   "/name",
	"missing-topology.json":               "/topology",
	"missing-repo.json":                   "/repo",
	"empty-roster.json":                   "/roster",
	"roster-missing-agent.json":           "/roster/0/agent",
	"roster-zero-count.json":              "/roster/0/count",
	"port-range-inverted.json":            "/workspace/materialise/ports/0/range",
	"file-neither-from-nor-template.json": "/workspace/materialise/files/0",
	"command-missing-run.json":            "/workspace/materialise/commands/0/run",
	"bad-on-exceed.json":                  "/budgets/on_exceed",
	"supervise-without-port-var.json":     "/workspace/materialise/services/0/supervise",
	"hook-undeclared-var.json":            "/workspace/materialise/hooks/on_start",
	"supervise-with-blank-port-var.json":  "/workspace/materialise/services/0/supervise",
	"padded-unknown-probe.json":           "/workspace/materialise/health/0/probe",
	"absolute-source.json":                "/workspace/materialise/files/0/from",
	"source-out-of-bounds.json":           "/workspace/materialise/files/0/from",
	"tilde-source.json":                   "/workspace/materialise/files/1/template",
}

func read(t *testing.T, dir, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", dir, name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func names(t *testing.T, dir string) []string {
	t.Helper()
	es, err := os.ReadDir(filepath.Join("testdata", dir))
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range es {
		if strings.HasSuffix(e.Name(), ".json") {
			out = append(out, e.Name())
		}
	}
	return out
}

func TestValidFixturesPass(t *testing.T) {
	fs := names(t, "valid")
	if len(fs) != 7 {
		t.Fatalf("valid fixtures = %d, want 7", len(fs))
	}
	for _, n := range fs {
		if _, issues := ValidateBytes(read(t, "valid", n)); len(issues) > 0 {
			t.Errorf("%s: want no issues, got %v", n, issues)
		}
	}
}

func TestInvalidFixturesRejectedAtTheRightPath(t *testing.T) {
	fs := names(t, "invalid")
	if len(fs) != 19 {
		t.Fatalf("invalid fixtures = %d, want 19", len(fs))
	}
	for _, n := range fs {
		want, ok := invalidWantPath[n]
		if !ok {
			t.Fatalf("%s has no expected error path — add one rather than loosening the test", n)
		}
		_, issues := ValidateBytes(read(t, "invalid", n))
		if len(issues) == 0 {
			t.Errorf("%s: accepted, want rejection at %s", n, want)
			continue
		}
		var found bool
		for _, is := range issues {
			if is.Path == want {
				found = true
			}
		}
		if !found {
			t.Errorf("%s: no issue at %s; got %v", n, want, issues)
		}
	}
}

func TestSecretFixturesFireTheLeakLint(t *testing.T) {
	fs := names(t, "secrets")
	if len(fs) != 7 {
		t.Fatalf("secret fixtures = %d, want 7", len(fs))
	}
	for _, n := range fs {
		_, issues := ValidateBytes(read(t, "secrets", n))
		var found bool
		for _, is := range issues {
			if is.Code == "secret_in_spec" {
				found = true
			}
		}
		if !found {
			t.Errorf("%s: leak lint did not fire; got %v", n, issues)
		}
	}
}

// A credential-shaped string must not be reported for an ordinary opaque value:
// a lint that cries wolf gets disabled, and then D4 is unenforced.
func TestLeakLintDoesNotFireOnOrdinaryStrings(t *testing.T) {
	ok := [][]byte{
		[]byte(`{"run":"npm ci --prefer-offline","cache_key":"package-lock.json"}`),
		[]byte(`{"run":"deploy --token \"$DEPLOY_TOKEN\""}`),
		[]byte(`{"url":"postgres://localhost:5432/app"}`),
		[]byte(`{"sha":"sk-"}`),
		[]byte(`{"note":"AKIA is a prefix"}`),
	}
	for _, b := range ok {
		if is := LintSecrets(b); len(is) > 0 {
			t.Errorf("false positive on %s: %v", b, is)
		}
	}
}

// ${VAR} resolves against allocated ports and the builtins, nothing else.
func TestUndeclaredInterpolationIsRejected(t *testing.T) {
	s := &Spec{Spec: SpecVersion, Name: "x", Repo: ".", Topology: "flat",
		Workspace: Workspace{Isolation: "worktree", Materialise: Materialise{
			Ports:    []Port{{Name: "PORT", Range: [2]int{4000, 4001}}},
			Commands: []Command{{Run: "start --port ${PORT} --db ${DB_URL}"}},
		}},
		Roster: []Role{{Role: "worker", Agent: "codex", Count: 1}}}
	issues := Validate(s)
	var got string
	for _, is := range issues {
		if is.Code == "undeclared_var" {
			got = is.Message
		}
	}
	if !strings.Contains(got, "DB_URL") {
		t.Fatalf("want an undeclared_var issue naming DB_URL, got %v", issues)
	}
	if strings.Contains(got, "${PORT}") {
		t.Fatalf("PORT is declared and must not be flagged: %v", issues)
	}
}

// An unknown health probe kind is refused rather than skipped at run time.
func TestUnknownProbeKindIsRejected(t *testing.T) {
	s := &Spec{Spec: SpecVersion, Name: "x", Repo: ".", Topology: "flat",
		Workspace: Workspace{Isolation: "worktree", Materialise: Materialise{
			Health: []Probe{{Probe: "telepathy"}}}},
		Roster: []Role{{Role: "worker", Agent: "codex", Count: 1}}}
	for _, is := range Validate(s) {
		if is.Path == "/workspace/materialise/health/0/probe" && is.Code == "unsupported" {
			return
		}
	}
	t.Fatal("unknown probe kind was accepted")
}

// A file destination may not escape the workspace root, however it is spelled.
func TestFileDestinationCannotEscapeWorkspace(t *testing.T) {
	for _, to := range []string{"/etc/passwd", "../outside/.env"} {
		s := &Spec{Spec: SpecVersion, Name: "x", Repo: ".", Topology: "flat",
			Workspace: Workspace{Isolation: "worktree", Materialise: Materialise{
				Files: []File{{From: "a", To: to}}}},
			Roster: []Role{{Role: "worker", Agent: "codex", Count: 1}}}
		var found bool
		for _, is := range Validate(s) {
			if is.Code == "escapes_workspace" {
				found = true
			}
		}
		if !found {
			t.Errorf("destination %q was accepted", to)
		}
	}
}

// Normalisation is the invariant the engine depends on: a padded value must never
// reach a consumer, because a validator more permissive than its consumer is
// worse than one that is stricter. A padded probe kind used to validate clean and
// then run the wrong branch.
func TestValidateNormalisesInPlace(t *testing.T) {
	s := &Spec{
		Spec: " " + SpecVersion + " ", Name: " x ", Repo: " . ", Topology: " flat ",
		Workspace: Workspace{Isolation: "  worktree  ", Materialise: Materialise{
			Ports:    []Port{{Name: " PORT ", Range: [2]int{4000, 4001}}},
			Files:    []File{{From: " a.env ", Template: "   ", To: " .env "}},
			Commands: []Command{{Run: " setup ", CacheKey: " lock.json "}},
			Services: []Service{{Name: " db ", Run: " start ", PortVar: " PORT ", Supervise: true}},
			Health:   []Probe{{Probe: "http ", URL: " http://x/h ", TimeoutS: 1}},
			Escape:   " ./b.sh ",
			Hooks:    &Hooks{OnStart: " announce "},
		}},
		Roster: []Role{{Role: " worker ", Agent: " codex ", Count: 1}},
	}
	if issues := Validate(s); len(issues) > 0 {
		t.Fatalf("a spec that is valid once trimmed was rejected: %v", issues)
	}
	m := s.Workspace.Materialise
	for label, got := range map[string]string{
		"spec": s.Spec, "name": s.Name, "repo": s.Repo, "topology": s.Topology,
		"isolation": s.Workspace.Isolation, "port": m.Ports[0].Name, "from": m.Files[0].From,
		"to": m.Files[0].To, "run": m.Commands[0].Run, "cache_key": m.Commands[0].CacheKey,
		"svc.name": m.Services[0].Name, "svc.run": m.Services[0].Run, "port_var": m.Services[0].PortVar,
		"probe": m.Health[0].Probe, "url": m.Health[0].URL, "escape": m.Escape,
		"on_start": m.Hooks.OnStart, "role": s.Roster[0].Role, "agent": s.Roster[0].Agent,
	} {
		if got != strings.TrimSpace(got) || got == "" {
			t.Errorf("%s = %q, want it trimmed and non-empty", label, got)
		}
	}
	// A whitespace-only field normalises to absent, which is what makes the
	// from/template exclusivity check agree with the engine's source pick.
	if m.Files[0].Template != "" {
		t.Errorf("whitespace-only template = %q, want empty", m.Files[0].Template)
	}
	if m.Health[0].Probe != "http" {
		t.Errorf("probe = %q, want %q — the engine dispatches on this exact value", m.Health[0].Probe, "http")
	}
}

// The D4 lint must not fail open. A line over any internal buffer used to end the
// scan as though the document were fully read, so a credential on or after it was
// missed and the spec passed.
func TestSecretLintSurvivesAnEnormousLine(t *testing.T) {
	huge := strings.Repeat("x", 5<<20)
	doc := []byte(`{"a":"` + huge + `",` + "\n" + `"b":"AKIAIOSFODNN7EXAMPLE"}`)
	issues := LintSecrets(doc)
	if len(issues) == 0 {
		t.Fatal("a credential after a 5MB line was missed — the lint failed open")
	}
	if issues[0].Code != "secret_in_spec" {
		t.Errorf("issue = %v, want secret_in_spec", issues[0])
	}
}

// testdata/normalises holds documents that are only valid AFTER the ingress
// normalises them — a padded probe kind, a whitespace-only template beside a real
// from. They are kept out of testdata/valid because valid/ means "satisfies the
// published schema.json as written", and JSON Schema cannot trim.
func TestNormalisingFixturesBecomeValid(t *testing.T) {
	fs := names(t, "normalises")
	if len(fs) != 5 {
		t.Fatalf("normalising fixtures = %d, want 5", len(fs))
	}
	for _, n := range fs {
		if _, issues := ValidateBytes(read(t, "normalises", n)); len(issues) > 0 {
			t.Errorf("%s: want no issues once normalised, got %v", n, issues)
		}
	}
}

// The contract normalize.go states — "adding a field to the spec means adding it
// here" — was backed by nothing. This walks the Spec by reflection, sets every
// string field to a padded value, and asserts normalize trimmed it. A new field
// that normalize forgets fails here instead of shipping a validator that is more
// permissive than its consumer.
func TestNormalizeCoversEveryStringField(t *testing.T) {
	s := &Spec{
		Workspace: Workspace{Materialise: Materialise{
			Ports:    []Port{{}},
			Files:    []File{{Vars: []string{" v "}}},
			Commands: []Command{{}},
			Services: []Service{{}},
			Health:   []Probe{{}},
			Hooks:    &Hooks{},
		}, Teardown: &Teardown{Commands: []string{" t "}}},
		Roster:  []Role{{}},
		Budgets: &Budgets{},
		Exits:   &Exits{ConvergeOn: []string{" c "}},
	}
	padEveryString(reflect.ValueOf(s).Elem())
	s.normalize()
	if missed := findUntrimmed(reflect.ValueOf(s).Elem(), ""); len(missed) > 0 {
		t.Fatalf("normalize() left these string fields untrimmed: %v", missed)
	}
}

func padEveryString(v reflect.Value) {
	switch v.Kind() {
	case reflect.String:
		if v.CanSet() {
			v.SetString("  padded  ")
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			padEveryString(v.Field(i))
		}
	case reflect.Ptr, reflect.Interface:
		if !v.IsNil() {
			padEveryString(v.Elem())
		}
	case reflect.Slice, reflect.Array:
		for i := 0; i < v.Len(); i++ {
			padEveryString(v.Index(i))
		}
	}
}

func findUntrimmed(v reflect.Value, path string) []string {
	var out []string
	switch v.Kind() {
	case reflect.String:
		if s := v.String(); s != strings.TrimSpace(s) {
			out = append(out, path)
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			out = append(out, findUntrimmed(v.Field(i), path+"."+v.Type().Field(i).Name)...)
		}
	case reflect.Ptr, reflect.Interface:
		if !v.IsNil() {
			out = append(out, findUntrimmed(v.Elem(), path)...)
		}
	case reflect.Slice, reflect.Array:
		for i := 0; i < v.Len(); i++ {
			out = append(out, findUntrimmed(v.Index(i), fmt.Sprintf("%s[%d]", path, i))...)
		}
	}
	return out
}

// The two ingresses must trim the same code points. Go's unicode.IsSpace trims
// U+0085 and not U+FEFF; JavaScript's String.trim does the opposite. Left to
// defaults, the relay and the browser judged the same document differently.
func TestWhitespaceSetCoversBothLanguagesDefaults(t *testing.T) {
	for _, r := range []string{"\u0085", "\ufeff", "\u00a0", "\u2003", "\u3000"} {
		s := &Spec{
			Spec: SpecVersion, Name: r + "x" + r, Repo: ".", Topology: "flat",
			Workspace: Workspace{Isolation: "worktree", Materialise: Materialise{
				Commands: []Command{{Run: "setup"}}}},
			Roster: []Role{{Role: "worker", Agent: "codex", Count: 1}},
		}
		if issues := Validate(s); len(issues) > 0 {
			t.Errorf("a name padded with %q was rejected: %v", r, issues)
		}
		if s.Name != "x" {
			t.Errorf("name padded with %q normalised to %q, want %q", r, s.Name, "x")
		}
	}
}

// The source bound: "beside the repo" is the documented pattern and must work;
// anything further out is refused. The destination rule cannot simply be reused,
// because the handoff's own example reads ../.env.local.
func TestFileSourceBounds(t *testing.T) {
	mk := func(from string) *Spec {
		return &Spec{
			Spec: SpecVersion, Name: "x", Repo: ".", Topology: "flat",
			Workspace: Workspace{Isolation: "worktree", Materialise: Materialise{
				Files: []File{{From: from, To: ".env"}}}},
			Roster: []Role{{Role: "worker", Agent: "codex", Count: 1}},
		}
	}
	for _, ok := range []string{".env.local", "config/.env", "../.env.local", "../shared/x.env"} {
		if issues := Validate(mk(ok)); len(issues) > 0 {
			t.Errorf("source %q should be allowed: %v", ok, issues)
		}
	}
	for _, bad := range []string{"/etc/passwd", "~/.aws/credentials", "../../x", "../../../../etc/passwd"} {
		var flagged bool
		for _, is := range Validate(mk(bad)) {
			if is.Code == "absolute_source" || is.Code == "source_out_of_bounds" {
				flagged = true
			}
		}
		if !flagged {
			t.Errorf("source %q was accepted - a spec could read it off the relay's box", bad)
		}
	}
}

// JSON escapes defeat a byte-level match, so the lint also checks the decoded form.
func TestSecretLintCatchesEscapedCredentials(t *testing.T) {
	for name, doc := range map[string]string{
		"unicode escapes": `{"spec":"menagerie.fleet.v1","run":"echo AKIAIOSFODNN7EXAMPLE"}`,
		"escaped solidus": `{"spec":"menagerie.fleet.v1","run":"psql postgres:\/\/usr:pw@h\/db"}`,
		"colon in pw":     `{"spec":"menagerie.fleet.v1","run":"psql postgres://usr:pw:x@h/db"}`,
	} {
		_, issues := ValidateBytes([]byte(doc))
		var leaked bool
		for _, is := range issues {
			if is.Code == "secret_in_spec" {
				leaked = true
			}
		}
		if !leaked {
			t.Errorf("%s: the credential walked past the lint; issues = %v", name, issues)
		}
	}
	// A lint that refuses ordinary specs gets disabled, and then D4 is unenforced.
	// Every one of these was refused by the over-wide pattern this replaces.
	for _, ok := range []string{
		`{"run":"curl https://api.example.com:8443/health?who=me@example.com"}`,
		`{"run":"npm ci --registry=https://registry.npmjs.org:443/@scope/pkg"}`,
		`{"run":"curl http://localhost:3000/@vite/client"}`,
		`{"run":"skopeo copy oci://ghcr.io:443/acme/charts/api@sha256:abcdef01"}`,
		`{"run":"curl https://cdn.example.com:443/img/logo@2x.png"}`,
		`{"run":"curl https://example.com/a/b"}`,
	} {
		if is := LintSecretsDecoded([]byte(ok)); len(is) > 0 {
			t.Errorf("false positive on %s: %v", ok, is)
		}
		if is := LintSecrets([]byte(ok)); len(is) > 0 {
			t.Errorf("false positive (raw) on %s: %v", ok, is)
		}
	}

	// A number the decoder cannot represent must not silently disable the pass.
	overflow := []byte(`{"spec":"menagerie.fleet.v1","annotations":{"ceiling":1e999},"run":"psql postgres:\/\/deploy:pw@db.internal/app"}`)
	var caught bool
	for _, is := range LintSecretsDecoded(overflow) {
		if is.Code == "secret_in_spec" || is.Code == "secret_lint_incomplete" {
			caught = true
		}
	}
	if !caught {
		t.Error("an out-of-range number silently disabled the decoded pass — the lint failed open")
	}
}
