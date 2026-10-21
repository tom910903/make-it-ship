---
name: writing-skills
description: Make It Ship skill authoring, test-first (absorbs Superpowers writing-skills, its subagent testing method and render-graphs) - write a learned skill only after watching a subagent fail a scenario without it, then prove the subagent passes with it (mis skill test) and that it lints. Use when creating or editing a skill and you need evidence it actually changes behavior.
---

# Make It Ship — writing skills (TDD for skills)

Absorbs: Superpowers writing-skills (RED-GREEN-REFACTOR for documentation), testing-skills-with-subagents, render-graphs.js. Skill format and management: `/make-it-ship:skill`.

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`.

A skill is code for agents: if you never saw an agent fail without it, you do not know it teaches anything.

## RED — scenario first
1. Write 1-3 scenarios as JSON (a file outside the skill, e.g. `.make-it-ship/skill-tests/<name>.json`):
   ```json
   [{ "name": "deadline pressure", "prompt": "<a realistic situation that tempts the wrong behavior; ask for a concrete choice or action>",
      "expect": ["<regex the right answer contains>"], "forbid": ["<regex of the rationalization or wrong choice>"] }]
   ```
   Good scenarios combine pressures (time, sunk cost, authority, "just this once") and force a concrete answer, not an opinion.
2. Save a first minimal draft with `mis skill add - --scope project` (lint must pass), then run `mis skill test <name> <scenarios.json>`. Each scenario runs twice through a fresh subagent: **baseline** (no skill) and **with the skill** (its text in the prompt). Read the baseline outputs: they are the RED evidence and show the exact rationalizations to counter.

## GREEN — minimal skill
3. Edit the skill to answer those specific failures, nothing more: `mis skill edit <name> -`.
4. `mis skill test <name> <scenarios.json>` until `status` is `GREEN` (every scenario fails without the skill and passes with it).
   - `FAIL` (exit 1): the agent still fails with the skill; close the loophole in the text (explicit "no exceptions" rule, a rationalization → reality table, a red-flag list) and rerun.
   - `NO_RED`: some scenario passes even without the skill; it proves nothing, make it harder.

## REFACTOR — close loopholes
5. Add a new scenario for each new rationalization you see; rerun all of them; stop when two rounds find nothing new.
6. `mis skill lint <name>` must report no errors: kebab-case name equal to the directory, description present (start with "Use when" and describe the situation, not the steps), one-line `triggers: [..]` with phrases of 3+ characters, a body without TODO/TBD placeholders.
7. Check the trigger: `mis test-prompt "<a prompt that should bring it up>"` lists the skill.

## How `mis skill test` runs the subagent
- Default agent: `claude -p --safe-mode --tools Read,Grep,Glob` (print mode; user/project skills, plugins, hooks and CLAUDE.md off; read-only tools), prompt on stdin, in an empty temporary directory with an empty Make It Ship home, so neither run sees learned skills except the text the test gives it. Claude Code session variables are not passed on.
- `MIS_SKILL_TEST_CMD="<shell command>"` replaces the agent (it gets the prompt on stdin and prints the answer on stdout). The plugin's own tests use this with a fake agent; they never launch real claude.
- Inside a session you can also run a scenario by hand with the Agent tool: dispatch one subagent with the scenario only and one with the skill text plus the scenario, and compare their answers against the same expect/forbid rules. Record both outputs as evidence.

## Flowcharts
Use a ```dot block only for a decision the reader could get wrong; render it for review with `mis skill graphs <name>` (writes `<graph>.svg` next to the skill; BLOCKED if graphviz `dot` is not installed).

## Done means
`mis skill test` status GREEN and `mis skill lint` with no errors, both quoted in your reply. Never claim a skill works from reading it.
