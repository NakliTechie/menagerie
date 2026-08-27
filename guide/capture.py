#!/usr/bin/env python3
"""Menagerie guide — screenshot capture.

Drives the running app in a real (headless) browser and shoots one retina PNG per
feature. Menagerie is single-role (the developer running it), so the plan is a flat
feature list, not per-role. State is staged through the app's OWN in-page demo seams
(`window.__menagerie.test.fakeSession` / `fakeAcpSession`) so no live relay or agent
is needed — the same seams /demo-nt and /walkthrough-nt use.

Source of truth is this route-plan + build_index.py's captions. Edit here and
regenerate; never hand-edit guide/index.html.

Usage: python3 guide/capture.py [--base URL] [--only slug1,slug2]
"""
import argparse, os, sys, json, pathlib

HERE = pathlib.Path(__file__).resolve().parent
SHOTS = HERE / "screenshots"
VIEWPORT = {"width": 1400, "height": 900}

# Each step: (nn, slug, theme, setup_js, wait_ms). setup_js runs after a clean
# load (fresh localStorage) with the page already at BASE; it prepares the screen
# (dismiss overlays, inject fake sessions, open a modal…) and returns nothing.
DISMISS_WS = """
  const skip = [...document.querySelectorAll('button')].find(b => /skip/i.test(b.textContent));
  if (skip) skip.click();
  document.querySelectorAll('.scrim.open').forEach(s => s.classList.remove('open'));
"""
FLEET = """
  window.__menagerie.test.fakeAcpSession();
  window.__menagerie.test.fakeSession('claude-code');
  window.__menagerie.test.fakeSession('codex');
"""

ROUTES = [
    # slug, theme, setup, wait
    ("01", "workspace-picker", "light",
     "/* fresh load: the workspace overlay is already open */", 500),
    ("02", "first-run-tour", "light",
     DISMISS_WS + "await new Promise(r=>setTimeout(r,900));", 300),
    ("03", "help-about", "light",
     DISMISS_WS + "document.getElementById('helpBtn').click();", 400),
    ("04", "relay-setup", "light",
     DISMISS_WS + "document.getElementById('settingsBtn').click();", 400),
    ("05", "spawn-dialog", "light",
     DISMISS_WS + FLEET + "document.getElementById('spawnBtn').click();", 400),
    ("06", "fleet-grid", "light",
     DISMISS_WS + FLEET, 500),
    ("07", "drill-instrument", "light",
     DISMISS_WS + """
       const id = window.__menagerie.test.fakeAcpSession();
       window.__menagerie.test.openDrillById(id);
     """, 500),
    ("08", "raw-event-log", "light",
     DISMISS_WS + """
       const id = window.__menagerie.test.fakeAcpSession();
       window.__menagerie.test.openDrillById(id);
       document.dispatchEvent(new KeyboardEvent('keydown', {key:'d', bubbles:true}));
     """, 400),
    ("09", "fleet-grid-dark", "dark",
     DISMISS_WS + FLEET, 500),
    ("10", "drill-instrument-dark", "dark",
     DISMISS_WS + """
       const id = window.__menagerie.test.fakeAcpSession();
       window.__menagerie.test.openDrillById(id);
     """, 500),
]


def capture(base, only):
    from playwright.sync_api import sync_playwright
    SHOTS.mkdir(parents=True, exist_ok=True)
    plan = [r for r in ROUTES if not only or r[1] in only]
    log = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for nn, slug, theme, setup, wait in plan:
            ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=2,
                                      color_scheme=theme)
            page = ctx.new_page()
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type in ("error", "warning") else None)
            # Clean slate: clear storage so first-run surfaces (workspace) show.
            page.goto(base, wait_until="load")
            page.evaluate("() => { try { localStorage.clear(); } catch(e){} }")
            # Suppress the auto-running first-run tour on every shot EXCEPT the one
            # that documents it — otherwise its spotlight dims every other screen.
            if slug != "first-run-tour":
                page.evaluate("() => { try { localStorage.setItem('menagerie.v1.tour-complete','1'); } catch(e){} }")
            if theme == "dark":
                page.evaluate("() => document.documentElement.setAttribute('data-theme','dark')")
            page.goto(base, wait_until="load")
            if theme == "dark":
                page.evaluate("() => document.documentElement.setAttribute('data-theme','dark')")
            page.wait_for_load_state("load")
            page.evaluate("() => document.fonts.ready")
            page.wait_for_timeout(250)
            try:
                page.evaluate(f"async () => {{ {setup} }}")
            except Exception as e:  # a setup that throws is a broken screen — record it
                errors.append(f"setup error: {e}")
            page.wait_for_timeout(wait)
            out = SHOTS / f"{nn}-{slug}.png"
            page.screenshot(path=str(out))
            # Blank guard: a near-empty body or a tiny file is a failed shot.
            body_len = page.evaluate("() => document.body.innerText.length")
            size = out.stat().st_size
            status = "ok" if (body_len > 40 and size > 12000) else "empty"
            log.append({"slug": slug, "status": status, "bytes": size,
                        "errors": [e for e in errors if "favicon" not in e][:5]})
            print(f"  [{status}] {nn}-{slug}.png  ({size//1024} KB, {len(errors)} console)")
            ctx.close()
        browser.close()
    (HERE / "CAPTURE-LOG.md").write_text(_render_log(log))
    ok = sum(1 for r in log if r["status"] == "ok")
    print(f"\n{ok}/{len(log)} routes rendered ok · log → guide/CAPTURE-LOG.md")
    return log


def _render_log(log):
    lines = ["# Menagerie guide — capture log", ""]
    ok = sum(1 for r in log if r["status"] == "ok")
    lines.append(f"{ok}/{len(log)} routes ok.")
    lines.append("")
    for r in log:
        errs = f" · {len(r['errors'])} console" if r["errors"] else ""
        lines.append(f"- **{r['slug']}** — {r['status']} ({r['bytes']//1024} KB){errs}")
        for e in r["errors"]:
            lines.append(f"    - `{e[:160]}`")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8799/index.html")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    only = [s for s in a.only.split(",") if s]
    capture(a.base, only)
