/**
 * Menagerie relay protocol — canonical message type definitions.
 *
 *   protocol-v1.3 (+ capability-gated 1.5 reads; see `hello.capabilities`)
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

export const PROTOCOL_VERSION = "1.3" as const;

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
/** `done` = the agent finished and nobody has looked yet; a `seen` frame demotes
 *  it to `idle`. Splitting them is what lets the attention badge mean "waiting
 *  on you" rather than "was busy at some point" (spec §8.1.1 E5). */
export type SessionEvent =
  | "exited" | "idle" | "done" | "needs_input" | "child_spawned" | "rate_limited" | "stalled"
  /** only from a self-report (§8.3): present but unclassifiable */
  | "unknown" | "running";

/** Lifecycle statuses the relay tracks server-side, so `wait` can resolve
 *  against them. `unknown` = present but unclassifiable — never a claim of
 *  completion, and it never satisfies a wait unless the caller named it (E3). */
export type SessionStatus = "running" | "idle" | "done" | "needs_input" | "stalled" | "rate_limited" | "exited" | "unknown";

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
  | "session_taken" // (1.3) another client attached; this client's token is void — re-attach to view again
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
  /**
   * Agent ids this relay can restart into one of their own past conversations
   * (see `spawn.resume_agent_session`). Absent ⇒ the relay resumes nothing.
   */
  resume_agents?: string[];
  /**
   * Protocol 1.5: optional feature names this relay or runtime serves
   * (`session_git_v1`, `github_inbox_v1`, `session_pr_v1`). Absent ⇒ none.
   * Clients gate the 1.5 reads on these names, never on `protocol_version`.
   */
  capabilities?: Capability[];
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
  parent_session_id?: string; // protocol 1.3; set when spawned as a child (supervisor tree)
  /** The agent's OWN session reference, when it issued one (structured sessions
   *  do, at session/new). Persist it: handing it back as
   *  `spawn.resume_agent_session` is what reopens this conversation later. */
  agent_session_id?: string;
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
  transport?: Transport; // protocol 1.2; absent ⇒ pty (so re-attach doesn't guess from agent capability)
  parent_session_id?: string; // protocol 1.3; present for a child session, so re-attach rebuilds the tree
  agent_session_id?: string; // the agent's own session reference, if it issued one
  status?: SessionStatus; // the relay's tracked status (additive, 2026-09-08); absent ⇒ assume running (pre-2026-09-08 relay)
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
  /** protocol 1.3: spawn this as a child of a live session (supervisor tree). An
   *  unknown/dead parent is ignored — the session spawns at root, never fails. */
  parent_session_id?: string;
  /**
   * Ask the agent to reopen one of ITS OWN past conversations, identified by a
   * reference the agent issued. Not to be confused with the `resume` frame,
   * which re-attaches this browser to a still-live relay session. Only agents
   * listed in `hello.resume_agents` accept it; anything else is refused rather
   * than spawned fresh, so a resume never silently loses the conversation.
   */
  resume_agent_session?: string;
}

/**
 * Report that a human actually looked at this session. The ONLY thing that
 * demotes `done` (finished, unseen) to `idle`. Reading a session over the
 * protocol must not send this: a supervisor polling its workers would silently
 * clear the human's attention badge (spec §8.1.1 E5).
 */
export interface SeenMessage extends BaseMessage {
  type: "seen";
  session_id: string;
  session_token: string;
}

/**
 * Park until a session reaches one of `until`. Server-owned and event-driven:
 * the relay resolves on a transition it already tracks, so no client polls.
 * A wait whose condition is ALREADY true resolves immediately (spec §8.1.1 E1).
 * Only states the caller names satisfy it — `unknown` included (E3).
 */
/** The wait half of an atomic prompt+wait (spec §8.2). */
/**
 * An agent declaring its own lifecycle state (spec §8.3). More reliable than
 * the relay's output heuristics, which is the point. E9: from the first report
 * the relay stops applying those heuristics to this session — one status
 * authority, never two, because two sources make the status flicker and neither
 * can be debugged. `exited` is not declarable: a process ending is observed.
 * `message` is display-only and never drives a wait.
 */
export interface ReportStatusMessage extends BaseMessage {
  type: "report_status";
  session_id: string;
  session_token: string;
  state: Exclude<SessionStatus, "exited">;
  message?: string;
}

export interface WaitSpec {
  until: SessionStatus[];
  timeout_ms?: number;
  wait_id?: string;
}

export interface WaitMessage extends BaseMessage {
  type: "wait";
  session_id: string;
  session_token: string;
  until: SessionStatus[]; // at least one; an unknown value is refused, not ignored
  timeout_ms?: number; // absent ⇒ a relay default; there is no unbounded wait
  wait_id?: string; // echoed back, so one client can hold several waits per session
}

/** Resolution of a WaitMessage. */
export interface WaitedMessage extends BaseMessage {
  type: "waited";
  session_id: string;
  wait_id?: string;
  state: SessionStatus; // the state as it stands — on timeout, NOT the one awaited
  timed_out: boolean;
  /** Set by a broker that composed this wait across relays, never by a relay.
   *  A brokered wait lives only as long as its broker; a relay-owned one has the
   *  durability of the relay. A supervisor needs to be able to tell them apart. */
  brokered?: boolean;
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
  subtree?: boolean; // protocol 1.3; kill only — also kill every descendant (leaf-first)
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
  /**
   * Arm a wait in the SAME frame (spec §8.2), so the transition this prompt
   * causes cannot land in the gap between a separate prompt and wait. The relay
   * arms it before dispatching. A prompt to a session already waiting on a human
   * decision is refused with `session_blocked` and nothing is sent — an approval
   * dialog would read the prompt as its answer (E6).
   */
  wait?: WaitSpec;
}

// ---- Repository context (protocol 1.5, capability-gated) -------------------
//
// Read-only Git and GitHub context. Every request below is sent only to a relay
// whose `hello.capabilities` lists the matching name. The browser never names a
// filesystem path; session reads use the directory the runtime recorded at
// spawn. Reads never change lifecycle state, take control, clear `done`, or
// write to Git or GitHub. Refresh is explicit; nothing polls.

/** Known 1.5 capability names; the set is open-ended. */
export type Capability = "session_git_v1" | "github_inbox_v1" | "session_pr_v1" | (string & {});

/** Result state shared by every 1.5 read. Anything but `ok` carries no data. */
export type ReadState =
  | "ok"
  | "not_repository"
  | "no_directory" // the runtime recorded no directory (e.g. an adopted tmux session)
  | "unavailable"
  | "timeout"
  | "busy" // too many reads in flight
  | "gh_missing"
  | "not_authenticated"
  | "rate_limited"
  | "no_remote"
  | "no_pr"
  | "not_found"
  | (string & {});

/** Git porcelain-v2 status letter: `.` unchanged, `?` untracked. */
export type GitStatusLetter = "." | "M" | "A" | "D" | "R" | "C" | "U" | "?" | "T" | "!" | (string & {});

export interface GitFileEntry {
  path: string;
  index: GitStatusLetter;
  worktree: GitStatusLetter;
}

/** Browser → relay (`session_git_v1`). */
export interface GitStatusMessage extends BaseMessage {
  type: "git_status";
  session_id: string;
  session_token: string;
  request_id: string; // 1–64 characters, echoed in the result
}

/** Relay → browser. `branch` absent when detached; `head` absent when unborn;
 *  `upstream`/`ahead`/`behind` absent without an upstream. `files` ≤ 200. */
export interface GitStatusResultMessage extends BaseMessage {
  type: "git_status_result";
  session_id: string;
  request_id: string;
  state: ReadState;
  branch?: string;
  detached?: boolean;
  unborn?: boolean;
  head?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  files?: GitFileEntry[];
  files_total?: number;
  truncated?: boolean;
}

export interface GitHubInboxItem {
  kind: "pr" | "issue";
  repo: string; // owner/name
  number: number;
  title: string; // ≤ 200 characters
  url: string;
  author?: string;
  updated_at?: string;
  draft?: boolean; // pull requests
  labels?: string[]; // issues
}

/** Browser → relay (`github_inbox_v1`); registration authority, no session. */
export interface GitHubInboxMessage extends BaseMessage {
  type: "github_inbox";
  request_id: string;
}

/** Relay → browser. Each lane holds at most 50 items, newest first. */
export interface GitHubInboxResultMessage extends BaseMessage {
  type: "github_inbox_result";
  request_id: string;
  state: ReadState;
  review_requested?: GitHubInboxItem[];
  assigned?: GitHubInboxItem[];
  truncated?: boolean;
}

/** Browser → relay (`github_inbox_v1`): one issue or pull request for a handoff. */
export interface GitHubItemMessage extends BaseMessage {
  type: "github_item";
  request_id: string;
  kind: "pr" | "issue";
  repo: string; // owner/name: letters, digits, -, _, .
  number: number; // positive integer
}

export interface GitHubItemDetail {
  kind: "pr" | "issue";
  repo: string;
  number: number;
  title: string;
  url: string;
  author?: string;
  state?: string;
  body?: string; // ≤ 16 KiB; rendered as text, used only to prefill an editable draft
  body_truncated?: boolean;
  labels?: string[];
  // pull requests only
  head_ref?: string;
  head_repo?: string;
  cross_repository?: boolean;
  maintainer_can_modify?: boolean;
}

export interface GitHubItemResultMessage extends BaseMessage {
  type: "github_item_result";
  request_id: string;
  state: ReadState;
  item?: GitHubItemDetail;
}

/** Browser → relay (`session_pr_v1`). */
export interface SessionPrMessage extends BaseMessage {
  type: "session_pr";
  session_id: string;
  session_token: string;
  request_id: string;
}

export type CheckBucket = "pass" | "fail" | "pending" | "skipping" | "cancel" | (string & {});

export interface SessionPrCheck {
  name: string;
  workflow?: string;
  bucket: CheckBucket;
  state?: string;
  link?: string; // opened in a new tab, never fetched
}

export interface SessionPrInfo {
  number: number;
  url: string;
  state: string; // OPEN | CLOSED | MERGED
  draft?: boolean;
  review_decision?: string;
  merge_state?: string;
  head_ref?: string;
  head_oid?: string;
  cross_repository?: boolean;
}

/** Relay → browser. `state: "no_pr"` ⇒ the session's branch has no pull request. */
export interface SessionPrResultMessage extends BaseMessage {
  type: "session_pr_result";
  session_id: string;
  request_id: string;
  state: ReadState;
  pr?: SessionPrInfo;
  checks?: SessionPrCheck[]; // latest run of each check, ≤ 100
  summary?: Record<"pass" | "fail" | "pending" | "skipping" | "cancel", number>;
  checks_total?: number;
  truncated?: boolean;
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
  | GitStatusResultMessage
  | GitHubInboxResultMessage
  | GitHubItemResultMessage
  | SessionPrResultMessage
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
  | GitStatusMessage
  | GitHubInboxMessage
  | GitHubItemMessage
  | SessionPrMessage
  | ErrorMessage;

export type Message = RelayToBrowserMessage | BrowserToRelayMessage;
