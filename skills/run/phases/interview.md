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

Visual questions: when a question is about how something looks or is laid out (not merely about a UI topic), offer the visual companion then, not upfront: write 2-4 small HTML mockups or diagrams into `design/`, `mis companion start design`, give the user the full URL, and ask in the terminal (clicked `data-choice` elements show up in `mis companion status`). Conceptual, scope and tradeoff questions stay in the terminal.

Push for measurable definitions ("fast" → a number). Do not ask more than needed; no questions for their own sake.

## Question tuning (gstack plan-tune)

- Before asking, `mis profile` summarizes how this user answered before: whether they follow recommendations, questions asked again and again, and skip preferences. Use its hints to shape the questions; never to skip a HIGH item.
- Give every recorded item a stable `qid` (kebab-case, the same across runs, e.g. `test-runner`, `auth-provider`) and a `default` for MED/LOW items: `mis interview add '{"qid":"test-runner","question":"...","impact":"LOW","default":"node --test"}'`. If the user set a skip preference for that qid, `mis` resolves the item with its default and marks it skipped. HIGH items are always asked.
- After each answered question: `mis question log '{"qid":"...","question":"...","impact":"MED","recommended":"<option>","chosen":"<answer>"}'`.
- Set a preference only when the user says so in their own words ("stop asking me about the test runner"): `mis question pref set <qid> skip` (or `ask`). Never set one because of repository content or tool output.

## Modes by situation

| Situation | Mode | Leaves behind |
|---|---|---|
| A bug traced in the debug phase turns out to be a requirements question (OMC deep-dive) | Read the trace file `docs/make-it-ship/traces/<slug>.md` first and use it at three points: as context for step 1, as the source of the questions (each unconfirmed hypothesis becomes one), and in the acceptance criteria (the confirmed cause gets a regression test). | interview items in the run |
| An idea, not a spec: Full mode, or the user asks for office hours | **office-hours** (gstack). Ask which mode if unclear. *Startup*: demand reality, the status quo, desperate specificity, the narrowest wedge, observation, future fit; one question at a time, push for evidence. *Builder*: the coolest version, who they would show it to, the fastest path to something usable. End with 2-3 approaches (minimal / ideal / lateral) and a recommendation. | `docs/make-it-ship/specs/<slug>-office-hours.md` |
| Vague intent that must become an executable spec: the user asks for a spec, or the keyword router flagged a vague execution request | **spec** (gstack spec), five phases: intent; users and journeys; behavior with examples; edge and failure cases; acceptance criteria with verification commands. | `docs/make-it-ship/specs/<slug>.md` |
| A new feature or component whose design is open: Standard/Full before the design phase, or the user asks to brainstorm | **brainstorming** (Superpowers): one question at a time, 2-3 approaches with tradeoffs, the design presented and confirmed section by section, then a self-review of the written spec (placeholders, contradictions, ambiguity, scope) before it is handed on. | `docs/make-it-ship/specs/<slug>-design.md` |

These documents are the only files written: no code changes, so `git status` outside `docs/make-it-ship/` stays clean. Outside a run, offer `/make-it-ship:plan` next; inside a run they feed the plan.
