# Phase: interview

Absorbs: OMC deep-interview, deep-dive · gstack office-hours, spec, plan-tune · Superpowers brainstorming.

Goal: remove the ambiguity that would make the plan wrong, asking the user as little as possible.

1. **Extract** ambiguity items from the input against what discover found. Judge Goal, Constraints, and Success criteria: what exactly happens, what must not change, how we will know it works.
2. **Answer from the repo first.** A question whose answer is in the code, docs, or request is not asked (PRD 8.2). Cite the `path:line` that answered it.
3. **Classify** each remaining item:
   - HIGH — a wrong guess changes behavior users see, loses data, breaks compatibility, or touches security/cost; or two reasonable readings lead to different implementations.
   - MED — affects design but has a safe default you can state.
   - LOW — cosmetic or easily changed later.
   Record every item: `mis interview add '{"question":"...","impact":"HIGH","why":"..."}'`.
4. **Ask HIGH items one at a time** (AskUserQuestion when available), targeting the weakest dimension first. For each: what is at stake, 2-4 options with one marked (recommended) and why, and what changes if we pick wrong. Irreversible or security choices are always asked.
   Record each answer: `mis interview resolve <id> "<answer>"`.
   For MED/LOW, state the default you will use and resolve them with that default.
5. **Scope check**: if the request contains several independent subsystems, say so and propose splitting; plan only the first unless the user wants all.
6. For an idea (not a spec) in Full mode, first frame the problem (office-hours style): who has it, what they do today, what the smallest valuable version is, and offer 2-3 approaches (minimal / ideal / lateral) with effort and risk, recommending one.
7. If the user says "just do it", stop asking: resolve open items with stated defaults; unresolved HIGH items stay open and `mis` will refuse approval until they are answered.
8. Non-interactive session: you cannot ask. Leave HIGH items open (never invent answers) and continue to planning; the approval gate will stop the run and the report will list the questions.

Push for measurable definitions ("fast" → a number). Do not ask more than needed; no questions for their own sake.
