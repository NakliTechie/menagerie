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

## 2. Start it

```sh
./menagerie-relay serve
```

First run writes `~/.menagerie/relay.toml` (`0600` perms — it holds a secret),
**copies a registration token to your clipboard**, and starts listening:

```
First run — created /Users/you/.menagerie/relay.toml (relay "m4pro-home", listening 127.0.0.1:7878).
✓ Registration token copied to your clipboard.
  In Menagerie, paste it into the localhost relay card and hit Connect.
  k3rT9_…opaque-base64url…
```

The relay listens on `127.0.0.1:7878` by default (local only — the safest
default). Leave it running. Lost the token? `./menagerie-relay token print`
re-prints (and re-copies) it. Want it always-on — starting at login and
restarting itself? `./menagerie-relay service install`.

> **What the relay does:** it runs the agents you launch from the app with
> **+ Spawn**, each in its own terminal it streams to the page. It does *not*
> watch other terminals you already have open — start agents from Menagerie.
> (Want a terminal you started *yourself* to show up? Run it in tmux and set
> `adopt_foreign_tmux = true` — see [relay-setup.md](./relay-setup.md).)

## 3. Open the app

The eventual home is the hosted single-file app at
**menagerie.naklitechie.com**. Until that deploy lands, serve it
locally from the repo root — in another terminal:

```sh
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

## 4. Add the relay

Click the **⚙ settings** gear → under **Relays**:

- **Relay URL**: `ws://127.0.0.1:7878`
- **Registration token**: paste the token from step 2
- **Add relay**

The app opens the WebSocket, reads the relay's `hello`, registers with the
token, and the relay's status chip turns green (connected).

## 5. Spawn an agent

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
