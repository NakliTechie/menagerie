# Menagerie — Vision & Roadmap

> One browser tab. Many coding agents. Anywhere they run.

---

## What it is

Menagerie is a browser-native control console for fleets of coding agents (mini-swe-agent, opencode, claude-code, codex, aider, swe-agent, and any TUI agent a user wants to wire up). The browser tab is the brain; small user-installed **relays** sit next to each agent and stream PTY bytes over WebSocket. No NakliTechie server. No accounts. No telemetry. The user owns every piece — agents, relays, sessions, trajectories.

The unit of UI is a **tile**: one agent, one terminal-or-structured view, one status pill, one input bar. Tiles arrange as a flat grid (default) or a nested supervisor tree (toggle). A workspace can hold dozens. A large screen can hold a fleet.

## Why it exists

By late 2025 / early 2026 a category emerged: "browser dashboard for parallel coding agents" — amux, clideck, ai-maestro and others. They solve real pain (juggling 5–20 Claude Code sessions across worktrees) but they all share a shape:

- Self-hosted **server** the user must run as a service (`amux serve` → `localhost:8822`)
- Tool-centric (`amux` is Claude-Code-first; others lock to specific stacks)
- Flat session lists; nested supervisor trees are at best gestured at
- Self-hostable, but **not browser-native**

The shape-shaped gap is real:

| | Existing tools | Menagerie |
|---|---|---|
| Server | localhost daemon required | None. Single HTML file. |
| Account | None — but installs server-shaped infra | None. Browser owns state. |
| BYOK | Implicit via wrapped agent | Explicit. Vault primitive. |
| Vendor | Claude-Code-first or tmux-locked | Protocol-first. Any agent that speaks the relay protocol is equal. |
| Supervisor trees | Flat grids | First-class. Tree view as core UX. |
| State | Server-side SQLite / JSON | FSA. User owns the files. |
| Sovereignty | Self-hostable | Browser-resident. |

Menagerie's wedge isn't "build a dashboard for parallel agents." That's done. It's:

**A zero-server, vendor-neutral, supervisor-tree-aware console for the shape of person who refused to install amux because they didn't want another daemon.**

That's a small audience. It's the same audience that uses every other NakliTechie tool.

## Who it's for

Same Path B portfolio audience: people who opted out of the SaaS pitch and value ownership, continuity, sovereignty, calm, craft. Specifically, the subset of those people who are running fleets of coding agents in 2026 and feel the friction of either (a) tmux gymnastics or (b) installing yet another self-hosted dashboard server.

It is also, deliberately, for **agents themselves**. Every Menagerie capability has an agent face: spawn a tile, send input, read output, kill, observe siblings. The same WebSocket protocol the browser uses is available to a supervisor agent that wants to orchestrate workers. The tile UX is just a human face on a protocol any agent can drive.

## Strategic stance

- **Shape is the moat.** Browser-native + protocol-defined + zero-server is structurally different from every existing player, not just stylistically. Won't be undercut by a faster competitor — the architectural commitments don't permit certain pivots.
- **No commercial path.** Menagerie is NakliTechie research, Track 1. The point is that if Chirag can build it, anyone can. Specs, protocols, and shims all published. Other people can write relays.
- **Embrace-and-extend over rewrite.** xterm.js for terminal rendering, established WebSocket libs for the relay, no reinventing PTY handling. Menagerie's novelty is in composition and shape, not in low-level engineering.
- **Agent-equality.** The spawn dialog lists agent types alphabetically. No featured agent. No promoted shim. mini, opencode, claude-code, codex all get the same treatment.
- **Protocol first, app second.** The relay protocol is the durable artifact. The browser app is one consumer of it. A supervisor agent is another. A future native app could be a third. We don't ship features that require browser-app-specific protocol extensions.

## Primitives used

Menagerie composes existing NakliTechie primitives, doesn't introduce new ones:

- **Identity** — local user identity for namespacing
- **Vault** — relay tokens (optional stronger isolation than FSA-resident JSON)
- **History** — per-session trajectory archive, queryable
- **Bridge** — for relay flavor (c), the WASM/Worker variant
- **LLM** — not directly used by Menagerie itself; agents make their own LLM calls

One open question is whether `Relay` (the user-installed daemon) should be formalized as the eighth primitive. Working assumption: no. The relay is a *product* that uses the protocol, not a primitive other tools compose against. If a second tool comes along that needs the same shape, revisit.

## Architecture (one diagram)

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser tab (menagerie.naklitechie.com — single HTML file)     │
│  ─ Grid view  /  Tree view  (toggle)                            │
│  ─ Vault (BYOK + relay tokens)                                  │
│  ─ History (per-session trajectory archive, FSA)                │
│  ─ xterm.js per tile + optional structured renderer             │
│  ─ Relay registry (FSA-backed)                                  │
└──────┬──────────────┬──────────────┬──────────────┬─────────────┘
       │ WSS          │ WSS          │ WSS          │ WSS
   ┌───▼───┐      ┌───▼───┐      ┌───▼───┐      ┌───▼───┐
   │ Relay │      │ Relay │      │ Relay │      │ Relay │
   │  Go   │      │ Python│      │ WASM/ │      │  Go   │
   │ M4Pro │      │Studio │      │Worker │      │ Modal │
   └───┬───┘      └───┬───┘      └───┬───┘      └───┬───┘
       │              │              │              │
   ┌───▼───┐      ┌───▼───┐      ┌───▼───┐      ┌───▼───┐
   │ mini  │      │opencode│     │ codex │      │claude │
   │  PTY  │      │  PTY  │      │  PTY  │      │ code  │
   └───────┘      └───────┘      └───────┘      └───────┘
```

The browser is agnostic to relay flavor. All relays speak the same protocol.

## The relay choice (offered, not prescribed)

Users pick the relay flavor that fits their context. Often they mix:

| Flavor | Shape | Best for |
|---|---|---|
| **(a) Go binary** — `menagerie-relay-go` | Single ~5MB binary, one command to install, systemd/launchd units | Personal boxes, long-lived hosts, "set and forget" |
| **(b) Python script** — `menagerie-relay-py` | `pip install` or single-file Python, stdlib + websockets | Hackable, auditable, fast iteration, one-off experiments |
| **(c) WASM/Worker** — `menagerie-relay-wasm` | Edge-deployed via Cloudflare Worker or Modal function, ephemeral | Sandboxed/throwaway agents, remote hosts you don't own, friends running relays for you |

No flavor is "blessed." Three paths, the user decides. Same protocol everywhere.

## What ships when

### v1.0 — anchor release (Phase 1)

The skeleton: browser app + one relay flavor + three shims + flat grid. Enough to be daily-useful for a single user with mini-swe-agent and Claude Code on their own machine. Tile, spawn, watch, input, kill, replay.

**Includes:**
- `apps/menagerie` — single HTML file, FSA-resident state, xterm.js tiles, flat grid view
- `relay-go` — Go binary, full protocol implementation
- Shims: `mini`, `claude-code`, `custom` (raw PTY)
- Per-session token model (each spawn issues a fresh token; relay enforces)
- PTY-byte capture replay (xterm.js re-renders losslessly)
- One workspace at a time
- Spawn dialog, kill, send-input, detach, basic filtering
- Settings panel for relay registry
- Browser tab notification on `needs-input`
- Up to 16 tiles tested in detail (more works; design polish targets v1.1)

**Excludes (deferred to v1.1):**
- Tree view, parent-child linkage
- Relay flavors (b) and (c)
- Shims for opencode, codex, aider, swe-agent
- Multi-workspace tabs
- Big-screen density mode
- Cross-trajectory search
- OS notifications

### v1.1 — "It has a second face." (amended 2026-08-22)

> **Roadmap amendment.** The original v1.1 ("fleet release", supervisor-tree UX)
> moved to **v1.2** below. Rationale: the v1.0 protocol was defined as
> *PTY-streaming **or** structured-output* and only PTY shipped — the structured
> half was scaffolded, never built. ACP is the first stable vendor-neutral
> structured source available, so the scaffold gets filled before new UX research
> opens.

**Shipped:** ACP transport as a first-class session kind (`spawn.transport`).
Structured tile rendering (message stream, tool calls, status). Drill-in surface
with diff review. Event-log replay (`acp-jsonl` capture beside `pty-bytes`).
Ships the desktop-application shape without becoming a desktop application.

### v1.2 — "It's a tree." (shipped)

**Shipped:** protocol-declared parentage (`spawn.parent_session_id`, `child_spawned`,
`hosts_children`), a collapsible **supervisor tree** (sidebar + a Grid/Tree toggle with
grid grouping), a spawn-child affordance, and **subtree kill** (`signal{kill, subtree}`).
A supervisor session and its workers read as one shape you can collapse, follow, and
stop as a unit — the tree remains the research surface; the structured transport is the
load-bearing one. **Deferred to v1.2.x:** cross-relay child-spawn, multi-workspace tabs,
and the agent-to-agent coordination layer (`wait` / atomic prompt+wait / self-reported
status — see `docs/design/v1.2-spec.md` §8, informed by herdr).

### Beyond v1.2 — not promised, possible

These are not v1.x. They live in a backlog and only graduate if a real user need surfaces.

- Per-session token rotation mid-session
- Read-only share link (export a trajectory to a static viewable file)
- Browser-driven agent-to-agent message routing (currently agents talk via files in shared workdir; this would add a Menagerie-mediated channel)
- Mobile companion view (read + needs-input answers only, no spawn)

## North star

As people move to the cloud and run terminal agents there, they will need a
desktop GUI that connects to local / remote TUI agents. That is the guiding
light for every surface decision: one window, many machines, agents you can see
and steer.

## Hard NOT-to-do rules

These don't soften. If a feature requires breaking these, the feature doesn't ship:

1. No NakliTechie-hosted server. Ever. Not even an optional one.
2. No telemetry. Relay does not phone home. Browser does not phone home.
3. No account system. No login. No "Menagerie account."
4. No vendor preference. Agent types listed alphabetically. No featured agent. No promoted shim.
5. No bundled MCP. Menagerie observes; agents do their own MCP business.
6. No locked-in protocol. Spec published. Anyone can write a relay or a shim.
7. No relay-token persistence outside the user's browser (FSA / Vault).
8. No analytics on agent usage patterns.
9. No subscription, no payment, no premium tier.
10. No "Menagerie cloud."

## Risks and what we accept

- **The relay is a process the user installs.** It is not a NakliTechie server, but it is *a* process. We accept this; we name it honestly; we don't claim "zero processes" when we mean "no NakliTechie infra."
- **PTY-in-browser is real engineering.** xterm.js + protocol + reconnection + scroll buffer persistence is non-trivial. We accept the engineering cost because the shape requires it.
- **Crowded category.** amux and friends have brand and docs. Menagerie has to be different in a way that matters to the small audience that already rejected those tools. We accept that the audience is small.
- **Phase 2 is research.** Nobody has done supervisor-tree UX well. We accept that v1.1 will iterate on the tree view shape more than other surfaces.

## Success criteria

v1.0 ships when Chirag can, in a single browser tab, spawn a mini-swe-agent on the M4 Pro and a claude-code session on the Studio, watch both tiles update in real time, answer a needs-input prompt without leaving the tab, kill one, and replay the killed session's trajectory from FSA.

v1.1 (structured transport) shipped when Chirag could, in one browser tab: spawn an `omp acp` session and a PTY session, see both as tiles with different render modes, drill into the omp tile, read a streamed response with tool calls expanded, review a proposed file diff and approve or reject it from the browser, return to the grid without losing either session — then close the tab, reopen, and replay the structured session from its event log. Verified 2026-08-22; evidence in `docs/design/v1.1-rubric-critique.md` + `STATE.md`.

## Role matrix — re-run for v1.1 (2026-08-22)

The milestone's spine added an actor, so the matrix re-fires (handoff §C6):

| Actor | Surface | Authority | v1.1 delta |
|---|---|---|---|
| Human at desktop | grid + drill-in | full control | NEW: structured tiles, diff approve/reject, raw event-log pane |
| Human on phone | drawer + single-column tiles | steer + answer | structured sessions render + prompt from mobile |
| **ACP agent** | **NEW machine actor** | **requests** filesystem writes via `permission_request`; cannot act without a human decision | everything about this milestone |
| PTY agent (TUI) | terminal tile | performs writes directly under its own approval model | unchanged; shares tile chrome |
| Relay | local process | owns children, mints tokens | spawns stdio JSON-RPC children; never tmux-wraps them |

The load-bearing asymmetry: a PTY agent *does* things you watch; an ACP agent
*proposes* things you decide. The drill-in surface exists because that
difference needed a first-class place to live.

Beyond that, the test is portfolio-shape: does the tool *belong* alongside Bahi, Tijori, VaultMind, Forge? If yes, it's done what it set out to do.
