# Phase: ship

Absorbs: gstack ship, document-release, document-generate, land-and-deploy (preparation only) · OMC writer, release, merge-readiness, git-master · Superpowers finishing-a-development-branch.

On request in Quick/Standard; always in Full. Shipping **prepares**; it never pushes, opens a PR, or deploys by itself — those are remote writes the guard asks the user to approve.

The phase has two parts because a reported run is final (`mis check` is refused after REPORTED):
- **Part A — before verify** (steps 1-2): every file change for shipping (docs, changelog) happens while the run is still executing, so the final checks, reviews, and verdict cover it.
- **Part B — after the report** (steps 3-5): drafts, commits, and finishing the branch; no more file edits. If something must change after the report, that is a follow-up run: `mis start --input "follow-up to <run id>: <what>"` (Quick, low risk).

1. **Docs** (document-release): for each changed public surface (CLI flags, API, config, UI behavior), update the user-facing docs (README, usage docs) — factual fixes directly, new sections or narrative changes only with the user's OK. Run the relevant checks again afterwards.
2. **Changelog**: if the project keeps `CHANGELOG.md`, add the entry (use the draft from step 3 if helpful) under `Unreleased`; match the existing format.
3. iOS projects: `mis ios bridge-scan` must list nothing (remove the debug bridge per its README first). `mis ship` writes `docs/make-it-ship/<run>/ship.md`: PR title/body draft (summary, changes, machine-checked verification, not-verified items, commits), a changelog draft, and a release checklist. It says **NOT READY** unless the verdict is VERIFIED.
4. **Commits** (git-master): group by concern, each revertible on its own, in dependency order; never on `main`/`master` without the user's OK; never amend or rewrite shared history.
5. **Finish the branch**: offer the user exactly these options — merge locally, push and open a PR, keep as is, or discard (discard needs them to type it). Push/PR run only after their approval in the guard prompt. Force-pushing the default branch is always refused.
6. `mis ship` must say READY on the final code. If it says NOT READY, do not finish the branch; report why.
