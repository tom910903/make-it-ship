---
name: skill
description: Make It Ship learned-skill manager (absorbs OMC skill) - list, search, add, edit, remove and lint learned skills in the project (.make-it-ship/skills) or user (~/.make-it-ship/skills) location. Use when the user wants to see, find, change, delete or check their learned or custom skills.
---

# Make It Ship — skill (learned skill manager)

Absorbs: OMC skill (list/add/remove/search/edit). Writing a new skill: `/make-it-ship:skillify` (from this session) or `/make-it-ship:writing-skills` (tested authoring).

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`.

A learned skill is `<base>/<name>/SKILL.md`:

```
---
name: <kebab-case, same as the directory>
description: Use when <the situation that should bring this skill up>
triggers: [phrase one, phrase two]
---

# <Title>
<the steps, rules or reference>
```

`triggers` must stay on one line in this `[a, b]` form: the prompt router offers the skill when a trigger phrase appears in a prompt (`mis test-prompt "<prompt>"` shows it).

| Command | Does |
|---|---|
| `mis skill list` | project, user and plugin skills with scope and triggers |
| `mis skill search <text>` | match on name, description, triggers and body |
| `mis skill add <file\|-> [--scope project\|user]` | lint, then write `.make-it-ship/skills/<name>/SKILL.md` (project, default) or `~/.make-it-ship/skills/<name>/SKILL.md` (user); refuses an existing name |
| `mis skill edit <name> [<file\|->] [--scope …]` | without content: print the path to edit, then lint; with content: lint, then replace |
| `mis skill remove <name> [--scope …]` | delete that learned skill's directory |
| `mis skill lint [<name>] [--scope …]` | errors (exit 1): bad name, name ≠ directory, missing description, missing or multi-line `triggers`, triggers under 3 characters, empty body, TODO/TBD placeholders. Warnings: description not starting with "Use when", body over 500 lines |

Rules:
- The plugin's own skills (`${CLAUDE_PLUGIN_ROOT}/skills`) are read-only: `edit` and `remove` refuse them. Never write into the plugin directory.
- Project scope for knowledge about this repository; user scope only for knowledge that holds across projects. Ask the user which scope when it is not obvious.
- Confirm with the user before `mis skill remove` (it deletes the file); show what will be deleted first.
- After any change run `mis skill lint <name>` and quote the result.
