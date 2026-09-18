# Menagerie architecture

The technical companion to the README: how the page, the relays and the
protocol fit together, and where the code lives.

## How it works

```
   Browser tab (one static HTML file)          ── you own the state:
   ─ terminal or structured tile per agent         relays + sessions +
   ─ dark default · light · drag · fullscreen      trajectories, saved to
        │         │          │                      a folder you pick (FSA)
        │ WSS     │ WSS      │ WSS
    ┌───▼──┐  ┌───▼──┐   ┌───▼──┐     each relay = one Go binary
    │relay │  │relay │   │relay │     that owns agent processes and speaks
    └──┬───┘  └──┬───┘   └──┬───┘     the published WebSocket protocol
   claude-code  codex    opencode …
```

The page is the whole app: `index.html`, no build step. It connects to one
or more **relays** — small servers you run once per machine — over
WebSocket and renders each session as a tile. A relay handles many agents;
run more relays only for more machines.

Two relays speak the protocol today:

- **`menagerie-relay`** (`relay-go/` in this repo) — the reference relay.
- **[Continuum](https://github.com/NakliTechie/continuum)** — the shared
  runtime: the same protocol on its Menagerie door, plus a durable journal,
  restart survival for terminal sessions, a versioned `/v1` API and a CLI.
  `continuum service cutover --adopt-relay` replaces an installed
  `menagerie-relay` in place. Continuum is where runtime work now lands; the
  reference relay stays compatible.

## The protocol is the SDK

Anything the browser can do, an agent can do too:
[protocol v1.3](../protocol/protocol.md) (`protocol.md` + `types.ts`,
fixtures under `protocol/fixtures/`). PTY sessions stream raw terminal bytes;
**structured sessions** (`transport: "acp"`) carry the agent's ACP messages
nested verbatim — messages, tool calls, permission requests with diffs — so the
page can render a transcript and an in-browser approve/reject without knowing
any agent by name. Lifecycle events (`running`, `needs_input`, `done`, `idle`,
`stalled`, `rate_limited`, `exited`) are relay-tracked; `done` means finished
*and nobody has looked yet* and is cleared only by a `seen` from a human.

A relay streams a session to one client at a time; when another client
attaches, the previous one receives `error{session_taken}` and offers a
re-attach (Continuum emits this; the reference relay does not yet).

## The bridge — many machines, one tab

Agents increasingly run on machines that aren't the one you're at. The bridge
is the tab holding a live connection to every one of those machines at once:

- **One view** — every agent on every machine in one grid.
- **They come to you** — each session reports its lifecycle; the attention
  badge holds until a human looks.
- **One command reaches across** — spawn, prompt, cancel, kill, resume on any
  machine from the same window, and one `wait` that resolves against sessions
  on different machines.

A relay answers only for sessions it hosts. Anything spanning machines is
composed by the client — one relay-local wait per machine, joined, returned
marked `brokered: true`. A relay-owned wait has the relay's durability; a
brokered one lives as long as the tab that composed it. Relays hold no
connection between themselves.

## State and storage

Relays, session metadata and trajectories (`.pty` bytes, `.acp.jsonl` event
logs) are the browser's copy, kept in a folder you choose via the File System
Access API — or nowhere, in memory, which is how a first visit starts. The
relay or Continuum daemon records every session on its own host regardless.
Inside [NakliOS](https://naklios.dev) the host owns storage (Folder or Crate)
and the same file is mirrored same-origin under `naklios.dev/apps/menagerie/`;
see [naklios.md](naklios.md).

## Supervisor trees and fleets

An agent can spawn child agents (`parent_session_id`); the page shows the
tree and can kill a subtree in one step. A declarative fleet spec
(`menagerie.fleet.v1`) is validated identically in Go and in the browser and
materialised relay-side into worktrees, ports, files, commands and services
([relay-setup.md](relay-setup.md), Continuum's `workspace` commands).

## Repo layout

```
index.html     the whole browser app (no build step)
relay-go/      the reference relay — one Go binary (serve · service · token · materialise)
protocol/      protocol v1.3 — the durable artifact (protocol.md + types.ts + fixtures)
docs/          walkthrough · quickstart · relay-setup · writing-a-shim · security-model · naklios
```

## Develop locally

Serve the repository root over localhost so the relay's origin check can
identify the page, then edit `index.html`:

```sh
python3 -m http.server 8000   # open http://localhost:8000
```

Before committing:

```sh
node protocol/validate-fixtures.mjs
cd relay-go && go test -race ./... && go vet ./... && go build ./...
```

Commits run an oxlint gate over the inline scripts.

## More

[STATE.md](../STATE.md) — shipped feature lines and verification record ·
[VISION.md](../VISION.md) — roadmap · [design/v1.2-spec.md](design/v1.2-spec.md)
— supervisor-tree design · [SPEC.md](../SPEC.md), [HANDOFF-v1.0.md](../HANDOFF-v1.0.md),
[DEFERRED.md](../DEFERRED.md) — the v1.0 anchor and backlog ·
[security-model.md](security-model.md) · [writing-a-shim.md](writing-a-shim.md)
