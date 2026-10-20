---
name: gbrain
description: Make It Ship gbrain integration, core flow (absorbs gstack setup-gbrain, sync-gbrain and the gstack-brain/gbrain helpers). Detect gbrain, initialize a local brain, set per-remote trust, queue and sync artifacts to a private git repo, ingest wiki pages and reports, query, restore and uninstall. Needs the user's gbrain CLI; writes and pushes always ask.
---

# Make It Ship — gbrain

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`.

**Policy.** gbrain can run on a remote engine (Postgres/Supabase), and the artifacts repo has a git remote: repository content may leave this machine. `init`, `import`, `query`, `sync`, `ingest`, `artifacts-init` and `restore` ask the user every time. **Company policy may forbid uploading company code or documents**: if in doubt, keep the brain local (PGLite) with no artifacts remote, or do not use it.

1. `mis gbrain detect` — is gbrain installed, its version, config, brain repo, queue, this repo's trust. Read-only: it does not run `gbrain doctor` (that may contact a remote engine); the user runs it. Without the CLI every other command is **BLOCKED** with the install steps; give them to the user (never install it yourself).
2. `mis gbrain init` — local PGLite brain.
3. Trust per remote: `mis gbrain policy set <remote-url|local> full|artifacts-only|deny` (default artifacts-only). `artifacts-only` lets only docs/, .make-it-ship/ and .md/.txt files into the queue, sync and import (source files are refused); `full` also allows source; `deny` blocks enqueue, sync, ingest and import for that repository. Sync checks every queued file again under its own repository's trust.
4. Artifacts repo (optional, private remote only): `mis gbrain artifacts-init <git-url>`; `mis gbrain artifacts-url` shows it.
5. Queue and sync: `mis gbrain enqueue <file...>`, then `mis gbrain sync` (copy → commit → push if a remote is set → `gbrain import`).
6. Ingest: `mis gbrain ingest --probe` lists what would go in (wiki pages, Make It Ship reports, research reports) and writes nothing; `mis gbrain ingest` does it.
7. Search: `mis gbrain query "<question>"`. New machine: `mis gbrain restore <git-url>`. Remove: `mis gbrain uninstall [--purge]`.

Not implemented (do not pretend): Supabase provisioning, remote MCP verification, brain cache and consumer registration, code-source wireup. Use gbrain's own commands for those, with the user's approval.
