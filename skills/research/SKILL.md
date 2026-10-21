---
name: research
description: Make It Ship research loops (absorbs OMC sciomc, scientist, autoresearch, self-improve and the omc autoresearch shim). Parallel scientist subagents with tagged evidence (mis research), a single-mission improvement loop with a strict evaluator contract and max runtime (mis autoresearch), and self-improvement that only proposes process/skill changes until the user approves them.
---

# Make It Ship — research loops

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`. Everything is local files under `.make-it-ship/`. Every loop is bounded; never remove a limit to "finish".

## sciomc — parallel analysis (`mis research`)
1. Split the goal into 2-5 independent stages. `mis research start "<goal>" --stages N [--max-iterations 10] [--max-runtime 2h]`.
2. Launch **N `make-it-ship:scientist` subagents in ONE message** (Agent tool), one stage each. Each must answer in the tag format of `agents/scientist.md` ([FINDING]/[EVIDENCE]/[CONFIDENCE]).
3. Record each answer: `mis research add <session> <stage> -` (stdin). It flags findings without evidence or confidence; send those back once for evidence.
4. AUTO mode (the user asked to keep going): repeat 2-3 for open questions until every stage is complete or `add` reports STOPPED (iteration or runtime limit). Then stop.
5. `mis research report <session>` → `report.md`; write its executive summary from verified findings only. Unverified findings stay labeled unverified.

## autoresearch — one mission, strict evaluator
1. The mission and evaluator come from an interview (`/make-it-ship:interview`): `mis autoresearch init <name> --mission "<goal>" --eval "<command>"`. The evaluator's last stdout line must be JSON `{"pass": boolean, "score"?: number}`; anything else is recorded as a contract error.
2. `mis autoresearch start <name> --max-runtime 30m [--max-iterations N]`.
3. Loop: make ONE change, then `mis autoresearch eval <name> --decision "<what and why>"`. A failing iteration does not stop the run; keep or revert your change based on `best`. Stop when the result says `stopped: true` (max runtime: an evaluator still running at the deadline is killed; or max iterations) or the user cancels (`mis autoresearch stop <name>`).
4. Report from `decision-log.md` and the `evaluations/iteration-*.json` files.
For recurring runs, schedule `mis autoresearch start/eval` with the user's own scheduler; one mission per job.

## self-improve — propose only
Self-improvement changes only process and skill files (`.make-it-ship/`, `.claude/`, `skills/`, `agents/`, `hooks/`, `CLAUDE.md`, `AGENTS.md`) and **never applies anything by itself**.
1. Evidence first: `mis retro`, learnings, review findings. One hypothesis per candidate patch (`git diff > a.patch`, then restore the file).
2. One candidate: `mis self-improve propose "<title>" --patch a.patch --why "<evidence>"`. Several: `mis self-improve tournament --bench "<command printing {\"score\": n}>" a.patch b.patch` scores each in a throwaway worktree and proposes the winner.
3. Show the user the patch (`mis self-improve show <id>`). Only the user approves: `mis approve proposal <id>` (the guard always asks). Rejected: `mis self-improve reject <id>`. Never apply a patch with git yourself.
