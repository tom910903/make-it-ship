---
name: android
description: Make It Ship Android devices and emulators over adb (iOS-family equivalent, no in-app bridge). Device detection where emulators never count as device verification; screen, UI tree and input control; a loopback QA relay, with a tailnet listener and tokens only after the user agrees.
---

# Make It Ship — Android devices and emulators

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`.

**Device first.** `mis android devices`. If it reports `blocked` (no connected phone, or no adb), on-device QA is **BLOCKED**: say so in the report. Emulator results never count as device verification, even when every emulator check passes.

## Emulator and device control
- `mis android avds` lists AVDs; `mis android boot <avd>` starts one and waits until it has booted; `mis android kill emulator-5554` stops it (emulators only).
- With more than one device online, every command needs `--serial <serial>`.
- `mis android ui` returns the screen's UI nodes (text, id, desc, clickable, tap `center`). Prefer it over guessing coordinates from a screenshot.
- `mis android shot [--out f.png]` saves a screenshot (default under the MIS state dir, not the repo, so evidence does not go stale).
- `mis android tap <x> <y>`, `swipe <x1> <y1> <x2> <y2> [ms]`, `type <text>` (letters, digits, spaces and `. , _ @ : / + = -` only), `key KEYCODE_BACK`, `launch <package>`, `install <apk>`.

## QA / fix / design review loop
1. Build and install the debug app (`mis android install app/build/outputs/apk/debug/app-debug.apk`), then `mis android launch <package>`.
2. **qa**: walk the flows from the plan's acceptance criteria with `ui` → `tap`/`type` → `ui`/`shot`; record each result with the screenshot path. **fix**: reproduce, root-cause (`/make-it-ship:debug`), fix test-first, re-verify. **design review**: compare screenshots with the design (`mis visual-verdict shot.png ref.png`), check spacing, type, insets, dark mode and font scale; list fixes by severity.
3. `mis qa detect` proposes `qa-android` (`./gradlew connectedDebugAndroidTest`) when a device or emulator is online.
4. Nothing is added to the app, so there is no bridge to remove before shipping. Stop what you started: `mis android daemon stop`, `mis android kill <emulator>`.

## Relay and remote agents on your tailnet
`mis android daemon start [--serial s] [--port 9098]` serves a fixed API on `127.0.0.1`: `GET /healthz`, `/screenshot`, `/ui`; `POST /tap`, `/swipe`, `/text`, `/key`, `/launch` (`content-type: application/json` bodies, validated like the CLI; no shell passthrough; other content types get 415 and a non-loopback Host gets 403, so web pages cannot drive the device). `--tailnet` also listens on your tailscale address, and every tailnet request needs a token from `mis android mint <agent-name> [--ttl 24h]` (iOS tokens do not work here); `mis android tokens [revoke <name>]` lists or revokes. Both ask the user first: this lets other machines see and drive the device and **company policy may forbid it**.
