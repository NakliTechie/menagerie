/**
 * Menagerie relay protocol — canonical message type definitions.
 *
 *   protocol-v1.0
 *
 * Single source of truth for message shapes. The browser app consumes these
 * types directly; the Go relay hand-ports them into `internal/protocol/`.
 * `protocol.md` is the human-readable reference and MUST stay in sync — if the
 * two disagree, this file wins.
 *
 * Transport: WebSocket. JSON text frames only in v1.0 (no binary frames; PTY
 * bytes travel base64-encoded inside `output.data`). One WebSocket connection
 * per browser↔relay pair; multiple sessions multiplex over it via `session_id`.
 */

export const PROTOCOL_VERSION = "1.1" as const;

// ---- Shared scalar types --------------------------------------------------

/** GOOS-style OS identifier a relay reports. Windows is not shipped in v1.0. */
export type HostOS = "darwin" | "linux";

/** GOARCH-style architecture a relay reports. */
export type HostArch = "amd64" | "arm64";

/** Stream transport kinds. v1.0 ships "pty" only. */
export type Transport = "pty";

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
  protocol_version: string; // e.g. "1.0"
  relay_version: string; // e.g. "0.1.0"
  relay_name: string; // human label, e.g. "m4pro-home"
  host_os: HostOS;
  host_arch: HostArch;
  agents: string[]; // agent ids this relay can spawn (display alphabetically)
  transports: Transport[]; // ["pty"] in v1.0
  hosts_children: boolean; // false in v1.0 (supervisor trees are v1.1)
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
  | ErrorMessage;

export type BrowserToRelayMessage =
  | RegisterMessage
  | SpawnMessage
  | AttachMessage
  | InputMessage
  | SignalMessage
  | ResumeMessage
  | ErrorMessage;

export type Message = RelayToBrowserMessage | BrowserToRelayMessage;
