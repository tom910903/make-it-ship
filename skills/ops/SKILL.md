---
name: ops
description: Make It Ship operations helpers (absorbs OMC omc wait and omc mission-board, gstack landing-report and gstack-detach). Read-only workspace snapshots (mission board, ship queue and version claims), waiting until a time and resuming, and running long jobs detached so they survive the session.
---

# Make It Ship — operations

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`.

- **Mission board**: `mis mission-board` — one JSON snapshot of this workspace: current and recent runs, the loop, the team, every worktree with its uncommitted changes, research sessions and autoresearch missions. Read-only.
- **Landing report**: `mis landing-report [--base main]` — VERSION on the base, open PRs and the versions they claim (via `gh`, read-only), collisions, sibling worktrees (★ active = VERSION ahead, committed in the last 24h, no PR), and the next free micro/patch/minor/major version. Without `gh` it says OFFLINE. Never fetches or writes. Suggest one next action: resolve a collision, rebump after an active sibling, or "queue is clean".
- **Wait**: `mis wait --until <ISO time|HH:MM> -- <resume command>` (or `--seconds N`) — for a usage-limit reset: sleeps, then runs the resume command (e.g. `tmux send-keys -t <session> 'continue' Enter`). At most 24h.
- **Detach**: `mis detach [--timeout 2h] [--label evals] -- <command...>` — starts the job in its own session so a SIGTERM to this process group does not kill it; returns the log path. Poll the log for `### mis-detach EXIT=<code> ###` (silence is not success). Secrets come from the environment only, never argv.
