---
name: session
description: Make It Ship project session manager (psm, absorbs OMC project-session-manager and Superpowers using-git-worktrees) - an isolated git worktree (and optional tmux session) per issue, pull request review, or feature, outside a Make It Ship run, with a baseline run of the quick checks. Use when the user asks to start work on an issue/PR/feature in its own worktree, says psm, or wants to list or clean up such sessions.
---

# Make It Ship — session (psm)

Absorbs: OMC project-session-manager / psm (worktree-first sessions for issues, PRs and features, optional tmux) · Superpowers using-git-worktrees.

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`, run from the main working tree.

| Command | Worktree | Branch |
|---|---|---|
| `mis session create issue <n> [--base <ref>]` | `.worktrees/issue-<n>` | `fix/<n>` from `--base` (default `HEAD`) |
| `mis session create pr <n> [--remote origin]` | `.worktrees/pr-<n>` | `pr-<n>-review`, fetched from `<remote>` `pull/<n>/head` |
| `mis session create feature "<name>" [--base <ref>]` | `.worktrees/feat-<slug>` | `feature/<slug>` |

- `--tmux` also opens a detached tmux session `mis-<name>` in the worktree; the output has the attach command. Without tmux this reports BLOCKED (the worktree is not created).
- After creating the worktree, `mis session create` runs the quick checks there (the worktree's `.make-it-ship.json`, else the main tree's) and prints them as `baseline`; `--no-baseline` skips that. Tell the user about a baseline FAIL before starting: it existed before any change.
- `mis session list` shows each session's path, branch, uncommitted changes (`dirty`) and tmux session.
- `mis session remove <name>` removes the worktree and closes its tmux session. It refuses while the worktree has uncommitted changes and always keeps the branch.
- `.worktrees/` is excluded locally (`.git/info/exclude`), so sessions never show up in the main tree's status.

Flow:
1. Create the session and tell the user the path (and attach command). For an issue, read it first (`gh issue view <n>` is a read) and put the title in your summary; the branch name stays `fix/<n>`.
2. Work inside the worktree (`cd <path>`). For build work start a run there with `/make-it-ship:run`; for a PR review use `/make-it-ship:review` against the PR's base.
3. Fetching a PR ref is a git read. Pushing, opening or merging a pull request is a remote write and needs the user's approval (the guard asks) — never route around it.
4. When done, `mis session remove <name>` after the work is committed (and pushed with approval, if the user wants that).
