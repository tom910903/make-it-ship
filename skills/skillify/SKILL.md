---
name: skillify
description: Make It Ship skill extraction (absorbs OMC skillify and learner) - turns a repeatable workflow or a hard-won fix from the current session into a learned skill draft in .make-it-ship/skills or ~/.make-it-ship/skills, with triggers the prompt router matches. Use when the user says skillify, learner, "make this a skill", "remember how we did this", or after solving a non-obvious problem worth reusing.
---

# Make It Ship — skillify / learner

Absorbs: OMC skillify (repeatable workflow → skill draft) and OMC learner (extract a learned skill from the conversation). For a skill that must change agent behavior under pressure, continue with `/make-it-ship:writing-skills` to test it.

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`.

## 1. Is it worth a skill?
Yes only if all hold: it took real effort or was not obvious; it will come up again; it is a technique or procedure, not a story of what happened once; it is not already a plugin skill (`mis skill search <topic>`) or a one-line project fact (that goes to `mis learn add`). If not, say so and stop.

## 2. Extract
From this session (only what actually happened and was verified — commands that ran, outputs you saw):
- **Workflow (skillify)**: the ordered steps, the inputs each needs, the command that proves each step worked, and where it went wrong first time.
- **Insight (learner)**: the symptom that should make someone think of it, the root cause, the fix, and how to verify it.
Remove secrets, tokens, customer data, hostnames and personal paths.

## 3. Draft
```
---
name: <kebab-case>
description: Use when <symptom or situation, in the words a user would type>
triggers: [<2-5 short phrases a prompt would contain>, ...]
---

# <Title>

## When to use
## Steps            (or: Cause and fix)
## Verify           (the command and the output that proves it worked)
## Pitfalls
```
Triggers: specific phrases (at least 3 characters, ideally 2+ words), lower case, one line. Check them: `mis test-prompt "<a realistic prompt>"` must list the skill, and an unrelated prompt must not.

## 4. Save (ask the scope)
Show the draft and ask: project (`.make-it-ship/skills`, this repository only — default) or user (`~/.make-it-ship/skills`, every project). Then:
```
mis skill add - --scope <project|user>   # SKILL.md text on stdin; lint runs first, nothing is written on an error
```
Never write a skill into the plugin directory. Quote the `mis skill add` result (path and warnings) in your reply.
