---
name: reference
description: Make It Ship reference for delegation and orchestration (absorbs OMC omc-reference) - agent catalog, MCP tools, keyword triggers and hooks read live from the code, plus where the team pipeline, routing and commit rules live. Load before delegating to agents, using the mis MCP tools, orchestrating a team or committing.
---

Here `mis` = the shell function `mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }` (define it in the same Bash call). The lists below come from `mis help`, which reads the code; do not rely on a list from memory.

1. Agents: `mis help agents`. Dispatch them as `make-it-ship:<name>` with the Agent tool. The reviewer agents (their descriptions in `mis help agents` say so) return the `BLOCKING: <n>` / `MAJOR: <n>` header that `mis review add` parses. Authoring and reviewing stay in separate agents.
2. MCP tools: `mis help mcp` (server `mis`; tools appear as `mcp__plugin_make-it-ship_mis__<name>`).
3. Keywords: `mis help keywords` (priority order; only a ralph prefix such as `ralph:` starts the loop, other mentions are a hint).
4. Hooks: `mis help hooks`. Skills: `mis help skills`. Commands: `mis help commands`.
5. Team pipeline (plan → exec → verify → fix, bounded fix loop): read `${CLAUDE_PLUGIN_ROOT}/skills/team/SKILL.md`. Parallel work inside a run: `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/parallel.md`.
6. Commits, pull requests and release: `${CLAUDE_PLUGIN_ROOT}/skills/run/phases/ship.md` (commit only after the report, `mis redact scan` before committing, push and PR only after approval).
7. Evidence: claims of done need `mis verdict`; see `/make-it-ship:status`.
