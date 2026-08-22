# ACP pin

The pinned source of truth for ACP message shapes used by Menagerie v1.1's
structured transport. Per handoff §C0: ACP shapes are **generated**, never
hand-written from memory — a stale transcription is worse than a generated one.

## Pin

| | |
|---|---|
| Spec | Agent Client Protocol (ACP), **schema v1** |
| Upstream | <https://github.com/agentclientprotocol/agent-client-protocol> |
| Commit | `b7f0005493b98de32fabee3e9540e2b64da68535` (main, 2026-08-22) |
| File | `schema/v1/schema.json` |
| Vendored copy | [`vendor/acp-schema-v1.json`](./vendor/acp-schema-v1.json) (+ `vendor/acp-meta-v1.json` method maps) |
| Generated output | [`acp-types.ts`](./acp-types.ts) via [`generate-acp-types.mjs`](./generate-acp-types.mjs) |

## Why v1

`omp acp` (omp 18.0.0) negotiates `protocolVersion: 1` in its initialize response
(verified in [`fixtures/acp-smoke.jsonl`](./fixtures/acp-smoke.jsonl)). The upstream
repo also publishes a v2 schema; we do not consume it.

## Regenerate

```sh
node protocol/generate-acp-types.mjs
```

Regeneration must produce **no diff** (checkpoint C0). To move the pin: replace the
vendored schema with the new upstream file at a recorded commit, update the commit in
this file *and* the header constants inside `generate-acp-types.mjs`, regenerate,
and re-run the smoke fixture against `omp acp`.

## Verification status at pin time

- Generated file compiles under `tsc --strict --noEmit`.
- Regen determinism verified (two runs, byte-identical).
- Live handshake + prompt→response round trip against real `omp acp`: see
  `fixtures/acp-smoke.jsonl`.
