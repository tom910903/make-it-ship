# Phase: implement

Absorbs: Superpowers test-driven-development, executing-plans, subagent-driven-development · OMC executor, deep-executor, test-engineer, autopilot, ralph.

For each task, in plan order:

1. `mis task <id> start`. If `mis` refuses (approval missing, open HIGH ambiguity), stop and resolve that first.
2. **Test first** when the code is testable:
   - write one failing test for the next behavior, using real code (mock only what you must);
   - run it through the project's runner and confirm it fails **for the expected reason** (a test that passes immediately tests nothing new — fix the test);
   - write the simplest code that passes; refactor only while green.
   Code written before its test gets deleted and redone test-first. Not testable (pure config, generated code)? Say so in the task notes.
3. **Smallest complete change** (simplify): does it need to exist → reuse what the codebase has → standard library → an installed dependency → minimal new code. No unrequested options, wrappers, or abstractions; no adjacent refactors. But finish everything the change breaks: callers, tests, fixtures, exports. Never cut validation at trust boundaries, data-loss error handling, or security. A deliberate limit gets a `shortcut: <limit>, <when to upgrade>` comment.
4. Stay inside the plan's files. Needing more is a scope change: tell the user.
5. Run the relevant check: `mis check <name>` (that run is the evidence; your own ad-hoc runs are not).
6. FAIL: go to the debug phase (`phases/debug.md`): reproduce, find the root cause, record it with `mis note rootcause`, then fix. Fix the cause, not the test.
7. `mis task <id> done` when its acceptance criteria are met by the code and its tests; `mis task <id> fail` if it cannot be completed now (say why); restarting it later requires `mis task <id> retry` after a root-cause note.

Do not commit or push unless the user asked. Never run package installs or remote writes without the user's approval (the guard will ask them). If a new dependency is truly needed, record why: `mis note dep "<why the standard library or existing code is not enough>"`; otherwise the verdict stays PARTIAL.
