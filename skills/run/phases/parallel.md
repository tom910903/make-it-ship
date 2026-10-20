# Phase: parallel (optional)

Absorbs: OMC ultrawork · Superpowers dispatching-parallel-agents, using-git-worktrees. OMC team / omc-teams (staged pipeline, tmux workers) live in `/make-it-ship:team` (`skills/team/SKILL.md`), project-session-manager in `/make-it-ship:session`.

Use only when the plan has 2+ tasks that are truly independent (different files, no shared state) and the user agreed to parallel work. Otherwise implement sequentially.

1. Every task needs `files` (its ownership) and `dependsOn` where relevant. `mis parallel plan` prints waves: tasks in one wave do not share files and have their dependencies done.
2. The main working tree must be committed (task worktrees start from `HEAD`). Ask the user before committing their work.
3. For each task in the current wave: `mis worktree add <task>` → it prints the worktree path and the task's files. Inside a task worktree the guard asks before any edit outside that task's files.
4. Dispatch one `make-it-ship:implementer` per task **in the same message** (they run concurrently). Each brief is self-contained: worktree path, task id, title, acceptance criteria, owned files, the `mis` command line, required checks, constraints copied verbatim. Never paste the conversation.
5. When they finish: read each report; for every DONE task `mis worktree merge <task>`. A conflict is aborted automatically (main stays clean) and reported with the files; resolve it in that worktree (rebase on the current branch, fix, commit) and merge again. Unmerged worktrees keep the verdict PARTIAL.
6. After each wave: run the required checks in the main tree (`mis check`), since evidence from worktrees does not cover the merged code. Then the next wave.

Outside a run, `mis session create feature "<name>"` (using-git-worktrees) also runs the quick checks in the new worktree and prints them as a baseline. A baseline FAIL existed before any change: tell the user before starting work there.
