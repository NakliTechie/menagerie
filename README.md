# Menagerie

> One browser tab. Many coding agents. Anywhere they run.

> **Status:** scaffolding — v1.0 in progress. The relay binary and the hosted app don't exist yet; the quickstart below describes the v1.0 target, not current reality. Build phases live in [`SPEC.md`](./SPEC.md).

Menagerie is a browser-native control console for fleets of coding agents (mini-swe-agent, claude-code, codex, opencode, aider, swe-agent, and any TUI agent you wire up). The browser tab is the brain; small user-installed **relays** sit next to each agent and stream PTY bytes over WebSocket. **No NakliTechie server. No accounts. No telemetry.** You own every piece — agents, relays, sessions, trajectories.

The unit of UI is a **tile**: one agent, one terminal, one status pill, one input bar. Tiles arrange as a flat grid (v1.0) or — later — a nested supervisor tree.

## Why it exists

A category emerged in late 2025 / early 2026: browser dashboards for parallel coding agents (amux, clideck, ai-maestro). They all need a self-hosted server daemon, lean tool-specific, and treat sessions as flat lists. Menagerie's wedge is the shape they can't pivot to: **zero-server, vendor-neutral, supervisor-tree-aware** — for the person who refused to install another daemon.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser tab (menagerie.naklitechie.com — single HTML file)      │
│  ─ Grid view (v1.0)  /  Tree view (v1.1)                         │
│  ─ Vault (BYOK + relay tokens) · History (trajectory archive)   │
│  ─ xterm.js per tile · Relay registry (FSA-backed)              │
└──────┬──────────────┬──────────────┬──────────────┬─────────────┘
       │ WSS          │ WSS          │ WSS          │ WSS
   ┌───▼───┐      ┌───▼───┐      ┌───▼───┐      ┌───▼───┐
   │ Relay │      │ Relay │      │ Relay │      │ Relay │
   └───┬───┘      └───┬───┘      └───┬───┘      └───┬───┘
   ┌───▼───┐      ┌───▼───┐      ┌───▼───┐      ┌───▼───┐
   │ mini  │      │opencode│     │ codex │      │claude │
   └───────┘      └───────┘      └───────┘      └───────┘
```

All relays speak the same protocol; the browser is agnostic to relay flavor.

## Quickstart (v1.0 target — not yet shippable)

1. **Install a relay** on the host where your agents run (`curl … | sh` — coming with the first relay release).
2. Open **menagerie.naklitechie.com** (coming with the first deploy).
3. **Register** your relay: paste its registration token (`menagerie-relay token print`).
4. Click **+**, pick relay + agent + working dir + task, hit **spawn**. Watch the tile stream.

## Repo layout

```
protocol/        WebSocket protocol spec — the durable artifact (protocol.md + types.ts)
apps/menagerie/  Single-file browser app (index.html, no build step)
relay-go/        Reference relay: single Go binary
docs/            quickstart · relay-setup · writing-a-shim · security-model
```

## Hard NOT-to-do

No NakliTechie-hosted server, ever · no telemetry · no accounts · no vendor preference (agents listed alphabetically) · no bundled MCP · no locked-in protocol (spec published) · no relay-token persistence outside FSA/Vault · no usage analytics · no subscription · no "Menagerie cloud." Full list in [`VISION.md`](./VISION.md).

## Design & process docs

- [`VISION.md`](./VISION.md) — vision & roadmap
- [`SPEC.md`](./SPEC.md) — locked-decisions index + build phases
- [`HANDOFF-v1.0.md`](./HANDOFF-v1.0.md) — the full v1.0 build spec (authoritative detail)
- [`walkthroughs.md`](./walkthroughs.md) — process/meta questions
- [`DEFERRED.md`](./DEFERRED.md) — v1.1+ with triggers

## License

AGPL-3.0 (LICENSE file added in build phase P2).
