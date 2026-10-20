---
name: retro
description: Make It Ship retrospective - aggregates past runs into machine-counted metrics (verdicts, failures fixed, retries, blocks, review findings), adds a few evidence-based habits, and records durable project learnings.
---

Run the retro/learn phase standalone. `mis` = the shell function `mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }` (define it in the same Bash call, or type the full `node` command; not a variable: `M="node …"; $M` fails in zsh).

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/retro.md` and follow it (no active run is needed).
2. Show the user the metrics table and at most 3 habits, and list any learnings you recorded. Do not change process files without their approval.
