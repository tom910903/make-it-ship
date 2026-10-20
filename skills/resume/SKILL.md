---
name: resume
description: Resume interrupted work - a Make It Ship run after a crash, closed session, limit, or failure (re-checks what changed, which evidence went stale, what is still open), or, outside a run, a saved working context (branch, notes, uncommitted files) with a warning when the branch differs. Also save context before stopping, and find recent Claude Code sessions across all projects.
---

Absorbs: gstack context-restore/context-save · OMC cancel, notepad, state.

`mis` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"`.

1. Run `mis resume` (or `mis resume <run-id>` if the user named one). It reclaims a lock left by a dead process, switches to that run, and prints: state, files changed since the last recorded step, evidence that is now stale, tasks that were in progress, open questions, and suggested next steps.
2. Show the user a short summary: where the run stopped (last completed step), what changed since, what is stale, and what needs their decision. Do not ask them to re-explain the task; the plan and history are in `mis status`.
3. Before continuing:
   - files changed since the last step: read the diff (`git diff`) and decide whether it is your unfinished work, the user's edits, or something unexpected. Ask the user if unexpected.
   - a task left IN_PROGRESS: check its acceptance criteria against the code; then continue it, or `mis task <id> done` / `fail`.
   - a bug fix or failing-test task with **no recorded failing check yet**: reproduce first (`mis check <name>` before changing code, then the debug phase with `mis note rootcause`), exactly as a fresh run would. Resuming never skips the reproduction step.
   - a check whose process died: re-run it with `mis check <name>`.
   - BLOCKED by a limit (runtime or retries): explain it in one sentence; only the user can lift it (`mis approve continue`, which asks them). Any other BLOCKED reason needs the cause fixed first.
   - AWAITING_APPROVAL: present the plan again and run `mis approve plan`.
4. Whenever you stop (finished, blocked by a limit, or waiting for approval), run `mis verdict` (or `mis status`) **at that moment** and quote that verdict — never one you saw earlier in the session.
5. Then continue the normal flow from the right phase of `/make-it-ship:run` (read `${CLAUDE_PLUGIN_ROOT}/skills/run/SKILL.md`). Stale evidence must be re-run before any verdict.

## Outside a run (gstack context-save / context-restore, global-discover)

- Save before stopping: `mis context save <name> --note "<where you are, what is next, open decisions>"` (branch, HEAD and changed files are captured).
- Restore: `mis context restore [<name>]` (latest when no name). If it warns about a branch mismatch or new commits, tell the user and ask before continuing on the current branch.
- `mis context list` shows saved contexts; `mis context sessions` lists recent Claude Code sessions of every project on this machine (from the Claude config directory), to find where some work happened.

Never edit `.git/make-it-ship/` directly. Never claim a step finished unless `mis status` shows it.
