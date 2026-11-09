English | [한국어](README.ko.md)

# Make It Ship

**From an idea to verified code, with a verdict you can trust.**

![version 0.4.0](https://img.shields.io/badge/version-0.4.0-blue) ![tests node:test](https://img.shields.io/badge/tests-node%3Atest-green) ![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-orange) ![no dependencies](https://img.shields.io/badge/dependencies-none-lightgrey)

Make It Ship is a Claude Code plugin that takes an idea, a requirements `.md` or an issue in your git repository and runs it through planning, implementation, **real** verification and review. It ends with one of four verdicts: `VERIFIED`, `PARTIAL`, `BLOCKED` or `FAILED`. The model never picks the verdict. `mis check` runs your project's own test and build commands and records the exit code for the exact code state; `mis verdict` applies fixed rules to that evidence. A PreToolUse hook (the guard) asks you before risky actions.

```
plan ──▶ approve ──▶ implement ──▶ verify ──▶ review ──▶ verdict + report
(questions,  (you)      (test-first)   (mis check)  (read-only     (mis verdict,
 mode, critic)                                       reviewers)     fixed rules)
```

## Quick start

Requirements: Claude Code with plugin support (macOS or Linux), Node.js 22+, a git repository. No runtime dependencies, no build step.

```sh
claude plugin marketplace add tom910903/make-it-ship
claude plugin install make-it-ship@make-it-ship
```

The repository is private, so your machine needs git access to `github.com/tom910903/make-it-ship` (an SSH key, or HTTPS through `gh auth setup-git`). Then start `claude` inside your repository and hand it one sentence:

```
/make-it-ship:run Fix the bug where a failed login shows no error message
```

On the first run it detects your test and build commands and shows a draft `.make-it-ship.json`; confirm it, because this file decides what must pass. `/make-it-ship:setup doctor` checks the installation, `/make-it-ship:status` shows progress, and `/make-it-ship:help` lists everything.

- **One repository only:** add `--scope project` to both commands, run inside that repository.
- **Update:** `claude plugin marketplace update make-it-ship`, then `claude plugin update make-it-ship@make-it-ship`, then restart. A release reaches users only when `version` in `.claude-plugin/plugin.json` changes.
- **Remove:** `claude plugin uninstall make-it-ship@make-it-ship`, `claude plugin marketplace remove make-it-ship`, then `rm -rf ~/.claude/plugins/cache/make-it-ship` (uninstall leaves this copy behind).
- **Try a clone for one session:** `claude --plugin-dir ~/make-it-ship` after `git clone git@github.com:tom910903/make-it-ship.git ~/make-it-ship`; update it with `git -C ~/make-it-ship pull`.

Claude checked the marketplace install from GitHub on 2026-10-21 (`docs/milestones/NH-auto-check.md`). A person has not yet checked it.

## See it work

Real output from driving `mis` by hand on the demo repository `evals/demos/a` (an "add `slugify`" request), with the plan still awaiting approval: the `unit` check passed, but the task was not done and no reviews were recorded yet. `mis verdict` refuses to call that done:

```json
{
  "verdict": "PARTIAL",
  "reasons": [
    "task T1 is TODO",
    "spec review missing for current code",
    "quality review missing for current code"
  ],
  "checks": { "unit": "PASS" },
  "treeHash": "13ab940ff8af4b782357ffb43463943d9727b283",
  "changedManifests": [],
  "state": "AWAITING_APPROVAL"
}
```

The report goes to `docs/make-it-ship/<run>/report.md`. Its template (`templates/report.md`) is written in Korean; the same run produced:

```
> **판정: PARTIAL** — 배포 준비 완료 아님
> 판정은 `mis verdict`가 규칙(Spec §6)으로 계산했다. 모델이 정한 값이 아니다.

## 4. 수행한 검증과 실제 결과 (기계 검증)
| ID | check | 명령(argv) | exit | 기록 당시 | 현재 코드 기준 | 종료 시각 |
| E1 | unit | `npm test` | 0 | PASS | PASS | 2026-10-21T23:31:30.085Z |

## 6. 검증하지 못한 영역과 이유
- task T1 is TODO
- spec review missing for current code
```

The report's ten sections cover the goal, task status, changed files, real check results, reviews, what could not be verified and why, evidence invalidated by later changes, decisions left to you, how to run the result, and intentional shortcuts. Each section says whether it is machine-verified or model judgment.

## How it works

**Verdict rules.** `mis verdict` applies these in order; the first match wins.

| Verdict | Meaning | Common reasons | What to do |
|---|---|---|---|
| `BLOCKED` | could not verify | the run is blocked (limit, missing tool or credentials), or a required check could not run and none failed | fix the reason, then `/make-it-ship:resume` |
| `FAILED` | verified, and it fails | a required check failed, or a review has blocking issues | read the failure log in the report |
| `PARTIAL` | nothing failed, but evidence is missing | stale or missing checks, a missing review, unfinished tasks or unmerged task worktrees, an unanswered HIGH question, a dependency change without `mis note dep`, an unapproved config change, no required checks defined | work through the reasons in the report |
| `VERIFIED` | required checks pass, required reviews exist, every task is done | — | run it as the report describes |

Quick mode requires `required.quick`; Standard and Full require `required.standard` plus every `qa-*` check. Reviews: quality (Quick), spec and quality (Standard, Full), plus security when risk flags (auth, payment, PII, migration, security) are set. Evidence recorded before the code or config changed becomes `STALE`. Run state lives in `.git/make-it-ship/`, so it is never committed.

**The guard.** While a run is active it asks before plan approval, `git push`, PR creation, package installs, config changes and external MCP writes. Destructive commands (`git reset --hard`, `git clean -f`, `git checkout .`, force push, recursive delete outside the repo, database `DROP`/`TRUNCATE`, `kubectl delete`, `docker system prune`) and calls to other model services are asked about **at any time**, run or not. Force-pushing to `main`/`master` and editing run state by hand are always denied. It protects against careless mistakes, not against a model deliberately obfuscating commands.

**MCP tools.** A bundled MCP server adds memory (`notepad_*`, `project_memory_*`, `state_*`), knowledge (`wiki_*`, `session_search`, `trace_timeline`), code intelligence (`lsp_*`, `ast_grep_*`, `python_repl`, using tools already installed) and skill loading. They appear as `mcp__plugin_make-it-ship_mis__<name>`.

**Built-in browser.** `mis browse` drives a Chrome, Chromium or Edge already on the machine, headless, through the DevTools Protocol. No Playwright, nothing installed; with no browser it reports `BLOCKED`. `mis browse start --local-only` starts a browser that can reach only this machine (localhost, `127.0.0.1`, `[::1]`); file uploads run without asking only there. Credential commands (cookies, headers, downloads, …) always ask.

All details: [docs/reference.md](docs/reference.md).

## How to use

Claude runs the `mis …` commands for you; you type the prompt.

**1. Fix a bug**
```
/make-it-ship:run Setting a cart quantity to 0 makes the total NaN. Fix it.
```
It finds the code involved and picks **Quick** mode for a small low-risk fix (no plan approval without risk flags). It writes a failing test first and records the root cause before the fix. Code touching auth, payment, personal data, migrations or security is raised to Standard and gets a security review.

**2. Add a feature (Standard, with approval)**
```
/make-it-ship:run Implement docs/feature-request.md
```
It asks only the questions the code cannot answer, one at a time, then writes a plan that the critic agent reviews. **You approve** the goal, tasks, acceptance criteria and required checks; nothing is built before that, and declining stops the run. Each task is test-first; with 3+ tasks each gets a fresh subagent, a spec review and a quality review. Add "and prepare a PR" to ship; push and PR creation still ask. `/make-it-ship:plan` plans now and builds later.

**3. You only have an idea**
```
/make-it-ship:interview I want a tool that summarizes our meeting notes and posts them to Slack
```
No code changes. One question at a time, each with a restatement, a recommendation and 2–4 options. The result is a spec in `docs/make-it-ship/specs/` with testable acceptance criteria. A bare "just build it" starts this interview instead of building.

**4. Review only**
```
/make-it-ship:review
```
Read-only reviewers check the working-tree changes; each finding has a severity and evidence. "audit the whole repo" reviews everything, report only.

**5. Resume, check status**
```
/make-it-ship:resume
```
It summarizes where the run stopped, what changed since, which checks are now `STALE` and what waits for you. Only you can lift a runtime or retry limit. `/make-it-ship:status` shows phase, tasks, checks, reviews and the current verdict.

**6. Browser QA (local-only)**
```
/make-it-ship:qa Check the sign-up page at http://localhost:3000 in local-only mode, including the profile photo upload
```
Headless screenshots and console errors from your installed browser. In local-only mode the upload runs without asking; in a normal browser it always asks, because the file could leave the machine.

## Reference

### Slash skills

| Area | Skills |
|---|---|
| Main flow | `/make-it-ship:run`, `/make-it-ship:status`, `/make-it-ship:resume`, `/make-it-ship:cancel` |
| Single phases | `/make-it-ship:plan`, `/make-it-ship:interview`, `/make-it-ship:brainstorm` (design options, optional slide deck), `/make-it-ship:plan-review`, `/make-it-ship:review`, `/make-it-ship:debug`, `/make-it-ship:qa`, `/make-it-ship:ship`, `/make-it-ship:retro` |
| Always on | `/make-it-ship:loop`, `/make-it-ship:style`, `/make-it-ship:browse` |
| Teams | `/make-it-ship:team`, `/make-it-ship:session` |
| Skills | `/make-it-ship:skill`, `/make-it-ship:skillify`, `/make-it-ship:writing-skills` |
| Setup and help | `/make-it-ship:setup`, `/make-it-ship:help`, `/make-it-ship:reference` |
| Outside services (ask first) | `/make-it-ship:ask`, `/make-it-ship:research`, `/make-it-ship:deploy`, `/make-it-ship:ops`, `/make-it-ship:ios`, `/make-it-ship:android`, `/make-it-ship:telemetry`, `/make-it-ship:gbrain`, `/make-it-ship:design-images`, `/make-it-ship:pair-agent`, `/make-it-ship:writer-memory` |

### Key `mis` commands

`mis` is `node scripts/mis.mjs` in the plugin; the skills call it for you. `mis help commands` prints all 90 from the code.

| Command | What it does |
|---|---|
| `mis doctor` / `mis init [--write]` | check the environment / propose `.make-it-ship.json` |
| `mis start --input <file\|text>` | start a run |
| `mis check <name>` | run one configured check and record the evidence |
| `mis verdict` / `mis report` | compute the verdict / write the report |
| `mis status` / `mis resume` | show / continue the current run |
| `mis layout [--json] \| write` | show layout violations / write `.ai/` skeletons and AGENTS.md |
| `mis browse <command>` | built-in headless browser |
| `mis bench <check> --runs N` | performance; +20% is WARN, +50% REGRESSION |
| `mis learn add\|list\|search` | project learnings |
| `mis second-opinion detect` | find codex/gemini CLIs for a second opinion (sending code asks first) |
| `mis help [topic]` | commands, skills, agents, keywords, styles, MCP tools, hooks |

### Always on

Installing the plugin is enough. Every session gets the working discipline (ask when unclear, test first, root cause before fixes, verify before claiming done), a coding style level (`/make-it-ship:style off|lite|full|ultra`), the guard, a status line, memory across sessions and auto-allow for plain read-only Bash inside the repository. Keywords in a prompt route to skills: `ralph` (persistent loop, only as a prefix such as "ralph: …"), `autopilot`, `ulw`, `ralplan`, `deep interview`, `deslop`, `tdd`, `code review`, `security review`, `ultrathink`, `ccg` (asks first), `office hours`, `cso`, `cancelomc`; Korean and Japanese forms work too. Check a prompt with `mis test-prompt "<text>"`.

### Planning, review, design, docs and release inside the flow

`/make-it-ship:run` brings in office hours, brainstorming, plan reviews (CEO, design, DX, eng), design boards, parallel tracers, audits, version bumps and secret scans at the phase where they fit; you do not call them separately. The run skill's "Situational steps" table lists every trigger.

### Charts, diagrams, visual docs and slides

All output is self-contained SVG/HTML with dark mode, written only inside the repository, with no runtime dependencies. Sources use mermaid syntax, so GitHub renders the same file.

```sh
mis chart sales.csv --type line --x month --y revenue,cost   # also .json, or a mermaid pie / xychart-beta .mmd
mis diagram design/login.mmd    # flowchart (+ .excalidraw), sequence, class, ER, state
mis doc docs/guide.md --pdf     # ```mermaid blocks become SVG; guide.md + guide.ko.md in one call
mis slides talk.md --pdf        # Marp-style markdown: --- between slides, <!-- notes -->
```

The HTML of `mis doc`, `mis slides` and `mis pdf` carries a Content-Security-Policy: scripts, frames, forms and remote loads in a document never run, raw tags that navigate (`<meta>` refresh, `<base>`, `<link>`, `<iframe>`, `<object>`, `<form>`) show as text, and only images inside the repository are inlined (as `data:`). The `.html` of `mis chart` and `mis diagram` holds only our own escaped SVG. Outputs that are symlinks are refused. PDFs need Chrome; without it the PDF is BLOCKED and the HTML stands. `mis doc` and `mis slides` exit 1 when a mermaid block cannot be drawn (the files and the `errors` report are still written).

### Teams and sessions

`/make-it-ship:team` runs plan → exec → verify → fix on top of a normal run (only on explicit request). `mis team start <N> "<task>"` opens tmux workers on their own worktrees; `mis session create issue|pr|feature` makes an isolated worktree; `mis companion start` serves mockups with clickable choices.

### Skill authoring

Learned skills live in `.make-it-ship/skills/` or `~/.make-it-ship/skills/`. `/make-it-ship:skillify` drafts one from the session, `/make-it-ship:writing-skills` tests it first (`mis skill test`), and `mis skill trust` is needed before a project skill is offered as instructions.

### Agents

21 subagents, each with the narrowest tool allowlist: read-only `explorer`, `analyst`, `planner`, `tracer`, `architect`, `critic`, `spec-reviewer`, `quality-reviewer`, `security-reviewer`, `product-reviewer`, `qa-tester`, `document-specialist`, `scientist`; `git-master` (commits, no push); writers `implementer`, `executor`, `debugger`, `designer`, `test-engineer`, `code-simplifier`, `writer`. Codex users: `adapters/codex/AGENTS.md` (same flow, no guard). iOS device QA uses the DEBUG-only bridge in `templates/ios-debug-bridge/`.

## Configuration

`.make-it-ship.json` in your repository:

```json
{
  "version": 1,
  "checks": { "unit": { "argv": ["npm", "test"], "timeoutSec": 600 } },
  "required": { "quick": ["unit"], "standard": ["unit"] },
  "limits": { "maxAttemptsPerTask": 2, "maxRuntimeMinutes": 120 },
  "layout": {
    "paths": ["src/**", "tests/**", "docs/**", ".ai/**", "*.md", "package.json", ".make-it-ship.json"],
    "purposes": { "src/**": "application code" },
    "docs": { "human": "docs", "ai": ".ai", "languages": ["en", "ko"] }
  }
}
```

Commands run without a shell. A command that is missing or times out counts as `BLOCKED`, never as passed. Going over `limits` makes the run `BLOCKED`; continuing needs your approval. Per-user settings: `mis config get|set` (`~/.make-it-ship/config.json`).

### Project layout and docs

`layout` is optional; without it the feature is off. With it, files go to fixed folders and docs are split by reader:

```
.ai/              for AI, English, terse facts
  index.md        map: which file to read when
  product.md      purpose, users, scope
  structure.md    folder rules (generated part from "layout")
  tech.md         stack and commands
  conventions.md  style, forbidden things
  decisions.md    one line per decision
  modules/        one doc per directory
AGENTS.md         canonical rules + map (CLAUDE.md imports it: @AGENTS.md)
docs/             for people, one file per language: guide/x.md + guide/x.ko.md
```

- `mis init` proposes a `layout` from your top-level folders (written only with `mis init --write`; if `.make-it-ship.json` already exists, `mis init --layout --write` adds only `layout`, and during a run that config change needs `mis approve config`). With two or more `layout.docs.languages`, a planned glob over human docs (`docs/**`) is refused: list each doc and its translations. The report lists human docs changed in the run that still miss a translation (section 6; the verdict rules are unchanged).
- `mis layout` lists files outside the rules and docs missing a translation. `mis layout write` creates missing `.ai/` skeletons (never overwritten), regenerates the marked part of `.ai/structure.md`, and writes a marked section in AGENTS.md and `@AGENTS.md` in CLAUDE.md (asks first). `.ai/` files are read on demand, not imported.
- At plan time inside a run, `mis plan set` refuses a plan with files outside `paths` or a human doc without its translation, and says how to fix each. Changing the layout is a config change (`mis approve config`).

## FAQ

**How is this different from oh-my-claudecode, superpowers, gstack or ponytail?** It absorbs their workflows into one plugin (`THIRD_PARTY_NOTICES.md`) and adds one rule: the verdict comes from recorded check results, not from the model. We measured it ([docs/m10/report.html](docs/m10/report.html)): six arms × three small demos × N=3 gave 54 runs, and all 54 passed and described the outcome honestly, so accuracy and honesty did not tell the arms apart. What differed was overhead against a no-plugin control (median cost): Make It Ship 4.1–6.1× with 2.2–2.6× the turns, gstack 7.5–8.2×, oh-my-claudecode, superpowers and ponytail 1.1–1.8×. The OMC workflow activated in 1 of 9 runs and superpowers in 6 of 9, so those arms partly measure an installed plugin. Medians only, no significance testing, one noisy machine; larger Standard and Full tasks were not measured.

**Does it send my code anywhere?** Not by itself. Commands that send data off the machine (other models, deploys, telemetry, which is off by default) always ask first, and their skills say company policy may forbid them.

**Why is my verdict `PARTIAL` when the tests pass?** Something else is missing: a review, a task not marked done, or a check that went `STALE`. The report lists each reason.

**Can it run headless (`claude -p`)?** Yes, but approval prompts cannot be shown there, so steps that need approval stop. Continue interactively with `/make-it-ship:resume`.

## Troubleshooting

- **Update shows no new version:** run `marketplace update` before `plugin update`, then restart; check that the release bumped `version`.
- **MCP tools are missing:** Claude Code does not load a plugin's MCP server under `--strict-mcp-config`.
- **`mis review add` is refused:** a review must contain exactly one `BLOCKING: <number>` line.
- **Files left after removal:** delete `~/.claude/plugins/cache/make-it-ship`; `mis uninstall --yes` removes the plugin's own user state.
- **Anything else:** `mis doctor` (or `mis doctor --fix`, `mis doctor session`).

## Docs, development, limits

- **Docs:** [docs/reference.md](docs/reference.md) (every feature in detail), [docs/HANDOFF.md](docs/HANDOFF.md) (current state), [docs/PROGRESS.md](docs/PROGRESS.md), [docs/Make_It_Ship_Spec_v1.1.md](docs/Make_It_Ship_Spec_v1.1.md) (authoritative spec), [docs/adr/](docs/adr/), [docs/m10/report.html](docs/m10/report.html) (comparison).
- **Development:**
  ```sh
  npm test                                         # node:test, no dependencies
  claude plugin validate .claude-plugin/plugin.json
  node evals/setup-demo.mjs a                      # demo repo in a temp dir
  claude plugin validate .                         # marketplace manifest
  node scripts/mis.mjs capabilities --write        # after adding a command, skill, agent, MCP tool or hook
  node scripts/gap-matrix.mjs --write              # recount docs/research/gap-matrix.md from its rows
  node evals/m10/run.mjs --arms control,mis --demos b --n 1   # comparison harness (runs real claude)
  node evals/m10/report.mjs <summary.json> [out.html]         # HTML report from the results
  ```
  To release, bump `version` in `.claude-plugin/plugin.json`.
- **Limits:** the guard stops careless mistakes, not deliberate obfuscation. Token budgets are not supported (plugins cannot read token usage); runtime and retry limits are enforced instead. Headless runs stop at approval steps.
- **License:** this private repository has no license file yet. Bundled third-party work is listed in `THIRD_PARTY_NOTICES.md`.
