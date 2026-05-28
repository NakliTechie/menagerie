# Menagerie — DEFERRED

> **Lifecycle:** living. Things deliberately pushed past v1.0. Each entry has **what / why deferred / trigger**. Nothing here is "no" — it's "not yet, and here's what would change that." Sources: VISION "Excludes" + "Beyond v1.1", and handoff locked-with-trigger decisions.

---

## To v1.1 (the fleet release)

**Tree view + parent-child linkage**
- *Why:* v1.0 is a flat-grid skeleton; supervisor-tree UX is genuinely research (nobody's done it well).
- *Trigger:* v1.0 ships and a supervisor-tree use case is live (success: one supervisor spawns 4 worker children, visible as a collapsible tree).

**Relay flavors (b) Python + (c) WASM/Worker**
- *Why:* v1.0 ships only `relay-go` to keep the protocol-vs-implementation boundary honest with one reference relay.
- *Trigger:* `relay-go` proven across Chirag's M4 Pro + Studio.

**More shims: opencode, codex, aider, swe-agent**
- *Why:* v1.0 proves the shim interface with `mini` / `claude-code` / `custom`.
- *Trigger:* shim interface stable after v1.0 (no breaking changes for two releases).

**Multi-workspace tabs**
- *Why:* v1.0 holds one workspace at a time.
- *Trigger:* routinely juggling >1 concurrent context (e.g. "morning research" vs "Pulse migration").

**Big-screen density mode (25–49 tiles)**
- *Why:* v1.0 tests up to 16 tiles in detail.
- *Trigger:* routinely running >16 tiles.

**Cross-trajectory search (History primitive, Ctrl+K)**
- *Why:* v1.0 has past-session list + replay, no search.
- *Trigger:* enough archived trajectories that linear browse is painful.

**OS notifications (idle-comes-alive, crashes)**
- *Why:* v1.0 uses favicon badge + tab-title prefix + tile pulse (§6 attention surface).
- *Trigger:* the in-tab attention surface proves insufficient in daily use.

**Idle / needs-input heuristic refinement**
- *Why:* v1.0 ships naive per-shim heuristics (§5); conservative by design.
- *Trigger:* false positives become annoying.

**Light mode**
- *Why:* v1.0 is dark-only (walkthroughs Q4).
- *Trigger:* v1.0 ships + user demand.

**Tiny agent-client lib (Python/TS protocol wrapper)**
- *Why:* in v1.0 "the protocol is the SDK" (§16) — a supervisor agent drives raw WS frames.
- *Trigger:* a supervisor-agent author asks for a wrapper.

---

## Architecture-level, with triggers

**Live reconnect-`resume` (relay-side replay of frames after `last_seq`)**
- *Why:* deferred during P4. It needs a pub/sub refactor so a session's output broadcasts to whatever connection is currently attached (and backfills missed frames on reattach), rather than the P3 model where output is wired to the spawning connection. P4 instead persists trajectories to FSA, and on reload the browser falls back to FSA replay (relay returns `resume_failed`), which covers the "reload → review past session" path without the refactor.
- *Trigger:* users want to reattach to a *still-running* agent after a tab reload/disconnect and resume the live stream (not just replay the recording). Targets a later v1.0 phase.

**Binary WebSocket frames**
- *Why:* v1.0 uses base64 PTY bytes inside JSON text frames (§4) — simpler, debuggable.
- *Trigger:* throughput suffers from base64 overhead. (Expensive to reverse — escalate per §14.)

**`Relay` as the 8th NakliTechie primitive**
- *Why:* VISION's working assumption is *no* — the relay is a product that uses the protocol, not a primitive other tools compose against.
- *Trigger:* a second tool needs the same user-installed-daemon shape.

---

## Beyond v1.1 — not promised, possible

Only graduate if a real user need surfaces:

- Per-session token rotation mid-session
- Structured-output renderers for specific agents (richer than xterm.js, lossy vs PTY)
- Read-only share link (export a trajectory to a static viewable file) — note: §13 forbids a "share" feature *in v1.0*
- Browser-mediated agent-to-agent message routing (today agents talk via files in a shared workdir)
- Mobile companion view (read + needs-input answers only, no spawn)

*Trigger for all:* a concrete, recurring user need — not speculation.
