# Research note — TUICommander as a reference point

> **Lifecycle:** living. A look at [sstraus/tuicommander](https://github.com/sstraus/tuicommander) (≈72★, Tauri + SolidJS + Rust) to mine UI cues and feature ideas for Menagerie. Captures what we looked at, what we adopted, and — more importantly — what we deliberately left out and why. Sourced from the public README on 2026-05-28.

---

## What it is

TUICommander bills itself as an "AI-native IDE": a **desktop binary** (Tauri shell, SolidJS frontend, Rust backend) that runs many coding agents in parallel, each in its own git worktree, with the diffs, PRs, CI status, usage dashboards, and an AI chat companion all in one window. It auto-detects ~10 agents (Claude Code, Codex, Aider, Gemini, Amp, Cursor Agent, OpenCode, Warp Oz, Droid, Goose) and reads their terminal output to know what each is doing.

It is a much **bigger** product than Menagerie, and a structurally different one. That contrast is the whole value of the comparison.

## Why it's worth studying

Its problem statement is almost word-for-word ours: you've got Claude Code in one terminal, Aider in another, Codex in a third; one hit a rate limit ten minutes ago and you didn't notice; another is blocked on a Y/N prompt; you lose the thread switching between windows. That's the exact pain Menagerie's grid-of-tiles answers. Seeing an independent team converge on the same three signals — **rate limit**, **question/needs-input**, **at-a-glance status** — was good validation that those were the right things to build next.

## The architectural fork (what "realistically implement" means here)

| | TUICommander | Menagerie |
|---|---|---|
| Shape | Installed desktop binary (Tauri/Rust) | One static `index.html` + a thin Go relay |
| Brain | Native app process | The browser tab |
| Agent integration | Per-agent detectors baked into the Rust core | Generic PTY heuristics on the relay; **zero** per-agent logic in the browser |
| Scope | IDE: editor, diffs, PRs, CI, worktrees, MCP hub, voice, plugins | Spawn · stream · steer · kill · replay |

Almost everything that makes TUICommander an *IDE* (worktree orchestration, the built-in CodeMirror editor, Git panel, PR/Issue management, CI auto-heal, MCP proxy hub, Whisper voice, the plugin SDK) sits on the far side of that fork — it needs a privileged native process and a much thicker client. Menagerie's bet is the opposite: keep the client a single HTML file with no server of its own, and push the only agent-specific knowledge down to the relay. So the filter for "can we realistically do this?" was: **does it fit a browser tab talking to a dumb PTY pipe?** The observability primitives do. The IDE does not.

## UI cues we took

- **Collapsible left rail.** TUICommander's sidebar lists repos/worktrees and slides away to give the terminals room. We adopted the *pattern* (not the content): a left rail listing **Relays · live Sessions · Past sessions**, toggled by a ☰ button, that collapses to hand the full width to the tiles.
- **Per-item status dots.** Their tabs carry status dots (idle/busy/done/question/error). We already had per-tile dots; this reinforced extending the vocabulary with a distinct **rate-limited** state and surfacing the same dots in the new sidebar rows.
- **Drag-to-reorder + detach.** We'd already shipped tile drag-reorder and per-tile fullscreen ("detach onto the desktop"), so this was confirmation rather than new input.

## Feature triage

| Observed in TUICommander | Verdict for Menagerie | Why |
|---|---|---|
| Collapsible sidebar | **Adopted** | Pure UI; fits the single-file client. |
| Question / needs-input detection + notification sound | **Adopted (adapted)** | High value, low cost. We do it as a *generic* relay heuristic + a Web Audio chime, not per-agent parsers. |
| Rate-limit detection | **Adopted (adapted)** | Same: generic substring heuristics on the PTY tail, surfaced as a distinct pill. No countdown timer (yet). |
| Activity dashboard (status at a glance) | **Already had it** | The tile grid + dots is exactly this. The sidebar makes it denser. |
| Session-aware resume | **Already had it (differently)** | We resume via the relay's live-session list + buffer replay (protocol 1.1), not by scraping agent session files off disk. |
| Git worktree orchestration | **Out of scope (v1)** | Needs a privileged local process managing the repo; violates the thin-client bet. |
| Editor / Git panel / diffs / PR & Issue mgmt / CI auto-heal | **Out of scope** | That's the IDE half of the fork. Menagerie steers agents; it isn't the IDE. |
| Usage dashboards (heatmaps, per-project) | **Deferred** | Provider-specific accounting; revisit if users ask to see spend across the fleet. |
| MCP proxy hub | **Out of scope** | Orthogonal infrastructure. |
| Mobile companion PWA | **Latent** | Menagerie is already a web app — a phone can load the same URL. A tap-to-answer mobile view is a possible later polish, not a port. |
| Voice (Whisper), plugin SDK, smart-prompt library | **Out of scope** | Native/host-level features. |

## What we shipped off the back of this

Three features, all browser- or relay-side, none requiring per-agent code in the client:

1. **Collapsible left sidebar** (`index.html`) — Relays / Sessions / Past sessions, status dots, click-to-focus a tile, click a past session to replay; ☰ toggles it and the tiles re-fit.
2. **Needs-input chime** (`index.html`) — a soft two-tone Web Audio beep on the *transition* into `needs_input` (not on every frame), plus the existing red attention dot and the `(n)` document-title counter.
3. **Rate-limit pill** (`index.html` + relay) — a distinct amber pulsing state, driven by a new `rate_limited` lifecycle event the relay emits when the PTY tail matches provider throttle phrases.

Relay-side detection (`internal/shims/shims.go`) is deliberately conservative and **agent-agnostic**: `LooksLikeNeedsInput` fires on explicit confirmation/choice prompts and ignores bare shell prompts; `LooksLikeRateLimited` matches common throttle/quota phrasings. False negatives are fine; false positives are annoying.

## Deferred refinements (triggers)

- **Per-agent detectors + rate-limit countdown timers.** *Why deferred:* our generic heuristics cover the common cases without baking agent specifics into the relay. *Trigger:* the generic matcher misses or mis-fires often enough in real use that per-agent patterns earn their complexity — and the matching still lives only on the relay, never in the browser.
- **Fleet usage/spend view.** *Trigger:* a user asks to see token/cost across running sessions.
- **Tap-to-answer mobile view.** *Trigger:* the desktop console is in daily use and answering prompts from a phone becomes a real want.
