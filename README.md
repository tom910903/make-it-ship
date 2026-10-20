# Make It Ship

A Claude Code plugin that takes an idea, a requirements `.md`, or an issue in your git repo, and runs it through planning, implementation, **real** verification, and review. It ends with an honest verdict: `VERIFIED`, `PARTIAL`, `BLOCKED`, or `FAILED`.

It makes two promises:
- **Nothing is called done without evidence.** Only `mis check` runs your project's test and build commands and records the exit code and log for the exact code state. Only `mis verdict` decides the result, using fixed rules. If the code or config changes later, that evidence is marked `STALE`.
- **Risky actions need your approval.** A PreToolUse hook asks you before plan approval, `git push`, PR creation, package installs, config changes, and external MCP writes while a run is active. Destructive commands (`git reset --hard`, `git clean -f`, `git checkout .`, force push, recursive delete outside the repo, database `DROP`/`TRUNCATE`, `kubectl delete`, `docker system prune`) and calls to other model services are asked about **at any time**, run or not. Force-pushing to `main`/`master` and editing run state by hand are always denied.

## Requirements
- Claude Code with plugin support, macOS or Linux
- Node.js 22 or newer
- A git repository

There are no runtime dependencies and no build step.

## Install
```sh
git clone <this repo> ~/make-it-ship
claude --plugin-dir ~/make-it-ship          # one session
```
Or install it through a marketplace. A local marketplace directory needs a `.claude-plugin/marketplace.json` that lists this repository as a plugin. Then run:
```sh
claude plugin marketplace add <marketplace-dir> --scope project
claude plugin install make-it-ship@<marketplace-name> --scope project
```
Step-by-step instructions are in `docs/milestones/NEEDS_HUMAN.md` (NH-5). This install path has not yet been confirmed by a person.

## Use
```
/make-it-ship:run Implement docs/feature-request.md
/make-it-ship:run Fix the bug described in ISSUE.md
/make-it-ship:status
```
Optional single-phase commands: `/make-it-ship:interview`, `/make-it-ship:plan-review`, `/make-it-ship:review`, `/make-it-ship:debug`, `/make-it-ship:qa`, `/make-it-ship:ship`, `/make-it-ship:resume`, `/make-it-ship:retro`.

What happens:
1. **Setup.** `mis doctor` checks the environment. `mis init` proposes `.make-it-ship.json`, which holds the check commands (detected from `package.json`, Python tests, a `Makefile`, Cargo, Go, or SwiftPM). You confirm it before it is written.
2. **Discover and interview.** The plugin reads the repo first and asks only the high-impact questions, one at a time.
3. **Plan and choose a mode.** The mode is Quick, Standard, or Full, and the plugin gives a reason for its choice. Risk flags (auth, payment, PII, migration, hardware, security) force Standard or higher.
4. **Plan critique and your approval.** These happen in Standard and Full. A Quick change with no risk flags skips approval.
5. **Implement.** Work is test-first and uses the smallest complete change.
6. **Verify and QA.** `mis check` runs the checks, including real-use QA checks (`qa-*`) for a CLI, API, web UI, or iOS simulator surface that `mis qa detect` finds. Read-only reviewer agents (spec and quality, plus security for risky changes) review the change.
7. **Report.** The report goes to `docs/make-it-ship/<run>/report.md`. It covers the goal, task status, changed files, real check results, what could not be verified and why, invalidated evidence, decisions left to you, and how to run the result.

8. **Ship (on request, or Full).** Doc and changelog edits happen before verify. After the report, `mis ship` writes a PR draft, a changelog draft and a release checklist (`NOT READY` unless VERIFIED). Push or PR happens only after your approval.

More tools:
- `mis bench <check> --runs N` measures performance. It flags +20% as WARN and +50% as REGRESSION.
- `mis retro` aggregates metrics across runs.
- `mis learn add|list` records project learnings.
- For a second opinion from another model, `mis second-opinion detect` finds codex/gemini CLIs. Calling them sends code to an external service, so it happens only with your approval.
- iOS device QA uses the DEBUG-only bridge in `templates/ios-debug-bridge/`. `mis ios devices` lists devices and `mis ios bridge-scan` finds leftover bridge code.
- Codex users: see `adapters/codex/AGENTS.md`. Its flow is the same, but no guard enforces it.

Run state lives in `.git/make-it-ship/`, so it is never committed and never affects the code hash.

## Always on (every conversation, not only inside a run)
Installing the plugin is enough; nothing else needs to be installed for these.
- **Session start:** the skill list and the working discipline (ask before building when unclear, test first, root cause before fixes, verify before claiming done), the coding style at the current level, an active-run notice, and a short map of the codebase's top-level functions.
- **Coding style:** `/make-it-ship:style off|lite|full|ultra` sets the level for the current session (`mis style <level>` inside a session); `mis style default <level>` sets what new sessions start with. The rules also reach subagents; set `subagentMatcher` in `~/.make-it-ship/config.json` to limit which ones. A prompt that is just "normal mode" turns it off for the session.
- **Keywords in your prompt:** `ralph` (persistent loop), `autopilot` / "build me an app…" (full run), `ulw` (parallel), `ralplan` (plan until the critic accepts), `deep interview`, `deslop`, `tdd`, `code review`, `security review`, `ultrathink`, `deepsearch`, `deep-analyze`, `ccg` (other models, asks first), `ultragoal`, `cancelomc`. Korean and Japanese forms work too (랄프, 울트라워크, 코드 리뷰, ラルフ, コードレビュー, …). Mentions inside code, quotes, URLs, paths or questions about a keyword do not trigger; `ralph` starts a loop only as a prefix ("ralph: …", "/ralph …", "ralph mode: …", "랄프: …", "ラルフ: …"); any other mention ("use ralph …", "랄프로 …", names, questions) only adds a note asking the model to judge, and "turn off ralph" / "ralph: stop" / "랄프 꺼줘" cancels it. Disable any with `keywords.disabled` in `~/.make-it-ship/config.json`; check a prompt with `mis test-prompt "<text>"`.
- **Persistent loop:** `/make-it-ship:loop` (`mis loop start|status|cancel`). It holds only the session that started it. That session cannot stop until a run reported after the loop started has verdict VERIFIED, the run is BLOCKED or awaiting your approval, the iteration limit is reached, or three continues make no progress. `mis cancel` also ends it.
- **Freeze:** `mis freeze <dir>` denies edits outside one directory of the current repository (other repositories are not affected; symlinks are followed); `mis unfreeze` lifts it.
- **After tool calls:** matching `.cursor/rules` and `.github/instructions` files are shown once per session (Claude Code already loads `.claude/rules`), a reminder to run tests after many edits, and a root-cause hint after the same call fails three times.
- **Status line:** `MIS ▸ idle · style full · frozen src · main · <model> · ctx 42%`, or the run progress when a run exists (register it from `mis init`'s `hud.statusLine`). To keep a status line you already had, put its command in `statusLine.chain` in `~/.make-it-ship/config.json`; its first line is appended after ` | `.
- **Memory across sessions:** `<remember>…</remember>` in a subagent result or your last answer is kept for 7 days, `<remember priority>…</remember>` permanently; priority notes, project directives and the wiki index are injected at session start and again after compaction.
- Per-user state lives in `~/.make-it-ship/` (`MIS_STATE_HOME` overrides it). These hooks never block a session on their own errors; only the guard fails closed.

## Teams and sessions
- **Team pipeline:** `/make-it-ship:team [N[:claude|codex|gemini]] <task>` runs plan → exec → verify → fix (at most 3 rounds) on top of a normal run, so approval, `mis check` and `mis verdict` still decide. Only on explicit request; the word "team" in a prompt does nothing.
- **tmux workers:** `mis team start <N> "<task>" [--tasks <json|->] [--worker claude|codex|gemini]` opens a tmux session with N panes, each on its own worktree and branch (`mis/team/<id>/wN`), claiming tasks from a shared file task list (atomic, no double claims) with a heartbeat and log per worker. `mis team status`, `mis team wait [--timeout s]`, `mis team shutdown` (closes panes, removes clean worktrees, keeps branches and any worktree with uncommitted work). Claude workers run `claude -p` with this plugin (guard and hooks active, run-level guard rules even without a run), Bash and file tools pre-allowed, and `git push`, `gh pr`/`gh release` and package installs disallowed; other guard asks have no one to answer in print mode, so do not expect them to pass. Codex/gemini workers send code to an external service, so the guard asks first. Without tmux it reports BLOCKED.
- **Sessions (psm):** `/make-it-ship:session`, `mis session create issue <n> | pr <n> | feature "<name>" [--base <ref>] [--tmux]`, `mis session list`, `mis session remove <name>`. Each gets its own worktree under `.worktrees/` (`fix/<n>`, `pr-<n>-review` fetched from `pull/<n>/head`, `feature/<slug>`). Remove refuses while the worktree has uncommitted changes and keeps the branch.
- **Visual companion:** `mis companion start [dir]` serves HTML mockups and diagrams (default `design/`) on 127.0.0.1 with a page index, live reload and clickable `data-choice` options (`mis companion status` lists clicks); `mis companion stop`. The URL carries an access key. The design phases offer it when a question is visual.

## Tools (MCP server `mis`, bundled)
The plugin ships an MCP server (`.mcp.json`), so these tools appear as `mcp__plugin_make-it-ship_mis__<name>`:
- **Memory:** `notepad_*` (priority / working 7 days / manual), `project_memory_*` (stack, commands, notes, directives), `state_*` (mode state; the run, loop, style and freeze are shown live and read-only), `shared_memory_*` (namespaced key/value with TTL for agents). Stored under `.git/make-it-ship/memory/`, never committed.
- **Knowledge:** `wiki_*` (pages in `.make-it-ship/wiki/`, git-ignored by default — delete its `.gitignore` to commit them), `session_search` (past Claude Code sessions of this project, read-only), `trace_timeline` / `trace_summary` (run events and hook activity), `deepinit_manifest`, `merge_readiness_*` (a check-your-understanding session before merging, using the run's evidence).
- **Code:** `lsp_*` (hover, definition, references, symbols, diagnostics, rename, code actions — uses language servers already installed: typescript-language-server, pyright/pylsp, gopls, rust-analyzer, clangd, sourcekit-lsp), `ast_grep_search` / `ast_grep_replace` (needs the `ast-grep` CLI), `python_repl` (a persistent `python3`; it is ordinary Python with the same reach as running python from Bash). A missing binary returns an install hint instead of a result.
- **Skills:** `list_skills`, `load_skills_local`, `load_skills_global`.
- `ast_grep_replace` and `lsp_rename` change files only with `apply: true`; while a run is active the guard asks before they (and `lsp_code_action_resolve`) rewrite files, and freeze applies to them.
- Note: Claude Code does not load a plugin's MCP server when started with `--strict-mcp-config`.

## Browser (built in, no Playwright)
`mis browse <command>` drives a real headless Chrome, Chromium or Edge already on the machine through the DevTools Protocol. Nothing is installed. One daemon runs per worktree; its state lives in `.git/make-it-ship/browse/`, or `~/.make-it-ship/browse/` outside a repo. It starts on the first command and stops after 30 idle minutes. If no browser is found, commands print `BLOCKED`.
- **Commands:** `goto`, `snapshot -i` (`@e` refs for `click`/`fill`/…), `text`, `console --errors`, `network`, `perf`, `screenshot`, `responsive`, `pdf`, `diff`, tabs and frames, `chain`, and `handoff`/`resume` (a visible window for CAPTCHA or MFA, then back to headless with the cookies kept). `mis browse` lists them all; see `skills/browse/SKILL.md`.
- **Guard:** `storage`, `js` and `eval` run freely on local pages (localhost, `file:`). On real sites they need `--remote`, and the guard asks you. Raw `mis browse cdp` always asks.
- `mis pdf <file.md> [-o out.pdf]` makes a print-ready PDF from markdown (remote images blocked unless `--allow-network`).
- `mis visual-verdict <shot.png> <ref.png>` compares two screenshots pixel by pixel: JSON with a 0–100 score (90 or more passes; otherwise exit 1) and a diff image.
- Web QA (`/make-it-ship:qa`) uses this browser when the project has no Playwright. That covers report-only QA, a design-review loop with live screenshots, and page benchmarks.
- Cookie import, connecting to your own Chrome, downloads and scraping are not included yet.

## `mis` CLI
You run it as `node scripts/mis.mjs <command>`. Commands: `doctor`, `init [--write]`, `start --input <file|text>`, `plan set <file|->`, `mode set <quick|standard|full> --reason <text>`, `interview add|resolve`, `approve plan|continue|config`, `task <id> start|done|fail|retry`, `check <name>`, `note dep|rootcause|design`, `review add <kind> <file|->`, `verdict`, `status [--json]`, `report`, `resume [run]`, `parallel plan`, `worktree add|merge <task>`, `qa detect`, `ship`, `block <reason>`, `cancel`, `style [level] | style default <level>`, `loop start [--max N] <task> | status | cancel`, `freeze <dir>`, `unfreeze`, `test-prompt <text>`, `browse <command>`, `pdf <file.md>`, `visual-verdict <shot> <ref>`, `team start|status|wait|shutdown`, `session create|list|remove`, `companion start|status|stop`.

## Configuration: `.make-it-ship.json`
```json
{
  "version": 1,
  "checks": { "unit": { "argv": ["npm", "test"], "timeoutSec": 600 } },
  "required": { "quick": ["unit"], "standard": ["unit"] },
  "limits": { "maxAttemptsPerTask": 2, "maxRuntimeMinutes": 120 }
}
```
Commands run without a shell. A command that is missing, not installed, or times out counts as `BLOCKED` ("not verified"), never as passed.

## Development
```sh
npm test                       # node:test, no dependencies
claude plugin validate .
node evals/setup-demo.mjs a    # demo repo in a temp dir
```
Design documents: `docs/Make_It_Ship_Spec_v1.1.md` (authoritative), `docs/adr/`, `docs/PROGRESS.md`.

## Limits
- The guard protects against careless mistakes, not against a model deliberately obfuscating commands.
- Token budgets are not supported because plugins cannot read token usage. Runtime and retry limits are enforced instead.
- In headless runs (`claude -p`), approval prompts cannot be shown. Steps that need approval stop instead.
