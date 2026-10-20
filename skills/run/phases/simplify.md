# Phase: simplify

Absorbs: Ponytail ponytail, ponytail-audit, ponytail-debt · OMC ai-slop-cleaner, code-simplifier.

Runs in every mode, after implementation and before the final reviews. Goal: the change contains nothing it does not need, and every deliberate limit is visible.

1. **Dependencies**: `mis check` warns when a dependency manifest changed. For each new dependency ask: is it in the standard library or already installed? Is it added for a few lines? Remove it, or record why it is needed with `mis note dep "<reason>"`. Without a reason the verdict stays PARTIAL.
2. **Lean pass over your own diff** (not the rest of the codebase): delete dead code, unused options/flags, speculative features; reuse existing helpers instead of near-copies; drop single-use abstractions and pass-through wrappers. One kind of smell per pass, and re-run the relevant `mis check` after each pass. If a cleanup breaks a check, revert it rather than forcing it.
3. **Never cut**: validation at trust boundaries, error handling that prevents data loss, security, accessibility, anything the user asked for.
4. **Shortcuts**: a deliberate limit gets a comment `shortcut: <the limit>, <when to upgrade>`. `mis report` lists every marker (section 10) and flags those without an upgrade trigger.
5. The quality reviewer checks leanness again; do not approve your own cleanup.

## On request

- **Debt ledger** (ponytail-debt): `mis debt` lists every `shortcut:` marker with `file:line` and flags markers without an upgrade trigger (`mis debt --json` gives counts). The report shows the same list in section 10.
- **Review-only slop pass** (ai-slop-cleaner review mode): the user asks only to find slop. Dispatch `make-it-ship:quality-reviewer` over the scope they named, focused on dead code, duplication, needless abstraction and unused dependencies; show the ranked findings and change nothing.
- **Cleanup beyond this change** (ai-slop-cleaner): only for a scope the user names. `make-it-ship:code-simplifier` works deletion first, one smell per pass, with the suite green before and after every pass.
