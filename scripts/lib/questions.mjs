// plan-tune (absorbs gstack plan-tune, gstack-question-log, gstack-question-preference, gstack-developer-profile):
// a log of questions the user answered, per-question preferences, and a profile derived from the log.

export const QID = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** A skip preference never suppresses a HIGH item: security, data-loss and irreversible choices are always asked. */
export function filterQuestions(items, prefs) {
  const ask = [], skip = [];
  for (const q of items) (q.qid && prefs[q.qid] === 'skip' && q.impact !== 'HIGH' ? skip : ask).push(q);
  return { ask, skip };
}

export function validateQuestionLog(e) {
  const errs = [];
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['entry must be an object'];
  for (const k of Object.keys(e)) if (!['qid', 'question', 'impact', 'options', 'recommended', 'chosen', 'skill'].includes(k)) errs.push(`unknown key: ${k}`);
  if (!QID.test(e.qid ?? '')) errs.push('qid must be kebab-case (2-64 chars), stable across runs');
  if (typeof e.question !== 'string' || !e.question.trim()) errs.push('question must be a non-empty string');
  if (typeof e.chosen !== 'string' || !e.chosen.trim()) errs.push('chosen must be a non-empty string');
  if (e.impact !== undefined && !['HIGH', 'MED', 'LOW'].includes(e.impact)) errs.push('impact must be HIGH|MED|LOW');
  if (e.options !== undefined && !(Array.isArray(e.options) && e.options.every((o) => typeof o === 'string'))) errs.push('options must be a string array');
  return errs;
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

/** Deterministic summary of how the user answers (no timestamps, sorted keys). */
export function deriveProfile(entries, prefs = {}) {
  const withRec = entries.filter((e) => e.recommended);
  const followed = withRec.filter((e) => e.chosen === e.recommended).length;
  const byImpact = {};
  for (const e of entries) byImpact[e.impact ?? 'unknown'] = (byImpact[e.impact ?? 'unknown'] ?? 0) + 1;
  const perQid = {};
  for (const e of entries) perQid[e.qid] = (perQid[e.qid] ?? 0) + 1;
  const repeated = Object.entries(perQid).filter(([, n]) => n >= 3).map(([q]) => q).sort();
  const rate = pct(followed, withRec.length);
  const style = rate === null ? 'unknown' : rate >= 70 ? 'trusts-recommendations' : rate <= 30 ? 'overrides-often' : 'mixed';
  const skips = Object.keys(prefs).filter((k) => prefs[k] === 'skip').sort();
  const hints = [];
  if (style === 'trusts-recommendations') hints.push('Lead with the recommendation; keep options short.');
  if (style === 'overrides-often') hints.push('Show the tradeoffs of every option; do not assume the recommended one.');
  for (const q of repeated) if (!skips.includes(q)) hints.push(`"${q}" was asked ${perQid[q]} times; offer a skip preference (mis question pref set ${q} skip) if the answer never changes.`);
  return {
    answered: entries.length,
    followedRecommendation: rate,
    style,
    byImpact: Object.fromEntries(Object.entries(byImpact).sort()),
    repeatedQuestions: repeated,
    skipPreferences: skips,
    hints,
  };
}
