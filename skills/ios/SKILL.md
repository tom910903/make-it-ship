---
name: ios
description: Make It Ship iOS on real devices (absorbs gstack ios-qa, ios-fix, ios-design-review, ios-sync, gstack-ios-qa-daemon, gstack-ios-qa-mint). Device QA, fix and visual review loops through the DEBUG-only bridge; template sync with a diff; a loopback relay to the device, with a tailnet listener and tokens only after the user agrees.
---

# Make It Ship — iOS devices

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`.

**Device first.** `mis ios devices`. If it reports `blocked` (no connected device, or no Xcode devicectl), device QA, fix and design review are **BLOCKED**: say so in the report. Simulator results never count as device verification.

## QA / fix / design review loop
1. With the user's OK, add the DEBUG-only bridge from `${CLAUDE_PLUGIN_ROOT}/templates/ios-debug-bridge/` (its README) and run the app on the device.
2. Relay it to this Mac: `mis ios daemon start --target http://<device-bridge-host>:<port>` (loopback only by default). Read state and screenshots through `http://127.0.0.1:<port>`.
3. **ios-qa**: walk the flows from the plan's acceptance criteria; record each result with the screenshot path. **ios-fix**: reproduce on the device, root-cause (`/make-it-ship:debug`), fix test-first, re-verify on the device. **ios-design-review**: compare screenshots with the design (`mis visual-verdict shot.png ref.png`), check spacing, type, safe areas, dark mode and Dynamic Type; list fixes by severity.
4. Before shipping: remove the bridge; `mis ios bridge-scan` must list nothing (`mis ship` refuses READY otherwise). `mis ios daemon stop`.

## Template sync (ios-sync)
`mis ios sync` shows the diff between the project's bridge copy and the current template. Show it to the user; update only with their OK: `mis ios sync --apply` (the guard asks).

## Remote agents on your tailnet
`mis ios daemon start --tailnet ...` also listens on your tailscale address, and every tailnet request needs a token from `mis ios mint <agent-name> [--ttl 24h]`; `mis ios tokens [revoke <name>]` lists or revokes. Both ask the user first: this exposes the device to other machines and **company policy may forbid it**.
