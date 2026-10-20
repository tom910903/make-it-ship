# Phase: retro / learn

Absorbs: gstack retro, learn · OMC learner, remember, wiki, skillify · Superpowers writing-skills.

Full mode at the end of a run, or on request (`/make-it-ship:retro`).

1. `mis retro [--days N]` aggregates every run's events into metrics (verdicts, fail→pass cycles, retries, root causes, resumes, blocked reasons, review blocking issues, durations) and writes `docs/make-it-ship/retro-<date>.md` with rule-based wins and improvements. Numbers are machine-counted; keep them as they are.
2. Edit the retro file: replace `_(아직 기록되지 않음)_` under "다음 습관 (모델 판단)" with up to 3 habits for the next run, each tied to a metric (e.g. "2 runs BLOCKED on a missing simulator → run `mis qa detect` during discover").
3. **Learnings** — record only what passes all three: not findable in five minutes of searching, specific to this codebase, and it took real effort to discover:

```
mis learn add - <<'MIS'
{"type":"pitfall","key":"ts-test-glob","insight":"node --test needs a quoted glob for .ts tests","confidence":8,"source":"observed","files":["package.json"]}
MIS
```

   Types: pattern, pitfall, preference, architecture, tool, operational. `mis learn list` shows current entries; entries whose files disappeared are marked STALE — update or supersede them.
4. **Process changes** (to `.make-it-ship.json`, this plugin's phases, or project conventions) are proposals: show the user the observed failure that motivates each one and apply only what they approve.
5. **Git history** (gstack retro): `mis retro --git --since 7d` (or the window the user names) adds commits, per-author activity (commits, lines, files) and hotspots (files changed most often) to the retro file. The metrics also include each reviewer's hit rate: the share of its reviews that found a BLOCKING or MAJOR issue (gstack specialist-stats). A reviewer that never hits is a candidate to skip for small changes; present that as a proposal.
6. **Search before adding** (gstack learnings-search): `mis learn search <words>` (`--type pitfall`); update an existing key instead of adding a near-duplicate.
7. **Distill** (gstack distill): turn free-text notes (the retro's habits, a session's notes) into proposals with `mis learn distill - <<'MIS'` … `MIS`; only lines like `- pitfall: ...` count. Show the proposals to the user and re-run with `--yes` only after they agree.
8. **Decisions** (gstack decision-log, decision-search): durable choices (architecture, conventions, "we don't do X") go to `mis decision add '{"decision":"...","rationale":"..."}'`. Run `mis decision search <topic>` before planning similar work. A changed mind is `mis decision supersede <id> -`, never an edit. Decision text with a secret in it is refused.
9. **Shared ledgers** (gstack jsonl-merge): in a team repository, `mis jsonl-merge install` (local git config only) makes `docs/make-it-ship/*.jsonl` merge as the union of both sides' lines.
