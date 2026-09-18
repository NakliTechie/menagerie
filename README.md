# Menagerie

**Run a whole fleet of coding agents — Claude Code, Codex, opencode, Aider, and friends — side by side in one browser tab.**

![Menagerie: a fleet of coding agents in one browser tab](docs/hero.jpg)

The page *is* the app: one static file that streams terminal and structured agent sessions from small **relays** you run next to them. **No server we host, no account, no telemetry** — everything runs on your machines and nothing leaves them.

→ **Try it:** open **[menagerie.naklitechie.com](https://menagerie.naklitechie.com)**. It opens straight onto your fleet; a one-minute tour is offered, and Settings lets you pick a folder to keep session history whenever you want one.

## Run a relay (~2 minutes)

A relay is one small binary you run **once per machine** — not per agent. Two options speak the same protocol:

**menagerie-relay** — the reference relay:

```sh
brew install naklitechie/tap/menagerie-relay
menagerie-relay serve          # first run creates the config and copies your token
```

**Continuum** — the shared runtime, with a durable journal, restart survival for terminal sessions, a `/v1` API and a CLI ([repo](https://github.com/NakliTechie/continuum)):

```sh
brew install naklitechie/tap/continuum
continuum serve                # prints the endpoint; the token is operator.token in its state dir
```

Then **Settings → paste the token into the localhost relay card → Connect**, and **+ Spawn**. Full walkthrough with screenshots: **[the walkthrough](https://menagerie.naklitechie.com/docs/walkthrough/)**. Always-on: `menagerie-relay service install` or `continuum service install --listen 127.0.0.1:7878`. Prebuilt binaries for both are on their GitHub releases (`darwin`/`linux`, `arm64`/`amd64`); no Windows build — use the `linux-amd64` binary in WSL2.

> Menagerie shows the agents you launch from the app; it doesn't watch other terminals you have open. To bring in one you started yourself, run it in tmux with `adopt_foreign_tmux = true` ([relay-setup](docs/relay-setup.md)).

## What you get

- **Two ways to watch an agent** — PTY tiles stream the raw terminal; structured (ACP) sessions stream messages, tool calls and **in-browser diff review**: approve or reject each proposed edit, or cancel the turn.
- **Built for many at once** — live status per tile (running · needs-input · done · idle · rate-limited), a chime when an agent needs you, drag, fullscreen, drill in.
- **Many machines, one tab** — every relay in one grid; `wait` parks until any or all sessions reach a state you named, across machines.
- **Supervisor trees** — agents spawn agents; collapse, follow and stop a whole subtree as one.
- **You own the data** — trajectories and event logs in a folder you pick; replay any past run. Reload the page and live tiles re-attach.
- **Vendor-neutral** — nothing bundled or promoted; any agent that speaks ACP gets the richer face.

## Docs

[docs/architecture.md](docs/architecture.md) — how the page, relays and protocol fit · [protocol/protocol.md](protocol/protocol.md) — protocol v1.3, the durable artifact · [docs/relay-setup.md](docs/relay-setup.md) · [docs/security-model.md](docs/security-model.md) · [STATE.md](STATE.md) — what has shipped and how it was verified

## License

[AGPL-3.0](LICENSE).
