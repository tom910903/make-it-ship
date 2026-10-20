---
name: retro
description: Make It Ship retrospective and project memory - machine-counted metrics from past runs and git history (commits, hotspots, per-author activity, reviewer hit rates), a few evidence-based habits, and durable learnings and decisions: search, distill notes into proposals, decision log with supersede, union merge for shared ledgers.
---

Run the retro/learn phase standalone. `mis` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"`.

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/retro.md` and follow it (no active run is needed).
2. For learnings or decisions alone ("what did we learn about X", "record this decision", "what did we decide about Y"), use steps 3 and 6-9 of the phase file directly: `mis learn search`, `mis learn distill`, `mis decision add|search|supersede`.
3. Show the user the metrics table and at most 3 habits, and list any learnings you recorded. Do not change process files without their approval.
