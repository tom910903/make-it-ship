# Phase: qa

Absorbs: gstack qa, qa-only, browse, benchmark, design-review, devex-review, ios-qa, ios-design-review · OMC qa-tester, visual-verdict.

Real-use verification beyond unit tests. Standard when a user-facing surface changed; always in Full. Every `qa-*` check defined in `.make-it-ship.json` is **required** in Standard/Full, so a missing or failing QA check keeps the verdict from VERIFIED.

1. `mis qa detect` lists the surfaces (web, cli, api, ios), each with a proposed `qa-*` check or a BLOCKED reason (e.g. no Chrome for the built-in browser, no Xcode, no simulator). Web uses the project's Playwright/Cypress if present. Otherwise it uses the built-in browser (`mis browse`, see `${CLAUDE_PLUGIN_ROOT}/skills/browse/SKILL.md`), so a missing Playwright alone is not BLOCKED.
2. Dispatch `make-it-ship:qa-tester` with the acceptance criteria, the diff base, and the detected surfaces. Record its output with `mis review add design -` only when it reviews UI design consistency; otherwise keep it as the scenario list.
3. Write the scenario scripts it outlines as real files (`qa/cli-smoke.mjs`, `qa/api-smoke.mjs`, `qa/web-smoke.mjs`, Playwright specs, XCUITest). They are deliverables: they run the real program and exit non-zero on any mismatch. `qa/web-smoke.mjs` drives the app with `node "$MIS_CLI" browse ...`, which `mis check` provides. Use only tools already in the project; a new runner is a package install and needs the user's approval.
4. Adding the `qa-*` check to `.make-it-ship.json` is a config change. Make it only before the report (after it, use a follow-up run). Show it to the user, edit the file, and run `mis approve config`; the guard asks them, and until they approve the verdict stays PARTIAL. Then run `mis check qa-<surface>`.
5. A surface that cannot run stays BLOCKED in the report. Never replace it with a weaker command to get a pass. A passing build is not the same as the app working on the target (a simulator is not a device; iOS devices are BLOCKED without one).
6. **Live web exploration** (gstack qa / browse): with the app running, `mis browse goto <url>`, then `snapshot -i`. Walk each changed screen as a user would:
   - click and fill through `@e` refs;
   - check `console --errors` after every action;
   - `snapshot -D` to confirm an action changed the page;
   - `responsive <prefix>` for 375/768/1280.

   Save screenshots under `qa/screens/` as evidence, Read them to show the user, and turn each confirmed bug into a scenario in the qa script. For logins with CAPTCHA or MFA, use `mis browse handoff` / `resume`.
7. **Report-only mode** (gstack qa-only): when the user asks only for a QA report, do steps 1, 2 and 6 and change no files. Report each finding with:
   - its severity (critical/high/medium/low);
   - repro steps;
   - a screenshot path;
   - the console errors.

   Also report a health score (console 15%, links 10%, visual 10%, functional 20%, UX 15%, performance 10%, content 5%, accessibility 15%; each category starts at 100 and loses 25/15/8/3 per critical/high/medium/low finding). End with the top three issues to fix.
8. **Design review loop** (gstack design-review, OMC visual-verdict): check the built screens against `DESIGN.md` and the qa-tester scenarios (hierarchy, spacing, color, states, 375px). For each finding:
   1. Take a screenshot (before).
   2. Make the smallest fix, CSS before structure.
   3. Take a screenshot again (after).
   4. If a reference image or mock exists, run `mis visual-verdict <after.png> <reference.png>` (90+ passes) and keep fixing the regions it lists.

   Revert a fix that breaks something else. Stop and ask the user after 5 fixes in a row without progress.
9. **Performance** (gstack benchmark):
   - Pages: run `mis browse perf` on each changed page before you change code, and again after. It reports TTFB, FCP, LCP, DOM complete, load, request count, transfer, JS and CSS bytes, and the largest resources. Timing up by more than 50% or 500 ms, or bundle size up by more than 25%, is a REGRESSION. Timing up by more than 20%, bundle up by more than 10%, or requests up by more than 30% is a WARN. Bundle size is the stable signal; timing is noisy, so re-measure before acting on it.
   - Command runtimes: run `mis bench <check> --runs 5` before (baseline) and after. `mis` marks +20% as WARN and +50% as REGRESSION against the run's first measurement.
10. **iOS on a real device** (gstack ios-qa): simulator results do not count as device verification. `mis ios devices` lists connected devices; with none, record device QA as BLOCKED in the report. With a device and the user's OK, add the DEBUG-only bridge from `${CLAUDE_PLUGIN_ROOT}/templates/ios-debug-bridge/` (see its README) to read state and screenshots during QA. It must be removed before shipping: `mis ios bridge-scan` must list nothing, and `mis ship` refuses READY otherwise.
