---
name: hud
description: Set up the Make It Ship status line (HUD) - pick a preset (minimal, focused, full) and turn parts on or off by group with live previews, no part names needed; or add, remove, reorder and reset parts directly. Use when the user asks to change, configure, simplify or reset the HUD or status line, or asks what it can show.
argument-hint: "[preset <minimal|focused|full> | add|remove <part...> | set <part...> | reset]"
---

Where `mis` = the shell function `mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }`.

**With an argument** (`preset full`, `add git cost`, `remove style`, `set …`, `reset`): run `mis hud <argument>`, show its `preview` in a code block and say in one line what changed.

**Without an argument**, walk the user through it. Never ask them to type a part name or a command.

1. Run `mis hud` once. Its JSON has the current `preset`, `add`, `remove` and `items`, the `groups` (each part with `on` and `doc`), the three `presets` with a rendered `preview` each, and `previewSource`. When that is the sample input (no status line refresh seen yet), say the previews use sample values.
2. One AskUserQuestion call with two questions:
   - Preset: options `minimal`, `focused`, `full`, each with its rendered preview as the option's `preview` and a one-line description. Mark the current one "(current)" and recommend keeping it unless the user asked for a change. If the current preset is `custom`, add "keep my custom list" as a fourth option.
   - Next: "save as is" / "turn parts on or off" / "set the order and rows myself".
3. Turn parts on or off: ask which groups to adjust, as two multi-select questions of four groups each (model, usage, cost, git / work, activity, session, other), each option described by its parts. A multi-select question may not accept an empty answer: tell the user to pick "Other" and write "none" to skip one.
4. For each chosen group, one multi-select question "Which of these should show?" with the group's parts (four at most) as options: label = part name, description = its `doc`, plus "(on now)" when the chosen preset shows it. Ask up to four questions per call. "none" for a group turns all its parts off.
5. Apply: if the preset changed, run `mis hud preset <name>` first (it clears earlier additions and removals). Then, for the groups asked, `mis hud add …` the parts picked that the preset leaves out and `mis hud remove …` the preset's parts not picked. Groups not asked keep the preset's choice.
6. Set the order and rows: show the current `items` and ask how to arrange them, in the user's words; then run `mis hud set <parts in order, br where a new row starts>`. That makes a custom list, which later versions add no new parts to: say so.
7. Finish with the `preview` of the last `mis hud` command in a code block and one line: it shows on the next status line refresh with no restart, and `mis hud reset` goes back to the default (focused).

Notes:
- Each part shows only when it has a value (no PR, no background task: nothing). `agents-list` adds a row per running subagent below the others.
- Take the parts, docs and groups from `mis hud`; do not list them from memory.
- `prompt` (time since the last prompt) changes only when the status line refreshes. A ticking clock needs `refreshInterval` in the user's statusLine settings; change it only when asked.
