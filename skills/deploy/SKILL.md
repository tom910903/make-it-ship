---
name: deploy
description: Make It Ship deploy (absorbs gstack setup-deploy, land-and-deploy, canary). Detect the platform and save deploy commands after the user confirms, merge and deploy with a health check, and watch the live site with browser canary checks against a baseline. Every deploy step and canary run asks the user first.
---

# Make It Ship — deploy

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`. Deploying changes a live system: the guard asks before `mis deploy setup --write`, `mis deploy run` and `mis canary`, with or without a run.

## Setup (once per project)
1. `mis deploy setup` detects the platform (fly, render, vercel, netlify, heroku, railway, deploy workflows) and shows a proposed config. Ask the user for each field: production URL, merge command (e.g. `gh pr merge --squash`), deploy command (or nothing when the platform deploys on push), status command, health URL.
2. Save only after they confirm: `mis deploy setup --merge-cmd ... --deploy-cmd ... --status-cmd ... --health <url> --url <url> --write` → `.make-it-ship/deploy.json`.

## Land and deploy
1. Ship first: the run's verdict must be VERIFIED and `mis ship` READY (`/make-it-ship:ship`). Do not deploy PARTIAL or BLOCKED work.
2. `mis deploy run --dry-run` shows the steps; then `mis deploy run` (asks): merge → deploy → status → health check (retries). A clean working tree is required.
3. FAILED: show the failing step and output; offer a revert (git revert + deploy) and do it only with the user's approval.

## Canary (after deploy)
1. Before deploying, capture a baseline: `mis canary <url> --pages /,/dashboard --baseline`.
2. After: `mis canary <url> --pages ... --checks 5 --interval 60s`. Each check loads every page in the built-in browser and records the HTTP status and console errors. Alerts compare with the baseline and must persist across 2 checks: CRITICAL (page failed or ≥400), HIGH (new console errors). Exit 1 = ALERT: show the alerts and screenshots (`mis browse screenshot`) and ask the user before any rollback.
