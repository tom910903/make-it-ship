# Manual checks

`npm test` never starts the real `claude`, a real device or another model. These checks cover what only a person can confirm: the permission dialogs in Claude Code, the status line on screen, installing and updating from the marketplace, real iOS and Android devices, and other models. Before a release, go through the checks whose code changed and write the result in the table.

| # | Check | Last recorded result | Result | Date | Notes |
|---|---|---|---|---|---|
| 1 | Approval dialog (`mis approve plan`) | Passed with Claude driving an interactive session in tmux (2026-10-22); not checked by a person | | | |
| 2 | Continue dialog after a limit (`mis approve continue`) | Same, for the time limit and the retry limit (2026-10-22) | | | |
| 3 | Edit outside the plan's files in a parallel run | Same, merge conflict included (2026-10-22) | | | |
| 4 | Install and update from the marketplace | Install from GitHub passed in tmux (2026-10-21, again 2026-10-22); manual update done once by Claude (0.9.0 to 1.0.0, 2026-11-13); auto-update not checked | | | |
| 5 | Status line (HUD) | Passed in tmux for the one-line HUD before 0.8.0; the presets and rows of 0.9.0 were not checked on screen | | | |
| 6 | iOS debug bridge on a real iPhone | Passed on the iOS simulator only (2026-10-22); a simulator does not count as a device | | | |
| 7 | Android on a real phone | Passed on the emulator only (2026-10-22); an emulator does not count as a device | | | |
| 8 | Second opinion from another model | Passed with codex in tmux (2026-10-22, gemini not installed); not checked by a person | | | |
| 9 | Codex adapter (`adapters/codex/AGENTS.md`) | Passed in tmux (2026-10-22); not checked by a person | | | |

## Setup

- Node.js 22+, git and Claude Code, logged in.
- `MIS=/path/to/make-it-ship`: a clone of this repository at the version under test. `mis` below means `node "$MIS/scripts/mis.mjs"`, except in the update part of check 4.
- Start Claude Code with that version: `claude --plugin-dir "$MIS"`. If the plugin is also installed, disable it for the check (`claude plugin disable make-it-ship@make-it-ship`, and `claude plugin enable make-it-ship@make-it-ship` afterwards), or test the installed copy after updating it.
- The demo repositories left the tree in 1.0.0; the `v0.9.0` tag still has them:

  ```sh
  mkdir -p /tmp/mis-demos && git -C "$MIS" archive v0.9.0 evals/setup-demo.mjs evals/demos | tar -x -C /tmp/mis-demos
  demo() { node /tmp/mis-demos/evals/setup-demo.mjs "$@"; }   # demo <name> <dir>: a fresh repository with one commit
  ```

  `a`: Node, a feature request in `docs/feature-request.md`. `b`: Python, a bug in `ISSUE.md`. `d`: Node, a test that fails from the start and `TASK.md`. `p`: Node, two independent modules and `REQUEST.md`.

## 1. Approval dialog

1. `demo a /tmp/mc1 && cd /tmp/mc1`, start Claude Code and enter `/make-it-ship:run Implement docs/feature-request.md. Use standard mode.`
2. After showing the plan, the model runs `mis approve plan`. A permission dialog appears with `make-it-ship: approval is recorded only when you confirm this command`.
3. Decline. `/make-it-ship:status` shows `AWAITING_APPROVAL`, and `git status` shows no code change.
4. Ask for the approval again and accept. The state becomes `EXECUTING`, and the run goes through implementation, checks and reviews to the report. The final verdict is the output of `mis verdict`.

Pass: 2, 3 and 4 behave as described.

## 2. Continue dialog after a limit

1. `demo d /tmp/mc2 && cd /tmp/mc2`, run `mis init --write` and set `"limits": { "maxAttemptsPerTask": 1, "maxRuntimeMinutes": 60 }` in `.make-it-ship.json`.
2. Start Claude Code and enter `/make-it-ship:run Do the task in TASK.md`.
3. When the first attempt fails and the task is retried, the run becomes `BLOCKED` (retry limit). If the first attempt passes, break the test once to get there.
4. Enter `/make-it-ship:resume`. When the model runs `mis approve continue`, a dialog appears. Accepting continues the run; declining leaves it `BLOCKED`.

Pass: the run is `BLOCKED` in 3, and 4 behaves as described.

## 3. Edit outside the plan's files in a parallel run

1. `demo p /tmp/mc3 && cd /tmp/mc3`, add the line `Also re-export kebab from src/math.js.` to the end of `REQUEST.md` and commit it. The line invites an edit outside a task's files.
2. Start Claude Code and enter `/make-it-ship:run Implement REQUEST.md with parallel worktrees and implementer agents. Local commits are fine.`
3. When an implementer agent writes a file outside its task's files, a dialog appears: `make-it-ship: <file> is outside the approved plan's files; editing it widens the scope`.
4. Declining leaves the file unchanged. If you accept and `mis worktree merge` then hits a conflict, the merge stops, the main checkout stays clean, the conflicting files are reported and the verdict stays `PARTIAL`.

Pass: the dialog appears in 3, and 4 behaves as described.

## 4. Install and update from the marketplace

Install, on a machine or account without the plugin:

1. Install with the two commands in the README's Quick start. `claude plugin list` shows `make-it-ship` enabled.
2. `demo b /tmp/mc4 && cd /tmp/mc4`, start `claude` (no `--plugin-dir`) and enter `/make-it-ship:run Fix the bug described in ISSUE.md`. The skills load and the run reaches the report. Asking for a `git push` during the run brings up a dialog; decline it.
3. Remove it with the README's commands. `~/.claude/settings.json` is as it was before the install.

Update, where an older version is installed:

1. Update with the README's commands and restart Claude Code. Session start may mention the new version first.
2. Use the installed copy here, not the clone: setup and the doctor write the path of the copy they run from into your settings. With `I=~/.claude/plugins/cache/make-it-ship/make-it-ship/<new version>`, `node "$I/scripts/mis.mjs" version` shows the new version and `node "$I/scripts/mis.mjs" doctor` reports no errors. A status line that still points at the old version's folder is repaired by `doctor --fix`; `setup` shows the change to the CLAUDE.md block, and `setup --write` applies it.
3. After a restart the status line shows and a skill such as `/make-it-ship:status` works.

Auto-update, after `mis setup --write` turned it on (`autoUpdate: true` under `extraKnownMarketplaces` in `~/.claude/settings.json`):

1. Release a new version. Start Claude Code and send a message; within about ten minutes Claude Code reports the plugin updated.
2. In the next session, session start says the status line and the CLAUDE.md block now point at the new version, and both files have a backup next to them.
3. A session still running the old version leaves the paths alone.

Pass: every step behaves as described.

## 5. Status line (HUD)

1. `mis doctor` reports the status line as Make It Ship's. If it is not, put the `hud.statusLine` that `mis init` prints into `"statusLine"` in `~/.claude/settings.json`, and put the old value back after the check.
2. In a repository without a run, the default `focused` preset shows two rows. The first starts with `MIS ▸ idle` and has the model, effort, context and plan usage; the second has the branch, git status, session time and recent activity. A part shows only when it has a value.
3. In a repository with a run (for example `/tmp/mc1` from check 1), the first row starts with `MIS ▸ <state> · T<done>/<total> · <checks> · <verdict>`, and the verdict matches `Verdict now` in `mis status` there.
4. While a subagent runs, a row per subagent (`├─ <type> <time>`) appears below the others and goes away when it ends.
5. Note your current choice with `mis hud`, then run `mis hud preset minimal`. The next refresh shows one row, with no restart. Put your choice back with `mis hud preset <name>` and the same `mis hud add` and `mis hud remove`.

Pass: 2 to 5 behave as described.

## 6. iOS debug bridge on a real iPhone

Needs an iPhone in developer mode on USB, Xcode and a team that can sign.

1. Make a test SwiftUI app: a new Xcode project, never company code.
2. Copy `$MIS/templates/ios-debug-bridge` into the app repository as `Packages/DebugBridge`, add it as a local package dependency and add the `#if DEBUG` hook-up from its README.
3. `mis ios devices` lists the phone with `connected: true`.
4. Install and run a DEBUG build on the phone. Forward the phone's loopback `127.0.0.1:8765` and check `/healthz` (`ok`), `/state` (JSON) and `/screenshot` (PNG).
5. `mis ios bridge-scan` lists the bridge files, and `mis ship` in a run is NOT READY with the bridge among its reasons.
6. Follow the removal steps in the bridge's README. Then `mis ios bridge-scan` gives `clean: true`, a Release build succeeds, and `nm -j <app binary> | grep -i debugbridge` finds nothing.
7. Take the run to VERIFIED again; `mis ship` is READY.

Pass: 3 to 7 behave as described.

## 7. Android on a real phone

Needs a phone with developer options and USB debugging on, connected by USB with "allow this computer" accepted, and the Android SDK platform-tools.

1. `mis android devices` lists the phone with `emulator: false`, `state: device` and no `blocked`.
2. If an emulator also runs, `mis android tap 1 1` without `--serial` refuses and asks for `--serial`.
3. On the phone: `mis android launch com.android.settings`, then `mis android ui` (the settings texts), `mis android tap` on one item's `center`, `mis android key KEYCODE_BACK` and `mis android shot --out phone.png` (a PNG).
4. `mis android daemon start --serial <phone>`: `/healthz`, `/screenshot` and `/ui` answer, and `POST /text` with `{"text":"$(reboot)"}` returns 400. Then `mis android daemon stop`.
5. Optional, with tailscale: `mis android daemon start --tailnet` and `mis android mint` each bring up a dialog, and a request without a token gets 401.

Pass: 1 to 4 behave as described.

## 8. Second opinion from another model

This sends repository content to an outside service. Use only the synthetic demo repository, never company code, and check company policy first: it may forbid this.

1. Install the codex or gemini CLI and log in.
2. `demo a /tmp/mc8 && cd /tmp/mc8`, start Claude Code and enter `/make-it-ship:run Implement docs/feature-request.md. Use full mode and get a second opinion.`
3. `mis second-opinion detect` finds the CLI, and calling it brings up a dialog.
4. Declining sends nothing. Accepting records the answer with `mis note second-opinion`, and the report's review list shows it as `second opinion (다른 모델, 판정에 미반영)`. The verdict is the same before and after.

Pass: 3 and 4 behave as described.

## 9. Codex adapter

The data warning of check 8 applies.

1. `demo a /tmp/mc9 && cd /tmp/mc9 && cp "$MIS/adapters/codex/AGENTS.md" AGENTS.md && export MIS_HOME="$MIS"`
2. In the Codex CLI, ask: "Implement docs/feature-request.md following AGENTS.md".
3. The run goes through `mis` start, plan, check, review and verdict. At the approval it asks you to run `mis approve plan` yourself, and the final verdict matches `mis verdict`.

Pass: all of 3. If Codex runs `mis approve plan` itself instead of asking you, the check fails.
