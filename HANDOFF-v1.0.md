# Menagerie v1.0 — Agent Handoff

> Spec for the Claude Code session that builds Menagerie v1.0. Read top-to-bottom before writing code. Re-read sections in flight when relevant.

---

## 1. What you're building

A monorepo with three deliverables for v1.0:

1. **`apps/menagerie`** — single-HTML-file browser app, deployed to `menagerie.naklitechie.com`. The control console.
2. **`relay-go`** — single Go binary that runs next to coding agents on any host, exposes a WebSocket the browser connects to, manages PTYs for spawned agents.
3. **`protocol/`** — the WebSocket protocol spec (Markdown + a tiny JSON Schema or TypeScript types file). Durable artifact; relays and clients implement against this.

All three live in one repo: `github.com/NakliTechie/menagerie`.

Three agent shims must work end-to-end in v1.0: `mini`, `claude-code`, `custom`.

By the end of v1.0 Chirag must be able to:
- Open `menagerie.naklitechie.com` in a browser
- Register a relay running on his M4 Pro (token-based)
- Click `+`, pick relay, pick agent (`mini`), pick cwd, type a task, hit spawn
- See a tile appear with the agent's terminal output streaming live
- Type into the tile's input bar and have it reach the agent
- Spawn a second tile (`claude-code` on the same relay) and see both tiles update simultaneously in a 2×2 grid
- Kill one agent from the browser
- Close the browser tab, reopen later, and replay the killed agent's session from FSA-stored PTY bytes

---

## 2. Repo layout

```
menagerie/
├── README.md
├── LICENSE                          # AGPL-3.0 (consistent with Crate / NakliTechie defaults)
├── protocol/
│   ├── README.md                    # The spec, human-readable
│   ├── protocol.md                  # Detailed message reference
│   └── types.ts                     # Single source of truth for message shapes
├── apps/
│   └── menagerie/
│       ├── index.html               # Single file. CSS + JS inline. xterm.js via CDN.
│       ├── README.md
│       └── icons/                   # SVG icons; inlined into index.html at build
├── relay-go/
│   ├── README.md
│   ├── go.mod
│   ├── go.sum
│   ├── cmd/menagerie-relay/
│   │   └── main.go
│   ├── internal/
│   │   ├── protocol/                # Go port of types.ts
│   │   ├── pty/                     # PTY management
│   │   ├── shims/                   # mini.go, claude_code.go, custom.go
│   │   ├── server/                  # WebSocket server, token auth
│   │   └── config/                  # TOML config loading
│   └── examples/
│       ├── relay.toml.example
│       ├── menagerie-relay.service  # systemd unit
│       └── com.naklitechie.menagerie-relay.plist  # launchd unit
├── docs/
│   ├── quickstart.md
│   ├── relay-setup.md
│   ├── writing-a-shim.md
│   └── security-model.md
└── .github/
    └── workflows/
        ├── relay-release.yml        # cross-compile Go binary for darwin/linux x amd64/arm64
        └── app-deploy.yml           # deploy apps/menagerie to Cloudflare Pages
```

Hard rule: **monorepo for v1.0 and v1.1**. Do not split into multiple repos. If the protocol or relays grow lives of their own after v1.1, revisit then.

---

## 3. Build / deploy

### Browser app
- Single file: `apps/menagerie/index.html`
- All CSS inline in `<style>`. All JS inline in `<script>` (ES modules with `type="module"` allowed).
- xterm.js loaded from `cdnjs.cloudflare.com`, version pinned with SRI hash.
- No bundler. No npm. No build step. Edit the file, refresh the tab.
- Deploy: Cloudflare Pages, custom domain `menagerie.naklitechie.com`.
- CI: `app-deploy.yml` triggers on push to `main`, deploys `apps/menagerie/` as static assets.

### Relay (Go)
- `cd relay-go && go build ./cmd/menagerie-relay` produces a single binary.
- CI: `relay-release.yml` triggers on tag `relay-v*`, cross-compiles for `darwin/amd64`, `darwin/arm64`, `linux/amd64`, `linux/arm64`. Uploads to GitHub Releases.
- No external runtime deps. Go standard library + `github.com/creack/pty` + `github.com/coder/websocket` + `github.com/BurntSushi/toml`. Nothing else. If a library proposes itself, ask before adding.

### Versioning
- Browser app: rolling. No version pinning needed; FSA state migration handled at load time.
- Relay: semantic, tags as `relay-v0.1.0`, `relay-v0.1.1`, etc.
- Protocol: semantic, `protocol-v1.0`. Browser checks relay's protocol version in `hello`. Mismatch → user-visible warning, attempt anyway.

---

## 4. Protocol (the durable artifact)

This is the spec. It is more important than either the relay or the app. Write `protocol/protocol.md` first. Get the message shapes right. Both implementations follow.

### Transport
- WebSocket Secure (WSS) preferred; WS allowed for local relays.
- JSON text frames. No binary frames in v1.0 (PTY bytes go in base64 inside JSON; revisit in v1.1 if throughput suffers).
- One WebSocket connection per browser-relay pair. Multiple tiles on the same relay multiplex over the one connection via `session_id`.

### Auth
- **Per-session token** (you confirmed this).
- Flow: browser sends `spawn` with a relay-registry token (the "registration token"). Relay validates registration token, mints a fresh `session_token`, returns it in the `spawned` event. All subsequent messages for that session carry `session_token`.
- Registration token: set at relay install time, written to `~/.menagerie/relay.toml`, displayed once by `menagerie-relay token print`. User pastes into browser when registering a relay.
- Session token: ephemeral, lives in browser memory, expires when session ends or relay restarts.
- Tokens are opaque random strings (32 bytes, base64url-encoded). No JWT, no expiry-claims, no PKI.

### Messages

Every message is `{"type": "<name>", "session_id": "...", ...}`. `session_id` is omitted for `hello` and `register`.

**`hello`** (relay → browser, immediately on connect)
```json
{
  "type": "hello",
  "protocol_version": "1.0",
  "relay_version": "0.1.0",
  "relay_name": "m4pro-home",
  "host_os": "darwin",
  "host_arch": "arm64",
  "agents": ["mini", "claude-code", "custom"],
  "transports": ["pty"],
  "hosts_children": false
}
```

**`register`** (browser → relay, after `hello`)
```json
{
  "type": "register",
  "registration_token": "..."
}
```
Relay responds with `registered` (ack) or `auth_failed` (close connection).

**`spawn`** (browser → relay)
```json
{
  "type": "spawn",
  "agent": "mini",
  "cwd": "/Users/chirag/code/sieve",
  "args": ["--task", "fix the failing test in test_review.py"],
  "env": {},
  "client_id": "<uuid generated by browser, for correlating>"
}
```

**`spawned`** (relay → browser)
```json
{
  "type": "spawned",
  "session_id": "<server-issued>",
  "client_id": "<echo>",
  "session_token": "<opaque>",
  "agent": "mini",
  "pid": 12345,
  "started_at": "2026-05-27T10:30:00Z"
}
```

**`input`** (browser → relay)
```json
{
  "type": "input",
  "session_id": "...",
  "session_token": "...",
  "data": "y\n"
}
```
`data` is a UTF-8 string. Raw keystrokes including control chars (the browser sends them as escape sequences; xterm.js's `onData` callback gives the right bytes).

**`output`** (relay → browser, streamed)
```json
{
  "type": "output",
  "session_id": "...",
  "data": "<base64-encoded PTY bytes>",
  "seq": 42
}
```
`seq` is monotonic per session. Browser uses it for ordering and resume.

**`signal`** (browser → relay)
```json
{
  "type": "signal",
  "session_id": "...",
  "session_token": "...",
  "signal": "kill" | "interrupt" | "resize",
  "cols": 120,
  "rows": 30
}
```
`cols`/`rows` only for `resize`. `kill` = SIGKILL. `interrupt` = SIGINT.

**`event`** (relay → browser, async lifecycle)
```json
{
  "type": "event",
  "session_id": "...",
  "event": "exited" | "idle" | "needs_input" | "child_spawned",
  "exit_code": 0,
  "child_session_id": "...",
  "at": "2026-05-27T10:35:12Z"
}
```
`idle` and `needs_input` are heuristics from the shim (no output for N seconds; prompt-like pattern detected). v1.0 ships them naive; v1.1 refines.

**`resume`** (browser → relay)
```json
{
  "type": "resume",
  "session_id": "...",
  "session_token": "...",
  "last_seq": 41
}
```
Relay replies with all frames after `last_seq`. If the session is gone (relay restarted), relay returns `resume_failed` and the browser knows to fall back to FSA replay.

**`error`** (either direction)
```json
{
  "type": "error",
  "session_id": "...",
  "code": "auth_failed" | "unknown_agent" | "spawn_failed" | "invalid_token" | "...",
  "message": "human-readable"
}
```

Write `protocol/types.ts` as the canonical type definitions. Go side hand-ports them into `internal/protocol/`.

---

## 5. Relay (Go)

### Install / config
- Binary: `menagerie-relay` (single executable).
- First run: `menagerie-relay init` creates `~/.menagerie/relay.toml` with a generated registration token, prints token to stdout once.
- Subsequent runs: `menagerie-relay serve` (default command if `relay.toml` exists).
- Config (TOML):
  ```toml
  name = "m4pro-home"
  listen = "0.0.0.0:7878"      # or "127.0.0.1:7878" for local-only
  tls_cert = ""                 # optional path; if set, WSS
  tls_key = ""
  registration_token = "..."    # generated; user-readable
  allowed_origins = ["https://menagerie.naklitechie.com"]
  
  [agents.mini]
  command = "mini"              # PATH lookup
  
  [agents.claude-code]
  command = "claude"
  
  [agents.custom]
  # custom shim accepts arbitrary command in spawn.args
  ```
- `menagerie-relay token print` re-prints the registration token (for re-registering after losing it).
- `menagerie-relay token rotate` generates a new registration token, invalidates the old one.

### PTY handling
- One PTY per session. Owned for the lifetime of the session.
- `github.com/creack/pty` for cross-platform PTY allocation (works on darwin and linux; we don't ship windows in v1.0).
- Read loop per PTY: read bytes → base64 → emit `output` frame → also write raw bytes to `~/.menagerie/sessions/<session_id>.pty` (append-only, for relay-side persistence and potential agent-side replay).
- Write loop: input frames → decode → write to PTY.
- On session end: emit `exited` event with exit code. Close PTY. Keep `.pty` file on disk until garbage-collected (config option: `session_retention_days = 7`).

### Shims
Each shim is a Go file in `internal/shims/`. Interface:

```go
type Shim interface {
    Name() string
    Spawn(cwd string, args []string, env map[string]string) (*exec.Cmd, error)
    DetectIdle(buf []byte) bool       // heuristic, return true if last N seconds of output suggests idle
    DetectNeedsInput(buf []byte) bool // heuristic, return true if output ends in a prompt-shaped pattern
}
```

- `mini.go`: spawns `mini` with args; idle heuristic = no output for 30s; needs-input = last line ends in `> ` or `? ` or similar.
- `claude_code.go`: spawns `claude` with args; idle = no output for 30s; needs-input = recognizes Claude's interactive prompt pattern.
- `custom.go`: takes `args[0]` as command, `args[1:]` as command args; no idle/needs-input detection.

Each shim's detection logic should be conservative — false negatives are fine, false positives are annoying. Tune in v1.1.

### Token enforcement
- Per-session token issued in `spawned`. Stored in-memory in a map: `session_id -> session_token`.
- Every `input` / `signal` / `resume` frame must include matching `session_token`. Mismatch → `error` frame with code `invalid_token`, frame dropped.
- On relay restart: in-memory token map cleared. All existing sessions become un-controllable (but PTYs are gone too because they were child processes). Browser detects via `resume_failed` and treats sessions as terminated.

### Security defaults
- Listen on `127.0.0.1` by default. User opts in to `0.0.0.0`.
- `allowed_origins` enforced on WebSocket upgrade. Default allowlist: `https://menagerie.naklitechie.com` and `null` (for `file://` local dev).
- TLS optional but recommended; docs cover generating self-signed certs and trusting them locally.
- No CORS pre-flight needed (WebSocket); origin check is the gate.

---

## 6. Browser app (`apps/menagerie/index.html`)

### Single-file constraint
- One HTML file. CSS inline in `<style>`. JS inline in `<script type="module">`.
- External: xterm.js + xterm-addon-fit from `cdnjs.cloudflare.com` with SRI hashes. Nothing else from CDN.
- Page must work opened from `file://` for local dev (no `fetch()` to relative paths, no service worker).

### State model
All persistent state lives in FSA-mounted dirs under a user-granted directory handle (the "Menagerie workspace folder"). Layout under that folder:

```
.menagerie/
├── config.json              # app config, density, view prefs
├── relays.json              # registered relays + registration tokens
└── sessions/
    ├── <session_id>.meta.json   # agent, cwd, started, ended, relay_name
    └── <session_id>.pty         # raw PTY byte stream
```

- On first launch: prompt user to pick a folder. Persist the FSA handle in IndexedDB (`navigator.storage.persist()` requested).
- Subsequent launches: rehydrate from FSA. If handle is stale, prompt again.
- Per-tab in-memory state: open WebSocket connections, current tile layout, current view (grid only in v1.0), focused tile.

### Persistence rules
- **Allowed in FSA**: relay registry, session metadata, PTY byte streams, app config.
- **Allowed in IndexedDB**: FSA root handle, in-flight session tokens (kept across reloads of the same tab).
- **Forbidden**: relay tokens in localStorage; PTY data in localStorage; anything that leaves the browser (no analytics endpoint, no error reporting).

### UI layout (v1.0)

Single page, three regions:

1. **Top bar**: Menagerie wordmark | workspace name (one workspace in v1.0; just shows folder name) | `+` spawn button | settings gear
2. **Tile grid**: CSS grid, auto-fit, `minmax(320px, 1fr)`. Tiles flow naturally. Up to 16 tested in detail.
3. **No sidebar in v1.0**. Tree view comes in v1.1.

### Tile anatomy

```
┌─────────────────────────────────────────────────┐
│ ● mini · m4pro-home · 00:03:42 · 🗑              │
├─────────────────────────────────────────────────┤
│                                                 │
│  (xterm.js terminal, fills body)                │
│                                                 │
│  $ python -m pytest tests/                      │
│  ...                                            │
│                                                 │
├─────────────────────────────────────────────────┤
│ > [single-line input bar          ] [Send] [⏏]  │
└─────────────────────────────────────────────────┘
```

- Status dot color: green = working (recent output), yellow = idle, red = needs-input, grey = exited, X = crashed
- Header click → focus tile (border highlight)
- Header double-click → expand tile to fill viewport (modal-over-grid); ESC restores
- 🗑 sends `signal: kill`
- Input bar: ENTER sends `input` with `data` = input value + `\n`; cleared on send
- ⏏ detaches (closes the tile UI; agent keeps running on relay; tile can be re-attached from settings → active sessions)

### Spawn dialog

`+` button opens modal:
- **Relay**: dropdown of registered relays (with status: connected / disconnected)
- **Agent**: dropdown of `relay.agents`, alphabetical
- **Working directory**: text input (relay validates)
- **Task**: textarea (sent as `args` to shim — shim decides how to format)
- **Custom command** (only if agent = `custom`): text input
- **Spawn** button → send `spawn` frame

### Settings panel

Gear icon opens modal:
- **Workspace folder**: shows current FSA path, "Change folder" button
- **Relays**: list of registered relays, add/remove
  - Add: URL + registration token, browser opens WSS, receives `hello`, sends `register`, on `registered` saves to `relays.json`
  - Remove: forgets the entry (no kill; just stops connecting)
- **Active sessions**: list of currently-running sessions (across all relays); each row has re-attach button (for detached tiles)
- **Past sessions**: list of completed sessions, click → opens replay tile

### Replay mode
- Replay tile: same anatomy as live tile, but the body is xterm.js fed from the `.pty` file at a configurable speed (1x, 2x, 4x, instant).
- Scrubbing: slider at the bottom of a replay tile lets the user jump to any byte position; xterm.js re-renders from the start to that position (cheap because PTY data is small).
- No input bar on replay tiles.

### Attention surface (v1.0)
- Favicon badge with count of `needs_input` sessions
- Tab title prefix: `(N) Menagerie` where N = count of `needs_input`
- Tile header pulses (CSS animation) when `needs_input`
- No OS notifications in v1.0 (deferred to v1.1)

### Hotkeys (v1.0)
- `n` — new spawn
- `g` + digit — focus tile by index (1–9)
- `f` — full-screen current focused tile
- `ESC` — close modals / unfocus
- `Tab` / `Shift+Tab` — cycle tile focus
- `Ctrl+Enter` (inside input bar) — send

### Things the browser explicitly DOES NOT do
- Does not contact any NakliTechie domain except its own static asset host (Cloudflare Pages).
- Does not contact any LLM provider directly. Agents do that themselves through the relay.
- Does not implement any agent logic. It's a viewer + control surface.
- Does not store anything outside FSA + IndexedDB.

---

## 7. Empty + error UX

### Empty states
- **No FSA folder picked**: full-page prompt, "Pick a folder to store your Menagerie state."
- **FSA picked, no relays**: empty-state card in tile grid: "Add your first relay in Settings."
- **Relays registered, no sessions**: empty-state card: "Click + to spawn an agent."

### Error states
- **WebSocket disconnects**: tile header shows red dot + "Reconnecting…"; auto-retry with exponential backoff (1s, 2s, 4s, 8s, 30s cap). Once reconnected, browser sends `resume` for each session it had open.
- **Relay restarted (resume_failed)**: tile header shows "Session lost"; replay still available from FSA.
- **Spawn failed**: spawn dialog shows the relay's error message inline; doesn't close.
- **Auth failed during register**: registration dialog shows error; user re-enters token.
- **FSA permission revoked**: prompt to re-pick folder; in-memory state preserved until refresh.

---

## 8. Security posture

- **CSP**: strict. `default-src 'self'; script-src 'self' 'unsafe-inline' cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; connect-src 'self' wss: ws:; img-src 'self' data:;`
- **No third-party JS** beyond xterm.js (SRI-pinned).
- **WSS preferred** for non-localhost relays; docs cover trust-on-first-use for self-signed certs.
- **Token discipline**: registration tokens stored in `relays.json` (FSA, in the user's chosen folder, never elsewhere). Session tokens in-memory only, lost on tab close (resume requires re-spawn or relay restart).
- **No service worker.** Tab close = tab close.

---

## 9. Accessibility verification

Before declaring v1.0 done, verify:

- Keyboard-only operation: every action reachable without mouse (spawn, kill, send, detach, switch tiles, open settings).
- Focus indicators visible on all interactive elements (`outline` not removed; if customized, equally visible).
- Screen reader: tile status announced (status dot has `aria-label`); xterm.js's built-in screen reader mode enabled (`screenReaderMode: true`).
- Color is never the only signal: status uses dot + icon + text, not just color.
- Contrast: meets WCAG AA (4.5:1 for normal text, 3:1 for large) in both light and dark modes (if both ship in v1.0; otherwise dark-only is fine).

---

## 10. Keyboard conflicts

xterm.js captures most keystrokes when a tile is focused — that's correct, the agent needs them. Reserved app-level hotkeys must NOT be captured by xterm.js:

- `Ctrl+Shift+P` (or platform equivalent) — reserved, but unused in v1.0
- `ESC` — closes modals; xterm.js keeps it for agents (handled by checking modal state first)
- `Tab` — when tile is focused, goes to agent; when no tile focused (or in input bar), cycles tiles

Resolution: app-level hotkeys use `Ctrl+Shift+*` or `Alt+*` (xterm.js doesn't capture those by default). The single-key shortcuts (`n`, `g`, `f`) only fire when no tile-body is focused.

---

## 11. README scope

`README.md` at repo root:
- One-paragraph "what this is"
- Quickstart: install relay (curl command for releases), open menagerie.naklitechie.com, register relay, spawn agent
- Architecture diagram (copy from vision doc)
- Hard NOT-to-do list
- Link to docs/

`apps/menagerie/README.md`: dev guide for the browser app (no build step; edit and refresh).

`relay-go/README.md`: dev guide for the relay (Go build commands, where to add shims).

`protocol/README.md`: protocol overview, link to `protocol.md` and `types.ts`.

---

## 12. Portfolio integration

- Added to naklitechie.com tools page under the "agents" category (a new category — Menagerie introduces it).
- Added to NAKLITECHIE-PROJECT-STATE.md under "in-flight" → "shipped v1.0" when v1.0 lands.
- Help modal in the app links to `naklitechie.com/menagerie` for context and to `github.com/NakliTechie/menagerie` for issues.

---

## 13. Hard NOT-to-do (in code)

1. Do not add a backend service (no Node/Python/Go service hosted by NakliTechie). The relay is the user's, not ours.
2. Do not add a build step for the browser app. One file, edit-and-refresh.
3. Do not add a third-party JS library beyond xterm.js + its fit addon.
4. Do not add a database. FSA + IndexedDB + relay-local files only.
5. Do not add telemetry. No fetch to any analytics endpoint. No error reporting service.
6. Do not add per-agent special-casing in the browser. All differences live in shims on the relay.
7. Do not persist relay tokens outside FSA/Vault. Never localStorage. Never IndexedDB except encrypted via Vault if used.
8. Do not introduce a new primitive. Compose existing ones.
9. Do not add MCP support to Menagerie itself. Agents handle their own MCP.
10. Do not add a "share" feature in v1.0. Trajectories stay local.

---

## 14. Escalation protocol

Proceed autonomously on:
- Internal naming (Go package names, JS function names, CSS class names)
- Implementation choices for PTY handling, WebSocket reconnection, FSA persistence
- UI polish (specific colors within design tokens, spacing, animation curves)
- Debugging, trying alternatives, picking between equivalent libraries
- Test coverage decisions
- README phrasing

Stop and ask only on:
- Protocol changes (any addition/removal of message types or fields)
- Shim interface changes
- Storage layout changes under `.menagerie/`
- Anything that would require a v1.0 user to re-register relays or lose past sessions
- New dependencies beyond what's listed in §3
- Anything that would weaken any of the hard NOT-to-do rules
- Architectural choices that would be expensive to reverse (e.g., switching from JSON to binary frames)

---

## 15. Gate artifacts for v1.0

Before declaring v1.0 done, produce and attach to the release:

1. **Working binary**: `menagerie-relay` for darwin-arm64 (Chirag's primary), built via the release CI.
2. **Deployed app**: `menagerie.naklitechie.com` live, single-file, loads in <1s on cold cache.
3. **Smoke-test recording**: a screen recording (no audio needed) showing the v1.0 success criteria: register relay → spawn mini → spawn claude-code → input → kill → replay.
4. **Protocol doc**: `protocol/protocol.md` complete, `protocol/types.ts` matches.
5. **README**: root README complete, quickstart actually works on a fresh M-series Mac.
6. **Five working tiles simultaneously**: verify CPU and memory are acceptable (memory < 500MB total for the tab with 5 active tiles).
7. **One full reload-and-replay cycle**: kill an agent mid-run, close the tab, reopen, replay from FSA — pixels match the live session.

---

## 16. Agent face of this tool

The same WebSocket protocol the browser uses is the agent face. A supervisor agent can:
- Connect to a relay with a registration token
- Send `spawn` to start child agents
- Receive `output` and `event` frames for monitoring
- Send `input` to direct children
- Send `signal` to kill children

No special "agent SDK" in v1.0 — the protocol is the SDK. In v1.1 we may publish a tiny Python/TS client that wraps the protocol, but it's not required.

This is the property that matters: anything the browser can do, an agent can do. Menagerie is not a "human UI for agents" — it's a "protocol with two faces, one of which is a human UI."

---

## 17. What you write first

In order, the first session of work:

1. `protocol/protocol.md` and `protocol/types.ts` — full message reference. Don't skip; this is the durable artifact.
2. `relay-go` skeleton: `main.go`, `internal/server/` (just the `hello` + `register` flow, no PTY yet), `internal/config/`.
3. `apps/menagerie/index.html` skeleton: top bar, empty grid, settings modal with relay add flow. Wire it to the skeleton relay; verify register works.
4. PTY + mini shim: get one tile to spawn and stream output.
5. Input + kill: full round-trip.
6. FSA persistence: relays.json, session metadata, PTY byte capture.
7. Replay mode.
8. claude-code shim, custom shim.
9. Polish, empty/error states, hotkeys, a11y pass.
10. Release CI, docs, gate artifacts.

Don't try to ship feature-complete in one go. Build the skeleton end-to-end first, then fill in.
