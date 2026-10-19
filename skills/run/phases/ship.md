# Phase: ship

Absorbs: gstack ship, document-release, document-generate, land-and-deploy (preparation only) · OMC writer, release, merge-readiness, git-master · Superpowers finishing-a-development-branch.

On request in Quick/Standard; always in Full. Shipping **prepares**; it never pushes, opens a PR, or deploys by itself — those are remote writes the guard asks the user to approve.

1. **Docs** (document-release): for each changed public surface (CLI flags, API, config, UI behavior), update the user-facing docs (README, usage docs) — factual fixes directly, new sections or narrative changes only with the user's OK. Run the relevant checks again afterwards.
2. **Changelog**: if the project keeps `CHANGELOG.md`, add the entry (use the draft from step 3 if helpful) under `Unreleased`; match the existing format.
3. `mis ship` writes `docs/make-it-ship/<run>/ship.md`: PR title/body draft (summary, changes, machine-checked verification, not-verified items, commits), a changelog draft, and a release checklist. It says **NOT READY** unless the verdict is VERIFIED.
4. **Commits** (git-master): group by concern, each revertible on its own, in dependency order; never on `main`/`master` without the user's OK; never amend or rewrite shared history.
5. **Finish the branch**: offer the user exactly these options — merge locally, push and open a PR, keep as is, or discard (discard needs them to type it). Push/PR run only after their approval in the guard prompt. Force-pushing the default branch is always refused.
6. If anything changed after the last verdict (docs, changelog), re-run the required checks and `mis verdict` before saying it is ready.
