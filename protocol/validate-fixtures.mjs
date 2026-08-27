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
const EVENTS = ["exited", "idle", "needs_input", "child_spawned", "rate_limited", "stalled"];
const OUTCOMES = ["approve", "reject", "approve_always"];

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
  spawn: shape({
    type: [(v) => v === "spawn", true],
    agent: [isStr, true],
    cwd: [isStr, true],
    args: [strArr, true],
    env: [(v) => obj(v), true],
    client_id: [isStr, true],
    transport: [(v) => TRANSPORTS.includes(v), false],
    parent_session_id: [isStr, false], // protocol 1.3
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
