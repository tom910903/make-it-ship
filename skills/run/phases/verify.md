# Phase: verify

Absorbs: Superpowers verification-before-completion · OMC verify, verifier, ultraqa · gstack health.

Iron law: no completion claim without fresh evidence for the **current** code.

1. Run every required check: `mis status` lists them; run `mis check <name>` for each one that is MISSING or STALE. Order: tests, then typecheck/build, then others.
2. Read each result. A BLOCKED check means it could not run (missing tool, timeout, undefined): report it as "not verified", never as passed. Do not swap in a different command to get a pass; changing `.make-it-ship.json` requires the user's approval (`mis approve config`, which asks them) and invalidates prior evidence; until approved the verdict stays PARTIAL, however the file was edited.
3. Any edit after a check makes that evidence STALE. Re-run before the verdict.
4. `mis verdict` decides. Quote its verdict and reasons; do not soften or upgrade them. Words to avoid about results: "should", "probably", "seems", "looks good".
5. Separate what was machine-verified (checks), what is model judgment (task completion, reviews), and what is unsupported (token budget).
6. Full mode, after the required checks: `mis health` once. It appends to `docs/make-it-ship/health.jsonl` and prints the trend. A score lower than the previous entry goes into the report as a regression to look at; it does not change the verdict.
