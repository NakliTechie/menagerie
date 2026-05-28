# Quickstart

Zero to a streaming agent tile. The relay runs next to your agents; the
browser app is the control surface. No NakliTechie server, no account.

You need a [Go toolchain](https://go.dev/dl/) (to build the relay) and a coding
agent on `PATH` — `mini` ([mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent))
or `claude` ([Claude Code](https://www.anthropic.com/claude-code)). The `custom`
shim runs any command, so even `bash` works for a first try.

## 1. Build the relay

```sh
cd relay-go
go build ./cmd/menagerie-relay   # → ./menagerie-relay
```

This produces a single binary with no runtime dependencies. (Pre-built binaries
for darwin/linux × amd64/arm64 ship on GitHub Releases once the relay is tagged.)

## 2. Initialize it

```sh
./menagerie-relay init
```

`init` writes `~/.menagerie/relay.toml` (with `0600` perms — it holds a secret)
and prints a **registration token** once:

```
Created /Users/you/.menagerie/relay.toml
Relay name: m4pro-home
Listening:  127.0.0.1:7878  (edit to 0.0.0.0:PORT to expose beyond localhost)

Registration token — paste into Menagerie → Settings → Add relay:
  k3rT9_…opaque-base64url…

Then run `menagerie-relay serve`.
```

Copy that token. If you lose it, `./menagerie-relay token print` re-prints it.

## 3. Start serving

```sh
./menagerie-relay serve
```

The relay listens on `127.0.0.1:7878` by default (local only — the safest
default). It logs the listen address, whether TLS is on, and the allowed
origins. Leave it running.

## 4. Open the app

The eventual home is the hosted single-file app at
**menagerie.naklitechie.com**. Until that deploy lands, serve
`apps/menagerie/` locally — in another terminal:

```sh
cd apps/menagerie
python3 -m http.server 8000
```

Open <http://localhost:8000/> in a Chromium-based browser (the app uses the
[File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
for state, which Firefox and Safari don't yet fully support).

> **Origin note.** The relay's default `allowed_origins` is just
> `https://menagerie.naklitechie.com`. To connect from `http://localhost:8000`
> during local dev, add that origin to `allowed_origins` in `relay.toml` and
> restart the relay — see [relay-setup.md](./relay-setup.md). Do **not** add
> `"null"`; [security-model.md](./security-model.md) explains why.

On first launch the app asks for a **workspace folder** — pick any directory.
Menagerie stores your relay registry and session trajectories there and nowhere
else. (You can choose **Skip (in-memory)** to try it without persistence.)

## 5. Add the relay

Click the **⚙ settings** gear → under **Relays**:

- **Relay URL**: `ws://127.0.0.1:7878`
- **Registration token**: paste the token from step 2
- **Add relay**

The app opens the WebSocket, reads the relay's `hello`, registers with the
token, and the relay's status chip turns green (connected).

## 6. Spawn an agent

Click **+ Spawn** (or press `n`):

- **Relay**: your connected relay
- **Agent**: `mini`, `claude-code`, or `custom` (listed alphabetically — no
  agent is featured)
- **Working directory**: an absolute path the agent should run in, e.g.
  `/Users/you/code/project`
- **Task**: what the agent should do (passed to the shim as `args`)
- For `custom`: a **Custom command** field appears — enter the command to run
  (e.g. `bash`)

Hit **Spawn**. A tile appears and the agent's terminal output streams live via
xterm.js. Type in the tile's input bar and press **Enter** (or **Send**) to send
keystrokes to the agent; the trash button sends `kill`.

That's the v1.0 loop: spawn, watch, input, kill. Closed the tab? Reopen it, open
**⚙ → Past sessions**, and **Replay** any session from the trajectory stored in
your workspace folder.

## Where to go next

- [relay-setup.md](./relay-setup.md) — running the relay as a service, TLS,
  exposing it beyond localhost, config reference
- [security-model.md](./security-model.md) — the two auth gates and the threat
  model
- [writing-a-shim.md](./writing-a-shim.md) — teach the relay a new agent
- [`../protocol/protocol.md`](../protocol/protocol.md) — the WebSocket protocol
  both the app and any agent speak
