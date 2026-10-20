---
name: deploy
description: Make It Ship deploy (absorbs gstack setup-deploy, land-and-deploy, canary). Detect the platform and save deploy commands after the user confirms, merge and deploy with a health check, and watch the live site with browser canary checks against a baseline. Every deploy step and canary run asks the user first.
---

# Make It Ship — deploy

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`. Deploying changes a live system: the guard asks before `mis deploy setup --write`, `mis deploy run` (naming the rollback when `--auto-revert` is given) and `mis canary`, with or without a run.

## Setup (once per project)
1. `mis deploy setup` detects the platform (fly, render, vercel, netlify, heroku, railway, deploy workflows) and shows a proposed config. Ask the user for each field: production URL, merge command (e.g. `gh pr merge --squash`), deploy command (or nothing when the platform deploys on push), status command, health URL, CI command (`--ci-cmd`: exit 0 green, 8 pending, else red; without it `gh pr checks` is used when gh is installed), rollback command (`--rollback-cmd`; needed for automatic rollback when the merge happens remotely, e.g. `gh pr merge`, because the local HEAD does not move) and base branch (`--base`, default origin/HEAD or main).
2. Save only after they confirm: `mis deploy setup --merge-cmd ... --deploy-cmd ... --status-cmd ... --health <url> --url <url> --write` → `.make-it-ship/deploy.json`.

## Land and deploy
1. Ship first: the run's verdict must be VERIFIED and `mis ship` READY (`/make-it-ship:ship`). Do not deploy PARTIAL or BLOCKED work.
2. `mis deploy run --dry-run` shows the steps; then `mis deploy run` (asks): VERSION drift check (the branch VERSION must be above the base branch's; stops before anything runs) → wait for CI (`--ci-tries`, `--ci-interval`) → merge → deploy → status → health check (retries). A clean working tree is required.
3. Rollback is chosen up front: `mis deploy run --auto-revert` (asks, naming the rollback) undoes the deploy if its health check fails: the rollback command, else `git revert` of what that run merged followed by the deploy command again (status REVERTED). Rerunning with `--auto-revert` after a failure does not help (it merges nothing new). FAILED without the flag: show the failing step and output; the report's `merge.after` is the commit that run merged, and `next` names the revert (or the rollback command). Do it only with the user's approval.

## Canary (after deploy)
1. Before deploying, capture a baseline: `mis canary <url> --pages /,/dashboard --baseline` (or `--discover [--max-pages 10]`: the start page plus same-origin pages from `/sitemap.xml` and its links).
2. After: `mis canary <url> --pages ... --checks 5 --interval 60s`. Each check loads every page in the built-in browser and records the HTTP status, console errors, load time (navigation timing) and a screenshot (`.make-it-ship/canary/shots/`). Alerts compare with the baseline and must persist across 2 checks: CRITICAL (page failed or ≥400), HIGH (new console errors), MEDIUM (load time ≥2x the baseline and ≥100 ms slower). Exit 1 = ALERT: show the alerts with their screenshot paths and ask the user before any rollback.
