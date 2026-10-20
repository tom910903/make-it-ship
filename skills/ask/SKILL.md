---
name: ask
description: Make It Ship other-model advisors (absorbs OMC ask, ccg, omc interop; gstack codex, codex-probe, benchmark-models). Ask Codex, Gemini or Claude CLI for a second opinion, run both and synthesize (ccg), compare models on one prompt, or open a Claude+Codex tmux pair. Sends repository content to another model service; the guard always asks.
---

# Make It Ship — ask other models

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`.

**Policy.** Every command here except `probe` sends your prompt and repository content to another company's model service. The guard asks the user each time, with or without a run. **Company policy may forbid it**: if the user declines or is unsure, answer with Claude alone and say the external advisor was not used. Never call `codex`/`gemini` directly; use these commands.

1. `mis second-opinion probe` — installed CLIs, versions, login state (AUTH_OK/AUTH_MISSING). Sends nothing. A missing CLI is BLOCKED: tell the user how to install and log in; do not install it yourself.
2. One advisor (OMC ask, gstack codex review/challenge/consult): `mis ask <codex|gemini|claude> "<question>" [--file <diff or notes>]`. Shape the question by mode: **review** (find bugs in this diff, P1/P2), **challenge** (argue against this plan), **consult** (answer a design question). The answer is written to `.make-it-ship/ask/second-opinion-<provider>-*.md`.
3. Two advisors + synthesis (OMC ccg): `mis ccg "<question>"`. Split the request first: codex gets architecture/correctness/risks, gemini gets UX/docs/alternatives (put both in the question). Then read the `ccg-*.md` file and fill its Synthesis section: agreed, conflicts (named), chosen direction and why, action checklist. A missing advisor is named in the file; say so in the answer.
4. Compare models (gstack benchmark-models): `mis benchmark-models "<prompt>" --models claude,codex,gemini` → one row per model with status, time and output size. Quality is not scored automatically; compare the linked outputs yourself and say that it is your judgment.
5. Side-by-side session (omc interop): `mis interop` opens tmux with Claude left and Codex right (BLOCKED without tmux). Give the user the attach command.

Advice never changes a verdict. Inside a run, record what you used with `mis note second-opinion -` (stdin: the summary) so the report shows it.
