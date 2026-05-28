# Menagerie app

The browser console — a single `index.html` with inline CSS + JS (ES module). **No build step:** edit the file, refresh the tab.

## Run locally

Open `index.html` directly (`file://`) or serve it:

```sh
python3 -m http.server 8000     # then open http://127.0.0.1:8000
# or:  npx serve .
```

Then **Settings → Add relay** with the relay URL (e.g. `ws://127.0.0.1:7878`) and the registration token from `menagerie-relay token print`. If you serve over `http://`, add that origin to the relay's `allowed_origins`; opening via `file://` is covered by the default `"null"` entry.

## Constraints (handoff §6, §13)

- One file. CSS in `<style>`, JS in `<script type="module">`. xterm.js (P3) will load from cdnjs with SRI.
- State will live in FSA + IndexedDB only (P4). No backend, no telemetry, no `localStorage` for tokens.
- Must work from `file://` (no fetch to relative paths, no service worker).

## Status

**P2 skeleton** — top bar, relay strip, empty grid, Settings (add/remove relay), Spawn dialog. Performs the `hello` + `register` round-trip; spawning surfaces the relay's response. Live tiles + xterm.js + replay arrive in P3–P4.
