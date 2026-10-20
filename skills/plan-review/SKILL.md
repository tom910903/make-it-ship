---
name: plan-review
description: Make It Ship plan review on its own - the read-only critic challenges a plan or design doc (claims checked against code, pre-mortem, gaps, testability); on request also the CEO, design, developer-experience (DX) and engineering lenses (plan-ceo-review, plan-design-review, plan-devex-review, plan-eng-review) or autoplan, which runs all four with logged auto-decisions.
---

Run the plan-critique phase standalone.

1. Find the plan: the file or text the user gave, or the active run's plan (`node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" status --json`).
2. Read `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/plan-critique.md` and dispatch the critic as described.
3. If a run is active and the plan reviewed is that run's plan, record it with `mis review add plan-critic -` (where `mis` = the shell function `mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }`). Otherwise just show the result.
4. Lenses: when the user asks for a CEO, design, DX or eng review, or for autoplan, follow `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/product-review.md` ("Lenses" and "Autoplan"). Each lens is appended to the plan document as its own `## Review: <lens>` section; autoplan also logs each auto-decision with `mis decision add` and leaves taste decisions to the user. In a run, record the result with `mis review add product -`.
5. Present the verdict line, blocking and major findings, and the fixes proposed. Do not change the plan's content (beyond the review sections) unless the user asks.
