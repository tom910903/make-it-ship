---
name: cancel
description: Cancel Make It Ship modes - stops an active persistent loop and, only when the user asks, cancels the current run. Use when the user says cancel, stop, cancelomc, or wants to abort the loop or the run.
---

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" loop status`. If a loop is active, run `mis loop cancel`.
2. If there is an active run, ask whether to keep it (it can be resumed later with `/make-it-ship:resume`) or drop it. Run `mis cancel` only if the user says to drop it.
3. Report in one or two lines what was stopped and what was kept.
