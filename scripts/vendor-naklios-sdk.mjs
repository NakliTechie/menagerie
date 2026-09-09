#!/usr/bin/env node
// vendor-naklios-sdk.mjs — keep an app's inlined naklios.js SDK fresh.
//
// The canonical SDK lives at https://naklios.dev/sdk/naklios.js (repo
// NakliTechie/nakliOS → sdk/naklios.js). Apps that run standalone (cross-origin,
// or single-file) can't <script src> it, so they vendor it INLINE. This script
// re-splices the canonical source between two JS-comment markers, so a vendored
// copy is never hand-edited and never silently rots.
//
// This is the "app-side re-splice" method: each app copies THIS script into its
// own repo and runs it from CI (see .github/workflows/vendor-sdk.yml in docs).
// No cross-repo tokens — the app pulls; naklios never pushes.
//
// The markers are JS block comments placed INSIDE the <script> that holds the
// SDK, bracketing the SDK IIFE. That works whether the SDK sits in its own
// <script> or shares one with app code:
//
//   /* naklios-sdk:begin ver=N sha256=… */
//   (function () { … the SDK … })();
//   /* naklios-sdk:end */
//
// One-time per app: run with --adopt to place the markers around the existing
// inlined SDK; thereafter plain runs keep it fresh.
//
// Usage:
//   node scripts/vendor-naklios-sdk.mjs [--file index.html]
//                                       [--canonical <url-or-path>]
//                                       [--check]   # verify only, exit 1 on drift
//                                       [--adopt]   # one-time: insert the markers
//
// Dependency-free (Node built-ins only).

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const CANONICAL_DEFAULT = 'https://naklios.dev/sdk/naklios.js';
const BEGIN_RE = /\/\*\s*naklios-sdk:begin\b[^*]*\*\//;
const END_RE = /\/\*\s*naklios-sdk:end\s*\*\//;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const FILE = arg('--file', 'index.html');
const CANONICAL = arg('--canonical', CANONICAL_DEFAULT);
const CHECK_ONLY = process.argv.includes('--check');
const ADOPT = process.argv.includes('--adopt');

async function loadCanonical(src) {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { redirect: 'follow' });
    if (!res.ok) throw new Error(`fetch ${src} → HTTP ${res.status}`);
    return await res.text();
  }
  return readFileSync(src, 'utf8');
}

// The exact bytes we place between the markers: the canonical source with every
// </script> neutralised so it can't close the host <script> early. The stamped
// hash is over THESE bytes, so `--check` compares like-for-like.
function inlineBody(canonical) {
  return canonical.replace(/<\/script/gi, '<\\/script');
}
function sha256(s) { return createHash('sha256').update(s, 'utf8').digest('hex'); }
function canonicalVersion(canonical) {
  const m = canonical.match(/@naklios-sdk-version\s+(\d+)/);
  return m ? m[1] : '0';
}
function beginMarker(ver, hash) {
  return `/* naklios-sdk:begin ver=${ver} sha256=${hash} — ` +
    'DO NOT EDIT until :end; run `node scripts/vendor-naklios-sdk.mjs` */';
}
const END_MARKER = '/* naklios-sdk:end */';

// Match the } that closes the { at openBraceIdx, skipping strings and comments.
// Safe over SDK content: no regex literals; backticks appear only in // comments.
// The three skippers return the index just past the token they consumed.
function skipString(src, i) {
  const q = src[i]; i++;
  while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
  return i + 1;
}
function skipLineComment(src, i) {
  i += 2;
  while (i < src.length && src[i] !== '\n') i++;
  return i;
}
function skipBlockComment(src, i) {
  i += 2;
  while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
  return i + 2;
}
function matchBrace(src, openBraceIdx) {
  let depth = 0, i = openBraceIdx;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }
    if (c === '/' && d === '/') { i = skipLineComment(src, i); continue; }
    if (c === '/' && d === '*') { i = skipBlockComment(src, i); continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

// Locate the SDK IIFE span [start, end). The SDK is `(function () { … window.naklios
// = {…}; })();`. window.naklios is assigned at the IIFE's top level, so no inner
// helper encloses it — the IIFE is the empty-param `(function () {` closest before
// it whose brace-match reaches past it. Scanning closest-first means matchBrace only
// ever runs over SDK content (inner helpers near the assignment, then the IIFE),
// never over app code before the SDK. A preceding /* … */ header is folded in.
function findSdkSpan(src) {
  const p = src.search(/window\.naklios\s*=/);
  if (p < 0) throw new Error('no `window.naklios =` found — is the SDK vendored here?');
  const opens = [...src.matchAll(/\(\s*function\s*\(\s*\)\s*\{/g)]
    .map((m) => m.index).filter((i) => i < p);
  for (let k = opens.length - 1; k >= 0; k--) {
    const iifeOpen = opens[k];
    const bodyOpen = src.indexOf('{', iifeOpen);
    const bodyClose = matchBrace(src, bodyOpen);
    if (bodyClose <= p) continue;           // helper that closes before the assignment
    // The IIFE invocation, either style: `})();` or `}())`. Anything else means
    // this candidate isn't the SDK IIFE — try the next one out rather than abort.
    const tail = src.slice(bodyClose + 1);
    const inv = tail.match(/^\s*\)\s*\(\s*\)\s*;?/) || tail.match(/^\s*\(\s*\)\s*\)\s*;?/);
    if (!inv) continue;
    const end = bodyClose + 1 + inv[0].length;
    let start = iifeOpen, s = iifeOpen - 1;
    while (s >= 0 && /\s/.test(src[s])) s--;
    if (src[s] === '/' && src[s - 1] === '*') {
      const cs = src.lastIndexOf('/*', s - 1);
      if (cs >= 0 && src.slice(cs, s + 1).includes('naklios')) start = cs;
    }
    return { start, end };
  }
  throw new Error('could not locate the SDK IIFE enclosing window.naklios');
}

function insertMarkers(src) {
  const { start, end } = findSdkSpan(src);
  return src.slice(0, start) +
    '/* naklios-sdk:begin ver=0 sha256=0 */\n' +
    src.slice(start, end) +
    '\n/* naklios-sdk:end */' +
    src.slice(end);
}

let html = readFileSync(FILE, 'utf8');
let beginM = html.match(BEGIN_RE);
let endM = html.match(END_RE);
if (!beginM || !endM || beginM.index >= endM.index) {
  if (ADOPT && !CHECK_ONLY) {
    html = insertMarkers(html);
    beginM = html.match(BEGIN_RE);
    endM = html.match(END_RE);
    console.log(`[vendor-sdk] adopted: wrapped ${FILE}'s inlined SDK in markers.`);
  } else {
    console.error(
      `[vendor-sdk] ${FILE}: no naklios-sdk:begin/end markers found.\n` +
      '  Run once with --adopt to place them around the inlined SDK\n' +
      '  (see docs/app-contract.md "Vendoring the SDK"), then re-run.',
    );
    process.exit(2);
  }
}

const canonical = await loadCanonical(CANONICAL);
const body = inlineBody(canonical);
const ver = canonicalVersion(canonical);
const hash = sha256(body);

const before = html.slice(0, beginM.index);
const after = html.slice(endM.index + endM[0].length);
const rebuilt = before + beginMarker(ver, hash) + '\n' + body + '\n' + END_MARKER + after;
const drifted = rebuilt !== html;

if (CHECK_ONLY) {
  if (drifted) {
    const stamped = (beginM[0].match(/sha256=([0-9a-f]+)/i) || [])[1] || '(none)';
    console.error(
      `[vendor-sdk] DRIFT: ${FILE} vendored SDK is stale.\n` +
      `  canonical ver=${ver} sha256=${hash}\n  vendored          sha256=${stamped}\n` +
      '  Run `node scripts/vendor-naklios-sdk.mjs` to refresh.',
    );
    process.exit(1);
  }
  console.log(`[vendor-sdk] OK: ${FILE} matches canonical ver=${ver}.`);
  process.exit(0);
}

if (!drifted) {
  console.log(`[vendor-sdk] up to date: ${FILE} already at ver=${ver} sha256=${hash}.`);
  process.exit(0);
}
writeFileSync(FILE, rebuilt);
console.log(`[vendor-sdk] refreshed: ${FILE} → ver=${ver} sha256=${hash}.`);
