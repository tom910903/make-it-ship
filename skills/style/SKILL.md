---
name: style
description: Set the Make It Ship always-on coding style level - off, lite, full (default) or ultra (smallest complete change, reuse first, no speculative code). Use when the user asks for a level, says "be lazy", "simplest solution", "yagni", "normal mode", or "ponytail <level>".
argument-hint: "[off|lite|full|ultra] | default <level>"
---

- With a level argument: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" style <level>` and confirm the new level in one line. It applies to this session only (new subagents included); follow it yourself from now on. New sessions start at the default level.
- `default <level>`: run `mis style default <level>` to store the level used when no session level is set.
- No argument: run `mis style` and show the current level and default.

Levels: `lite` builds what was asked and names a smaller option; `full` applies the rules as written; `ultra` also pushes back on parts of the request the need does not justify; `off` turns the style rules off (the Make It Ship discipline still applies).
