# Writing a shim

A **shim** teaches the relay how to drive one coding agent: how to build the
command line that launches it, and how to read its output for activity signals
(idle, needs-input). Shims are the only place per-agent knowledge lives.

> **Hard rule (handoff §13 #6):** all per-agent logic lives on the relay, in a
> shim — **never** in the browser. The browser app is a vendor-neutral viewer;
> it knows agents only by the id strings the relay advertises in `hello`. If you
> find yourself special-casing an agent in `index.html`, stop:
> the difference belongs in a shim.

Shims live in [`../relay-go/internal/shims/`](../relay-go/internal/shims/). Two
ship: `Generic` — which every configured agent uses — and `custom`.

> **Read this first:** adding an agent usually needs **no shim at all.** An agent
> is a row in the relay's known-agent registry (`internal/config/agents.go`) or a
> table in `relay.toml`; the relay detects it on `PATH` and runs it through
> `Generic`. Write a shim only for an agent whose spawn mechanics genuinely
> differ. See [Adding an agent](#adding-an-agent-usually-not-a-shim) below.

## The `Shim` interface

From [`shims.go`](../relay-go/internal/shims/shims.go):

```go
// Shim builds an agent's command and detects naive activity signals.
type Shim interface {
    Name() string
    Spawn(cwd string, args []string, env map[string]string) (*exec.Cmd, error)
    DetectIdle(buf []byte) bool       // naive in v1.0, refined in v1.1
    DetectNeedsInput(buf []byte) bool // naive in v1.0, refined in v1.1
}
```

| Method | Responsibility |
|---|---|
| `Name()` | The agent id — must match the registry key and the id the browser shows. |
| `Spawn(cwd, args, env)` | Build (but do **not** start) the `*exec.Cmd`. The relay starts it under a PTY. `args` is the `spawn.args` from the protocol — the shim decides how to interpret it. `cwd` is the working directory; `env` is per-spawn overrides. |
| `DetectIdle(buf)` | Heuristic: does this recent output suggest the agent has gone idle? Return `true`/`false`. |
| `DetectNeedsInput(buf)` | Heuristic: does this recent output look like the agent is waiting for input? Return `true`/`false`. |

`Spawn` returns a configured `*exec.Cmd`; the relay's PTY layer is what actually
launches it and wires up the byte stream. Your job is only to assemble the
command.

## Worked example: `Generic`

[`generic.go`](../relay-go/internal/shims/generic.go) — the shim behind every
configured agent:

```go
// Generic runs a configured coding-agent CLI: exec the command, hand it the
// spawn's args, attach a PTY.
type Generic struct {
    ID  string // the agent id the browser shows
    Cmd string // executable (PATH lookup); empty falls back to ID
}

func (g Generic) Name() string { return g.ID }

func (g Generic) Spawn(cwd string, args []string, env map[string]string) (*exec.Cmd, error) {
    bin := g.Cmd
    if bin == "" {
        bin = g.ID
    }
    return build(bin, args, cwd, env), nil
}
```

`Cmd` comes from the resolved agent list — the registry entry, or `relay.toml`'s
`command =` when you pinned one. The task `args` pass straight through. That is
the whole of what `claude-code`, `codex`, `opencode` and the rest need, which is
why they are configuration rather than code.

## Worked example: `custom`

[`custom.go`](../relay-go/internal/shims/custom.go) — runs an arbitrary command,
so it carries no built-in executable and no heuristics:

```go
package shims

import (
    "errors"
    "os/exec"
)

// Custom runs an arbitrary command supplied in spawn.args (args[0] is the
// executable, the rest are its arguments). No activity heuristics.
type Custom struct{}

func (Custom) Name() string { return "custom" }

func (Custom) Spawn(cwd string, args []string, env map[string]string) (*exec.Cmd, error) {
    if len(args) == 0 {
        return nil, errors.New("custom agent requires a command in args")
    }
    return build(args[0], args[1:], cwd, env), nil
}

func (Custom) DetectIdle(buf []byte) bool       { return false }
func (Custom) DetectNeedsInput(buf []byte) bool { return false }
```

Note the two interpretations of `args`: `mini`/`claude-code` treat it as a task
to pass to a fixed binary, while `custom` treats `args[0]` as the binary itself.
Returning an error from `Spawn` surfaces to the client as an `error` frame with
code `spawn_failed`.

## Shared helpers

Three helpers in [`shims.go`](../relay-go/internal/shims/shims.go) save each shim
from boilerplate:

### `build(name, args, cwd, env)`

Assembles the `*exec.Cmd`: `exec.Command(name, args...)`, sets `cmd.Dir = cwd`,
and `cmd.Env = mergeEnv(env)`. Almost every shim's `Spawn` is a one-liner over
`build`.

### `mergeEnv(env)`

Inherits the relay's own environment, **ensures `TERM` is set**
(`TERM=xterm-256color` if neither the caller nor the relay's environment already
provides one), then applies the caller's per-spawn overrides. Setting `TERM`
matters: a TUI agent under a PTY renders incorrectly without it.

### `endsWithPrompt(buf)`

The conservative needs-input heuristic shared by `mini` and `claude-code`. It
trims trailing whitespace and checks whether the output ends in a prompt-shaped
character:

```go
for _, suffix := range []string{">", "?", ":", "$", "#", "❯"} {
    if strings.HasSuffix(s, suffix) {
        return true
    }
}
```

## Adding an agent (usually not a shim)

The relay decides which agents exist from data, not code:

1. **The registry** — `KnownAgents` in
   [`internal/config/agents.go`](../relay-go/internal/config/agents.go) maps an
   agent id to the executable to probe. At startup `ResolveAgents` runs
   `exec.LookPath` over each one and advertises only what this machine actually
   has, so the browser's dropdown never offers a spawn that would fail.
2. **`relay.toml`** — any `[agents.<id>]` table is always offered, detected or
   not, and its `command` overrides the registry. That is how a user points an id
   at a wrapper script or an off-PATH binary.

So adding an agent is one registry row:

```go
"opencode": {Command: "opencode"},
```

Set `Transports: []string{"acp"}` only if you have verified the agent speaks the
Agent Client Protocol over stdio — claiming it wrongly yields a broken session.

Then `go build ./cmd/menagerie-relay && go test ./...`, restart `serve`, and —
if the binary is on your `PATH` — reconnect in the app to find the agent in the
**+ Spawn** dropdown (alphabetically; no agent is featured). `menagerie-relay
agents` prints what was detected and what was not. The browser needs no change:
it learns agent ids from the relay's `hello.agents` list.

The registry ships inside the binary and is refreshed at release time. It is
never fetched at runtime — the relay would then be taking the names of programs
it executes from the network, and a periodic check would be a phone-home.

## Registering a real shim

`NewRegistry` in [`shims.go`](../relay-go/internal/shims/shims.go) builds itself
from the resolved agent list:

```go
func NewRegistry(commands map[string]string) map[string]Shim {
    reg := make(map[string]Shim, len(commands)+1)
    for id, cmd := range commands {
        if id == "custom" {
            continue
        }
        reg[id] = Generic{ID: id, Cmd: cmd}
    }
    reg["custom"] = Custom{}
    return reg
}
```

An agent that needs different mechanics gets a struct of its own in
`internal/shims/` implementing `Shim`, plus a case in this loop keyed by its id
(`if id == "myagent" { reg[id] = MyAgent{Cmd: cmd}; continue }`). Reach for that
only when `Generic` cannot express the spawn — a different executable name is
not a reason; that is what `Command` is for.

## Heuristic guidance

`DetectIdle` and `DetectNeedsInput` drive the `idle` and `needs_input` lifecycle
events (and thus the tile's status pill and the attention badge). Keep them
**conservative**:

> **False negatives are fine; false positives are annoying.**

A missed `needs_input` just means the user notices the prompt themselves. A
spurious `needs_input` makes the tile pulse and the tab badge light up for
nothing, training the user to ignore it. When unsure, return `false`. The v1.0
heuristics are intentionally naive (the shared `endsWithPrompt`; `DetectIdle`
off entirely) — refinement is a v1.1 task, gated on real false-positive pain
(see [`../DEFERRED.md`](../DEFERRED.md)). Mirror that restraint in new shims.
