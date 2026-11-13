# Changelog

Each version is tagged `v<version>` on the commit that set it (`v0.9.0`: the release head).

## 1.0.1 — 2026-11-13
- Updates arrive by themselves: `mis setup` on a marketplace install also turns on Claude Code's auto-update for its marketplace (`autoUpdate` under `extraKnownMarketplaces`; off by default for a GitHub marketplace).
- After an update, session start points the status line and the CLAUDE.md block at the new version folder, with backups, so the status line no longer breaks when the old folder goes. Only our own entries, and only to a newer version.

## 1.0.0 — 2026-11-13
- The repository keeps only what the plugin needs to run. The specs, design records, development logs, milestone reports, the comparison experiment and the demo repositories were removed; git history and the `v0.9.0` tag keep them. An install shrinks from about 12 MB to about 3 MB.
- `mis gain` no longer shows the benchmark against the original plugins: its results were part of the removed experiment.
- `docs/manual-checks.md`: what only a person can check before a release (permission dialogs, the status line on screen, install and update, real iOS and Android devices, other models), with the last recorded result of each.
- Version history moves to this file. Test titles and file names no longer carry development-stage labels, and the docs test also checks the commands that `docs/manual-checks.md` names.

## 0.9.0 — 2026-11-13
- HUD presets `minimal`, `focused` (default: two rows plus a row per running subagent) and `full`. A user's choice is kept as changes on top of the preset (`statusLine.preset`, `add`, `remove`), so parts a later version adds to the preset still show; `mis hud set` makes a fixed custom list (a 0.8.0 `statusLine.items` list keeps working as one).
- `mis hud preset|add|remove|set|reset|preview`; `mis hud` returns the groups and a preview of each preset rendered from the last status line input. `/make-it-ship:hud` walks through preset, then parts by group.
- Parts from the OMC HUD: `repo`, `git` (`+staged !modified ?untracked ⇡ahead ⇣behind`), `prompt` (time since the last prompt), `skill`, `calls` (`🔧 🤖 ⚡`), `bg` (background tasks until their completion notice), `apikey` (source only, never the key), `agents-list`; `duration` gets a session-health color and `think` follows the latest reply.
- `git status` is cached for 5 seconds (a minute when it took over 500 ms); the transcript is read in chunks, at most 32 MB per refresh.
- Fixed: item and preset names such as `toString` were accepted.

## 0.8.0 — 2026-11-13
- The HUD shows every field Claude Code passes to the status line: effort, thinking, fast mode, PR and review state, spend limit, cost, lines added/removed, session time, prompt cache, worktree, session and agent name, vim mode and output style. `ctx` reads `context_window` first.
- `mis hud` and `/make-it-ship:hud` choose the parts and their order (`statusLine.items`; `br` starts a new row).

## 0.7.0 — 2026-11-10
- One global memory store (`~/.make-it-ship/memory`, a project is its git remote), search across projects, and a one-time import of claude-mem history.

## 0.6.0 — 2026-11-10
- claude-mem absorbed: an observation per tool call, `mis memory` and the `memory_search` tool, per-turn summaries, and recent memories at session start.

## 0.5.0 — 2026-11-10
- `/make-it-ship:brainstorm` on its own; a design can be handed on as a slide deck.

## 0.4.0 — 2026-11-04
- Visuals: `mis chart`, more `mis diagram` kinds (subgraph, sequence, class, ER, state), `mis doc` (markdown with mermaid to HTML/PDF, en/ko pairs) and `mis slides`.

## 0.3.3 — 2026-10-30
- HUD gauges: `ctx`, `5h` and `7d` as 10-cell bars with the time to reset, yellow from 70% and red from 85%; colors off with `NO_COLOR`.

## 0.3.2 — 2026-10-30
- `mis init` no longer offers the HUD when one is set; headless Chrome no longer throttles background tabs; test fixes.

## 0.3.1 — 2026-10-30
- Fixed: the SubagentStop hook logged an error outside git repositories.

## 0.3.0 — 2026-10-30
- `master` became the development line and the default branch. The `.ai/` layout, Android devices and emulators (`mis android`), a review after the report reopens the run, and plan usage (5h/7d) in the HUD. The MCP server reports the `plugin.json` version.

## 0.2.0 — 2026-10-22
- First release: the run workflow (plan, approval, checks with recorded evidence, reviews, verdict and report), the guard, always-on hooks, the MCP tool server, the built-in browser, teams, and the absorbed oh-my-claudecode, Superpowers, Ponytail and gstack workflows.

## 0.1.0 — 2026-10-19
- Initial scaffold.

## Earlier tags
Until 2026-11-13 the repository had milestone tags instead of version tags; they were removed. Their commits: `m1-verified` a9862cb, `m2-verified` a54d31a, `m3-verified` 60d1940, `m4-verified` bb945b3, `m5-verified` be21dd8, `m6-verified` 21799f0, `m7-verified` 3483577, `m8-verified` and `m9-verified` 0c5b755, `m10-verified` 215ffca.
