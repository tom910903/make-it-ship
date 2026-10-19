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
