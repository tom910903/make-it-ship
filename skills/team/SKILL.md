---
name: team
description: Make It Ship team pipeline (absorbs OMC team and omc-teams) - N workers on a shared task list through plan, exec, verify, fix with a bounded fix loop and mis evidence. Workers are Claude Code subagents or tmux worker processes (`mis team`). Use only when the user explicitly asks for a team (/make-it-ship:team, "omc-teams", "N:claude workers"); never because the word "team" appears in a request.
---

# Make It Ship — team

Absorbs: OMC team (staged pipeline, stage routing, handoffs), omc-teams (tmux CLI workers, `omc team start|status|shutdown`, deprecated `omc_run_team_*` MCP tools → `mis team`) · Superpowers dispatching-parallel-agents, subagent-driven-development.

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`, run from the main working tree. All the rules of `/make-it-ship:run` apply (read `${CLAUDE_PLUGIN_ROOT}/skills/run/SKILL.md` first): approval gates, test-first, only `mis check` creates evidence, only `mis verdict` decides.

Invoke only on an explicit request. Arguments: `[N[:claude|codex|gemini]] <task>`. N is 1-10 (default: the number of independent tasks in the current wave, at most 5).

## Choose the worker surface (once, at the start)

| | Subagents (default) | tmux workers (`mis team`) |
|---|---|---|
| How | Agent tool, `make-it-ship:implementer`, one per task in the same message | `mis team start` opens a tmux session with N panes; each pane claims tasks from a shared file task list |
| Use when | normal parallel work inside this session | the user asks for CLI workers / omc-teams, long tasks that should survive this session, or codex/gemini workers |
| Needs | nothing | tmux (`mis team start` reports BLOCKED without it) |

Codex and gemini workers send repository content to an external model service: `--worker codex|gemini` (or a custom `MIS_TEAM_WORKER_CMD`) makes the guard ask the user. Company policy may forbid it; if the user declines, use claude workers. Never call codex/gemini directly.

Claude tmux workers run `claude --plugin-dir <this plugin> --allowedTools Bash,Read,Edit,Write,Grep,Glob --disallowedTools <push, gh pr/release, installs> --permission-mode acceptEdits -p <task prompt>`. The guard and hooks are active in them with run-level rules (`MIS_TEAM_ID`), push/PR/install commands are disallowed outright, and other guard asks have no one to answer in print mode. Remote writes, installs and config changes stay with you, the lead.

## Stage 1 — plan

1. `mis start --input "<task>"`, then the run phases discover → interview (only if ambiguous) → plan (`skills/run/phases/plan.md`). Every task needs `files` (ownership) and `dependsOn`; split until tasks in one wave share no files.
2. `mis mode set ...`, plan-critique for standard/full, then the user approves: `mis approve plan`. No worker starts before approval.
3. `mis parallel plan` prints the waves. Write a 5-line stage handoff (decided / rejected / risks / files / remaining) with the `shared_memory_write` tool (namespace `team-<run id>`, key `handoff-<stage>`); subagent briefs and the next stages read it with `shared_memory_read`, so context survives compaction.

## Stage 2 — exec (one wave at a time)

**Subagents:** follow `skills/run/phases/parallel.md` — `mis worktree add <task>` per task, dispatch one implementer per task in the same message with a self-contained brief, then `mis worktree merge <task>` for each DONE task.

**tmux workers:**
1. Mark the wave's tasks started: `mis task <id> start` for each.
2. Write the wave as JSON (`[{"subject":"T1: <title>","description":"<acceptance criteria, owned files, constraints, which tests to run>"}]`) and start: `mis team start <N> "<goal>" --tasks - [--worker claude] <<'MIS'` … `MIS`. It prints the team id, worker branches and an attach command; give the user the attach command.
3. Wait: `mis team wait --timeout 100` (stays under the Bash tool's 2-minute default; repeat while it times out and `mis team status` shows workers running; a worker whose heartbeat is older than 30 s is `stale` — read its log path from the status).
4. `mis team shutdown`: closes the panes and removes clean worker worktrees. Dirty worktrees are kept and listed (uncommitted work is never deleted); the branches are always kept.
5. Review each worker branch (`git log`/`git diff <base>..<branch>`), merge it (`git merge --no-ff <branch>`), resolve conflicts yourself, and mark tasks: `mis task <id> done` for merged work, `mis task <id> fail` for failed or missing work.

## Stage 3 — verify

Exactly the verify and review phases: `mis check <name>` for every required check in the main tree (worker or worktree evidence does not cover merged code), the reviewers from `skills/run/phases/review.md`, then `mis verdict`. VERIFIED → `mis report` and stop. Otherwise go to fix with the verdict's reasons.

## Stage 4 — fix (bounded loop)

1. For each failed task or failing check: reproduce, record the root cause (`mis note rootcause <id> -`), then `mis task <id> retry`. The retry limit is enforced by `mis`; when it refuses, the run is BLOCKED for the user (`mis approve continue` is their call) — stop and report.
2. Fix with one worker per failing task (subagent, or a new `mis team start` with only the fix tasks), then back to Stage 3.
3. At most 3 exec → verify → fix rounds in total. After the third, stop: `mis report` with the current verdict and the open reasons. Never loop without new evidence.

## Cancel

`mis team shutdown` (tmux) and `mis cancel` only if the user also drops the run. Report which branches and kept worktrees remain.
