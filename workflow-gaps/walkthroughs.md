# Workflow decisions

> Lifecycle: locked for G0 — routine implementation decisions made under the user's request, not separately approved product policy.

1. Runtime ownership: Continuum implements Git inspection. Menagerie remains a client.
2. Compatibility: capability negotiation disables Git inspection for old relays.
3. Authority: Git reads use a session token and the runtime's cwd, without lifecycle changes.
4. Actions: editable drafts with explicit Send; terminal sessions get an explicit copy path.
5. Persistence: existing workspace storage; memory-only use is labelled.
6. Validation: one complete build batch, followed by appropriate Go and browser gates.

These decisions are folded into SPEC.md. Later feature contracts are settled in their own batches.
