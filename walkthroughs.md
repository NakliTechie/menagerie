# Menagerie — walkthroughs

> **Lifecycle:** locked (2026-05-28). The substantive design walkthrough is already folded into `HANDOFF-v1.0.md` — its message shapes (§4), relay design (§5), UI (§6), and escalation protocol (§14) reflect decisions that were walked through and locked when it was authored. This file tracks only the residual **process/meta** questions. Numbering is stable; never renumber.

For what would require stopping mid-build to ask, see `HANDOFF-v1.0.md` §14 (escalation protocol).

---

## Q1 — Process: spec-kit or dev-process? ✅ LOCKED 2026-05-28

The handoff is a denser, more build-ready spec than `specify init` would generate. Re-transcribing it into spec-kit's constitution/spec/plan/tasks format would add ceremony without design value.

**Locked:** use the dev-process skill with a *light* scaffold — this `SPEC.md` + `walkthroughs.md` + `DEFERRED.md` + `README.md`. No spec-kit. Tripwire to reconsider: if the build reveals the handoff has real design gaps that need a structured re-spec.

---

## Q2 — Branch strategy ✅ LOCKED 2026-05-28

The dev-process convention is a `<slug>v1` branch per initiative — but that's designed for adding a feature to a project with a protected `main`. Menagerie is greenfield: the whole repo *is* the initiative, and `main` has nothing to protect.

**Locked:** build on `main`. Tripwire: if a second concurrent initiative (e.g. a v1.1 spike) needs isolation, branch then.

---

## Q3 — Repo visibility ✅ LOCKED 2026-05-28

VISION commits to publishing specs, protocols, and shims. But there's no reason to be public before there's anything to run.

**Locked:** private during the v1.0 build; flip to public at v1.0 ship. Trigger to flip: gate artifacts (handoff §15) complete.

---

## Q4 — Light vs dark mode in v1.0 ✅ LOCKED 2026-05-28

Handoff §9 allows dark-only for v1.0 ("if both ship… otherwise dark-only is fine"). Shipping both doubles the design-token + contrast-verification surface for no v1.0 success-criterion gain.

**Locked:** dark-only for v1.0. Light mode → `DEFERRED.md` (trigger: v1.0 ships + user demand).

---

*No open design questions remain for v1.0. The build can proceed from `SPEC.md` build phases.*
