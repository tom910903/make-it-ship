---
name: design-images
description: Make It Ship AI design mockups (absorbs gstack design/ binary and the AI-variant part of design-shotgun) - generate, explore variants, iterate on feedback, evolve a screenshot, and compare them on a board in design/variants/. Uses the user's OpenAI API key; the brief and images are sent to OpenAI, so the guard always asks.
---

# Make It Ship — design images

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`.

**Policy.** Generation sends the brief (and for `evolve`, a screenshot) to the OpenAI image API with the user's key, and it is billed to them. The guard asks every call. **Company policy may forbid sending product screens or unreleased designs**: if the user declines or has no key (BLOCKED), sketch the options as HTML instead (`/make-it-ship:run` design phase).

1. Write a brief: audience, screen purpose, content, constraints (brand colors, platform, density).
2. `mis design variants "<brief>" --count 3` (or `generate` for one). Files land in `design/variants/`.
3. `mis design compare` writes `design/variants/board.html`; open it (`mis browse goto file://<path>`, screenshot) and ask the user to pick and comment.
4. `mis design iterate <responseId|variant.png> "<feedback>"` refines a pick; `mis design evolve <screenshot.png> "<brief>"` starts from the current UI. `mis design gallery` lists everything.
5. The chosen mockup is a reference, not code: implement it in the design phase and check with `mis visual-verdict`.
