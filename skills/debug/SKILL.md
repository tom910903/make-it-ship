---
name: debug
description: Make It Ship root-cause debugging on its own - reproduce, trace, test one hypothesis at a time (competing hypotheses in parallel tracer agents when several fit), record the root cause, then fix test-first. Use for a failing test, a bug report, or unexpected behavior; a trace that reveals a requirements gap feeds the interview (deep-dive).
---

Run the debug phase standalone.

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/debug.md` and follow steps 1-5 and 8, plus "Competing hypotheses" when more than one cause fits (its trace file is what `/make-it-ship:interview` reads when the cause turns out to be a requirements question).
2. If a Make It Ship run is active (`node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" status` succeeds), record the root cause with `mis note rootcause <task> -` and use `mis task <id> retry` / `mis check` as the phase describes (`mis` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"`).
3. Without a run: report Symptom, Root cause (`file:line`), Evidence (the experiment), proposed Fix, and the Regression test to add. Do not change code unless the user asks; if they do, fix test-first and show the real test output.
