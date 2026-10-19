# Make It Ship iOS debug bridge (DEBUG only)

Absorbs gstack ios-qa / ios-fix / ios-clean / ios-sync in a minimal form. It lets QA on a **real device** read app state and screenshots during DEBUG runs.

## Add (with the user's approval)
1. Copy this folder into the app repository (e.g. `Packages/DebugBridge`) and add it as a local Swift package dependency of the app target.
2. Wire it in the `@main` App, inside DEBUG only:
   ```swift
   #if DEBUG
   import DebugBridge
   #endif
   init() {
       #if DEBUG
       DebugBridge.start(state: { ["screen": "home"] })
       #endif
   }
   ```
3. The server binds to `127.0.0.1:8765` on the device only. Reach it from the Mac through a device tunnel/port forward of your choice. Without a connected device, device QA is **BLOCKED**. It is never reported as passed.

## Remove before shipping (ios-clean)
`mis ios bridge-scan` lists every file that still references the bridge, and `mis ship` reports NOT READY (PARTIAL) while any remain. To remove it:
1. Delete the `import DebugBridge` / `DebugBridge.start` blocks and keep the surrounding code.
2. Remove the package dependency.
3. Delete the copied folder.
4. Build Release, then confirm `mis ios bridge-scan` lists nothing.
