---
name: interview
description: Make It Ship requirements interview on its own - turns a vague request or requirements doc into goal, constraints, and testable acceptance criteria by asking only the high-impact questions, one at a time.
---

Run the interview phase standalone.

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/interview.md` and follow it. Investigate the repository first so you only ask what it cannot answer.
2. If a Make It Ship run is active (`node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" status` succeeds), record items and answers in it with `mis interview add` / `mis interview resolve` (where `mis` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"`). Otherwise do not start a run; just conduct the interview.
3. Finish with: Goal, Constraints, Non-goals, testable Acceptance criteria, Assumptions (with how each was resolved), and any open questions. Offer `/make-it-ship:run` to build it.
