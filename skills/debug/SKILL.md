---
name: debug
description: Make It Ship root-cause debugging on its own - reproduce, trace, test one hypothesis at a time (competing hypotheses in parallel tracer agents when several fit), record the root cause, then fix test-first. Use for a failing test, a bug report, or unexpected behavior; a trace that reveals a requirements gap feeds the interview (deep-dive).
---

Run the debug phase standalone.

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/debug.md` and follow steps 1-5 and 8, plus "Competing hypotheses" when more than one cause fits (its trace file is what `/make-it-ship:interview` reads when the cause turns out to be a requirements question).
2. If a Make It Ship run is active (`node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" status` succeeds), record the root cause with `mis note rootcause <task> -` and use `mis task <id> retry` / `mis check` as the phase describes (`mis` = the shell function `mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }`).
3. Without a run: report Symptom, Root cause (`file:line`), Evidence (the experiment), proposed Fix, and the Regression test to add. Do not change code unless the user asks; if they do, first lock the fix to the files the root cause names with `mis debug scope <file|dir…>` (the guard then asks before edits elsewhere), fix test-first, show the real test output, and run `mis debug scope --clear` when done.
