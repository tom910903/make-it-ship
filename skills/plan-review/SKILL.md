---
name: plan-review
description: Make It Ship plan critique on its own - has the read-only critic agent challenge a plan or design doc (claims checked against code, pre-mortem, gaps, testability) and returns a verdict with blocking issues.
---

Run the plan-critique phase standalone.

1. Find the plan: the file or text the user gave, or the active run's plan (`node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" status --json`).
2. Read `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/plan-critique.md` and dispatch the critic as described.
3. If a run is active and the plan reviewed is that run's plan, record it with `mis review add plan-critic -` (where `mis` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"`). Otherwise just show the result.
4. Present the verdict line, blocking and major findings, and the fixes the critic proposes. Do not edit the plan unless the user asks.
