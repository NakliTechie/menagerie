# Menagerie protocol

> **protocol-v1.0** · the durable artifact

The WebSocket protocol every Menagerie relay and client implements. The browser app is one client; a supervisor agent is another. Get this right and both implementations follow.

- **[`protocol.md`](./protocol.md)** — human-readable reference: transport, auth, connection lifecycle, full message catalog, error codes, versioning.
- **[`types.ts`](./types.ts)** — canonical message type definitions (single source of truth). The Go relay hand-ports these into `relay-go/internal/protocol/`.

If `protocol.md` and `types.ts` ever disagree, **`types.ts` wins** and `protocol.md` is the bug.

## At a glance

- **Transport:** WebSocket — WSS preferred, WS allowed for local relays. JSON text frames only in v1.0; PTY bytes ride base64 inside `output.data`.
- **Multiplexing:** one connection per browser↔relay pair; sessions are distinguished by `session_id`.
- **Auth:** an install-time registration token authorises a client to a relay; the relay mints an ephemeral per-session token (returned in `spawned`) required on every `input`/`signal`/`resume`.
- **Versioning:** semantic, `protocol-v<major>.<minor>`. The browser checks `hello.protocol_version`; on mismatch it warns and attempts anyway.
