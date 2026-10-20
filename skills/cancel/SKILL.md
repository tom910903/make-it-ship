---
name: cancel
description: Cancel Make It Ship modes - stops an active persistent loop, team workers and merge-readiness sessions and, only when the user asks, cancels the current run. Use when the user says cancel, stop, cancelomc, or wants to abort the loop, the team or the run.
---

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" cancel --all`. It ends the loop, shuts down a running team (worktrees with uncommitted work are kept) and cancels merge-readiness sessions of this worktree. It never cancels the run.
2. If the output has `runKept`, ask whether to keep the run (it can be resumed later with `/make-it-ship:resume`) or drop it. Run `mis cancel` only if the user says to drop it.
3. Report in one or two lines what was stopped and what was kept.
