# Menagerie — SPEC

> **Lifecycle:** locked (2026-05-28). The design is settled in `HANDOFF-v1.0.md`. This file is the dev-process index: it lists the locked decisions and the build phases, and points at the authoritative detail. It does **not** re-state the handoff — if a design decision changes, change it in the handoff and add a dated note here.

## What

A browser-native control console for fleets of coding agents. One single-file HTML app is the brain; small user-installed **relays** sit next to each agent and stream PTY bytes over WebSocket. No NakliTechie server, no accounts, no telemetry. The unit of UI is a **tile**: one agent, one terminal, one status pill, one input bar.

## Authoritative sources

| File | Role |
|---|---|
| `VISION.md` | Why it exists, roadmap (v1.0 → v1.1 → beyond), hard NOTs, audience |
| `HANDOFF-v1.0.md` | **The locked build spec** — protocol, relay, app, security, a11y, gates. All detail lives here. |
| `walkthroughs.md` | Residual process/meta questions (the design walkthrough itself is folded into the handoff) |
| `DEFERRED.md` | v1.1+ and beyond, each with a revisit trigger |

## Locked decisions (v1.0)

- **Monorepo** — `protocol/` + `relay-go/` + `docs/` + the app's root `index.html` in one repo; no splits through v1.1. (Handoff §2 placed the app at `apps/menagerie/`; moved to the repo root 2026-05-28 for a clean static deploy.)
- **Protocol is the durable artifact** — written first, before relay or app (handoff §4, §17).
- **Browser app** — single `index.html`, no build step, xterm.js via CDN with SRI; state in FSA + IndexedDB only (handoff §6, §13).
- **Relay** — single Go binary; deps limited to `creack/pty` + `coder/websocket` + `BurntSushi/toml` (handoff §3).
- **Auth** — per-session token model: registration token registers a relay, relay mints an ephemeral session token per spawn (handoff §4).
- **Transport** — JSON text frames, base64 PTY bytes (binary frames deferred — see `DEFERRED.md`).
- **v1.0 shims** — `mini`, `claude-code`, `custom` (handoff §1).
- **License** — AGPL-3.0 (handoff §2). *LICENSE file to be added in P2.*
- **Autonomy boundaries** — handoff §14 governs proceed-vs-stop during the build.
- **Process** — dev-process skill, light scaffold; no spec-kit (`specify init`). [2026-05-28, walkthroughs Q1]
- **Branch** — build on `main`; greenfield, the whole repo is the initiative. [2026-05-28, walkthroughs Q2]
- **Repo visibility** — private during build, public at v1.0 ship. [2026-05-28, walkthroughs Q3]
- **Theme** — dark-only acceptable for v1.0; light mode deferred. [2026-05-28, walkthroughs Q4]

## Build phases (dev-process Stage 5 — groups handoff §17)

This is the authoritative phase plan; `plan/workplan.md` points here.

- **P1 — protocol/** — `protocol.md` (human reference) + `types.ts` (canonical message shapes). The durable artifact; nothing else starts until this is right.
- **P2 — skeletons** — relay-go (`hello` + `register` flow, config, WS server; no PTY yet) + app shell (top bar, empty grid, settings → relay-add → register round-trip). Plus LICENSE + repo-layout dirs.
- **P3 — live agent** — PTY + `mini` shim: spawn, stream `output`, full `input` + `kill` round-trip.
- **P4 — persistence** — FSA `relays.json` + session metadata + PTY byte capture; replay mode (scrub + speeds).
- **P5 — breadth + polish** — `claude-code` + `custom` shims; empty/error states (§7); hotkeys (§10); a11y pass (§9).
- **P6 — ship** — release CI (cross-compile relay) + app-deploy (Cloudflare Pages → menagerie.naklitechie.com); `docs/`; gate artifacts (§15).
- **P7 — security sweep** — dev-process Stage 6 (`/security-review`) on the full diff.
- **P8 — browser walkthrough** — dev-process Stage 7: drive the golden path + edge states in a real browser.

## Success criteria (handoff §1, VISION)

In one browser tab: register a relay on the M4 Pro, spawn `mini` and `claude-code`, watch both tiles stream live, answer a `needs_input` prompt without leaving the tab, kill one, close the tab, reopen, and replay the killed session from FSA — pixels match the live run.
