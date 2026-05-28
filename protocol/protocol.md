# Menagerie relay protocol

> **protocol-v1.1** · **Lifecycle:** locked (2026-05-28). v1.1 adds live re-attach (`sessions` / `attach` / `attached`); all v1.0 messages are unchanged.

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
| `error` | either | Typed error with `code` + human-readable `message` |

## 5. Messages

### `hello` (relay → browser)
Sent immediately on connect.
```json
{
  "type": "hello",
  "protocol_version": "1.0",
  "relay_version": "0.1.0",
  "relay_name": "m4pro-home",
  "host_os": "darwin",
  "host_arch": "arm64",
  "agents": ["claude-code", "custom", "mini"],
  "transports": ["pty"],
  "hosts_children": false
}
```
`host_os` ∈ {`darwin`, `linux`}; `host_arch` ∈ {`amd64`, `arm64`}; `transports` is `["pty"]` in v1.0; `hosts_children` is `false` in v1.0 (supervisor trees are v1.1). `agents` may arrive in any order — clients display alphabetically.

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
  "client_id": "5f1c…-uuid"
}
```
`agent` must be one of `hello.agents`. `args` is handed to the shim, which decides how to format it. `client_id` is a browser-generated UUID echoed back in `spawned` so the client can correlate the response with its pending request.

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
`exit_code` accompanies `exited`; `child_session_id` accompanies `child_spawned`. `idle` and `needs_input` are shim heuristics (no output for N seconds; prompt-shaped trailing output) — naive in v1.0, refined in v1.1.

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
| `invalid_token` | `input`/`signal`/`resume` carried a missing or wrong `session_token`. Frame dropped. |

The set is **open-ended** — clients MUST tolerate unknown codes and surface `message` to the user.

## 8. Versioning & compatibility

- Protocol versions are semantic: `protocol-v<major>.<minor>`. This is `1.1` — v1.1 added `sessions` / `attach` / `attached` (additive; same major, so v1.0 clients still interoperate for spawn/stream/kill).
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
