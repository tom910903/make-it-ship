---
name: setup
description: Install, diagnose, update or remove Make It Ship - routes setup, doctor, MCP server setup, config, update and uninstall requests. Use when the user says setup, install, doctor, something is broken with the plugin, add an MCP server, update/upgrade, uninstall, or migrate from oh-my-claudecode/Superpowers/Ponytail/gstack.
---

Run every command as `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <command>`. Anything that edits files outside the repository is dry by default: show the user what it prints, and run the executing form only after they agree (the guard asks again).

Pick the route from the request:

1. **Setup / migrate** (first install, "set up the status line", "remove the OMC instructions"): run `mis setup`. Show each `diff` and the `review` lines (references to the replaced plugins in CLAUDE.md or `~/.claude/rules`, which are never rewritten automatically). After approval run `mis setup --write`; backups are written next to each file. For a shared repository, `mis setup team` drafts `.make-it-ship.json` and `.gitignore`; `mis setup team --write` creates them.
2. **Doctor** ("it does not work", "check the install"): run `mis doctor`. If checks are `error` and `next` mentions `--fix`, explain what is broken and, with approval, run `mis doctor --fix`. For "what is going on in this session" run `mis doctor session` (run, loop, team, freeze, merge-readiness, recent hook errors).
3. **MCP servers**: `mis mcp-setup list`, then `mis mcp-setup add <name>` to show the `claude mcp add` command; run it with `--write` after approval. Never print API keys; ask the user to export the variable named in `missingEnv`.
4. **Project layout and docs** ("set up the folder layout", "AI docs"): `mis init` proposes a `layout` for `.make-it-ship.json` (allowed paths; human docs in `docs/` in English and Korean, AI docs in `.ai/`). If the config already exists, `mis init --layout --write` adds only the proposed `layout` after the user confirms (the guard asks; during a run it is a config change that needs `mis approve config`). `mis layout` shows the rules and what is outside them. After the user approves, `mis layout write` creates the missing `.ai/` skeletons (index, product, tech, structure, conventions, decisions; never overwritten), regenerates the marked part of `.ai/structure.md`, writes a marked rules section in AGENTS.md and an `@AGENTS.md` import in CLAUDE.md (the guard asks).
5. **Config / version**: `mis config get [key]`, `mis config set <key> <value>` (rejects unknown keys and bad values), `mis version`.
6. **Update**: `mis update-check --force` shows whether a newer version exists (read-only; it never sends repository data). `mis upgrade` shows the update command; run `mis upgrade --yes` only after approval, then tell the user to restart Claude Code and run `mis setup` again.
7. **Uninstall**: run `mis uninstall` and show the list (state to delete, settings diffs, processes to stop, run records kept). Only after approval run `mis uninstall --yes` (`--purge-runs` also deletes `.git/make-it-ship` run records, ask separately). Then the user runs `claude plugin uninstall make-it-ship`.

Report in two or three lines what changed and what the user still has to do (restart, export a key).
