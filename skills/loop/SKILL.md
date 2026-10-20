---
name: loop
description: Make It Ship persistent mode (ralph/autopilot) - keeps working on a task until the run is reported with verdict VERIFIED, the run is BLOCKED for the user, or the iteration limit is hit. Use when the user says ralph, "don't stop", "keep going until it works", or "must complete"; ralphthon (hackathon) runs interview, loop, then harden.
---

1. Start the loop: `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" loop start --max 20 "<the task in one line>"`. Use a smaller `--max` when the user gives a limit. If a loop is already active, show `mis loop status` and ask whether to continue it or cancel it.
2. Do the work through the normal flow: invoke `/make-it-ship:run` with the task (or `/make-it-ship:resume` when a run already exists). Every gate still applies — plan approval, test-first, `mis check`, reviews, `mis report`.
3. Each time you try to stop, the Stop hook checks the evidence. Unless the run is REPORTED with verdict VERIFIED, it sends you back with the current verdict reasons. Work on those reasons; do not argue with the hook and do not claim completion yourself.
4. The loop also lets the session stop when the run is BLOCKED (something only the user can do) or when the iteration limit is reached. In both cases tell the user exactly what is left.
5. If the user asks to stop, run `mis loop cancel` (and `mis cancel` only if they also want to drop the run).

## Ralphthon (OMC ralphthon)

When the user asks for a ralphthon or a hackathon-style build, keep this order:
1. **Interview** first (`${CLAUDE_PLUGIN_ROOT}/skills/run/phases/interview.md`): goal and testable acceptance criteria before any code.
2. **Loop**: steps 1-4 above until the run is VERIFIED.
3. **Harden** before the report: the qa phase (real use), a security review, and the simplify phase; fix their BLOCKING findings and re-verify (the loop still requires VERIFIED on the final code).

Never edit `loop.json` or run state by hand to end the loop.
