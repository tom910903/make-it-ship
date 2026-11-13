---
name: hud
description: Choose what the Make It Ship status line (HUD) shows and in what order - effort, model, branch, PR, context, 5h/7d plan usage, cost, lines changed, prompt cache, and more, on one or more rows. Use when the user asks to add, remove, reorder or reset HUD or status line items.
argument-hint: "[add|remove <item...> | set <item...> | reset]"
---

- No argument: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" hud` and show the current items in order, then the items that are off, each with its one-line doc. Ask what to change.
- `add <item...>` appends items at the end (an item already on moves there), `remove <item...>` drops them, `set <item...>` replaces the whole list in that order, `reset` goes back to every item. Run `mis hud <sub> <item...>` and show the new order in one line.
- `br` is an item that starts a new status line row, for example `mis hud set model effort branch pr br ctx 5h 7d cost cache`.
- Each item shows only when it has a value (no PR, no line). The change shows on the next status line refresh; no restart.
