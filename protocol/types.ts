/**
 * Menagerie relay protocol — canonical message type definitions.
 *
 *   protocol-v1.2
 *
 * Single source of truth for message shapes. The browser app consumes these
 * types directly; the Go relay hand-ports them into `internal/protocol/`.
 * `protocol.md` is the human-readable reference and MUST stay in sync — if the
 * two disagree, this file wins.
 *
 * Transport: WebSocket. JSON text frames only; PTY bytes travel base64-encoded
 * inside `output.data`. One WebSocket connection per browser↔relay pair;
 * multiple sessions multiplex over it via `session_id`.
 *
 * v1.2 adds structured sessions (`transport: "acp"`): ACP payloads ride nested
 * inside Menagerie frames (`session_update`, `permission_request`,
 * `permission_response`, `prompt`) and are never flattened — the ACP pin stays
 * swappable without a protocol major. See `acp-pin.md` + `acp-types.ts`.
 */

export const PROTOCOL_VERSION = "1.2" as const;

// ---- Shared scalar types --------------------------------------------------

/** GOOS-style OS identifier a relay reports. Windows is not shipped. */
export type HostOS = "darwin" | "linux";

/** GOARCH-style architecture a relay reports. */
export type HostArch = "amd64" | "arm64";

/**
 * Stream transport kinds. `"pty"` streams raw terminal bytes (v1.0);
 * `"acp"` is a structured session whose child speaks the pinned Agent Client
 * Protocol over stdio (v1.2). Unknown transports are ignored by clients.
 */
export type Transport = "pty" | "acp";

/** Control signals the browser can send to a session. */
export type SignalKind = "kill" | "interrupt" | "resize";

/** Async lifecycle events a relay emits for a session. */
export type SessionEvent = "exited" | "idle" | "needs_input" | "child_spawned" | "rate_limited" | "stalled";

/**
 * Error codes carried in `error` frames. The set is open-ended (§4): clients
 * MUST tolerate unknown codes. The named members below are the v1.0 catalog.
 * `(string & {})` keeps literal autocomplete while permitting any string.
 */
export type ErrorCode =
  | "auth_failed" // registration token rejected; relay closes the connection
  | "unknown_agent" // spawn requested an agent not in hello.agents
  | "spawn_failed" // relay could not start the agent (bad cwd, exec error, …)
  | "invalid_token" // input/signal/resume carried a wrong/missing session_token
  | (string & {});

// ---- Message envelope -----------------------------------------------------

/**
 * Every message is a JSON object discriminated by `type`. `session_id` is
 * present on all per-session messages and omitted for `hello`, `register`,
 * and `registered`.
 */
export interface BaseMessage {
  type: string;
  session_id?: string;
}

// ===========================================================================
// Relay → Browser
// ===========================================================================

/** Sent by the relay immediately on connect, before anything else. */
export interface HelloMessage extends BaseMessage {
  type: "hello";
  protocol_version: string; // e.g. "1.2"
  relay_version: string; // e.g. "0.5.0"
  relay_name: string; // human label, e.g. "m4pro-home"
  host_os: HostOS;
  host_arch: HostArch;
  agents: string[]; // agent ids this relay can spawn (display alphabetically)
  transports: Transport[]; // ["pty"] pre-1.2 relays; ["pty","acp"] with structured support
  hosts_children: boolean; // false through protocol 1.2 (supervisor trees deferred)
  /**
   * Per-agent spawn forms: agent id → transports it may be spawned under.
   * Absent (pre-1.2 relays) ⇒ every listed `agents` entry spawns as `"pty"`.
   */
  agent_transports?: Record<string, Transport[]>;
}

/**
 * Acknowledges a successful `register`. Auth failure is NOT a `registered`
 * variant — it is reported via an `error` frame with code "auth_failed",
 * after which the relay closes the connection.
 */
export interface RegisteredMessage extends BaseMessage {
  type: "registered";
}

/** The relay's response to a `spawn`. Carries the session's ephemeral token. */
export interface SpawnedMessage extends BaseMessage {
  type: "spawned";
  session_id: string; // server-issued
  client_id: string; // echoed from the spawn request, for correlation
  session_token: string; // opaque; required on all later input/signal/resume
  agent: string;
  pid: number;
  started_at: string; // ISO-8601 UTC
}

/**
 * Streamed PTY output. `seq` is monotonic per session; the browser uses it for
 * ordering and as the `last_seq` cursor on `resume`. (Relay-defined start; the
 * browser relies only on monotonicity, not the first value.)
 */
export interface OutputMessage extends BaseMessage {
  type: "output";
  session_id: string;
  data: string; // base64-encoded raw PTY bytes
  seq: number;
}

/** Async session lifecycle. Which optional fields apply depends on `event`. */
export interface EventMessage extends BaseMessage {
  type: "event";
  session_id: string;
  event: SessionEvent;
  exit_code?: number; // present for "exited"
  child_session_id?: string; // present for "child_spawned"
  at: string; // ISO-8601 UTC
}

/**
 * The relay could not satisfy a `resume` (the session is gone, e.g. the relay
 * restarted). The browser falls back to FSA replay.
 */
export interface ResumeFailedMessage extends BaseMessage {
  type: "resume_failed";
  session_id: string;
}

/** One live session in a `sessions` list (protocol 1.1). */
export interface SessionInfo {
  session_id: string;
  agent: string;
  started_at: string; // ISO-8601 UTC
  pid: number;
}

/** Live session list, sent right after `registered`, so a reconnecting client can re-attach (protocol 1.1). */
export interface SessionsMessage extends BaseMessage {
  type: "sessions";
  sessions: SessionInfo[];
}

/** Confirms a re-attach and issues a fresh session token; the relay then replays buffered output (protocol 1.1). */
export interface AttachedMessage extends BaseMessage {
  type: "attached";
  session_id: string;
  session_token: string;
  agent: string;
  started_at: string;
  pid: number;
}

// ===========================================================================
// Browser → Relay
// ===========================================================================

/** Register this client against the relay using the install-time token. */
export interface RegisterMessage extends BaseMessage {
  type: "register";
  registration_token: string;
}

/** Request a new agent session. */
export interface SpawnMessage extends BaseMessage {
  type: "spawn";
  agent: string; // must be one of hello.agents
  cwd: string; // relay validates
  args: string[]; // passed to the shim; the shim decides how to format them
  env: Record<string, string>;
  client_id: string; // client-generated UUID, echoed back in `spawned`
  /** Absent ⇒ "pty", so stored pre-1.2 session definitions keep working. */
  transport?: Transport;
}

/** Send input (keystrokes) to a session's PTY. */
export interface InputMessage extends BaseMessage {
  type: "input";
  session_id: string;
  session_token: string;
  data: string; // UTF-8; raw keystrokes including control characters
}

/** Send a control signal to a session. `cols`/`rows` apply only to "resize". */
export interface SignalMessage extends BaseMessage {
  type: "signal";
  session_id: string;
  session_token: string;
  signal: SignalKind; // kill=SIGKILL, interrupt=SIGINT, resize=set window size
  cols?: number; // resize only
  rows?: number; // resize only
}

/**
 * Ask the relay to replay all frames after `last_seq` (used after a transient
 * disconnect within a still-live session). The relay replies with the missing
 * `output` frames, or a `resume_failed` if the session is gone.
 */
export interface ResumeMessage extends BaseMessage {
  type: "resume";
  session_id: string;
  session_token: string;
  last_seq: number;
}

/** Re-attach a registered client to an existing live session (protocol 1.1). The
 *  registration token (already presented via `register`) is the authority; the
 *  relay issues a fresh session_token in the `attached` reply. */
export interface AttachMessage extends BaseMessage {
  type: "attach";
  session_id: string;
}

// ---- Structured sessions (protocol 1.2) ------------------------------------
//
// A `transport:"acp"` session streams Menagerie frames whose ACP payloads ride
// NESTED and uninterpreted — the transport layer forwards, the render layer
// reads. ACP shapes live in `acp-types.ts`, generated from `acp-pin.md`; no
// frame here flattens them, so the pin can move without another protocol bump.

/** Relay → browser: wraps ONE ACP agent→client notification, verbatim. */
export interface SessionUpdateMessage extends BaseMessage {
  type: "session_update";
  session_id: string;
  seq: number; // monotonic per structured session; independent of output.seq
  acp: unknown; // one ACP agent→client message (e.g. a session/update notification)
}

/** Relay → browser: the agent asks to proceed. Review happens on drill-in. */
export interface PermissionRequestMessage extends BaseMessage {
  type: "permission_request";
  session_id: string;
  request_id: string; // relay-correlated id; echo it in permission_response
  seq: number;
  acp: unknown; // nested ACP permission request (options, tool call, diffs)
}

/** Browser → relay: answer to a permission_request. */
export interface PermissionResponseMessage extends BaseMessage {
  type: "permission_response";
  session_id: string;
  session_token: string;
  request_id: string; // echoes permission_request.request_id
  outcome: PermissionOutcome;
  /** Explicit ACP option id when the UI picks precisely; otherwise the relay maps `outcome`. */
  option_id?: string;
}

/** Approve-always is SESSION-scoped only — never persisted across sessions (v1.2). */
export type PermissionOutcome = "approve" | "reject" | "approve_always";

/**
 * Browser → relay: prompt a structured session. The structured analogue of
 * v1.0's `input`; `input` stays PTY-only and must not be overloaded.
 */
export interface PromptMessage extends BaseMessage {
  type: "prompt";
  session_id: string;
  session_token: string;
  text: string; // relay maps to ACP content blocks
}

// ===========================================================================
// Either direction
// ===========================================================================

export interface ErrorMessage extends BaseMessage {
  type: "error";
  session_id?: string; // present when the error pertains to a session
  code: ErrorCode;
  message: string; // human-readable
}

// ---- Unions ---------------------------------------------------------------

export type RelayToBrowserMessage =
  | HelloMessage
  | RegisteredMessage
  | SessionsMessage
  | SpawnedMessage
  | AttachedMessage
  | OutputMessage
  | EventMessage
  | ResumeFailedMessage
  | SessionUpdateMessage
  | PermissionRequestMessage
  | ErrorMessage;

export type BrowserToRelayMessage =
  | RegisterMessage
  | SpawnMessage
  | AttachMessage
  | InputMessage
  | SignalMessage
  | ResumeMessage
  | PromptMessage
  | PermissionResponseMessage
  | ErrorMessage;

export type Message = RelayToBrowserMessage | BrowserToRelayMessage;
