---
name: status
description: Show the current Make It Ship run - phase, tasks, required checks (PASS/FAIL/STALE/BLOCKED/MISSING), reviews, open questions, decisions needed, and the current verdict. Also the code health dashboard (weighted check score and trend) and the shortcut debt ledger on request.
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" status` in the repository and show the output to the user as-is (it is already formatted). Then, in one or two lines, say what the next step is and whether the user must decide anything. If there is no active run, say so and offer `/make-it-ship:run`.

Asked about code health or quality trend instead: run `mis health` (weighted score of the project's checks, appended to `docs/make-it-ship/health.jsonl`, with the trend) and show the score, each check and the delta. Asked for deferred shortcuts or debt: `mis debt`. Here `mis` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"`.

Do not restate the verdict in your own words; quote the `Verdict now:` line.
