---
name: brainstorm
description: Make It Ship brainstorming on its own (Superpowers brainstorming) - explores an open design for a new feature or component one question at a time, compares 2-3 approaches with tradeoffs, confirms the design section by section and writes it to docs/make-it-ship/specs/<slug>-design.md; can hand the result on as a slide deck (mis slides, HTML and PDF). Use for "brainstorm", "let's explore options", "브레인스토밍". Writes only documents, never code; for office hours or a spec use /make-it-ship:interview.
---

Run the brainstorming mode of the interview phase standalone.

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/interview.md` and follow its **brainstorming** row in "Modes by situation" plus "Question tuning". Investigate the repository first so you only ask what it cannot answer.
2. If a Make It Ship run is active (`node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" status` succeeds), record items and answers in it with `mis interview add` / `mis interview resolve` (where `mis` = the shell function `mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }`). Otherwise do not start a run.
3. Only files under `docs/make-it-ship/specs/` are written: the design document, and the deck when the user wants one (if they asked for slides up front, make it without asking again).
4. Finish with the chosen approach, the open questions and the file paths. Offer `/make-it-ship:plan` or `/make-it-ship:run` to build it.
