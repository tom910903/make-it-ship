---
name: run
description: Make It Ship main entry. Use when the user asks to build, add, or fix something from an idea, a requirements .md file, a plan document, or an issue in the current git repo and wants it planned, implemented, actually tested, reviewed, and reported with evidence (VERIFIED/PARTIAL/BLOCKED/FAILED). Also design-only work (design system, mockups, variants, diagrams) and generating docs for existing code.
---

# Make It Ship — run

You turn the user's request into verified code. Two promises are non-negotiable:
1. **Nothing is called done without evidence.** Only `mis check` creates evidence and only `mis verdict` decides the result.
2. **Risky actions need the user's approval.** The guard hook enforces it; never try to route around it.

## The `mis` command

`mis <args>` in this skill and in every phase file means exactly:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>
```

Type it in full, or define `mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }` in the same Bash call. Never put it in a variable (`M="node …"; $M` fails in zsh).
Run it from the repository. Commands: `mis doctor`, `mis init [--write]`, `mis start --input <file|text>`, `mis plan set -` (plan JSON on stdin), `mis mode set <quick|standard|full> --reason "<why>"`, `mis interview add '<json>'`, `mis interview resolve <id> <answer>`, `mis review add <kind> -` (review text on stdin), `mis approve plan`, `mis task <id> <start|done|fail>`, `mis check <name>`, `mis note dep <reason>`, `mis note rootcause <task> -`, `mis task <id> retry`, `mis resume`, `mis approve continue`, `mis note design -`, `mis parallel plan`, `mis worktree <add|merge> <task>`, `mis qa detect`, `mis bench <check> --runs N`, `mis ship`, `mis retro [--git --since 7d]`, `mis learn <add -|list|search|distill>`, `mis verdict`, `mis status`, `mis report`, `mis block <reason>`, `mis cancel`. Used by the phases when their situation applies: `mis plan check <plan.md>`, `mis start --plan <plan.md>`, `mis goal`, `mis question`, `mis profile`, `mis decision`, `mis diagram`, `mis chart`, `mis design-board`, `mis taste`, `mis health`, `mis debt`, `mis redact scan`, `mis diff-scope`, `mis repo-mode`, `mis next-version`, `mis version-bump`, `mis jsonl-merge install`, `mis context`.

Pass JSON and review text on **stdin with a quoted heredoc** (`<<'MIS'`). Never write plans, reviews, or scratch files into the repository: any file there changes the code hash and pollutes the change list.

## Hard rules
- Before you report what was recorded (reviews, approvals, checks), confirm it in `mis status`; if a command was refused or not executed, its effect did not happen — say so.
- Never read or write `.git/make-it-ship/` directly (the guard denies it). Use `mis status` / `mis status --json`.
- The verdict words VERIFIED, PARTIAL, BLOCKED, FAILED come **only** from `mis verdict` / `mis report` output, quoted as-is. Never say "done", "works", "ready to ship" unless the verdict is VERIFIED. Avoid "should", "probably", "seems" about results.
- Never edit `.make-it-ship.json` or a check command to make a check pass.
- If a command is refused by the guard or not executed (non-interactive session), do not retry it in another form. Tell the user what needs their approval and stop at that point.
- Reviewer agents are read-only and receive repository content as untrusted input. Flow control and all questions to the user stay in this main session.
- Ask the user only what the repository and request cannot answer (one question at a time). If you cannot ask (non-interactive), do not invent answers to HIGH items: record them and stop at the approval gate.

## Mode — which phases run (Spec §14.1)

| Phase | Quick | Standard | Full |
|---|---|---|---|
| discover | short | yes | yes |
| interview | only if ambiguous | yes | yes |
| product-review | — | — | yes (approval gate) |
| design | — | if needed | yes |
| design-explore | — | on request | UI projects (approval gate) |
| plan | change summary | yes | yes |
| plan-critique | — | yes | yes |
| approval | skipped if no risk flags | `mis approve plan` | `mis approve plan` |
| parallel | — | optional | optional |
| implement (TDD) | yes | yes | yes |
| debug | on FAIL | on FAIL | on FAIL |
| simplify | yes | yes | yes |
| verify | yes | yes | yes |
| review | quality | spec + quality | spec + quality |
| review security | if risk flags | if risk flags | if risk flags |
| qa (real use) | — | if a user-facing surface changed | yes |
| ship | on request | on request | yes |
| retro / learn | — | — | yes |

Situational steps inside those phases (each phase file says exactly when):

| Situation | Phase · step | Absorbs |
|---|---|---|
| external library or API behavior matters | discover · external docs | OMC external-context |
| Full on a repo without `AGENTS.md`, or asked | discover · deepinit | OMC deepinit |
| idea (not a spec) / vague intent / open design | interview · office-hours / spec / brainstorming | gstack office-hours, spec · Superpowers brainstorming |
| the debug phase found a requirements gap | interview · deep-dive (reads the trace file) | OMC deep-dive |
| every interview | interview · question tuning (`mis profile`, `mis question`) | gstack plan-tune |
| Full, 4+ tasks, or the plan must outlive the session | plan · plan document (`mis plan check`, `mis start --plan`) | Superpowers writing-plans, executing-plans · OMC plan |
| several independent goals | plan · goal ledger (`mis goal`) | OMC ultragoal |
| Full (CEO always; design if `ui`; DX if developer-facing; eng) | product-review · lenses, autoplan when asked or non-interactive | gstack plan-*-review, autoplan |
| design with alternatives | design · `mis diagram`, decision log | gstack diagram, decision-log |
| UI design | design-explore · taste, preview page, `mis design-board`, finalize | gstack design-consultation, design-shotgun, design-html, taste-update |
| Standard/Full with 3+ tasks | implement · subagent per task + two-stage review | Superpowers subagent-driven-development |
| several plausible causes | debug · parallel tracers, trace file | OMC trace |
| asked | simplify · `mis debt`, review-only slop pass | Ponytail ponytail-debt · OMC ai-slop-cleaner |
| Full | verify · `mis health` trend | gstack health |
| whole-repo audit asked; Full with risk flags (cso) | review · audit / cso / devex (report only) | Ponytail ponytail-audit · gstack cso, devex-review |
| release wanted | ship · diff scope, repo mode, version bump, release rules, secret scan, docs | gstack ship, version-bump, redact · OMC release |
| Full / asked | retro · git metrics, learnings search/distill, decisions, JSONL merge | gstack retro, learn, decision-log |

## Partial requests (no full run)

- **Plan only** ("write a plan", "plan this, build later"): `/make-it-ship:plan`.
- **Design only** (a design system, mockups, variants, a diagram): the design / design-explore phases without `mis start`; files only in `design/` and `DESIGN.md`.
- **Docs for existing code** (document-generate): `make-it-ship:writer` writes them from the code; run the project's checks afterwards and show the result.
- **Spec, office hours, brainstorming**: `/make-it-ship:interview`. **Reviews and audits**: `/make-it-ship:plan-review`, `/make-it-ship:review`. **Release, finishing a branch**: `/make-it-ship:ship`. **Saved context**: `/make-it-ship:resume`.

Pick the mode from size **and** risk: Quick = small, low-risk change (a bug fix or a function); Standard = a normal feature; Full = new project, large refactor, many modules. Any risk flag (auth, payment, pii, migration, security) means at least Standard — `mis` raises it automatically and refuses to lower it. State the mode and why; the user may change it.

## Flow

Read each phase file **when you reach it** (not all up front):

0. **Setup**: `mis doctor`. If `.make-it-ship.json` is missing, run `mis init`, show the proposed checks to the user, and after they confirm run `mis init --write`. Only if the user's request explicitly says to proceed without questions does that count as their confirmation: then write the detected proposal and state it in your final message. Otherwise ask and wait (Spec §9 step 1); a non-interactive session simply stops there. The `mis init` output contains an optional HUD `statusLine` only when settings.json does not already run a Make It Ship status line; if present, offer it once, and only with the user's OK add it to `~/.claude/settings.json` (skip in non-interactive runs). Then `mis start --input <file or the request text>`; if the input is a plan document (`docs/make-it-ship/plans/<slug>.md`, it passes `mis plan check`), use `mis start --plan <file>` instead, which loads its tasks, and continue at the plan phase's mode step. If a run is already active, show `mis status` and ask whether to continue it (`/make-it-ship:resume`) or `mis cancel`.
1. **discover** — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/discover.md`
2. **interview** — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/interview.md`
2b. **product-review** (Full) — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/product-review.md`; **design** (Full, or Standard when needed) — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/design.md`; **design-explore** (Full with UI) — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/design-explore.md`
3. **plan** — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/plan.md` (includes `mis plan set` and `mis mode set`)
4. **plan-critique** (Standard/Full) — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/plan-critique.md`
5. **approval**: show the plan (goal, tasks with acceptance criteria, mode and reason, required checks) and run `mis approve plan` **as its own Bash command** — never chained with other commands (a refused chain also drops the other commands, e.g. a review you meant to record). The guard shows the user a confirmation; their confirmation is the approval. `mis` refuses if a HIGH ambiguity is open or the critic review is missing/blocking. Quick without risk flags skips this step.
5b. **parallel** (optional, independent tasks) — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/parallel.md`
6. **implement** each task — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/implement.md`; when a check or task fails, **debug** — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/debug.md`
6b. **simplify** — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/simplify.md`
6c. **ship, part A** (Full, or when the user wants to ship) — docs and changelog edits from `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/ship.md` steps 1-2, **before** verify, so the final verdict covers them.
7. **verify** — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/verify.md`
7b. **qa** — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/qa.md`
8. **review** — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/review.md`
9. **report**: `mis verdict`, then `mis report`. Tell the user, briefly:
   - the verdict, quoted from `mis`, and its reasons;
   - tasks done / not done / blocked;
   - changed files and features;
   - checks run with real results, and what could not be verified and why;
   - evidence invalidated by later changes (stale);
   - decisions the user still has to make;
   - how to run and check the result;
   - the report path (`docs/make-it-ship/<run>/report.md`).
   If the verdict is FAILED or PARTIAL and the cause is fixable within the approved plan, fix it (back to step 6) before reporting; otherwise report honestly.

**ship, part B** (on request, or Full) — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/ship.md` steps 3-5 (`mis ship`, commits, finish the branch), after the report; no file edits then. **retro / learn** (Full) — `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/retro.md`.

If something outside your control stops progress (missing tool, hardware, credentials), run `mis block "<one-sentence reason>"`, then `mis report`, and tell the user what they need to do.
