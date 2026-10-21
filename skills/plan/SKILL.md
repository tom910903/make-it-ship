---
name: plan
description: Make It Ship planning without building - turns a request, idea or spec into a written implementation plan (docs/make-it-ship/plans/<slug>.md) with tasks, acceptance criteria and verification commands, checked by mis plan check, and executable later with mis start --plan. Use when the user asks for a plan, an implementation plan, writing-plans, or wants to plan now and build later; also for multi-goal work (ultragoal).
---

# Make It Ship — plan (no code changes)

Absorbs: OMC plan, planner, ultragoal · Superpowers writing-plans, executing-plans · gstack spec (via the interview).

`mis` means the shell function `mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }` (define it in the same Bash call). No run is started; nothing outside `docs/make-it-ship/` changes.

1. Discover read-only: `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/discover.md` (dispatch `make-it-ship:explorer` for anything larger than a few files).
2. Clarify: if goal, constraints or success criteria are unclear, follow `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/interview.md` (spec or brainstorming mode when the intent is vague or the design is open). `make-it-ship:analyst` can draft the acceptance criteria and gaps.
3. Write the plan following `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/plan.md` ("Plan documents"): `make-it-ship:planner` may draft it; you own the result. Save it as `docs/make-it-ship/plans/<slug>.md`, then run `mis plan check docs/make-it-ship/plans/<slug>.md` and fix every missing section it lists.
4. Several independent goals: record them with `mis goal add` as `plan.md` describes ("Several independent goals") and write one plan document per goal.
5. Review when it is worth it: a critic pass via `/make-it-ship:plan-review` (always offered; run it when the plan has 4+ tasks or risk flags), and the product lenses or autoplan when the user asks.
6. Tell the user the path, the tasks, and how to execute it: `/make-it-ship:run` with `mis start --plan docs/make-it-ship/plans/<slug>.md` (another session can do this; the plan document is the handoff).
