---
name: help
description: Make It Ship quick help (absorbs Ponytail ponytail-help, ponytail-gain and OMC omc info, omc capabilities) - lists every mis command by group, skill, agent, keyword (including the ralph prefix rule), style level, MCP tool and hook, generated from the code; also versions and counts (mis info), the capabilities lockfile (mis capabilities) and measured results (mis gain). Use for "help", "how do I use make it ship", "what commands are there", "what does it save", "gain", "capabilities".
---

Here `mis` = the shell function `mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }` (define it in the same Bash call).

- Help: run `mis help` (or `mis help <topic>` with topic commands, skills, agents, keywords, styles, mcp or hooks) and show the output as-is. It is generated from the live registries, so never add commands, skills or keywords from memory.
- Versions and counts: `mis info` (plugin version, Node, commit, agents, MCP tool count, hook events).
- Drift: `mis capabilities` compares the commands, skills, agents, MCP tools and hook events with `.make-it-ship/capabilities.lock.json`. `mis capabilities --check` exits 1 on drift; `--write` records the current set (the only file these commands write, inside the repository).
- Gain: `mis gain` shows measured local evidence only: run verdict counts, check pass rates, `mis bench` deltas and shortcut debt. Quote it as-is. If it says `BLOCKED: no benchmark results`, say that the comparison with the original plugins has not been measured yet; never estimate savings.
