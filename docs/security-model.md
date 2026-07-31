# Security model

Menagerie's threat model is shaped by what it is: a browser tab that can spawn
and drive processes on machines you own. The relay can run arbitrary agents on
its host, so the bar is "only the people you've authorized, only from the app
you trust." There is no NakliTechie server in the loop to lean on — every gate
is between your browser and your relay.

This document describes the posture, the two authentication gates, and the
deliberate decisions behind them. Where it matters, it cites the code.

## Trust boundaries

```
┌────────────────────────────┐         ┌──────────────────────────────┐
│ Browser tab                │  WS/WSS │ Relay (your host)            │
│ - app from a static host   │ ──────▶ │ - origin gate                │
│ - relay tokens in FSA      │         │ - registration-token gate    │
│ - session tokens in memory │         │ - spawns agents under a PTY  │
└────────────────────────────┘         └──────────────────────────────┘
```

The relay is the asset under guard: anyone who can both reach its socket *and*
present a valid registration token can spawn processes on its host. So the relay
enforces two independent gates on every connection, and the browser is
disciplined about where secrets live.

## The two gates

A client must pass **both** to control anything.

### Gate 1 — WebSocket Origin allowlist

On the WebSocket upgrade the relay checks the browser's `Origin` header against
the `allowed_origins` allowlist (exact string match) and rejects anything not on
it with `403`. From [`server.go`](../relay-go/internal/server/server.go):

```go
origin := r.Header.Get("Origin")
if origin != "" && !s.cfg.OriginAllowed(origin) {
    http.Error(w, "origin not allowed", http.StatusForbidden)
    return
}
```

This is what stops a random web page you happen to have open from opening a
WebSocket to your localhost relay and driving your agents (a cross-site
WebSocket hijacking, or CSWSH, attack). Browsers set `Origin` honestly and a
page cannot forge it, so an allowlist of origins you trust is the gate.

A request with **no** `Origin` header is a non-browser client (the protocol's
"agent face" — a supervisor agent driving the relay directly). Those are allowed
past the origin gate and still must pass Gate 2.

The default allowlist is exactly `["https://menagerie.naklitechie.com"]` — the
hosted app and nothing else.

**Localhost convenience (loopback relays only).** When the relay is bound to a
loopback address (`127.0.0.1`, `::1`, or `localhost` — the default), it also
accepts `http(s)://localhost`, `http(s)://127.0.0.1`, and `http(s)://[::1]`
origins on any port, so a local dev or preview server connects without editing
the allowlist. This does **not** weaken the gate against the web: a page's
`Origin` is its own `scheme://host:port` and cannot be forged, so only a page
*actually served from loopback* matches — `https://evil.example` (or even
`http://localhost.evil.com`) never does, and DNS-rebinding doesn't change a
page's origin. A relay you expose on `0.0.0.0` gets **no** such convenience — it
must list its origins explicitly. Opt out entirely with
`allow_localhost_origins = false`.

### Gate 2 — registration + session tokens

Two opaque random tokens (32 bytes, base64url — no JWT, no PKI, no expiry
claims), both compared in **constant time** to avoid timing side channels.

| Token | Lifetime | Where it lives | Checked on |
|---|---|---|---|
| **Registration token** | Set at `init`; rotatable | Relay: `relay.toml`. Client: FSA `relays.json`. | Every `register` |
| **Session token** | Per spawn; dies with the session or on relay restart | Client memory only | Every `input` / `signal` / `resume` |

**Registration** — the client sends the registration token; the relay compares
it constant-time and either acks `registered` or returns `error{auth_failed}`
and closes the connection
([`server.go`](../relay-go/internal/server/server.go)):

```go
want := cn.srv.cfg.RegistrationToken
if want == "" || subtle.ConstantTimeCompare([]byte(msg.RegistrationToken), []byte(want)) != 1 {
    cn.sendError("", protocol.ErrAuthFailed, "registration token rejected")
    _ = cn.ws.Close(websocket.StatusPolicyViolation, "auth_failed")
    return
}
```

**Per-session** — on a successful `spawn` the relay mints a fresh session token,
returns it in `spawned`, and stores it in an in-memory `session_id →
session_token` map. Every later `input`, `signal`, or `resume` must carry the
matching token; the lookup is constant-time and a mismatch yields
`error{invalid_token}` with the frame dropped:

```go
func (s *Server) getSession(id, token string) (*pty.Session, bool) {
    e, ok := s.sessions[id]
    if !ok {
        return nil, false
    }
    if subtle.ConstantTimeCompare([]byte(e.token), []byte(token)) != 1 {
        return nil, false
    }
    return e.sess, true
}
```

The per-session token limits blast radius: holding it lets you control *that*
session, not register new ones. On relay restart the map is cleared (and the
PTYs are gone), so all prior session tokens become useless — clients learn this
via `resume_failed`.

## Why the default `listen` is `127.0.0.1`

A fresh `menagerie-relay init` binds `127.0.0.1:7878` — reachable only from the
same machine. The safest default is local-only; nothing is exposed to the
network until you opt in by editing `listen` to `0.0.0.0:PORT` (and, you should,
turning on TLS). This means the common case — agents and browser on one laptop —
has no network attack surface at all.

## Where secrets live (and don't)

The browser is strict about token storage. From the app
([`index.html`](../index.html)):

- **Registration tokens** are persisted only in `relays.json` inside the
  **workspace folder you grant via the File System Access API** — a directory
  you own, never anywhere else.
- **Session tokens** live in the in-memory `sessions` map for the life of the
  tab and are not persisted at all in v1.0.
- **The FSA directory handle** (not a token) is kept in IndexedDB so the app can
  re-request access to your folder on the next launch.
- **Never `localStorage`.** No token — registration or session — touches
  `localStorage`, and nothing is sent to any analytics or error-reporting
  endpoint. (Handoff §13 #5, #7.)

The relay side keeps `relay.toml` — which holds the registration token — at
`0600`, in a `0700` directory.

## Content Security Policy

The app ships a strict CSP as a `<meta http-equiv>` tag
([`index.html`](../index.html)):

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com;
style-src 'self' 'unsafe-inline';
connect-src 'self' wss: ws:;
img-src 'self' data:;
object-src 'none';
base-uri 'none';
frame-ancestors 'none'
```

Notes:

- **`script-src`** allows the app's own inline script plus exactly one external
  origin, `cdnjs.cloudflare.com`, which serves xterm.js — pinned by **SRI hash**
  so a tampered CDN response is rejected. No other third-party JS loads.
- **`style-src 'self' 'unsafe-inline'`** — xterm.js's CSS is inlined into the
  page so styles don't need a third-party origin.
- **`connect-src 'self' wss: ws:`** lets the app open WebSockets to relays
  (including plain `ws:` for loopback relays) while blocking other network
  destinations.
- **`object-src`, `base-uri`, `frame-ancestors`** are locked to `'none'`:
  no plugins, no `<base>` hijacking, no embedding the app in a frame.

There is **no service worker** — closing the tab ends the session; nothing runs
in the background.

## Transport: TLS for non-localhost

For a loopback relay, plain WS is fine — the bytes never leave the machine. The
moment you set `listen` to a non-loopback address you should also set
`tls_cert`/`tls_key` so the relay serves WSS. A registration token sent over
plain WS across an untrusted network is exposed in transit. See
[relay-setup.md](./relay-setup.md#tls) for generating and trusting a
certificate.

## Honest limitations

- **The relay is a process you install.** Menagerie has no NakliTechie server,
  but the relay is still *a* process that, once authorized, runs agents on its
  host. We name this honestly rather than claiming "zero processes."
- **A valid registration token is full authority to spawn.** There are no
  per-agent or per-directory scopes in v1.0 — anyone holding the token (and
  passing the origin gate) can spawn any configured agent in any directory. Keep
  the token secret; rotate it with `menagerie-relay token rotate` if it leaks.
- **`custom` runs arbitrary commands by design.** The `custom` shim executes
  whatever command the client supplies. That's the intended power of the relay;
  it is also why the gates above matter.

## A deliberate decision: `"null"` is not a default origin

This one is worth spelling out because the obvious-looking choice is wrong.

It is tempting to default-allow the `"null"` origin so the app works when opened
straight from a `file://` path during development. **We deliberately do not.**

Browsers send `Origin: null` not only for `file://` pages but for **any
sandboxed iframe** — and any website can embed a sandboxed iframe. If `"null"`
were in the default `allowed_origins`, any page on the internet could host a
sandboxed iframe, open a WebSocket to your localhost relay, pass the origin gate,
and then only need the registration token to drive your agents. Allowing `"null"`
by default would silently widen the origin gate from "the app I trust" to
"anyone," which is exactly the CSWSH weakening Gate 1 exists to prevent.

So the default allowlist is just `["https://menagerie.naklitechie.com"]`. The
code documents the choice at the point of definition
([`config.go`](../relay-go/internal/config/config.go)):

```go
// Origin is the gate. We deliberately do NOT default-allow "null":
// browsers send Origin: null not only for file:// pages but for any
// sandboxed iframe, so allowing it would let any website pass the gate.
// Add "null" (or a "http://localhost:PORT" dev origin) by hand only when
// doing local file:// development.
AllowedOrigins: []string{"https://menagerie.naklitechie.com"},
```

If you genuinely need `file://` development, add `"null"` to `allowed_origins`
**by hand**, keep it short-lived, and remove it when you're done. For a local
static server, prefer adding the concrete origin (e.g. `http://localhost:8000`)
instead — it's narrow and doesn't carry the sandboxed-iframe problem.

> This was a P7 security-sweep finding: `init` originally seeded `"null"` into
> the default allowlist, and the sweep removed it. See the git history —
> `fix(menagerie): P7 security — drop "null" from default origin allowlist`.

## A known gap: live reconnect-`resume`

The protocol defines a `resume` message for re-attaching to a still-running
session after a transient disconnect, but **relay-side live resume is not
implemented in v1.0** — the relay answers `resume` with `resume_failed`. On a
tab reload or dropped connection the browser therefore replays the recorded
trajectory from your workspace folder (FSA) rather than re-attaching to the live
stream. This is a deliberate deferral (it needs a pub/sub refactor of the
relay's output path), not a security hole; see [`../DEFERRED.md`](../DEFERRED.md)
for the rationale and the trigger to build it. The security-relevant consequence
is mild: a session whose tab closed cannot be re-driven, which fails safe.
