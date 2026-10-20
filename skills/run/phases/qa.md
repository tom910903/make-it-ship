# Phase: qa

Absorbs: gstack qa, qa-only, browse, benchmark, design-review, devex-review, ios-qa, ios-design-review · OMC qa-tester, visual-verdict.

Real-use verification beyond unit tests. Standard when a user-facing surface changed; always in Full. Every `qa-*` check defined in `.make-it-ship.json` is **required** in Standard/Full, so a missing or failing QA check keeps the verdict from VERIFIED.

1. `mis qa detect` lists the surfaces (web, cli, api, ios) with a proposed `qa-*` check each, or a BLOCKED reason (e.g. no Playwright, no Xcode, no simulator).
2. Dispatch `make-it-ship:qa-tester` with the acceptance criteria, the diff base, and the detected surfaces; record its output with `mis review add design -` only when it reviews UI design consistency, otherwise keep it as the scenario list.
3. Write the scenario scripts it outlines as real files (`qa/cli-smoke.mjs`, `qa/api-smoke.mjs`, Playwright specs, XCUITest) — they are deliverables, run the real program, and exit non-zero on any mismatch. Use only tools already in the project; a new runner (Playwright, etc.) is a package install and needs the user's approval.
4. Adding the `qa-*` check to `.make-it-ship.json` is a config change (before the report only — after it, use a follow-up run): show it to the user, edit the file, and run `mis approve config` (the guard asks them; until they approve the verdict stays PARTIAL). Then `mis check qa-<surface>`.
5. A surface that cannot run stays BLOCKED in the report — never replace it with a weaker command to get a pass. A build passing is not the same as the app working on the target (simulator ≠ device; iOS devices are BLOCKED without one).
6. UI: check the built screens against `DESIGN.md` and the qa-tester scenarios (hierarchy, spacing, color, states, 375px). Findings go through the normal fix → check loop.
7. **Performance** (gstack benchmark): for performance-sensitive changes, run `mis bench <check> --runs 5` **before** changing code (baseline) and again after. `mis` marks +20% as WARN and +50% as REGRESSION against the run's first measurement; the report lists them for the user. Timing is noisy: judge with the median and re-run before acting on a small WARN.
8. **iOS on a real device** (gstack ios-qa): simulator results do not count as device verification. `mis ios devices` lists connected devices; with none, record device QA as BLOCKED in the report. With a device and the user's OK, add the DEBUG-only bridge from `${CLAUDE_PLUGIN_ROOT}/templates/ios-debug-bridge/` (README there) to read state and screenshots during QA; it must be removed before shipping (`mis ios bridge-scan` must list nothing; `mis ship` refuses READY otherwise).
