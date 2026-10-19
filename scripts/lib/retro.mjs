// mis retro (Spec §14 retro): metrics aggregated from runs/*/events.jsonl. Observations are rule-based; the
// retro phase asks the model to add judgment on top, clearly separated.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const count = (arr) => arr.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});

export function loadRuns(root) {
  const dir = join(root, 'runs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((id) => existsSync(join(dir, id, 'state.json'))).sort().map((id) => ({
    state: JSON.parse(readFileSync(join(dir, id, 'state.json'), 'utf8')),
    events: existsSync(join(dir, id, 'events.jsonl')) ? readFileSync(join(dir, id, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [],
  }));
}

export function retroMetrics(runs, { sinceMs = 0 } = {}) {
  const rs = runs.filter((r) => Date.parse(r.state.startedAt) >= sinceMs);
  const ev = (r, type) => r.events.filter((e) => e.type === type);
  let failToPass = 0;
  for (const r of rs) {
    const failed = new Set();
    for (const e of ev(r, 'check')) {
      if (e.status === 'FAIL') failed.add(e.check);
      else if (e.status === 'PASS' && failed.delete(e.check)) failToPass++;
    }
  }
  const checks = rs.flatMap((r) => ev(r, 'check'));
  const reviewBlocking = {};
  for (const e of rs.flatMap((r) => ev(r, 'review'))) if (e.blocking) reviewBlocking[e.kind] = (reviewBlocking[e.kind] ?? 0) + e.blocking;
  const minutes = rs.map((r) => (Date.parse(r.events.at(-1)?.at ?? r.state.startedAt) - Date.parse(r.state.startedAt)) / 60000).sort((a, b) => a - b);
  return {
    runs: rs.length,
    finalStates: count(rs.map((r) => r.state.state)),
    finalVerdicts: count(rs.map((r) => [...r.events].reverse().find((e) => e.type === 'report' || e.type === 'verdict')?.verdict ?? 'none')),
    modes: count(rs.map((r) => r.state.mode ?? 'unset')),
    checks: { total: checks.length, failed: checks.filter((e) => e.status === 'FAIL').length, blocked: checks.filter((e) => e.status === 'BLOCKED').length, failToPass },
    retries: rs.flatMap((r) => ev(r, 'task')).filter((e) => e.action === 'retry').length,
    rootCauses: rs.flatMap((r) => ev(r, 'note')).filter((e) => e.kind === 'rootcause').length,
    resumes: rs.flatMap((r) => ev(r, 'resume')).length,
    blockedReasons: rs.flatMap((r) => ev(r, 'block')).map((e) => e.reason),
    reviewBlocking,
    medianMinutes: minutes.length ? Math.round(minutes[Math.floor(minutes.length / 2)] * 10) / 10 : 0,
  };
}

export function renderRetro(m, date) {
  const wins = [];
  const improve = [];
  if (m.checks.failToPass) wins.push(`실패한 check를 원인 확인 후 통과시킨 경우 ${m.checks.failToPass}회`);
  if (Object.keys(m.reviewBlocking).length) wins.push(`리뷰가 출시 전 blocking 이슈를 ${Object.values(m.reviewBlocking).reduce((a, b) => a + b, 0)}건 잡음 (${Object.entries(m.reviewBlocking).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  if (m.finalVerdicts.VERIFIED) wins.push(`VERIFIED로 끝난 run ${m.finalVerdicts.VERIFIED}개`);
  if (m.blockedReasons.length) improve.push(`차단된 run의 사유: ${m.blockedReasons.join('; ')} — 사전에 환경 요구사항을 확인할 수 있었는지 검토`);
  if (m.checks.blocked) improve.push(`실행할 수 없었던 check ${m.checks.blocked}회 — 도구 설치나 check 정의 점검`);
  if (m.retries) improve.push(`재시도 ${m.retries}회 — 같은 실패 유형이 반복되는지 학습 기록(mis learn) 후보`);
  const L = [`# Make It Ship 회고 — ${date}`, '', '## 지표 (기계 집계)', '', '| 항목 | 값 |', '|---|---|',
    `| 실행 수 | ${m.runs} |`, `| 최종 상태 | ${JSON.stringify(m.finalStates)} |`, `| 최종 판정 | ${JSON.stringify(m.finalVerdicts)} |`,
    `| 모드 | ${JSON.stringify(m.modes)} |`, `| check 실행 / 실패 / 실행 불가 | ${m.checks.total} / ${m.checks.failed} / ${m.checks.blocked} |`,
    `| 실패→통과 | ${m.checks.failToPass} |`, `| 재시도 / 원인 기록 / 재개 | ${m.retries} / ${m.rootCauses} / ${m.resumes} |`,
    `| run 소요 시간 중앙값(분) | ${m.medianMinutes} |`, '',
    '## 잘한 점', ...(wins.length ? wins.map((w) => `- ${w}`) : ['- (지표에서 도출된 항목 없음)']), '',
    '## 개선할 점', ...(improve.length ? improve.map((w) => `- ${w}`) : ['- (지표에서 도출된 항목 없음)']), '',
    '## 다음 습관 (모델 판단)', '_(아직 기록되지 않음)_', ''];
  return L.join('\n');
}
