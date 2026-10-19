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
```sh
git clone <this repo> ~/make-it-ship
claude --plugin-dir ~/make-it-ship          # one session
```
Or add it through a plugin marketplace that points to this repository.

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
6. **Verify.** `mis check` runs the checks, and read-only reviewer agents (spec and quality) review the change.
7. **Report.** The report goes to `docs/make-it-ship/<run>/report.md`. It covers the goal, task status, changed files, real check results, what could not be verified and why, invalidated evidence, decisions left to you, and how to run the result.

Run state lives in `.git/make-it-ship/`, so it is never committed and never affects the code hash.

## `mis` CLI
You run it as `node scripts/mis.mjs <command>`. Commands: `doctor`, `init [--write]`, `start --input <file|text>`, `plan set <file|->`, `mode set <quick|standard|full> --reason <text>`, `interview add|resolve`, `approve plan|continue|config`, `task <id> start|done|fail|retry`, `check <name>`, `note dep|rootcause|design`, `review add <kind> <file|->`, `verdict`, `status [--json]`, `report`, `resume [run]`, `parallel plan`, `worktree add|merge <task>`, `qa detect`, `ship`, `block <reason>`, `cancel`.

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
