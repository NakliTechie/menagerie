# Relay setup

The relay (`menagerie-relay`) is a single Go binary that runs next to your
coding agents. It exposes one WebSocket endpoint, manages a PTY per spawned
agent, and streams output to whatever client connects — the browser app or a
supervisor agent. It is **your** process, not a NakliTechie service: it never
phones home.

This document covers installing, running, configuring, and exposing the relay.
For the fastest happy path see [quickstart.md](./quickstart.md).

## Build

```sh
cd relay-go
go build ./cmd/menagerie-relay   # → ./menagerie-relay
go test ./...
go vet ./...
```

No runtime dependencies beyond the Go module set
(`coder/websocket`, `BurntSushi/toml`, `creack/pty`). Pre-built binaries for
`darwin/{amd64,arm64}` and `linux/{amd64,arm64}` ship on GitHub Releases once
the relay is tagged `relay-v*`.

## Commands

```
menagerie-relay serve             start the relay. First run creates the config and
                                  copies the registration token to your clipboard.
menagerie-relay service install   run the relay always-on (launchd / systemd --user)
menagerie-relay service uninstall remove the always-on service
menagerie-relay service status    is the always-on service running?
menagerie-relay init              write the config + token only (no serve)
menagerie-relay token print       re-print (and copy) the registration token
menagerie-relay token rotate      generate a new registration token (invalidates the old)
```

Running `menagerie-relay` with no arguments is equivalent to `serve`. For most
people, `serve` is the only command they ever type.

### `serve`

Starts the WebSocket server on `listen`. **On first run it creates
`~/.menagerie/relay.toml`** (dir `0700`, file `0600` — it holds a secret) with a
fresh registration token and the v1.0 shim set (`mini`, `claude-code`, `custom`),
so a single command gets a new machine going. When run in a terminal it also
**copies the registration token to your clipboard** and prints it; when run
non-interactively (e.g. as a service) it stays quiet, keeping the token out of
log files. It logs the relay name, listen address, TLS state, and origins:

```
relay "m4pro-home" listening on 127.0.0.1:7878 (tls=false, origins=[https://menagerie.naklitechie.com])
```

`serve` shuts down cleanly on `SIGINT`/`SIGTERM`.

### `init`

Optional — `serve` now does this on first run. `init` just writes the config +
token (no serving), for when you want to review/edit `relay.toml` before starting.
It refuses to overwrite an existing config; use `token rotate` to change the token.

### `service install` / `uninstall` / `status`

Keep the relay always-on — see [Running as a service](#running-as-a-service).

### `token print`

Re-prints the current registration token — useful when re-registering after
clearing browser state. In a terminal it also copies the token to your clipboard;
when piped it prints only the token, so it still composes cleanly:

```sh
menagerie-relay token print | pbcopy
```

### `token rotate`

Generates a new 32-byte registration token, writes it back to the config, and
prints it. The old token stops working immediately, so **every client must
re-register** with the new token. Use this if a token leaks.

## Configuration: `~/.menagerie/relay.toml`

`init` generates this file; you edit it by hand to change behavior. An annotated
copy lives at [`../relay-go/examples/relay.toml.example`](../relay-go/examples/relay.toml.example).

```toml
# Human-readable name shown in the Menagerie relay registry.
name = "m4pro-home"

# Address to listen on. 127.0.0.1 = local only (default, safest).
# Use "0.0.0.0:7878" to accept connections from other hosts — set TLS too.
listen = "127.0.0.1:7878"

# Optional TLS. If BOTH are set, the relay serves WSS instead of WS.
tls_cert = ""
tls_key  = ""

# Opaque registration token. Clients paste this to register. Keep it secret;
# rotate with `menagerie-relay token rotate`.
registration_token = "…generated…"

# Origins allowed to open a WebSocket (the origin check is the gate).
allowed_origins = ["https://menagerie.naklitechie.com"]

# Agents this relay can spawn. The table key is the id the browser shows
# (alphabetical, no agent featured); `command` is the executable (PATH lookup).
[agents.claude-code]
command = "claude"

[agents.mini]
command = "mini"

# The "custom" shim takes its command from spawn.args, so it needs no `command`.
[agents.custom]
```

| Field | Meaning |
|---|---|
| `name` | Display name in the app's relay registry. Defaults to the machine hostname. |
| `listen` | `host:port` to bind. `127.0.0.1:7878` is local-only; `0.0.0.0:PORT` exposes it to the network. |
| `tls_cert` / `tls_key` | Paths to a cert/key pair. When **both** are non-empty the relay serves WSS; otherwise plain WS. |
| `registration_token` | The shared secret a client sends in `register`. Compared in constant time. |
| `allowed_origins` | Exact-match allowlist of WebSocket `Origin` values. The first auth gate. See below. |
| `[agents.<id>]` | One table per spawnable agent. `<id>` is what the app shows (alphabetically); `command` is the executable resolved via `PATH`. |

### Editing agents

Add an agent by adding a table. For example, to expose a second `mini` variant
under a different id, or to point `claude-code` at an absolute path:

```toml
[agents.claude-code]
command = "/opt/homebrew/bin/claude"
```

Restart `serve` after editing the config. To add an agent type the relay
doesn't know how to drive yet, you need a shim — see
[writing-a-shim.md](./writing-a-shim.md).

## Origins and local development

The `Origin` header is the first security gate (the second is the registration
token). On WebSocket upgrade the relay rejects any browser origin not in
`allowed_origins` with `403`. The default allowlist is exactly:

```toml
allowed_origins = ["https://menagerie.naklitechie.com"]
```

To run the app from a local static server during development (e.g.
`python3 -m http.server 8000` from the repo root), add that origin:

```toml
allowed_origins = ["https://menagerie.naklitechie.com", "http://localhost:8000"]
```

> **Do not add `"null"`.** Browsers send `Origin: null` for any sandboxed
> iframe, not just `file://` pages — so allowing `null` would let any website on
> the internet pass the origin gate. It is deliberately omitted from the
> default. Only add it by hand, briefly, if you're loading the app straight from
> `file://`, and remove it afterward. See
> [security-model.md](./security-model.md) for the full reasoning.

A client with **no** `Origin` header (a non-browser client, e.g. a supervisor
agent — the "agent face" of the protocol) is allowed past the origin gate and
still must pass the registration-token check.

## Exposing the relay beyond localhost

The relay defaults to `127.0.0.1` so a fresh install is reachable only from the
same machine. To control agents on a remote box (your Studio, a cloud VM) from a
browser elsewhere:

1. Set `listen = "0.0.0.0:7878"` (or a specific interface).
2. **Strongly recommended:** enable TLS so the connection is WSS, not plain WS.
   A registration token sent over plain WS on an untrusted network is exposed in
   transit.
3. Add the app's origin to `allowed_origins` (the hosted app uses
   `https://menagerie.naklitechie.com`).
4. Make sure your firewall / security group actually permits the port.

### TLS

Set both `tls_cert` and `tls_key` to PEM file paths; the relay then serves WSS.
For a self-signed certificate during testing:

```sh
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout ~/.menagerie/relay.key \
  -out    ~/.menagerie/relay.crt \
  -days 365 -subj "/CN=your-host.local"
```

```toml
tls_cert = "/Users/you/.menagerie/relay.crt"
tls_key  = "/Users/you/.menagerie/relay.key"
```

A self-signed cert needs to be trusted by the browser (trust-on-first-use, or
add it to your OS/browser trust store) before the WSS connection will open. For
a long-lived public host, use a real certificate (e.g. via a reverse proxy that
terminates TLS, or a CA-issued cert).

## Running as a service

Let the relay start at login and restart itself if it exits:

```sh
menagerie-relay service install     # launchd on macOS, systemd --user on Linux
menagerie-relay service status      # is it running?
menagerie-relay service uninstall   # remove it
```

`install` writes the unit (a launchd LaunchAgent on macOS with `RunAtLoad` +
`KeepAlive`, or a systemd `--user` unit on Linux with `Restart=always`), loads
it, and creates the config first on a fresh machine. On a headless Linux box,
`loginctl enable-linger "$USER"` keeps the user service running across reboots
without an active login session.

> Note: this keeps the *relay* always-on. Agents you spawned still stop when the
> relay restarts (they're its children) — running them under tmux to survive a
> restart is on the roadmap.

Prefer to wire it up by hand? Example unit files live in
[`../relay-go/examples/`](../relay-go/examples/).

### Linux — systemd (user service)

[`menagerie-relay.service`](../relay-go/examples/menagerie-relay.service):

```sh
cp menagerie-relay ~/.local/bin/
mkdir -p ~/.config/systemd/user
cp menagerie-relay.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now menagerie-relay
```

It runs `menagerie-relay serve` after the network is online and restarts on
failure.

### macOS — launchd (LaunchAgent)

[`com.naklitechie.menagerie-relay.plist`](../relay-go/examples/com.naklitechie.menagerie-relay.plist):

```sh
cp menagerie-relay /usr/local/bin/
cp com.naklitechie.menagerie-relay.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.naklitechie.menagerie-relay.plist
```

`RunAtLoad` + `KeepAlive` keep it running; logs go to
`/tmp/menagerie-relay.log`. Adjust the binary path in the plist if you installed
it elsewhere.

## Where state lives on disk

Everything the relay persists lives under `~/.menagerie/`:

```
~/.menagerie/
├── relay.toml                 # config + registration token (0600)
└── sessions/
    └── <session_id>.pty       # append-only raw PTY byte stream per session
```

Every session's raw PTY output is appended to
`~/.menagerie/sessions/<session_id>.pty` as it streams, so a recording survives
even if the relay restarts — independently of the browser's own FSA copy. (The
browser keeps its trajectories in the workspace folder you pick; this is the
relay-side mirror.)

## Operational notes

- **One WebSocket connection per browser↔relay pair.** Multiple agent tiles on
  the same relay multiplex over the single connection, distinguished by
  `session_id`.
- **Restart = sessions lost.** The relay keeps its `session_id → session_token`
  map in memory. On restart the map is cleared and the spawned PTYs are gone
  (they were child processes), so prior sessions become uncontrollable. The
  client learns this via `resume_failed` and falls back to trajectory replay
  from its workspace folder.
- **Live reconnect to a still-running agent is not yet implemented.** On a
  transient browser disconnect/reload the app currently replays the recording
  from its workspace folder rather than re-attaching to the live stream; the
  relay answers `resume` with `resume_failed`. This is a deliberate v1.0
  deferral — see [`../DEFERRED.md`](../DEFERRED.md).
