# Menagerie relay protocol

> **protocol-v1.3** · **Lifecycle:** locked (2026-05-28); extended 2026-08-22, 2026-08-27.
> v1.1 added live re-attach (`sessions` / `attach` / `attached`). v1.2 added
> **structured sessions** (`transport: "acp"`) with nested ACP payloads
> (`session_update` / `permission_request` / `permission_response` / `prompt`).
> v1.3 adds **supervisor trees** (all additive, optional): `spawn`/`spawned`/
> `SessionInfo` carry `parent_session_id`; a `child_spawned` event fires to the
> parent; `signal{kill}` accepts `subtree: true` (kill descendants leaf-first);
> `hello.hosts_children` advertises support. A pre-1.3 client ignores every new
> field and sees a flat grid. All earlier messages are unchanged.

The WebSocket protocol every Menagerie relay and client implements. It is the durable artifact: the browser app is one client, a supervisor agent is another, a future native app could be a third. Anything the browser can do, an agent can do — there is no privileged client.

`types.ts` in this folder is the **canonical** definition of every message shape. This document is the human-readable reference. If the two disagree, `types.ts` wins and this document is the bug.

---

## 1. Transport

- **WebSocket.** WSS preferred; plain WS allowed for local (loopback) relays.
- **JSON text frames only** in v1.0. No binary frames. PTY bytes travel base64-encoded inside `output.data`. (Binary frames are deferred — revisit if throughput suffers; see `../DEFERRED.md`.)
- **One connection per browser↔relay pair.** Multiple agent sessions on the same relay multiplex over the single connection, distinguished by `session_id`.
- Every message is a JSON object with a `type` discriminator. `session_id` is present on all per-session messages and omitted for `hello`, `register`, and `registered`.

## 2. Connection lifecycle

```
browser                                   relay
   │  ── WebSocket connect ──────────────▶  │
   │  ◀───────────────────────── hello ───  │   (immediately on connect)
   │  ── register {registration_token} ──▶  │
   │  ◀──────────────────── registered ───  │   (or error{auth_failed} + close)
   │                                         │
   │  ── spawn {agent,cwd,args,env,…} ───▶  │
   │  ◀──────── spawned {session_id,token}─  │
   │  ◀──────────── output {seq:0} ────────  │   ┐
   │  ◀──────────── output {seq:1} ────────  │   │ streamed
   │  ── input {session_token,data} ─────▶  │   │ while the
   │  ◀──────────── output {seq:2} ────────  │   │ agent runs
   │  ◀──────────── event {needs_input} ──  │   ┘
   │  ── signal {session_token,kill} ────▶  │
   │  ◀──────────── event {exited,code} ──  │
```

**Reconnect within a live session** (transient network drop): the browser re-opens the WebSocket, receives a fresh `hello`, re-`register`s, then sends `resume {session_id, last_seq}` for each session it still holds. The relay replays every `output` frame after `last_seq`. If the session no longer exists (the relay restarted, PTYs gone), the relay replies `resume_failed` and the browser falls back to FSA-stored replay.

## 3. Auth

Two token kinds, no JWT/PKI/expiry-claims. Tokens are opaque random strings (32 bytes, base64url).

| Token | Lifetime | Where it lives | Purpose |
|---|---|---|---|
| **Registration token** | Set at relay install; rotatable | Relay: `~/.menagerie/relay.toml`. Client: FSA (`relays.json`) / Vault — never localStorage. | Authorises a client to talk to a relay at all. Sent once in `register`. |
| **Session token** | Per spawn; dies with the session or on relay restart | Client memory (IndexedDB across same-tab reloads) | Authorises control of one session. Returned in `spawned`; required on every `input`, `signal`, `resume`. |

**Enforcement:** the relay keeps an in-memory `session_id → session_token` map. Any `input`/`signal`/`resume` whose `session_token` doesn't match is answered with `error{code:"invalid_token"}` and dropped. On relay restart the map is cleared and all prior sessions become uncontrollable (their PTYs are gone too); clients learn this via `resume_failed`.

## 4. Message catalog

| `type` | Direction | Purpose |
|---|---|---|
| `hello` | relay → browser | Relay announces itself + capabilities on connect |
| `register` | browser → relay | Authenticate with the registration token |
| `registered` | relay → browser | Ack of successful registration |
| `spawn` | browser → relay | Start a new agent session |
| `spawned` | relay → browser | Session created; carries `session_token` |
| `output` | relay → browser | Streamed PTY bytes (base64), with `seq` |
| `input` | browser → relay | Keystrokes to the session PTY |
| `signal` | browser → relay | `kill` / `interrupt` / `resize` |
| `event` | relay → browser | Async lifecycle: `exited` / `idle` / `needs_input` / `child_spawned` |
| `resume` | browser → relay | Replay frames after `last_seq` |
| `resume_failed` | relay → browser | Session gone; fall back to FSA replay |
| `sessions` | relay → browser | Live session list, sent after `registered` (1.1) |
| `attach` | browser → relay | Re-attach a registered client to a live session (1.1) |
| `attached` | relay → browser | Re-attach ack + fresh `session_token` (1.1) |
| `session_update` | relay → browser | One ACP notification for a structured session, nested verbatim (1.2) |
| `permission_request` | relay → browser | ACP agent asks to proceed; carries request id + nested action (1.2) |
| `permission_response` | browser → relay | Approve / reject / approve-always (session-scoped) (1.2) |
| `prompt` | browser → relay | Prompt a structured session; structured analogue of `input` (1.2) |
| `error` | either | Typed error with `code` + human-readable `message` |

## 5. Messages

### `hello` (relay → browser)
Sent immediately on connect.
```json
{
  "type": "hello",
  "protocol_version": "1.2",
  "relay_version": "0.5.0",
  "relay_name": "m4pro-home",
  "host_os": "darwin",
  "host_arch": "arm64",
  "agents": ["claude-code", "custom", "mini", "omp"],
  "transports": ["pty", "acp"],
  "hosts_children": false,
  "agent_transports": { "omp": ["acp"], "mini": ["pty"], "claude-code": ["pty"], "custom": ["pty"] }
}
```
`host_os` ∈ {`darwin`, `linux`}; `host_arch` ∈ {`amd64`, `arm64`}; `hosts_children` is `false` through protocol 1.2 (supervisor trees deferred). `agents` may arrive in any order — clients display alphabetically.

**Transports (protocol 1.2).** `transports` lists what the relay can stream. A pre-1.2 browser ignores unknown transports and keeps offering PTY agents; a 1.2 browser talking to a pre-1.2 relay sees no `"acp"` in `transports` (or no `agent_transports` at all) and degrades to PTY-only with no error wall. `agent_transports` maps agent id → spawn forms; when absent, every listed agent spawns as `"pty"`.

### `register` (browser → relay)
```json
{ "type": "register", "registration_token": "…" }
```
Relay replies `registered` on success, or `error{code:"auth_failed"}` then closes the connection.

### `registered` (relay → browser)
```json
{ "type": "registered" }
```

### `spawn` (browser → relay)
```json
{
  "type": "spawn",
  "agent": "mini",
  "cwd": "/Users/chirag/code/sieve",
  "args": ["--task", "fix the failing test in test_review.py"],
  "env": {},
  "client_id": "5f1c…-uuid",
  "transport": "acp"
}
```
`agent` must be one of `hello.agents`. `args` is handed to the shim, which decides how to format it. `client_id` is a browser-generated UUID echoed back in `spawned` so the client can correlate the response with its pending request. **`transport` (protocol 1.2)** selects the session kind: absent ⇒ `"pty"` (stored pre-1.2 session definitions keep working); `"acp"` starts a structured session whose child speaks the pinned ACP over stdio. A relay that cannot honor the requested transport replies `error{code:"unsupported_transport"}` rather than silently downgrading.

### `spawned` (relay → browser)
```json
{
  "type": "spawned",
  "session_id": "srv-issued-id",
  "client_id": "5f1c…-uuid",
  "session_token": "opaque-32B-base64url",
  "agent": "mini",
  "pid": 12345,
  "started_at": "2026-05-28T10:30:00Z"
}
```

### `output` (relay → browser, streamed)
```json
{ "type": "output", "session_id": "…", "data": "<base64 PTY bytes>", "seq": 42 }
```
`seq` is monotonic per session. Clients order by `seq` and pass `last_seq` to `resume`. xterm.js re-renders losslessly from the decoded byte stream.

### `input` (browser → relay)
```json
{ "type": "input", "session_id": "…", "session_token": "…", "data": "y\n" }
```
`data` is a UTF-8 string of raw keystrokes including control characters (xterm.js's `onData` yields the correct bytes).

### `signal` (browser → relay)
```json
{ "type": "signal", "session_id": "…", "session_token": "…", "signal": "resize", "cols": 120, "rows": 30 }
```
`kill` = SIGKILL, `interrupt` = SIGINT, `resize` = set PTY window size. `cols`/`rows` are present only for `resize`.

### `event` (relay → browser, async)
```json
{ "type": "event", "session_id": "…", "event": "exited", "exit_code": 0, "at": "2026-05-28T10:35:12Z" }
```
`exit_code` accompanies `exited`; `child_session_id` accompanies `child_spawned`. `idle`, `needs_input`, and `rate_limited` are conservative relay-side heuristics over recent output (a confirmation/choice prompt; a provider rate-limit message) — they may flip back to running when normal output resumes. `stalled` fires once when recent output keeps repeating the same line (a likely loop); unlike the others it is *not* cleared by continued output (a loop keeps printing) — it clears when the client sends input or the session exits. Clients must tolerate unknown `event` values.

### `resume` (browser → relay)
```json
{ "type": "resume", "session_id": "…", "session_token": "…", "last_seq": 41 }
```
Relay replays every `output` after `last_seq`, or replies `resume_failed`.

### `resume_failed` (relay → browser)
```json
{ "type": "resume_failed", "session_id": "…" }
```

### Live re-attach (protocol 1.1)

A client reconnect (e.g. a browser refresh) drops the WebSocket, but the relay's sessions keep running. The relay advertises them and the client re-attaches. No session tokens are persisted across the reconnect — the **registration token** (already presented via `register`) is the authority, and the relay mints a fresh `session_token` on attach.

**`sessions`** (relay → browser) — sent immediately after `registered`:
```json
{ "type": "sessions", "sessions": [ { "session_id": "…", "agent": "mini", "started_at": "2026-05-28T10:30:00Z", "pid": 12345 } ] }
```

**`attach`** (browser → relay) — for each live session the client wants to resume:
```json
{ "type": "attach", "session_id": "…" }
```

**`attached`** (relay → browser) — re-issues a fresh `session_token`; the relay then replays the session's buffered output (as an `output` frame) and resumes live streaming:
```json
{ "type": "attached", "session_id": "…", "session_token": "…", "agent": "mini", "started_at": "2026-05-28T10:30:00Z", "pid": 12345 }
```
If the session is gone (relay restarted), the relay replies `resume_failed` and the client falls back to FSA replay.

### Structured sessions (protocol 1.2)

A session spawned with `transport:"acp"` streams **Menagerie frames whose ACP
payloads ride nested and uninterpreted**. The relay bridges JSON-RPC over the
agent's stdio; it never flattens ACP shapes into Menagerie fields, so the ACP pin
(see [`acp-pin.md`](./acp-pin.md)) can move without another protocol bump. ACP
message shapes are generated into [`acp-types.ts`](./acp-types.ts).

**`session_update`** (relay → browser) — wraps ONE ACP agent→client message verbatim:
```json
{ "type": "session_update", "session_id": "…", "seq": 17, "acp": { "jsonrpc": "2.0", "method": "session/update", "params": { … } } }
```
`seq` is monotonic per structured session, independent of PTY `output.seq`; clients order by it and the relay may use it to mark backpressure drops. Frames replayed on re-attach carry **`seq: -1`** (the same convention as PTY `output`): render them, but never persist them — the event log already holds them under their original sequence.

**`permission_request`** (relay → browser) — the agent asked to proceed (an ACP `session/request_permission`):
```json
{ "type": "permission_request", "session_id": "…", "request_id": "pr-9f2…", "seq": 18, "acp": { … options, tool call, diffs … } }
```
`request_id` is relay-correlated. While one is pending, the session's status pill reads *needs-input*; reviewing happens on drill-in.

**`permission_response`** (browser → relay):
```json
{ "type": "permission_response", "session_id": "…", "session_token": "…", "request_id": "pr-9f2…", "outcome": "approve" }
```
`outcome` ∈ `approve` | `reject` | `approve_always`. The relay maps an outcome onto the ACP option kinds when `option_id` is absent; a present `option_id` wins. **Approve-always is session-scoped only in protocol 1.2 — never persisted across sessions.** A persisted blanket grant to an agent that can write files needs its own design pass first.

**`prompt`** (browser → relay) — the structured analogue of v1.0's `input`; **`input` stays PTY-only**:
```json
{ "type": "prompt", "session_id": "…", "session_token": "…", "text": "fix the failing test in test_review.py" }
```
The relay maps `text` to ACP content blocks. Prompt completion surfaces as `event{idle}`; a pending permission request reads as `needs_input`; agent death as `exited`. Cancellation uses ACP's cancel via `signal{interrupt}`; `kill` remains the hard stop.

### `error` (either direction)
```json
{ "type": "error", "session_id": "…", "code": "invalid_token", "message": "…" }
```
`session_id` is present when the error pertains to a session.

## 6. Sequencing & resume

- `seq` is per-session and monotonic. There is exactly one `output` stream per session.
- The browser persists the highest `seq` it has rendered. On reconnect it sends `resume {last_seq}`; the relay re-emits everything after it. Frames are idempotent to re-render given `seq`, so a small overlap is harmless.
- Relay-side, every session's raw PTY bytes are also appended to `~/.menagerie/sessions/<session_id>.pty`, so replay survives relay restarts independently of the browser's FSA copy.

## 7. Error codes

| `code` | Meaning |
|---|---|
| `auth_failed` | Registration token rejected. Relay closes the connection. |
| `unknown_agent` | `spawn.agent` is not in `hello.agents`. |
| `spawn_failed` | Relay could not start the agent (bad `cwd`, exec error, …). |
| `invalid_token` | `input`/`signal`/`resume`/`prompt`/`permission_response` carried a missing or wrong `session_token`. Frame dropped. |
| `unsupported_transport` | (1.2) `spawn.transport` names a transport this relay cannot honor. |
| `unknown_request` | (1.2) `permission_response.request_id` matches no pending permission request. |

The set is **open-ended** — clients MUST tolerate unknown codes and surface `message` to the user.

## 8. Versioning & compatibility

- Protocol versions are semantic: `protocol-v<major>.<minor>`. This is `1.2`.
  - **1.1** added `sessions` / `attach` / `attached` (additive; same major).
  - **1.2** added structured sessions: `hello.agent_transports`, `spawn.transport`, and the `session_update` / `permission_request` / `permission_response` / `prompt` frames (additive; ACP payloads nested, never flattened).
- The browser reads `hello.protocol_version`. On mismatch it shows a user-visible warning and attempts the connection anyway (best-effort).
- Adding a new optional field or a new `error` code is a **minor** bump. Removing/renaming a field or message type, or changing a field's meaning, is a **major** bump.

## 9. The agent face

The same protocol is the agent SDK. A supervisor agent connects with a registration token, sends `spawn` to start children, reads `output`/`event` to monitor them, sends `input` to direct them, and `signal` to kill them. No separate agent SDK ships in v1.0 — the protocol is the SDK. (A thin Python/TS wrapper may follow in v1.1; see `../DEFERRED.md`.)

---

## Resolution notes (locked 2026-05-28)

These five points were under-specified in handoff §4 and resolved as below during P1 review. Recorded so future readers know why the shapes are what they are:

1. **Auth failure shape.** Modeled as `error{code:"auth_failed"}` + connection close, reusing the error catalog, rather than a dedicated `auth_failed` message type. (Handoff §4 names both an "`auth_failed`" register response *and* an `auth_failed` error code; this collapses them.)
2. **`registered` is field-less.** No fields were specified. It could echo `relay_name` for symmetry with `hello` if useful.
3. **`resume_failed` carries `session_id`** so the client can correlate it to the right tile. (Handoff named the message but not its fields.)
4. **`output.seq` start value** is relay-defined; the browser relies only on monotonicity. (Examples use `42`; `0` is assumed as the first frame but not mandated.)
5. **Error catalog** includes only the four handoff-named codes; the type stays open (`string`) per §4's trailing "…". Candidates not yet added: `unknown_session`, `bad_message`.
