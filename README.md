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
- **Keywords in your prompt:** `ralph` (persistent loop), `autopilot` / "build me an app…" (full run), `ulw` (parallel), `ralplan` (plan until the critic accepts), `deep interview`, `deslop`, `tdd`, `code review`, `security review`, `ultrathink`, `deepsearch`, `deep-analyze`, `ccg` (other models, asks first), `ultragoal`, `cancelomc`. Korean and Japanese forms work too (랄프, 울트라워크, 코드 리뷰, ラルフ, コードレビュー, …). Mentions inside code, quotes, URLs, paths or questions about a keyword do not trigger; `ralph` starts a loop only in an explicit form ("ralph: …", "/ralph …", "use ralph …", "랄프로 …", "ラルフで…"); any other mention only adds a note asking the model to judge, and "turn off ralph" / "랄프 꺼줘" cancels it. Disable any with `keywords.disabled` in `~/.make-it-ship/config.json`; check a prompt with `mis test-prompt "<text>"`.
- **Persistent loop:** `/make-it-ship:loop` (`mis loop start|status|cancel`). It holds only the session that started it. That session cannot stop until a run reported after the loop started has verdict VERIFIED, the run is BLOCKED or awaiting your approval, the iteration limit is reached, or three continues make no progress. `mis cancel` also ends it.
- **Freeze:** `mis freeze <dir>` denies edits outside one directory of the current repository (other repositories are not affected; symlinks are followed); `mis unfreeze` lifts it.
- **After tool calls:** matching `.cursor/rules` and `.github/instructions` files are shown once per session (Claude Code already loads `.claude/rules`), a reminder to run tests after many edits, and a root-cause hint after the same call fails three times.
- **Status line:** `MIS ▸ idle · style full · frozen src · main · <model> · ctx 42%`, or the run progress when a run exists (register it from `mis init`'s `hud.statusLine`). To keep a status line you already had, put its command in `statusLine.chain` in `~/.make-it-ship/config.json`; its first line is appended after ` | `.
- Per-user state lives in `~/.make-it-ship/` (`MIS_STATE_HOME` overrides it). These hooks never block a session on their own errors; only the guard fails closed.

## `mis` CLI
You run it as `node scripts/mis.mjs <command>`. Commands: `doctor`, `init [--write]`, `start --input <file|text>`, `plan set <file|->`, `mode set <quick|standard|full> --reason <text>`, `interview add|resolve`, `approve plan|continue|config`, `task <id> start|done|fail|retry`, `check <name>`, `note dep|rootcause|design`, `review add <kind> <file|->`, `verdict`, `status [--json]`, `report`, `resume [run]`, `parallel plan`, `worktree add|merge <task>`, `qa detect`, `ship`, `block <reason>`, `cancel`, `style [level] | style default <level>`, `loop start [--max N] <task> | status | cancel`, `freeze <dir>`, `unfreeze`, `test-prompt <text>`.

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
