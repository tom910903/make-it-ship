---
name: ship
description: Make It Ship release preparation on its own - updates docs and changelog, writes a PR draft and release checklist from the verified run, and finishes the branch only with the user's approval for any push or PR.
---

Run the ship phase standalone. `mis` = the shell function `mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }` (define it in the same Bash call, or type the full `node` command; not a variable: `M="node …"; $M` fails in zsh).

1. Requires an active run (`mis status`). If there is none, tell the user to verify first with `/make-it-ship:run` (or `/make-it-ship:qa`), because shipping without evidence would be reported as NOT READY anyway.
2. Read `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/ship.md`. If the run is already REPORTED, only Part B applies (drafts, commits, finishing the branch); docs or changelog edits need a follow-up run as that file describes. Otherwise do Part A, verify and report, then Part B.
3. Show the user the `mis ship` result (READY / NOT READY and why), the PR draft, and the checklist. Ask before any push or PR.
