// mis retro (Spec §14 retro): metrics aggregated from runs/*/events.jsonl. Observations are rule-based; the
// retro phase asks the model to add judgment on top, clearly separated.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const count = (arr) => arr.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});

export function loadRuns(root) {
  const dir = join(root, 'runs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((id) => existsSync(join(dir, id, 'state.json'))).sort().map((id) => ({
    state: JSON.parse(readFileSync(join(dir, id, 'state.json'), 'utf8')),
    events: existsSync(join(dir, id, 'events.jsonl')) ? readFileSync(join(dir, id, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [],
  }));
}

const median = (xs) => (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2);

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
  const reviewers = {};
  for (const e of rs.flatMap((r) => ev(r, 'review'))) {
    if (e.blocking) reviewBlocking[e.kind] = (reviewBlocking[e.kind] ?? 0) + e.blocking;
    // gstack specialist-stats: a review "hits" when it found at least one BLOCKING or MAJOR issue.
    const r = (reviewers[e.kind] ??= { reviews: 0, hits: 0, hitRate: 0 });
    r.reviews++;
    if (e.blocking || e.major) r.hits++;
    r.hitRate = Math.round((r.hits / r.reviews) * 100) / 100;
  }
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
    reviewers,
    medianMinutes: minutes.length ? Math.round(median(minutes) * 10) / 10 : 0,
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
    `| run 소요 시간 중앙값(분) | ${m.medianMinutes} |`,
    `| 리뷰어 적중률 (BLOCKING/MAJOR를 찾은 리뷰) | ${Object.entries(m.reviewers ?? {}).map(([k, r]) => `${k} ${r.hits}/${r.reviews}`).join(', ') || '-'} |`, '',
    '## 잘한 점', ...(wins.length ? wins.map((w) => `- ${w}`) : ['- (지표에서 도출된 항목 없음)']), '',
    '## 개선할 점', ...(improve.length ? improve.map((w) => `- ${w}`) : ['- (지표에서 도출된 항목 없음)']), '',
    '## 다음 습관 (모델 판단)', '_(아직 기록되지 않음)_', ''];
  return L.join('\n');
}

/** Git-history metrics for a window (gstack retro): commits, hotspots, and per-author activity. */
export function gitMetrics(root, days = 7) {
  const r = spawnSync('git', ['log', `--since=${days}.days`, '--numstat', '--no-merges', '--format=@@%H%x09%aN%x09%aE'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const authors = {}, files = {};
  let commits = 0, cur = null;
  for (const l of (r.status === 0 ? r.stdout : '').split('\n')) {
    if (l.startsWith('@@')) {
      const [, name, email] = l.slice(2).split('\t');
      commits++;
      cur = (authors[email.toLowerCase()] ??= { name, commits: 0, added: 0, deleted: 0, files: 0 });
      cur.commits++;
      continue;
    }
    const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m || !cur) continue;
    cur.added += Number(m[1]) || 0; cur.deleted += Number(m[2]) || 0; cur.files++;
    files[m[3]] = (files[m[3]] ?? 0) + 1;
  }
  const hotspots = Object.entries(files).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([file, changes]) => ({ file, changes }));
  return { days, commits, authors: Object.values(authors).sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name)), hotspots };
}

export function renderGitRetro(g) {
  const L = ['', `## git 이력 (최근 ${g.days}일, 기계 집계)`, '', `커밋 ${g.commits}개`, '', '| 작성자 | 커밋 | +줄 | -줄 | 파일 변경 |', '|---|---|---|---|---|',
    ...g.authors.map((a) => `| ${a.name} | ${a.commits} | ${a.added} | ${a.deleted} | ${a.files} |`), '', '핫스팟 (가장 자주 바뀐 파일):',
    ...(g.hotspots.length ? g.hotspots.map((h) => `- \`${h.file}\` — ${h.changes}회`) : ['- (없음)']), ''];
  return L.join('\n');
}
