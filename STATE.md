# STATE — v1.1 build ("Structured transport")

Working state for the v1.1 build cycle defined in `~/Downloads/MENAGERIE-v1.1-AGENT-HANDOFF.md`.
Per handoff §C0: where the doc contradicts the repo, **the repo wins** — divergences are
recorded here and the build continues against reality.

## Chunk status

| Chunk | Status |
|---|---|
| C0 reconcile + pin | **complete** (2026-08-22) |
| C1 protocol 1.2 | **complete** (2026-08-22) |
| C2 relay acp kind | in progress |
| C3 structured tiles | not started (gated on §7 UX reference) |
| C4 drill-in + diffs | not started (gated on §7 UX reference) |
| C5 structured replay | not started |
| C6 close-out | not started |

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
