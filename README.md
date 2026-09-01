# Menagerie

**Run a whole fleet of coding agents — Claude Code, Codex, opencode, Aider, and friends — side by side in one browser tab.**

![Menagerie: a fleet of coding agents in one browser tab](docs/hero.jpg)

The page *is* the app. It streams terminal and structured agent sessions from small **relays** you run next to them. **No server we host, no account, no telemetry** — everything runs on your machines and nothing leaves them. It opens in dark mode; light mode is one click away.

→ **Try it:** open **[menagerie.naklitechie.com](https://menagerie.naklitechie.com)**. On your first visit, choose a folder for Menagerie's local state (or skip for an in-memory workspace); the quick tour starts after that choice. Then start a relay below.

The front end is one static file. For a local checkout, serve the repository over localhost so the relay's origin check can identify the page:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Get going in ~2 minutes

A relay is one small binary you run **once per machine** — not per agent. It launches and streams every Menagerie session on that box, so you start it once and leave it running.

**Install it** — Homebrew (macOS / Linux), no Go, no build step:

```sh
brew install naklitechie/tap/menagerie-relay
```

…or grab the prebuilt binary directly — `darwin-arm64` (Apple Silicon), `darwin-amd64` (Intel), `linux-amd64`, or `linux-arm64`:

```sh
curl -L -o menagerie-relay \
  https://github.com/NakliTechie/menagerie/releases/latest/download/menagerie-relay-darwin-arm64
chmod +x menagerie-relay
```

> **Release status (2026-09-01):** Homebrew and the latest prebuilt binaries install relay **v0.4.0** (protocol 1.1), which supports PTY sessions and live re-attach. This repository contains relay **v0.6.0** (protocol 1.3), adding structured ACP sessions and supervisor trees. Until the next relay release, build the current feature line from source:
>
> ```sh
> git clone https://github.com/NakliTechie/menagerie.git
> cd menagerie/relay-go
> go build -o menagerie-relay ./cmd/menagerie-relay
> ```

**Run it** — once per machine, then leave it running (drop the `./` if you installed via Homebrew):

```sh
./menagerie-relay serve    # first run sets up config + copies your token; leave it running
```

First run creates the config and **copies a registration token to your clipboard**. After the workspace step, open **Settings**, paste it into the **localhost relay** card, and hit Connect — a guided checklist walks you the rest of the way. Full step-by-step with screenshots: **[the walkthrough](https://menagerie.naklitechie.com/docs/walkthrough/)**. Want the relay always-on (starts at login, restarts itself)? `./menagerie-relay service install`.

> **What Menagerie shows:** the relay runs the agents you launch from the app with **+ Spawn** and streams each into a terminal or structured tile. It doesn't watch other terminals you have open. (Want a terminal you started *yourself* to appear? Run it in tmux and set `adopt_foreign_tmux = true` — see [relay-setup](docs/relay-setup.md).)

> **Windows:** there's no native Windows build (the relay needs a Unix PTY) — run the **`linux-amd64`** binary inside **[WSL2](https://learn.microsoft.com/windows/wsl/install)**. The app reaches it over `localhost`, same as on Mac/Linux.
>
> **macOS Gatekeeper:** Homebrew **and** `curl` both run clean — only *browser* downloads get quarantined. If you grab it from the Releases page in a browser, clear the flag once: `xattr -dr com.apple.quarantine menagerie-relay`.
>
> **Prefer `go install`?** `go install github.com/NakliTechie/menagerie/relay-go/cmd/menagerie-relay@latest`

## How it works

```
   Browser tab (one static HTML file)          ── you own the state:
   ─ terminal or structured tile per agent         relays + sessions +
   ─ dark default · light · drag · fullscreen      trajectories, saved to
        │         │          │                      a folder you pick (FSA)
        │ WSS     │ WSS      │ WSS
    ┌───▼──┐  ┌───▼──┐   ┌───▼──┐     each relay = one Go binary
    │relay │  │relay │   │relay │     that owns agent processes and speaks
    └──┬───┘  └──┬───┘   └──┬───┘     published WebSocket protocol
   claude-code  codex    opencode …
```

Anything the browser can do, an agent can do too — **the protocol *is* the SDK** ([protocol v1.3](protocol/protocol.md)). A relay handles many agents at once; run more relays only for more *machines*.

## What makes it different

- **Zero-server, vendor-neutral** — no daemon we host, agents listed alphabetically, nothing bundled or promoted.
- **Two ways to watch an agent** — PTY tiles stream the raw terminal; structured (ACP) sessions stream messages, tool calls, and **in-browser diff review**: approve or reject each proposed file edit from the tile. Nothing is special-cased by agent name — any agent that speaks ACP gets the richer face.
- **You own the data** — sessions, terminal trajectories, *and* structured event logs live in your folder; replay any past run.
- **Supervisor trees** — an agent can spawn child agents; Menagerie shows the parent→children relationship as a collapsible tree (sidebar + a Grid/Tree toggle), and kills a whole subtree in one step. A supervisor and its workers read as one shape you can collapse, follow, and stop as a unit.
- **Built for many at once** — live status per tile (running · needs-input · rate-limited · idle), a chime when an agent needs you, drag to reorder, fullscreen or drill into any tile.
- **Survives refreshes** — relays keep running; reload the page and your live tiles re-attach.

## Repo layout

```
index.html     the whole browser app (no build step)
relay-go/      the reference relay — one Go binary (serve · service · token)
protocol/      protocol v1.3 — the durable artifact (protocol.md + types.ts)
docs/          walkthrough · quickstart · relay-setup · writing-a-shim · security-model
```

## Develop locally

The browser app has no build step. Serve the repository root with the localhost command above and edit `index.html`.

Run the protocol and relay checks before committing:

```sh
node protocol/validate-fixtures.mjs

cd relay-go
go test -race ./...
go vet ./...
go build ./...
```

## More

[`STATE.md`](STATE.md) tracks the shipped feature lines and verification record. [`VISION.md`](VISION.md) holds the roadmap; [`docs/design/v1.2-spec.md`](docs/design/v1.2-spec.md) is the current supervisor-tree design; [`SPEC.md`](SPEC.md), [`HANDOFF-v1.0.md`](HANDOFF-v1.0.md), and [`DEFERRED.md`](DEFERRED.md) preserve the v1.0 anchor and backlog.

## License

[AGPL-3.0](LICENSE).
