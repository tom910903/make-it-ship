---
name: qa
description: Make It Ship real-use QA on its own - detects the CLI, API, web (built-in browser, no Playwright needed), iOS (simulator; device via the debug bridge) surfaces, designs user scenarios, turns them into runnable qa-* checks, and reports BLOCKED where something cannot be exercised. Also report-only QA, design review with live screenshots, and page benchmarks.
---

Run the qa phase standalone. `mis` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"`.

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/qa.md` and follow it. For web pages, also read `${CLAUDE_PLUGIN_ROOT}/skills/browse/SKILL.md`; `mis browse` is the browser.
2. If no Make It Ship run is active, start one first (`mis start --input "QA: <what to verify>"`) so the QA check results are recorded as evidence. `mis qa detect` and `mis check` need a run.
3. Pick the mode from the request:
   - **qa** (default): test, fix, verify.
   - **report only** / qa-only: phase step 7. Change no files.
   - **design review**: phase step 8.
   - **benchmark**: phase step 9, with `mis browse perf` per page and a baseline before changes.
4. Report:
   - each surface and its scenarios;
   - the `mis check qa-*` results, quoted from `mis`;
   - screenshots taken (paths);
   - what stayed BLOCKED, and why.
