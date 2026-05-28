# Writing a shim

A **shim** teaches the relay how to drive one coding agent: how to build the
command line that launches it, and how to read its output for activity signals
(idle, needs-input). Shims are the only place per-agent knowledge lives.

> **Hard rule (handoff §13 #6):** all per-agent logic lives on the relay, in a
> shim — **never** in the browser. The browser app is a vendor-neutral viewer;
> it knows agents only by the id strings the relay advertises in `hello`. If you
> find yourself special-casing an agent in `index.html`, stop:
> the difference belongs in a shim.

Shims live in [`../relay-go/internal/shims/`](../relay-go/internal/shims/). v1.0
ships three: `mini`, `claude-code`, and `custom`.

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

## Worked example: `mini`

[`mini.go`](../relay-go/internal/shims/mini.go) — the whole file:

```go
package shims

import "os/exec"

// Mini runs mini-swe-agent.
type Mini struct {
    // Cmd overrides the executable; empty uses "mini" from PATH.
    Cmd string
}

func (Mini) Name() string { return "mini" }

func (m Mini) Spawn(cwd string, args []string, env map[string]string) (*exec.Cmd, error) {
    bin := m.Cmd
    if bin == "" {
        bin = "mini"
    }
    return build(bin, args, cwd, env), nil
}

func (Mini) DetectIdle(buf []byte) bool       { return false }
func (Mini) DetectNeedsInput(buf []byte) bool { return endsWithPrompt(buf) }
```

The struct carries a `Cmd` override (set from `relay.toml`'s `command =`), falls
back to `mini` on `PATH`, and hands the task `args` straight through. Idle
detection is left off (`false`); needs-input reuses the shared `endsWithPrompt`
helper. `claude-code` ([`claude_code.go`](../relay-go/internal/shims/claude_code.go))
is structurally identical, defaulting to the `claude` binary.

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

## Registering a shim

A shim only exists to the relay once it's in the registry. From `NewRegistry` in
[`shims.go`](../relay-go/internal/shims/shims.go):

```go
// NewRegistry returns the shims implemented in this build, keyed by agent id.
// `commands` maps an agent id to its configured executable (empty => shim default).
func NewRegistry(commands map[string]string) map[string]Shim {
    return map[string]Shim{
        "mini":        Mini{Cmd: commands["mini"]},
        "claude-code": ClaudeCode{Cmd: commands["claude-code"]},
        "custom":      Custom{},
    }
}
```

The `commands` map comes from `relay.toml`'s `[agents.<id>]` tables, so a shim
that honors a configurable binary should pull its override from
`commands["<id>"]`.

## Adding a new shim — step by step

1. **Create the file**, e.g. `internal/shims/opencode.go`, with a struct
   implementing `Shim`. Lean on `build` and `mergeEnv`; reuse `endsWithPrompt`
   if its prompt set fits, or write a tighter heuristic for your agent.
2. **Register it** in `NewRegistry` with the agent id as the key:
   ```go
   "opencode": OpenCode{Cmd: commands["opencode"]},
   ```
3. **Add it to `relay.toml`** so the relay advertises it:
   ```toml
   [agents.opencode]
   command = "opencode"
   ```
4. **Build and test:** `go build ./cmd/menagerie-relay && go test ./...`.
   Restart `serve`; reconnect in the app and the new agent appears in the
   **+ Spawn** dropdown (alphabetically — no agent is featured).

That's the whole loop. The browser needs no change: it learns the new agent id
from the relay's `hello.agents` list.

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
