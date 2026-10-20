---
name: writer-memory
description: Make It Ship writer memory (absorbs OMC writer-memory) - a story bible for fiction writers kept in .make-it-ship/writer-memory/memory.json - characters, relationships with their evolution, scenes, themes and world rules, with query, export and automatic backups. Use when the user writes fiction and wants characters and scenes remembered.
---

# Make It Ship — writer memory

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`. Values may be JSON (`--keywords '["just","fine"]'`). Every change backs up the previous file first.

- Start: `mis writer-memory init "<project>" [--genre romance]`; overview: `mis writer-memory status`.
- Characters: `char add <name> [--tone ... --speechLevel ... --arc ... --taboo '[...]']`, `char <name>`, `char update <name> <field> <value>`, `char list`, `char remove <name>`.
- Relationships: `rel add <a> <b> <type>`, `rel update <a> <b> <event>` (appends to its evolution), `rel show <a> <b>`, `rel remove <a> <b>`.
- Scenes: `scene add <title> [--characters '[..]' --location ... --emotional_tag ...]`, `scene list`, `scene show <id>`, `scene remove <id>`. Themes: `theme add <name> [--expression ...]`. World: `world set <field> <value>`.
- `mis writer-memory query <text>` finds matching characters, relationships, scenes and themes; read those entries before writing.
- `export` writes a readable Markdown bible; `backup` makes a manual copy.

You do the judgment parts from the stored data: dialogue checks against a character's tone, speech level, keywords and taboo words (quote the fields you used), and the emotion-focused synopsis (protagonist attitude, relationship structure, emotional theme, genre contrast, ending aftertaste). Save agreed results back with `char update` / `world set`.
