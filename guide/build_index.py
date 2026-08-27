#!/usr/bin/env python3
"""Menagerie guide — HTML builder.

Reads the captured screenshots + the caption/section DATA below and emits one
self-contained guide/index.html: feature sections, captioned cards, inline search,
and a full-navigation lightbox. Themed from the app's own Rangrez tokens so it reads
as part of the product.

CAPTIONS and SECTIONS are the authored content — regeneration re-shoots screenshots
and rebuilds HTML but never loses this prose. Edit here, then regenerate.
"""
import html, json, pathlib

HERE = pathlib.Path(__file__).resolve().parent
SHOTS = HERE / "screenshots"
OUT = HERE / "index.html"

# slug -> (title, one-line "what this screen is")
CAPTIONS = {
    "01-workspace-picker": ("Pick a workspace", "First run asks for a folder to own your relays and trajectories — nothing leaves your machine. Skip for an in-memory session."),
    "02-first-run-tour": ("The first-run tour", "A six-step spotlight walkthrough greets new users — relays, connect, spawn, the fleet board, theme, help. Replayable any time from Help."),
    "03-help-about": ("Help & about", "What Menagerie is and how to install a relay, one click behind the ? button — including the ‘Take the quick tour’ replay."),
    "04-relay-setup": ("Connect a relay", "Settings lists the localhost relay as a self-advancing checklist: start it, paste the token, connected. Add remote relays by URL too."),
    "05-spawn-dialog": ("Spawn an agent", "Describe a task, pick an agent and model (or a custom command). ACP-capable agents default to a structured session; Git-backed work gets its own branch and worktree."),
    "06-fleet-grid": ("Your fleet, at a glance", "Every agent is a live tile — working, needs-you, rate-limited, or idle. PTY terminals and structured streams sit side by side on one board."),
    "07-drill-instrument": ("Drill into an agent", "Open a tile for the full session: the instrument bar (model · context gauge · thinking · tokens), transcript, tool calls, and diff review — approve or reject each hunk."),
    "08-raw-event-log": ("The raw event log", "Press d to reveal exactly what crossed the wire — the JSONL of every frame. When the render layer doesn’t understand a frame, you still can."),
    "09-fleet-grid-dark": ("Dark theme", "The whole console in the Rangrez ‘Kutch Bhunga’ dark palette. The topbar toggle switches light / dark live and remembers your choice."),
    "10-drill-instrument-dark": ("Drill-in, dark", "The per-agent instrument panel and diff review in dark theme — the same structured surface, different glass."),
}

# (section title, intro, [slugs])
SECTIONS = [
    ("Getting started", "Menagerie is a browser tab that runs and watches fleets of coding agents. First run walks you in.",
     ["01-workspace-picker", "02-first-run-tour", "03-help-about"]),
    ("Connect & spawn", "A relay is a small server you run once per machine; it runs the agents you spawn from here.",
     ["04-relay-setup", "05-spawn-dialog"]),
    ("Watch your fleet", "The Kanban-free board keeps every agent legible — status derived from live session, PR, and CI facts.",
     ["06-fleet-grid", "09-fleet-grid-dark"]),
    ("Drill into an agent", "One task, one agent, one isolated workspace — with the full transcript, diffs, and instruments attached.",
     ["07-drill-instrument", "08-raw-event-log", "10-drill-instrument-dark"]),
]

# App tokens (Rangrez) — kept in sync with index.html :root so the guide matches.
LIGHT = dict(bg="#f9f9f8", panel="#ffffff", panel2="#f1f1ee", elev="#ebebe6",
             border="#e2e1db", text="#1c1815", muted="#6b6962", faint="#9b988f",
             accent="#8b3a1f", on_accent="#ffffff")
DARK = dict(bg="#1a2848", panel="#2a3858", panel2="#223150", elev="#34456a",
            border="#3a4a6e", text="#f4ecd8", muted="#b4bacb", faint="#8a90a8",
            accent="#e0573a", on_accent="#ffffff")
SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'


def _vars(d):
    return "; ".join(f"--{k.replace('_','-')}: {v}" for k, v in d.items())


def build():
    cards_html, order, n = [], [], 0
    toc = []
    for title, intro, slugs in SECTIONS:
        sec_id = title.lower().replace(" & ", "-").replace(" ", "-")
        toc.append(f'<a href="#{sec_id}">{html.escape(title)}</a>')
        items = []
        for slug in slugs:
            img = SHOTS / f"{slug}.png"
            if not img.exists():
                continue
            cap_title, desc = CAPTIONS.get(slug, (slug, ""))
            search = f"{title} {cap_title} {desc} {slug}".lower()
            items.append(f'''
        <figure class="card" data-search="{html.escape(search)}" data-idx="{n}" data-section="{html.escape(title)}">
          <button class="shot" data-full="screenshots/{slug}.png" data-title="{html.escape(cap_title)}" data-desc="{html.escape(desc)}" data-role="{html.escape(title)}" aria-label="Open {html.escape(cap_title)}">
            <img loading="lazy" src="screenshots/{slug}.png" alt="{html.escape(cap_title)}">
          </button>
          <figcaption><h3>{html.escape(cap_title)}</h3><p>{html.escape(desc)}</p></figcaption>
        </figure>''')
            order.append({"src": f"screenshots/{slug}.png", "title": cap_title, "desc": desc, "role": title})
            n += 1
        if items:
            cards_html.append(f'''
      <section id="{sec_id}" class="feat">
        <div class="sec-head"><h2>{html.escape(title)}</h2><p class="sec-intro">{html.escape(intro)}</p></div>
        <div class="grid">{''.join(items)}</div>
      </section>''')

    # Embed as real JSON in the <script>; only neutralize a literal </script>
    # breakout. NOT html.escape — script content is raw text, so escaping & would
    # double-encode it (and mangle apostrophes in captions).
    order_json = json.dumps(order, ensure_ascii=False).replace("</", "<\\/")
    doc = TEMPLATE.format(
        light=_vars(LIGHT), dark=_vars(DARK), sans=SANS, mono=MONO,
        toc="".join(toc), sections="".join(cards_html), count=n,
        order_json=order_json,
    )
    OUT.write_text(doc)
    print(f"built guide/index.html — {n} screenshots, {len(SECTIONS)} sections")


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Menagerie — Guide</title>
<style>
  :root {{ {light}; --sans: {sans}; --mono: {mono};
    --radius: 12px; --shadow: 0 8px 30px rgba(0,0,0,.12); }}
  :root[data-theme="dark"] {{ {dark}; --shadow: 0 8px 30px rgba(0,0,0,.4); }}
  @media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ {dark}; --shadow: 0 8px 30px rgba(0,0,0,.4); }} }}
  * {{ box-sizing: border-box; }}
  html {{ scroll-behavior: smooth; scroll-padding-top: 90px; }}
  body {{ margin: 0; font-family: var(--sans); background: var(--bg); color: var(--text); line-height: 1.55; }}
  a {{ color: var(--accent); text-decoration: none; }} a:hover {{ text-decoration: underline; }}
  header.top {{ position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); }}
  .top-inner {{ max-width: 1080px; margin: 0 auto; padding: 12px 20px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }}
  .brand {{ font-weight: 700; font-size: 18px; }} .brand span {{ color: var(--accent); }}
  .search {{ flex: 1; min-width: 180px; }}
  .search input {{ width: 100%; padding: 9px 13px; border: 1px solid var(--border); border-radius: 9px; background: var(--panel); color: var(--text); font-size: 14px; font-family: inherit; outline: none; }}
  .search input:focus {{ border-color: var(--accent); }}
  .themebtn {{ border: 1px solid var(--border); background: var(--panel); color: var(--text); border-radius: 9px; padding: 8px 11px; cursor: pointer; font-size: 15px; }}
  main {{ max-width: 1080px; margin: 0 auto; padding: 26px 20px 80px; }}
  .lede {{ font-size: 16px; color: var(--muted); max-width: 720px; }}
  nav.toc {{ display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 8px; }}
  nav.toc a {{ font-size: 13px; padding: 5px 11px; border: 1px solid var(--border); border-radius: 20px; color: var(--muted); }}
  nav.toc a:hover {{ border-color: var(--accent); color: var(--accent); text-decoration: none; }}
  .feat {{ margin-top: 34px; }}
  .sec-head h2 {{ margin: 0 0 4px; font-size: 21px; }}
  .sec-intro {{ margin: 0 0 16px; color: var(--muted); font-size: 14px; max-width: 680px; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }}
  .card {{ margin: 0; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); }}
  .card.hidden {{ display: none; }}
  .shot {{ display: block; width: 100%; padding: 0; border: 0; background: var(--panel-2); cursor: zoom-in; }}
  .shot img {{ display: block; width: 100%; height: auto; max-width: 100%; border-bottom: 1px solid var(--border); }}
  figcaption {{ padding: 13px 15px 16px; }}
  figcaption h3 {{ margin: 0 0 5px; font-size: 15px; }}
  figcaption p {{ margin: 0; font-size: 13px; color: var(--muted); }}
  .nomatch {{ display: none; color: var(--muted); padding: 40px 0; text-align: center; }}
  .nomatch.show {{ display: block; }}
  footer {{ max-width: 1080px; margin: 0 auto; padding: 30px 20px; color: var(--faint); font-size: 13px; border-top: 1px solid var(--border); }}
  /* lightbox */
  .lb {{ position: fixed; inset: 0; z-index: 50; display: none; background: rgba(0,0,0,.86); }}
  .lb.open {{ display: flex; flex-direction: column; }}
  .lb-bar {{ display: flex; align-items: center; gap: 14px; padding: 12px 16px; color: #eee; font-size: 13px; }}
  .lb-pos {{ margin-right: auto; opacity: .85; }}
  .lb-btn {{ background: rgba(255,255,255,.12); color: #fff; border: 0; border-radius: 8px; width: 44px; height: 44px; font-size: 18px; cursor: pointer; }}
  .lb-btn:hover {{ background: rgba(255,255,255,.22); }}
  .lb-stage {{ flex: 1; display: flex; align-items: center; justify-content: center; padding: 0 8px 8px; min-height: 0; position: relative; }}
  .lb-stage img {{ max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; }}
  .lb-side {{ position: absolute; top: 0; bottom: 0; width: 24%; border: 0; background: transparent; cursor: pointer; color: transparent; }}
  .lb-side.prev {{ left: 0; }} .lb-side.next {{ right: 0; }}
  .lb-cap {{ color: #eee; padding: 4px 18px 18px; text-align: center; }}
  .lb-cap b {{ display: block; font-size: 15px; margin-bottom: 3px; }}
  .lb-cap span {{ font-size: 13px; opacity: .8; }}
  @media (max-width: 560px) {{
    .grid {{ grid-template-columns: 1fr; }}
    .lb-side {{ width: 30%; }}
  }}
</style>
</head>
<body>
<header class="top">
  <div class="top-inner">
    <div class="brand">Menagerie<span>.</span> Guide</div>
    <div class="search"><input id="q" type="search" placeholder="Search features…  ( / to focus )" autocomplete="off"></div>
    <button class="themebtn" id="theme" aria-label="Toggle theme">◐</button>
  </div>
</header>
<main>
  <p class="lede">A browser-native console for running and watching fleets of coding agents — Claude Code, Codex, opencode, Aider and friends — side by side in one window. This guide walks every screen.</p>
  <nav class="toc">{toc}</nav>
  {sections}
  <div class="nomatch" id="nomatch">No features match that search.</div>
</main>
<footer>{count} screens · a build artifact — regenerate with <code>guide/regenerate.sh</code>, never hand-edited · <a href="../index.html">Open Menagerie →</a></footer>

<div class="lb" id="lb" role="dialog" aria-modal="true" aria-label="Screenshot viewer">
  <div class="lb-bar">
    <span class="lb-pos" id="lbpos"></span>
    <button class="lb-btn" id="lbprev" aria-label="Previous">‹</button>
    <button class="lb-btn" id="lbnext" aria-label="Next">›</button>
    <button class="lb-btn" id="lbclose" aria-label="Close">×</button>
  </div>
  <div class="lb-stage" id="lbstage">
    <button class="lb-side prev" id="lbprevz" aria-label="Previous"></button>
    <img id="lbimg" alt="">
    <button class="lb-side next" id="lbnextz" aria-label="Next"></button>
  </div>
  <div class="lb-cap"><b id="lbtitle"></b><span id="lbdesc"></span></div>
</div>

<script>
const ORDER = {order_json};
// ---- theme (remembered) ----
try {{ const t = localStorage.getItem('menagerie-guide-theme'); if (t) document.documentElement.setAttribute('data-theme', t); }} catch {{}}
document.getElementById('theme').addEventListener('click', () => {{
  const cur = document.documentElement.getAttribute('data-theme');
  const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {{ localStorage.setItem('menagerie-guide-theme', next); }} catch {{}}
}});
// ---- inline search ----
const q = document.getElementById('q'), cards = [...document.querySelectorAll('.card')], nomatch = document.getElementById('nomatch');
function filter() {{
  const s = q.value.trim().toLowerCase();
  let any = false;
  for (const c of cards) {{ const hit = !s || c.dataset.search.includes(s); c.classList.toggle('hidden', !hit); if (hit) any = true; }}
  for (const sec of document.querySelectorAll('.feat')) {{
    const vis = [...sec.querySelectorAll('.card')].some(c => !c.classList.contains('hidden'));
    sec.style.display = vis ? '' : 'none';
  }}
  nomatch.classList.toggle('show', !any);
}}
q.addEventListener('input', filter);
document.addEventListener('keydown', e => {{
  if (lb.classList.contains('open')) return;
  if (e.key === '/' && document.activeElement !== q) {{ e.preventDefault(); q.focus(); }}
  else if (e.key === 'Escape' && document.activeElement === q) {{ q.value = ''; filter(); q.blur(); }}
}});
// ---- lightbox with full navigation ----
const lb = document.getElementById('lb'), lbimg = document.getElementById('lbimg');
const lbtitle = document.getElementById('lbtitle'), lbdesc = document.getElementById('lbdesc'), lbpos = document.getElementById('lbpos');
let idx = 0, scrollY = 0;
function visibleIdxs() {{ return cards.map((c,i)=>({{c,i}})).filter(o=>!o.c.classList.contains('hidden')).map(o=>parseInt(o.c.dataset.idx,10)); }}
function show(i) {{
  const vis = visibleIdxs(); if (!vis.length) return;
  if (!vis.includes(i)) i = vis[0];
  idx = i; const it = ORDER[i];
  lbimg.src = it.src; lbimg.alt = it.title;
  lbtitle.textContent = it.title; lbdesc.textContent = it.desc;
  lbpos.textContent = it.role + ' — ' + (vis.indexOf(i)+1) + '/' + vis.length;
}}
function step(d) {{ const vis = visibleIdxs(); const at = vis.indexOf(idx); if (at < 0) return show(vis[0]); const nx = vis[(at + d + vis.length) % vis.length]; show(nx); }}
function sectionJump(d) {{
  const vis = visibleIdxs(); const curSec = ORDER[idx].role;
  if (d > 0) {{ for (const i of vis) if (ORDER[i].role !== curSec && i > idx) return show(i); return show(vis[0]); }}
  const seen = {{}};
  for (const i of vis) {{ if (!(ORDER[i].role in seen)) {{ seen[ORDER[i].role] = i; }} }}
  const roles = Object.keys(seen); const ci = roles.indexOf(curSec);
  return show(seen[roles[(ci - 1 + roles.length) % roles.length]]);
}}
function openLb(i) {{ scrollY = window.scrollY; lb.classList.add('open'); document.body.style.top = `-${{scrollY}}px`; document.body.style.position='fixed'; document.body.style.width='100%'; show(i); }}
function closeLb() {{ lb.classList.remove('open'); document.body.style.position=''; document.body.style.top=''; document.body.style.width=''; window.scrollTo(0, scrollY); }}
document.querySelectorAll('.shot').forEach(b => b.addEventListener('click', () => openLb(parseInt(b.closest('.card').dataset.idx, 10))));
document.getElementById('lbclose').addEventListener('click', closeLb);
document.getElementById('lbprev').addEventListener('click', () => step(-1));
document.getElementById('lbnext').addEventListener('click', () => step(1));
document.getElementById('lbprevz').addEventListener('click', () => step(-1));
document.getElementById('lbnextz').addEventListener('click', () => step(1));
lb.addEventListener('click', e => {{ if (e.target === lb || e.target.classList.contains('lb-stage')) closeLb(); }});
document.addEventListener('keydown', e => {{
  if (!lb.classList.contains('open')) return;
  if (e.key === 'Escape') closeLb();
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowDown') sectionJump(1);
  else if (e.key === 'ArrowUp') sectionJump(-1);
}});
// touch: swipe left/right = prev/next, swipe down = close
let tx = 0, ty = 0;
lb.addEventListener('touchstart', e => {{ tx = e.touches[0].clientX; ty = e.touches[0].clientY; }}, {{passive:true}});
lb.addEventListener('touchend', e => {{
  const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
  else if (dy > 70 && Math.abs(dy) > Math.abs(dx)) closeLb();
}}, {{passive:true}});
</script>
</body>
</html>
"""

if __name__ == "__main__":
    build()
