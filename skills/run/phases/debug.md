# Phase: debug

Absorbs: Superpowers systematic-debugging · OMC debugger, tracer, trace, debug · gstack investigate.

Runs when a check FAILs or a task fails. Iron law: **no fix without a root cause.** `mis` enforces it: a FAILED task can only restart with `mis task <id> retry`, which is refused until a root-cause note is recorded after the failure, and blocks the run when the retry limit is reached.

1. **Read** the failure: the `tail` printed by `mis check` (stored logs under `.git/make-it-ship/` are not readable directly — the guard blocks that path). If you need more output, re-run the single failing test with the project's own runner (e.g. `node --test test/x.test.js`, `python3 -m unittest tests.test_x -v`) — that is also your reproduction. Note the exact error.
2. **Reproduce** reliably with the smallest command (a single test, one input). If you cannot reproduce it, gather more data — do not guess.
3. **Look at recent change**: `git diff` against the run's base commit. A regression usually lives in the diff.
4. **Compare** with similar code that works; list the differences. Trace the bad value backward to where it is first wrong.
5. **One hypothesis at a time**: "X is the root cause because Y". Test it with the smallest experiment (a temporary assert/log or a focused test), one variable at a time. Wrong → new hypothesis; never stack fixes.
6. **Record** what you found before changing code:

```
mis note rootcause <task-id> - <<'MIS'
REPRODUCTION: <exact command and observed output>
HYPOTHESIS: <X is the cause because Y>
EVIDENCE: <the experiment that confirmed it, file:line>
MIS
```

7. If the task was marked failed: `mis task <id> retry`. Then fix test-first: a regression test that fails without the fix, the single root-cause fix (smallest diff, no "while I'm here"), then `mis check` again.
8. **Three failed hypotheses → stop.** Question the approach and ask the user: new direction, escalate to a human, or instrument and wait. If `mis` blocks the run on the retry limit, explain it in one sentence; only the user can lift it (`mis approve continue`).

Never weaken or delete a test to make it pass. Never say "this should fix it" — `mis check` decides.
