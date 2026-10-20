---
name: review
description: Make It Ship code review on its own - read-only spec-compliance and quality reviews of the current changes (correctness, safety, tests, unneeded code or dependencies), each with blocking/major counts.
---

Run the review phase standalone on the current working-tree changes.

1. Determine the base: the active run's `baseCommit` (`node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" status --json`), or else the merge-base with the default branch, or `HEAD` for uncommitted changes. Determine requirements: the run's plan, or what the user describes. Without requirements, run only the quality review.
2. Read `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/review.md` and follow it.
3. If a run is active, record each review with `mis review add <spec|quality> -` (where `mis` = the shell function `mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }` (define it in the same Bash call, or type the full `node` command; not a variable: `M="node …"; $M` fails in zsh)). Otherwise just present the findings.
4. Do not fix anything unless the user asks.
