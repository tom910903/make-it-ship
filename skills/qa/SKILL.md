---
name: qa
description: Make It Ship real-use QA on its own - detects the CLI, API, web, iOS (simulator; device via the debug bridge) surfaces, designs user scenarios, turns them into runnable qa-* checks, and reports BLOCKED where something cannot be exercised.
---

Run the qa phase standalone. `mis` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"`.

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/qa.md` and follow it.
2. If no Make It Ship run is active, start one first (`mis start --input "QA: <what to verify>"`) so the QA check results are recorded as evidence; `mis qa detect` and `mis check` need it.
3. Report: each surface, scenarios, `mis check qa-*` results quoted from `mis`, and what stayed BLOCKED and why.
