# Phase: plan

Absorbs: Superpowers writing-plans · OMC plan, planner, ultragoal · gstack spec.

Goal: a plan another engineer could execute without asking, stored with `mis plan set`.

1. Map files and responsibilities first; follow existing patterns; one responsibility per file.
2. Tasks: 1-3 for Quick, 3-7 for Standard/Full. A task is the smallest unit with its own test cycle that a reviewer could reject on its own. Each task has testable acceptance criteria (pass/fail; numbers instead of adjectives) and the files it touches.
3. No placeholders: no "TBD", "add appropriate error handling", "similar to T2". No features, options, abstractions, or dependencies the request did not ask for.
4. Self-check: every requirement maps to a task; names are consistent across tasks.
5. Store it (JSON on stdin):

```
mis plan set - <<'MIS'
{
  "goal": "one sentence",
  "constraints": ["what must not change", "no new dependencies"],
  "nonGoals": ["explicitly out of scope"],
  "acceptance": ["overall, testable"],
  "tasks": [
    {"id": "T1", "title": "...", "acceptance": ["testable criterion"], "files": ["src/x.ts", "test/x.test.ts"]}
  ],
  "plannedFiles": ["src/**", "test/**"],
  "riskFlags": [],
  "howToRun": ["npm test", "node bin/cli.js --help"],
  "ui": false
}
MIS
```

   `riskFlags` ⊆ `auth, payment, pii, migration, security`. `ui: true` when the work builds Web or iOS screens (Full mode then requires design-explore). Tasks may add `"dependsOn": ["T1"]`; `files` is the task's ownership for parallel work. `mis` rejects unknown keys and prints every schema error; fix and resend.
   **Layout**: when `.make-it-ship.json` has a `layout` (`mis layout` prints it), every `plannedFiles` and `files` entry must match one of its path globs, and a human doc under the docs folder needs one file per language (`docs/guide/x.md` + `docs/guide/x.ko.md`); AI docs go under `.ai/` in English, without a pair. `mis plan set` refuses a plan that breaks this and lists every violation. Fix the plan (move files under an allowed path, narrow a glob, add the translation), or, if the layout itself is wrong, propose the `layout` change to the user: it is a config change, and during a run it needs `mis approve config`.
6. Choose the mode and say why: `mis mode set <quick|standard|full> --reason "<why>"`. Risk flags force Standard or higher.
7. Until the plan is approved (or Quick without risk flags starts), make **no** code changes.

## Plan documents (Superpowers writing-plans, executing-plans; OMC plan)

When the plan must outlive this session (Full mode, 4+ tasks, the user asks for a plan, or someone else will execute it), also write it as `docs/make-it-ship/plans/<slug>.md`:

```
# Plan: <title>
## Goal
<one paragraph>
## Constraints
- <what must not change>
## Non-goals
- <out of scope>
## Tasks
### T1: <title>
Files: src/x.ts, test/x.test.ts
Depends on: T0
- <testable acceptance criterion>
## Acceptance criteria
- <overall, testable>
## Verification
- `npm test`
```

`mis plan check <file>` must pass; it exits 1 and lists missing sections (goal, tasks, a criterion per task, acceptance criteria, verification). To execute a plan document later (another session or person): `mis start --plan docs/make-it-ship/plans/<slug>.md` creates the run with its tasks loaded; continue at step 6 (mode) with every gate as usual.

## Several independent goals (OMC ultragoal)

When the request holds several goals that each deserve their own verified result ("CSV export, JSON export and an import wizard"), do not cram them into one plan. Record each one: `mis goal add "<goal>" --criteria "<a; b>"`. Then run them one at a time, one run per goal. After a goal's run is VERIFIED, `mis goal done <id> --evidence "<verdict and run id>"` prints the `/goal` handoff for the next goal. The ledger lives in the repository's state and survives sessions (`mis goal list`).
