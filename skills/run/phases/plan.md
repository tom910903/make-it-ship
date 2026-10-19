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
  "howToRun": ["npm test", "node bin/cli.js --help"]
}
MIS
```

   `riskFlags` ⊆ `auth, payment, pii, migration, hardware, security`. `mis` rejects unknown keys and prints every schema error; fix and resend.
6. Choose the mode and say why: `mis mode set <quick|standard|full> --reason "<why>"`. Risk flags force Standard or higher.
7. Until the plan is approved (or Quick without risk flags starts), make **no** code changes.
