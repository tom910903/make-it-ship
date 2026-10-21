# Make It Ship

A Claude Code plugin that takes an idea, a requirements `.md`, or an issue in your git repo, and runs it through planning, implementation, **real** verification, and review. It ends with an honest verdict: `VERIFIED`, `PARTIAL`, `BLOCKED`, or `FAILED`.

It makes two promises:
- **Nothing is called done without evidence.** Only `mis check` runs your project's test and build commands and records the exit code and log for the exact code state. Only `mis verdict` decides the result, using fixed rules. If the code or config changes later, that evidence is marked `STALE`.
- **Risky actions need your approval.** A PreToolUse hook asks you before plan approval, `git push`, PR creation, package installs, destructive deletes, config changes, and external MCP writes. Force-pushing to `main`/`master` and editing run state by hand are always denied.

## Requirements
- Claude Code with plugin support, macOS or Linux
- Node.js 22 or newer
- A git repository

There are no runtime dependencies and no build step.

## Install
You need read access to `github.com/tom910903/make-it-ship` (a private repository).

### Option A: load it for one session
```sh
git clone git@github.com:tom910903/make-it-ship.git ~/make-it-ship
cd /path/to/your/repo
claude --plugin-dir ~/make-it-ship
```
To update later, run `git -C ~/make-it-ship pull`.

### Option B: install through a local marketplace
Create the marketplace in `~/make-it-ship-marketplace`. The plugin is cloned inside it.
```sh
mkdir -p ~/make-it-ship-marketplace/.claude-plugin ~/make-it-ship-marketplace/plugins
git clone git@github.com:tom910903/make-it-ship.git ~/make-it-ship-marketplace/plugins/make-it-ship
cat > ~/make-it-ship-marketplace/.claude-plugin/marketplace.json <<'EOF'
{
  "name": "mis-local",
  "owner": { "name": "local" },
  "description": "Local marketplace for the Make It Ship plugin",
  "plugins": [ { "name": "make-it-ship", "source": "./plugins/make-it-ship" } ]
}
EOF
```
Then install it from inside the repository where you want to use it. `--scope project` writes only to that repository's `.claude/settings.json`.
```sh
cd /path/to/your/repo
claude plugin marketplace add ~/make-it-ship-marketplace --scope project
claude plugin install make-it-ship@mis-local --scope project
claude plugin list    # make-it-ship@mis-local should show as enabled
```
Start `claude` with no flags. The commands below are now available.

To update, run `git -C ~/make-it-ship-marketplace/plugins/make-it-ship pull` and then `claude plugin update make-it-ship@mis-local`. To remove the plugin, run these commands from the same repository:
```sh
claude plugin uninstall make-it-ship@mis-local --scope project
claude plugin marketplace remove mis-local
rm -rf ~/.claude/plugins/cache/mis-local    # uninstall leaves this cached copy behind
```

Claude checked Option B in an interactive session on 2026-10-21 (`docs/milestones/NH-auto-check.md`, NH-5). A person has not yet checked it.

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
3. **Plan and choose a mode.** The mode is Quick, Standard, or Full, and the plugin gives a reason for its choice. Risk flags (auth, payment, PII, migration, security) force Standard or higher.
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

## `mis` CLI
You run it as `node ~/make-it-ship/scripts/mis.mjs <command>`; the skills call it for you. Commands: `doctor`, `init [--write]`, `start --input <file|text>`, `plan set <file|->`, `mode set <quick|standard|full> --reason <text>`, `interview add|resolve`, `approve plan|continue|config`, `task <id> start|done|fail|retry`, `check <name>`, `note dep|rootcause|design`, `review add <kind> <file|->`, `verdict`, `status [--json]`, `report`, `resume [run]`, `parallel plan`, `worktree add|merge <task>`, `qa detect`, `ship`, `retro`, `learn add|list`, `bench <check> [--runs N]`, `second-opinion detect`, `ios devices|bridge-scan`, `block <reason>`, `cancel`.

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
