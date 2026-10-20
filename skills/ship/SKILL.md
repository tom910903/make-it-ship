---
name: ship
description: Make It Ship release preparation - docs and changelog, version bump (VERSION, package.json, CHANGELOG) with a v<version> PR title, diff scope and solo/team repo mode, a secret scan before push, a PR draft and release checklist from the verified run; finishing a branch (merge, PR, keep, discard) and tagging also work without a run, with the user's approval for any push, PR or tag.
---

Run the ship phase standalone. `mis` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"`.

1. Readiness (`mis ship`, READY / NOT READY) requires an active run (`mis status`). Without one, offer `/make-it-ship:run` (or `/make-it-ship:qa`) to verify first, because shipping without evidence would be NOT READY anyway. These work without a run: finishing a branch (step 5 of the phase), the version bump and release rules, `mis diff-scope`, `mis repo-mode` and `mis redact scan` ("Release details" in the phase file). Creating a tag, pushing and opening a PR are asked by the guard.
2. Read `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/ship.md`. If the run is already REPORTED, only Part B applies (drafts, commits, finishing the branch); docs or changelog edits need a follow-up run as that file describes. Otherwise do Part A, verify and report, then Part B.
3. Show the user the `mis ship` result (READY / NOT READY and why), the PR draft, and the checklist. Ask before any push or PR.
