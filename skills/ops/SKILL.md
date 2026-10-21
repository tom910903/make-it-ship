---
name: ops
description: Make It Ship operations helpers (absorbs OMC omc wait and omc mission-board, gstack landing-report and gstack-detach). Read-only workspace snapshots (mission board, ship queue and version claims), waiting until a time and resuming, and running long jobs detached so they survive the session.
---

# Make It Ship — operations

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`.

- **Mission board**: `mis mission-board` — one JSON snapshot of this workspace: current and recent runs, the loop, the team, every worktree with its uncommitted changes, research sessions and autoresearch missions. Read-only.
- **Landing report**: `mis landing-report [--base main]` — VERSION on the base, open PRs and the versions they claim (via `gh`, read-only), collisions, sibling worktrees (★ active = VERSION ahead, committed in the last 24h, no PR), and the next free micro/patch/minor/major version. Without `gh` it says OFFLINE. Never fetches or writes. Suggest one next action: resolve a collision, rebump after an active sibling, or "queue is clean".
- **Wait for a usage limit**: `mis wait detect` lists tmux panes whose screen shows a Claude Code usage-limit stop, with the reset time read from the message (`--pane %N` for one pane, `--log <file>` for saved output). `mis wait auto [--margin 60s] [--text continue]` sleeps until the latest reset, then types the text and Enter into each stopped pane; with `--log <file> -- <resume command>` it runs the command instead. A stop whose message has no reset time is reported (exit 1), never guessed. To arm it before the limit hits: `mis detach --label wait -- mis wait auto --watch [--poll 60s] [--max-watch 12h]` keeps scanning until a stop appears. Manual form: `mis wait --until <ISO time|HH:MM> -- <resume command>` (or `--seconds N`, at most 24h).
- **Detach**: `mis detach [--timeout 2h] [--label evals] [--lock <name>] -- <command...>` — `--lock` serializes jobs machine-wide (`~/.make-it-ship/locks/<name>.lock` with the holder pid; a dead holder's lock is reclaimed; the log shows WAITING), and on macOS the job runs under `caffeinate -i` so the machine does not idle-sleep. It starts the job in its own session so a SIGTERM to this process group does not kill it; returns the log path. Poll the log for `### mis-detach EXIT=<code> ###` (silence is not success). Secrets come from the environment only, never argv.
