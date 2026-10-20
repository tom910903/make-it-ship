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
5. **Finish the branch** (also without a run, when the user just wants to finish a branch: run the project's tests first and show the result): offer the user exactly these options — merge locally, push and open a PR, keep as is, or discard (discard needs them to type it). Push/PR run only after their approval in the guard prompt. Force-pushing the default branch is always refused.
6. `mis ship` must say READY on the final code. If it says NOT READY, do not finish the branch; report why.

## Release details (by situation)

- **Base branch first** (gstack ship): before part A's final verify, bring in the base branch (`git fetch` then `git merge origin/<base>`, or the project's rebase convention) so the checks run on what will land; a conflict is resolved test-first and is a decision for the user when it touches behavior.
- **Scope and repository mode** (gstack diff-scope, repo-mode): `mis diff-scope` sorts the change into code / test / docs / config; a docs-only or config-only change gets no version bump. `mis repo-mode` says solo or collaborative (the top author made 80% or more of the last 90 days' commits). Solo: offer merging locally first. Collaborative: a PR first, and offer `mis jsonl-merge install` so the shared ledgers (decisions, learnings, health) merge without conflicts.
- **Version** (gstack ship, version-bump, next-version): part A, only when the project versions its releases (a `VERSION` file, a package version, or a CHANGELOG with versions) and the user wants a release. Pick the level from the change (fix → patch, feature → minor, breaking → major; ask when unsure), show it with `mis next-version <level>`, then `mis version-bump <level>` updates VERSION and package.json and turns `## [Unreleased]` into the new version in CHANGELOG.md. The `mis ship` PR title then starts with `v<version>` (gstack pr-title-rewrite).
- **Release rules** (OMC release): before the first release in a repository, read how it releases (CONTRIBUTING, RELEASE*.md, CI workflows, `git tag -l`), and write the rules down in `docs/make-it-ship/release-rules.md`; reuse that file next time instead of deriving them again. Creating a tag (`git tag v<version>`) and pushing it are asked by the guard.
- **Secrets before push** (gstack redact, redact-prepush): `mis redact scan` before committing. The guard also scans the unpushed commits on every `git push` and shows the result in its question. A finding means remove the secret and rotate it; never push it "to fix later".
- **Generated docs** (gstack document-generate): a new module, command or public API with no documentation at all gets docs written from the code by `make-it-ship:writer` in part A, so verify covers them. Outside a run, on request, the same without a run.
