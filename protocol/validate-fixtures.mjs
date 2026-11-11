#!/usr/bin/env node
// Fixture validation suite for the Menagerie relay protocol.
//
//   node validate-fixtures.mjs
//
// Validates every *.json fixture under fixtures/frames/ against the shapes in
// types.ts, and asserts catalog coverage (one+ fixture per message type). The
// shape table below mirrors types.ts by hand — if they disagree, types.ts wins
// and this table is the bug. Exit 0 = all pass; nonzero = failures printed.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const framesDir = join(here, "fixtures", "frames");

const isStr = (v) => typeof v === "string" && v.length > 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isBool = (v) => typeof v === "boolean";

function obj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** spec: { field: [checker, required] } — unknown fields allowed (forward compat). */
function shape(spec) {
  return (msg) => {
    const errs = [];
    for (const [field, [check, req]] of Object.entries(spec)) {
      const v = msg[field];
      if (v === undefined) {
        if (req) errs.push(`missing ${field}`);
        continue;
      }
      const r = check(v);
      if (r !== true) errs.push(`bad ${field}: ${r === false ? JSON.stringify(v)?.slice(0, 60) : r}`);
    }
    return errs;
  };
}

const TRANSPORTS = ["pty", "acp"];
const SIGNALS = ["kill", "interrupt", "resize"];
const STATUSES = ["running", "idle", "done", "needs_input", "stalled", "rate_limited", "exited", "unknown"];
const EVENTS = ["exited", "idle", "done", "needs_input", "child_spawned", "rate_limited", "stalled", "unknown", "running"];
const OUTCOMES = ["approve", "reject", "approve_always"];

const READ_STATES = [
  "ok", "not_repository", "no_directory", "unavailable", "timeout", "busy",
  "gh_missing", "not_authenticated", "rate_limited", "no_remote", "no_pr", "not_found",
];
const BUCKETS = ["pass", "fail", "pending", "skipping", "cancel"];
const isReqId = (v) => (typeof v === "string" && v.length >= 1 && v.length <= 64 ? true : "expected 1–64 char request_id");
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
const isPosInt = (v) => Number.isInteger(v) && v > 0;
const isRepo = (v) => (typeof v === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v) ? true : "expected owner/name");
const isKind = (v) => v === "pr" || v === "issue";
const readState = (v) => (READ_STATES.includes(v) ? true : `expected one of ${READ_STATES}`);
const inboxItems = (v) =>
  Array.isArray(v) &&
  v.length <= 50 &&
  v.every((i) => obj(i) && isKind(i.kind) && isRepo(i.repo) === true && isPosInt(i.number) && typeof i.title === "string" && i.title.length <= 200 && isStr(i.url))
    ? true
    : "expected InboxItem[] (≤ 50)";

const optBool = (v) => v === undefined || isBool(v);
const itemDetail = shape({
  kind: [isKind, true],
  repo: [isRepo, true],
  number: [isPosInt, true],
  title: [(v) => typeof v === "string", true],
  url: [isStr, true],
  body: [(v) => typeof v === "string" && v.length <= 16384, false],
  body_truncated: [optBool, false],
  cross_repository: [optBool, false],
  maintainer_can_modify: [optBool, false],
});

const strArr = (v) => (Array.isArray(v) && v.every(isStr) ? true : "expected string[]");
const transportArr = (v) =>
  Array.isArray(v) && v.every((t) => TRANSPORTS.includes(t)) ? true : `expected subset of ${TRANSPORTS}`;

const S = {
  hello: shape({
    type: [(v) => v === "hello", true],
    protocol_version: [isStr, true],
    relay_version: [isStr, true],
    relay_name: [isStr, true],
    host_os: [(v) => ["darwin", "linux"].includes(v), true],
    host_arch: [(v) => ["amd64", "arm64"].includes(v), true],
    agents: [strArr, true],
    transports: [transportArr, true],
    hosts_children: [isBool, true],
    resume_agents: [strArr, false], // agents that can reopen their own past conversations
    capabilities: [strArr, false], // protocol 1.5: capability-gated reads
    agent_transports: [
      (v) =>
        obj(v) &&
        Object.entries(v).every(([k, t]) => isStr(k) && Array.isArray(t) && t.every((x) => TRANSPORTS.includes(x)))
          ? true
          : "expected Record<agentId, Transport[]>",
      false,
    ],
  }),
  register: shape({ type: [(v) => v === "register", true], registration_token: [isStr, true] }),
  registered: shape({ type: [(v) => v === "registered", true] }),
  sessions: shape({
    type: [(v) => v === "sessions", true],
    sessions: [
      (v) =>
        Array.isArray(v) &&
        v.every((s) => obj(s) && isStr(s.session_id) && isStr(s.agent) && isStr(s.started_at) && isNum(s.pid))
          ? true
          : "expected SessionInfo[]",
      true,
    ],
  }),
  attach: shape({ type: [(v) => v === "attach", true], session_id: [isStr, true] }),
  attached: shape({
    type: [(v) => v === "attached", true],
    session_id: [isStr, true],
    session_token: [isStr, true],
    agent: [isStr, true],
    started_at: [isStr, true],
    pid: [isNum, true],
  }),
  report_status: shape({
    type: [(v) => v === "report_status", true],
    session_id: [isStr, true],
    session_token: [isStr, true],
    // `exited` is not self-declarable — a process ending is observed.
    state: [(v) => STATUSES.includes(v) && v !== "exited", true],
    message: [isStr, false],
  }),
  wait: shape({
    type: [(v) => v === "wait", true],
    session_id: [isStr, true],
    session_token: [isStr, true],
    until: [(v) => strArr(v) && v.length > 0 && v.every((x) => STATUSES.includes(x)), true],
    timeout_ms: [isNum, false],
    wait_id: [isStr, false],
  }),
  waited: shape({
    type: [(v) => v === "waited", true],
    session_id: [isStr, true],
    wait_id: [isStr, false],
    state: [(v) => STATUSES.includes(v), true],
    timed_out: [isBool, true],
    brokered: [isBool, false],
  }),
  seen: shape({
    type: [(v) => v === "seen", true],
    session_id: [isStr, true],
    session_token: [isStr, true],
  }),
  spawn: shape({
    type: [(v) => v === "spawn", true],
    agent: [isStr, true],
    cwd: [isStr, true],
    args: [strArr, true],
    env: [(v) => obj(v), true],
    client_id: [isStr, true],
    transport: [(v) => TRANSPORTS.includes(v), false],
    parent_session_id: [isStr, false], // protocol 1.3
    resume_agent_session: [isStr, false], // reopen the agent's own past conversation
  }),
  spawned: shape({
    type: [(v) => v === "spawned", true],
    session_id: [isStr, true],
    client_id: [isStr, true],
    session_token: [isStr, true],
    agent: [isStr, true],
    pid: [isNum, true],
    started_at: [isStr, true],
    parent_session_id: [isStr, false], // protocol 1.3
    agent_session_id: [isStr, false], // the agent's own session reference
    status: [isStr, false], // the relay's tracked status, additive 2026-09-08
  }),
  output: shape({
    type: [(v) => v === "output", true],
    session_id: [isStr, true],
    data: [isStr, true],
    seq: [isNum, true],
  }),
  input: shape({
    type: [(v) => v === "input", true],
    session_id: [isStr, true],
    session_token: [isStr, true],
    data: [(v) => typeof v === "string", true],
  }),
  signal: shape({
    type: [(v) => v === "signal", true],
    session_id: [isStr, true],
    session_token: [isStr, true],
    signal: [(v) => SIGNALS.includes(v), true],
    cols: [isNum, false],
    rows: [isNum, false],
    subtree: [isBool, false], // protocol 1.3; kill-subtree
  }),
  event: shape({
    type: [(v) => v === "event", true],
    session_id: [isStr, true],
    event: [(v) => EVENTS.includes(v), true],
    exit_code: [isNum, false],
    child_session_id: [isStr, false],
    at: [isStr, true],
  }),
  resume: shape({
    type: [(v) => v === "resume", true],
    session_id: [isStr, true],
    session_token: [isStr, true],
    last_seq: [isNum, true],
  }),
  resume_failed: shape({ type: [(v) => v === "resume_failed", true], session_id: [isStr, true] }),
  error: shape({
    type: [(v) => v === "error", true],
    session_id: [isStr, false],
    code: [isStr, true],
    message: [isStr, true],
  }),
  // protocol 1.2 — structured sessions. `acp` payloads are opaque here BY DESIGN:
  // the relay must not interpret them, so the validator only checks nesting.
  session_update: shape({
    type: [(v) => v === "session_update", true],
    session_id: [isStr, true],
    seq: [isNum, true],
    acp: [obj, true],
  }),
  permission_request: shape({
    type: [(v) => v === "permission_request", true],
    session_id: [isStr, true],
    request_id: [isStr, true],
    seq: [isNum, true],
    acp: [obj, true],
  }),
  permission_response: shape({
    type: [(v) => v === "permission_response", true],
    session_id: [isStr, true],
    session_token: [isStr, true],
    request_id: [isStr, true],
    outcome: [(v) => OUTCOMES.includes(v), true],
    option_id: [isStr, false],
  }),
  prompt: shape({
    type: [(v) => v === "prompt", true],
    session_id: [isStr, true],
    session_token: [isStr, true],
    text: [isStr, true],
    // §8.2 atomic prompt+wait: same rules as a standalone wait's `until`.
    wait: [(v) => obj(v) && strArr(v.until) && v.until.length > 0 && v.until.every((x) => STATUSES.includes(x)), false],
  }),
  // protocol 1.5 — capability-gated repository and GitHub reads.
  git_status: shape({
    type: [(v) => v === "git_status", true],
    session_id: [isStr, true],
    session_token: [isStr, true],
    request_id: [isReqId, true],
  }),
  git_status_result: shape({
    type: [(v) => v === "git_status_result", true],
    session_id: [isStr, true],
    request_id: [isReqId, true],
    state: [readState, true],
    branch: [isStr, false],
    detached: [isBool, false],
    unborn: [isBool, false],
    head: [isStr, false],
    upstream: [isStr, false],
    ahead: [isNonNegInt, false],
    behind: [isNonNegInt, false],
    files: [
      (v) =>
        Array.isArray(v) && v.length <= 200 && v.every((f) => obj(f) && isStr(f.path) && isStr(f.index) && isStr(f.worktree))
          ? true
          : "expected GitFileEntry[] (≤ 200)",
      false,
    ],
    files_total: [isNonNegInt, false],
    truncated: [isBool, false],
  }),
  github_inbox: shape({ type: [(v) => v === "github_inbox", true], request_id: [isReqId, true] }),
  github_inbox_result: shape({
    type: [(v) => v === "github_inbox_result", true],
    request_id: [isReqId, true],
    state: [readState, true],
    review_requested: [inboxItems, false],
    assigned: [inboxItems, false],
    truncated: [isBool, false],
  }),
  github_item: shape({
    type: [(v) => v === "github_item", true],
    request_id: [isReqId, true],
    kind: [isKind, true],
    repo: [isRepo, true],
    number: [isPosInt, true],
  }),
  github_item_result: shape({
    type: [(v) => v === "github_item_result", true],
    request_id: [isReqId, true],
    state: [readState, true],
    item: [(v) => (obj(v) && itemDetail(v).length === 0 ? true : `expected GitHubItemDetail: ${obj(v) ? itemDetail(v) : "not an object"}`), false],
  }),
  session_pr: shape({
    type: [(v) => v === "session_pr", true],
    session_id: [isStr, true],
    session_token: [isStr, true],
    request_id: [isReqId, true],
  }),
  session_pr_result: shape({
    type: [(v) => v === "session_pr_result", true],
    session_id: [isStr, true],
    request_id: [isReqId, true],
    state: [readState, true],
    pr: [(v) => (obj(v) && isPosInt(v.number) && isStr(v.url) && isStr(v.state) ? true : "expected SessionPrInfo"), false],
    checks: [
      (v) =>
        Array.isArray(v) && v.length <= 100 && v.every((c) => obj(c) && isStr(c.name) && BUCKETS.includes(c.bucket))
          ? true
          : "expected SessionPrCheck[] (≤ 100)",
      false,
    ],
    summary: [(v) => (obj(v) && BUCKETS.every((b) => isNonNegInt(v[b])) ? true : "expected bucket counts"), false],
    checks_total: [isNonNegInt, false],
    truncated: [isBool, false],
  }),
};

let pass = 0;
let fail = 0;
const covered = new Set();

for (const f of readdirSync(framesDir).sort()) {
  if (!f.endsWith(".json")) continue;
  let msg;
  try {
    msg = JSON.parse(readFileSync(join(framesDir, f), "utf8"));
  } catch (e) {
    console.error(`FAIL ${f}: not valid JSON (${e.message})`);
    fail++;
    continue;
  }
  const check = S[msg.type];
  if (!check) {
    console.error(`FAIL ${f}: unknown frame type "${msg.type}"`);
    fail++;
    continue;
  }
  const errs = check(msg);
  if (errs.length) {
    console.error(`FAIL ${f}:\n  - ${errs.join("\n  - ")}`);
    fail++;
  } else {
    covered.add(msg.type);
    pass++;
  }
}

const missing = Object.keys(S).filter((t) => !covered.has(t));
if (missing.length) {
  console.error(`FAIL coverage: no fixture for frame types: ${missing.join(", ")}`);
  fail++;
}

console.log(`${pass} fixtures passed, ${fail} failed, ${covered.size}/${Object.keys(S).length} frame types covered`);
process.exit(fail ? 1 : 0);
