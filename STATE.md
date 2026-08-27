# STATE — v1.1 build ("Structured transport")

Working state for the v1.1 build cycle defined in `~/Downloads/MENAGERIE-v1.1-AGENT-HANDOFF.md`.
Per handoff §C0: where the doc contradicts the repo, **the repo wins** — divergences are
recorded here and the build continues against reality.

## Chunk status

| Chunk | Status |
|---|---|
| C0 reconcile + pin | **complete** (2026-08-22) |
| C1 protocol 1.2 | **complete** (2026-08-22) |
| C2 relay acp kind | **complete** (2026-08-22) |
| §7 UX reference gate | **complete** ([docs/design/v1.1-ux-reference.md](docs/design/v1.1-ux-reference.md)) |
| C3 structured tiles | **complete** — verified in browser, critique filed (0 blockers) |
| C4 drill-in + diffs | **complete** — approve/reject cycles verified; grid round-trip asserted; see env-note below |
| C5 structured replay | **complete** — `byteIdentical: true` asserted across a live reload+attach cycle |
| C6 close-out | **complete with one honest gap** (2026-08-22): roadmap amendment ✓ · role matrix re-run ✓ · README/version bump ✓ · cleanup ✓. **Gap:** the handoff's `/forward-pass` fresh-context audits after C2 and C5 were NOT run as separate fresh-context passes — the subagent/oracle budget ran out mid-session; verification instead happened continuously per-chunk with machine-checked evidence at every checkpoint. A fresh-context forward-pass over `v1.1-structured-transport` is the recommended next action before merge.

## Push/merge policy (standing authorization, 2026-08-27)

Chirag authorized **automated push + merge to `main`** for this repo. The agent
may commit, merge feature branches into `main`, and push to origin autonomously
once local gates pass (`go test -race ./...`, the oxlint pre-commit gate, and
browser verification of any observable change). No hold-for-owner on push/merge.
The genuine stop-lines still apply: destructive history rewrites, secrets/creds,
and anything outward-facing beyond pushing this repo.

### Owner actions remaining

- Portfolio/profile entries (outside this repo).
- To exercise the real-omp permission leg once the provider 400 is resolved:
  `[agents.omp] acp_args = ["acp", "--approval-mode", "always-ask"]` in relay.toml,
  then spawn omp from the app and prompt it to write a file.

### Browser verification evidence (C3/C4/C5)

All driven through the real UI against the real relay (`go build` binary + fake
agent + omp), Playwright/Chromium:

- hello advertises `transports ["pty","acp"]` + per-agent `agent_transports`; the
  spawn dialog marks ACP-capable agents and defaults them to structured sessions.
- Mixed grid: PTY xterm tile + structured stream tiles simultaneously.
- Tile prompt → `prompt` frame → streamed `agent_message_chunk` rendered in-tile;
  status pill flips to idle on turn end.
- Drill-in: grid DOM untouched (order + scroll preserved, **asserted not
  eyeballed**); Esc-with-pending-composer-text flashes instead of closing (the
  named bug, prevented); Esc-empty returns to grid.
- Diff review: pending card with path, hunk header, add/del washes, per-hunk
  ✓/✕, explicit Approve/Reject sending `permission_response {outcome,
  option_id}` over the live WebSocket (captured frames verified for both
  outcomes); reject clears state back to running.
- Raw event-log pane toggled by `{}` / `d`.
- Replay: Past-sessions dispatch on `meta.capture: "acp-jsonl"`; replay streams
  through the SAME ingest/render path; after a live run + full page reload +
  attach, the event log holds exactly the live frames and
  `serializeStream(live) === serializeStream(replay)` (**byteIdentical: true**).
- Screenshots + rubric critique filed under `docs/design/` (0 blocker findings).

### Known environment note (C4, honest)

The final leg of the real-`omp` permission cycle — omp *raising* the permission
during this session's E2E — could not be exercised because Chirag's local
omp/provider config rejects large `max_tokens` (`400 … exceeds maximum 16384`),
and omp auto-approves writes under its default mode. The permission round trip
itself is proven at three other levels: relay↔agent Go test (fake agent),
browser UI decision frames captured over the live WebSocket, and real-omp
streaming (init/session/prompt/updates/idle) through the full stack. To exercise
the last leg later: set `acp_args = ["acp", "--approval-mode", "always-ask"]` on
the omp agent in `relay.toml` once the model config permits full turns.

### C0 evidence

- `protocol/acp-types.ts` generated from the pinned schema; regen byte-identical
  (verified twice); compiles clean under `tsc --strict --noEmit`.
- `protocol/fixtures/acp-smoke.jsonl`: full round trip against real `omp acp`
  (omp 18.0.0): initialize → `protocolVersion:1` → session/new (no authenticate
  needed; existing `~/.omp` creds) → prompt → streamed `agent_message_chunk`
  (`SMOKE-OK`) → `{stopReason:"end_turn"}`. 11 JSON-RPC lines, both directions,
  valid JSONL.
- `protocol/acp-pin.md` records commit `b7f0005493b98de32fabee3e9540e2b64da68535`,
  schema/v1.

## Post-C6: instrument bar (2026-08-27)

The drill-in's instrument bar (design §2 — context gauge · model · thinking ·
mode · token counters · status) was thin: the render read `usage.totalTokens`,
a field ACP never sends, and model/mode/thinking were never plumbed at all.
Grounded in the real omp handshake fixture (`protocol/fixtures/acp-smoke.jsonl`):
model / mode / thought_level ship in the **session/new result**, and per-turn
usage ships in the **prompt result** — both responses the browser never sees
(the relay forwards only notifications).

Fix (relay + browser, additive, protocol 1.2 unchanged):
- Relay captures `configOptions` from the session/new result
  ([relay-go/internal/acp/session.go](relay-go/internal/acp/session.go)) and
  re-surfaces it to the browser as a synthetic `config_option_update`
  session/update on spawn; per-turn `usage` from the prompt result is
  re-surfaced as a `_menagerie/turn_usage` update on turn end
  ([relay-go/internal/server/server.go](relay-go/internal/server/server.go)).
  Both ride the existing `deliverStructured` funnel (seq'd, tailed, persisted,
  replayed), and the latest of each is kept on the sessionEntry and re-emitted
  on re-attach (seq -1) so a long session restores them after they scroll out
  of the 256-frame tail ring.
- Browser derives model/mode/thinking (label-resolved) + context-window gauge
  (`used/size`, colored ≥80% yellow / ≥95% red) + turn token counters, each
  collapsing when absent (never fabricated). `current_mode_update` now reads the
  spec field `currentModeId` (was reading a non-existent `current_mode`).

Verification:
- Relay: `go build ./... && go test -race ./...` — all pass (4.6s); new
  `TestACPInstrumentFrames` asserts the config + turn_usage frames cross the
  wire with correct selectors and token totals.
- Browser (served, real render): drill-in bar shows
  `ctx ▮ 62% · 124k/200k · model Claude Opus 4 · think Medium · mode Default ·
  tokens 21k (in 21k · out 412) · status` (DOM-read, not eyeballed); a bare
  session collapses to `status idle` only.
- Replay parity: `serializeStream` excludes config/usage (state fields, not
  stream items) — C5's byte-identical invariant is structurally untouched
  (observed: `serIncludesConfig: false`).

- **D10 — config selectors re-surfaced as `config_option_update`.** The array is
  the agent's own `configOptions` verbatim; only the delivery channel changes
  (response → notification). Real ACP update kind, shape-accurate.
- **D11 — turn usage rides `_menagerie/turn_usage`.** ACP has no notification for
  per-turn token counts; the `_`-prefix reserves it for menagerie per the ACP
  extension rule. Distinct from ACP's context-window `usage_update` ({used,size}),
  which still drives the gauge when an agent sends it.

## Doc ↔ repo divergences (found at C0, 2026-08-22)

1. **Protocol version collision — load-bearing.** Handoff C1 says "Protocol version
   bumps to `1.1`", but the repo is **already at protocol 1.1**: post-v1.0 work shipped
   live re-attach (`sessions`/`attach`/`attached`) and set `PROTOCOL_VERSION = "1.1"` in
   both [`protocol/types.ts`](protocol/types.ts) and
   [`relay-go/internal/protocol/messages.go`](relay-go/internal/protocol/messages.go).
   → **This build's protocol work bumps to `1.2`**, additive per §8 rules. All handoff
   references to "v1.1 frames/version" read as "the next minor".

2. **App path.** Handoff says the browser app lives at `apps/menagerie/index.html`.
   It lives at repo-root [`index.html`](index.html) (single file, ~1200 lines);
   `apps/` exists but is empty. All C3–C5 edits target root `index.html`.

3. **Relay ≠ the v1.0 baseline the handoff assumes.** Relay is v0.4.0 and carries:
   tmux-backed sessions (spawn may wrap an agent in a detached tmux session so it
   survives relay restarts, incl. foreign-tmux adoption), stall/loop detection
   (`stalled` event), and `resume` demoted to a graceful stub in favor of
   `sessions`+`attach`. Consequence for C2: **ACP sessions must bypass tmux wrapping**
   — JSON-RPC framing over a PTY/tmux attach gets mangled (line-discipline \n→\r\n,
   echo). ACP children spawn as plain stdio pipes.

4. **Session-kind seam is wider than "a strategy behind the existing session interface".**
   `shims.Shim` is PTY-shaped end to end (`Spawn` → `*exec.Cmd`, heuristics over raw
   byte buffers); [`sessionEntry`](relay-go/internal/server/server.go) holds a single
   `*pty.Session`. The `acp` kind cannot be a shim — C2 introduces a second session
   strategy beside the PTY one, and `sessionEntry` learns to hold either. The WebSocket
   layer, token flow, and multiplexing stay untouched (handoff holds).

5. **Status-pill vocabulary mapping (for C2/C3).** Handoff wants ACP lifecycles mapped
   onto existing states: idle, working, needs-input, done, errored. Existing vocabulary
   is events `exited/idle/needs_input/child_spawned/rate_limited/stalled` over tile
   states running · needs-input · rate-limited · idle (+ exited). Map onto these; add
   nothing new unless a state truly has no home.

6. **Cosmetic drift inside the repo** (fix opportunistically during C1): `types.ts`
   header comment still reads "protocol-v1.0" while the constant is `"1.1"`;
   `protocol.md`'s `hello` example still shows `"protocol_version": "1.0"`;
   `hosts_children` comment says "supervisor trees are v1.1" — they are now v1.2.
   → Fixed in C1.

7. **No protocol fixture set existed** despite C1's checkpoint referencing "the v1.0
   fixture set". Created fresh under `protocol/fixtures/frames/`: baseline v1.0/v1.1
   frames + one fixture per new 1.2 frame, validated by
   [`protocol/validate-fixtures.mjs`](protocol/validate-fixtures.mjs) (20 fixtures,
   19/19 types covered).

## Environment facts (C0)

- `omp` 18.0.0 at `~/.local/bin/omp`; `omp acp` subcommand present ("Run Oh My Pi as an
  ACP (Agent Client Protocol) server over stdio"). Park wall not triggered.
- Go module deps unchanged from v1.0 set (coder/websocket, BurntSushi/toml, creack/pty)
  — verified against go.mod during C0.

### C2 evidence

- `relay-go/internal/acp`: stdio JSON-RPC child (one process/session, owner read
  goroutine, mutex'd writer), initialize+session/new handshake, prompt/cancel,
  permission correlation (`pr-N` ↔ ACP rpc id, outcome→option-kind resolution).
- Event log: every frame both directions appended to
  `~/.menagerie/sessions/<id>.acp.jsonl` BEFORE interpretation.
- Bounded outbox (384) per structured session; drops counted + `frames_dropped`
  error-frame marker; re-attach replays a 256-frame tail through the same queue.
- Config: agents gain `transports` / `acp_args` (TOML); default config ships an
  `omp` entry — configuration only, no code path branches on the name.
- Tests: 5 unit tests against a fake agent binary
  (`internal/server/testdata/fakeagent`) — hello transports, spawn→stream→prompt
  →idle, permission round trip, cancel-then-kill, transport guards. Integration
  test vs real `omp acp` behind `-tags acpintegration` — **passes** (3.7s round
  trip). Unit runs never require omp.

## Decisions log (this build)

- **D1 — protocol bumps to 1.2, not 1.1.** 1.1 was consumed by the re-attach release
  (divergence #1). All handoff "v1.1 frame" references land as protocol 1.2, additive.
- **D2 — ACP pin = schema v1 @ `b7f0005…`.** omp 18.0.0 negotiates
  `protocolVersion: 1`; upstream also ships v2, unconsumed. See `protocol/acp-pin.md`.
- **D3 — smoke fixture is pure JSON-RPC lines** (both directions interleaved, no
  wrapper objects) so C2's fake agent can replay it verbatim; direction and roles are
  recoverable from shape (client requests carry method+id).
- **D4 — per-agent transport tagging rides a new optional `hello` field**
  (`agent_transports`), not a reshaped `agents` array. Reshaping `agents` to objects
  would break v1.0 browsers that render the strings; §8 rules make an added optional
  field a minor bump. New browser: use map when present, default `pty` when absent.
- **D5 — structured frames carry their own monotonic `seq`.** Handoff doesn't name one,
  but C2's drop-with-marker backpressure and C5's replay need per-session ordering
  independent of PTY `output.seq`.
- **D6 — prompt turn lifecycle maps onto existing events.** Prompt completion →
  `event{idle}`; permission pending → `needs_input`; process death → `exited`. No new
  event vocabulary (divergence #5); `errored` surfaces via `error` frames.
- **D7 — the `acp` field carries the FULL JSON-RPC envelope verbatim** (request or
  notification, incl. `jsonrpc`/`method`/`id`), not just params — "wraps one ACP
  message" taken literally; matches protocol.md examples and fixtures.
- **D8 — all structured-session lifecycle events ride the bounded outbox** (not the
  direct PTY-style send) so an event can never overtake the frames that caused it.
- **D9 — ACP children never get tmux-wrapped** (divergence #3 operationalized): a PTY
  line discipline mangles JSON-RPC framing; tmux mode applies to `pty` spawns only.
