# Menagerie inside NakliOS

Menagerie has two front doors. The canonical one is
[menagerie.naklitechie.com](https://menagerie.naklitechie.com) — this repo, deployed
as static assets. The second is **[NakliOS](https://naklios.dev)**, a browser desktop
that runs NakliTechie apps as windows and hosts a same-origin **mirror** of this file
at `naklios.dev/apps/menagerie/`. Nothing about the app is forked for that: NakliOS
pulls `index.html` from this repository at a pinned commit. This note is what a
maintainer of *this* repo needs to know so changes here keep working there.

The full host-side contract lives in the nakliOS repo (`docs/app-contract.md`,
`docs/app-loading.md`, `apps/manifest.json`). What follows is the part that touches
Menagerie.

## 1. How the mirror works — and why it exists

`showDirectoryPicker()` — the API Menagerie's workspace folder uses — is blocked
inside a cross-origin iframe, and no sandbox flag unlocks it. So NakliOS cannot embed
`menagerie.naklitechie.com` directly; it mirrors the file onto its own origin.

- **Declared** in nakliOS `apps/manifest.json` (repo, ref, and the exact files:
  `index.html`, `manifest.webmanifest`, the four icons).
- **Pinned** in `apps/manifest.lock.json`: the ref is resolved to an immutable commit
  and every file is recorded with its SHA-256 and byte size. The lock, not the
  checked-in copy, is the source of truth; a hand edit to the mirror fails their gate.
- **Refreshed** by their `sync-mirrors` workflow. This repo's
  `.github/workflows/notify-naklios.yml` triggers it on every push to `main` that
  touches a shipped file, so the mirror lags a push by minutes, not a day. That
  trigger needs the repo secret `NAKLIOS_DISPATCH_TOKEN` (a fine-grained PAT with
  Actions:write on `NakliTechie/nakliOS`) — a credential, set by a person. Without it
  the mirror still refreshes on their daily schedule.

Consequences of being same-origin with the host:

- The iframe runs **without a `sandbox` attribute**, and `localStorage` / IndexedDB are
  shared with the NakliOS origin (namespaced only by key). Menagerie keeps nothing
  secret in `localStorage` — theme and tree-view preferences only — and relay tokens
  live in the workspace store. Keep it that way.
- The page's **`Origin` is `https://naklios.dev`**, which matters to the relay (§5).
- `?naklios` is appended to the embed URL. It is a *hint* the SDK reads
  (`capabilities.hosted` / `flagged`); it does not switch transports by itself —
  `naklios.fs` only becomes real after a handshake with an actual parent frame.

## 2. The SDK is vendored, and machine-managed

`sdk/naklios.js` is the cooperative protocol between a hosted app and NakliOS:
lifecycle (`ready`, `title`, `close`, `beforeClose`), theme, capabilities, and the
`naklios.fs` / `naklios.ai` / `naklios.net` transports. Single-file apps cannot
`<script src>` it, so it is **inlined** in `index.html`, between two JS-comment
markers:

```js
/* naklios-sdk:begin ver=2 sha256=… — DO NOT EDIT until :end; … */
(function () { … })();
/* naklios-sdk:end */
```

- **Never edit inside the markers.** `node scripts/vendor-naklios-sdk.mjs` re-splices
  the canonical (`https://naklios.dev/sdk/naklios.js`) between them and stamps
  `ver` + `sha256`; `--check` exits 1 on drift.
  `.github/workflows/vendor-sdk.yml` runs that daily and commits the refresh. The app
  *pulls*; naklios never pushes into this repo.
- The SDK is a **no-op standalone** (`window.parent === window`): every call returns
  or resolves harmlessly, so the same file serves both front doors.
- This is why the CSP keeps `script-src 'unsafe-inline'`.

## 3. The storage ladder — where state lives when hosted

NakliOS storage is a ladder the *user* configures, once, for every app:
**OPFS** (browser-private, per device) → **Folder** (a disk folder via the File
System Access API) → **Crate** (encrypted cloud, roams across machines). Apps do not
pick a tier. They call `naklios.fs` — `read`, `readBinary`, `write`, `append`,
`list`, `delete`, `exists`, `subscribe` — with paths **relative to
`apps/menagerie/`** on whatever the user connected; `capabilities.fsBackend` names it,
`onCapabilitiesChange` reports a switch. Traversal (`../`) is refused at the host.

The one hard rule of the host contract: **a hosted app never opens its own picker.**
Menagerie honours it with a storage adapter (`FS` in `index.html`, "storage layer"):

| Situation | Store | What the user sees |
|---|---|---|
| Standalone | The folder they pick (FSA), as always | "Pick a folder…" on first run |
| Inside NakliOS, Folder or Crate connected | `naklios.fs`, at `apps/menagerie/` | Workspace chip reads `NakliOS · Folder` / `· Crate`; no picker; "Change folder" hidden |
| Inside NakliOS, nothing connected | In-memory for the session | The overlay says so and points at NakliOS Settings → Storage; the picker is not offered |

Two details worth knowing:

- The **on-disk layout is identical** under both stores (`.menagerie/relays.json`,
  `.menagerie/sessions/*.meta.json`, `*.pty`, `*.acp.jsonl`), so a folder written one
  way reads the other.
- `naklios.fs.append` is a *text-line* append. Trajectories are bytes, so the host
  half appends by `readBinary` + concat + `write` — byte-exact, and the same read-
  rewrite cost the host's own append pays. Menagerie already batches PTY flushes,
  which is what keeps that affordable.
- Storage can arrive after boot (the user connects a Folder while Menagerie is open):
  the app mounts it on the capabilities change and starts persisting. Sessions that
  were already streaming keep streaming.

## 4. AI transport — not used here, and what to do if it ever is

NakliOS exposes shared inference as `naklios.ai` (OpenAI-shaped:
`chat.completions.create`, streaming, `images.generate`), **bifurcated by tier**:
general-purpose completions default to Chrome's on-device **Gemini Nano** when it is
available — private, free, zero-config — while the *agent* tier (`agent: true`, tool-
calling coding work) always goes to the user's configured endpoint and never to Nano.
`agent: true` is honoured only for system apps; a mirrored app gets the GP tier.

Menagerie performs **no inference itself** — the coding agents run on relays — so
nothing here calls `naklios.ai`. If a feature ever needs a model (summarise a
session, name a tile), follow the contract's adapter pattern: one `ai` object chosen
at init by `capabilities.hosted && capabilities.ai`, falling back to a bring-your-own
endpoint standalone, and never a `naklios.*` call scattered through the code.

Likewise **egress**: `naklios.net.fetch` routes cross-origin HTTP through the user's
own worker or local bridge. Menagerie's relay connections are direct `ws(s)://` to
loopback or LAN and do not go through it. The CSP `connect-src wss: ws:` is unchanged
and sufficient.

## 5. The relay's origin gate

The relay rejects a WebSocket upgrade whose `Origin` is not in `allowed_origins`
(403 — which the browser surfaces as a bare close). Inside NakliOS that origin is
**`https://naklios.dev`**, so the relay's default allowlist carries both front doors:

```toml
allowed_origins = ["https://menagerie.naklitechie.com", "https://naklios.dev"]
```

A relay installed before that default existed keeps its own `relay.toml` — add the
second entry by hand. A NakliOS checkout served from `localhost` is covered by
`allow_localhost_origins` (on by default for a loopback-bound relay). See
[relay-setup.md](./relay-setup.md) "Origins and local development".

## 6. Theme and lifecycle

- NakliOS sends its theme (`{ id, mood, colors }`) on request and on change. Menagerie
  maps `mood === "dark"` → dark, anything else → light. The ☾ toggle still works
  inside the host and remains the only path that writes the saved preference.
- `naklios.ready()` fires once the page has painted, so the host drops its loading
  cover; `naklios.title()` follows the live session count.
- `frame-ancestors` in the CSP `<meta>` names `naklios.dev` as the one permitted
  embedder. Browsers ignore that directive in a meta policy — it only binds as an HTTP
  header — so the line records intent; the deploy's headers are the actual gate.

## 7. Checklist when you change `index.html`

1. Leave the SDK markers and everything between them alone; run
   `node scripts/vendor-naklios-sdk.mjs --check` if in doubt.
2. Keep every persistence call on `FS.*`. A new file type needs nothing else; a new
   *kind* of access (rename, watch) needs a host half too.
3. Never call `showDirectoryPicker` on a path a hosted user can reach —
   `hostedInNakliOS()` is the guard.
4. Push to `main` → `notify-naklios.yml` → the mirror updates. Check
   `nakliOS.openApp('menagerie')` from the naklios.dev console if the change touches
   boot or storage.
5. A new shipped sidecar (icon, manifest) must be added to the `paths:` list in
   `notify-naklios.yml` **and** to the `files` list in nakliOS `apps/manifest.json`,
   or the mirror serves a 404 for it.
