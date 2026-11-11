# Agent workflow gaps

> Lifecycle: locked for G0 — implementation decisions under the 2026-10-17 request. Later batches remain planned.

## Goal

Show the repository state of a running agent and make common instructions reusable
without asking the agent to inspect Git or automatically sending it a command.

## Ownership and compatibility

Menagerie owns presentation and the public protocol. Continuum implements the new
runtime reader. Protocol 1.5 (1.4 is reserved for the usage object) adds optional hello capabilities and authenticated
git_status/git_status_result frames; older 1.x relays keep their existing workflow.
Only a runtime advertising session_git_v1 receives requests. No new Git reader is
added to the reference relay. No installed service changes occur in development.

## Git snapshot

A request identifies a session and supplies its session token and request ID.
The runtime uses the session's recorded working directory; the browser cannot
name a filesystem path. Read branch/upstream/divergence and staged, unstaged and
untracked entries with bounded Git output and a deadline. Disable external Git
helpers where applicable. No fetch, index update, commit, checkout or write occurs.
Return explicit not_repository/unavailable states and a bounded changed-file list.
Do not forward command stderr, credentials or Git configuration to the browser.
Authentication failures return no repository data. Reads do not acquire control,
change lifecycle state or clear human attention. Refresh is explicit, not a poll.

## Saved actions

Provide editable defaults for review, commit, commit/push, prepare a pull request,
resolve conflicts and recap. Store edits through the existing workspace storage,
never localStorage. In-memory mode is labelled honestly. Preparing an action
never sends input. It preserves an existing composer draft and opens an editable
draft before the existing Send operation. Replay, exited, lost, taken and blocked
sessions cannot receive an action. PTY users can copy the draft for deliberate
terminal input; ACP users can place it in their structured composer. Never treat a
saved instruction as an approval answer. Repository text renders as text, not HTML.

## Batch gate

Implement both runtime and UI before verification. Cover real temporary Git repos,
malformed/unauthorized requests, dirty/clean/unborn/detached states, file limits and
legacy fallback. Run the existing protocol/relay checks, the relevant Continuum
gate, frontend lint and a browser journey against a private runtime. Verify nearby
spawn, structured approval and replay behavior. Fix and recheck any failed gate.

## Build sequence

G0: protocol and runtime, browser Git panel, saved action settings/drafts, full batch gate.
G1–G8: see the private plan/gaps-2026-10-17.md; no later batch is claimed complete.
