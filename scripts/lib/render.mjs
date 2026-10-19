// Human-readable status (Spec §8 status) and report (templates/report.md, PRD 9.3).
import { readFileSync } from 'node:fs';
import { evidenceStatus, currentReviews, requiredReviews, verdict } from './verdict.mjs';

const latestEvidence = (state) => new Map((state.evidence ?? []).map((e) => [e.check, e]));

export function renderStatus(s, ctx) {
  const L = [];
  L.push(`MIS run ${s.runId} · ${s.state} · mode ${s.mode ?? 'unset'}${s.modeReasons?.length ? ` (${s.modeReasons.join('; ')})` : ''}`);
  if (s.plan) L.push(`Goal: ${s.plan.goal}`);
  if (s.riskFlags?.length) L.push(`Risk flags: ${s.riskFlags.join(', ')}`);
  if (s.blockedReason) L.push(`Blocked: ${s.blockedReason}`);
  const tasks = s.plan?.tasks ?? [];
  if (tasks.length) {
    L.push(`Tasks (${tasks.filter((t) => t.status === 'DONE').length}/${tasks.length} done):`);
    for (const t of tasks) L.push(`  [${t.status}] ${t.id} ${t.title}${t.attempts > 1 ? ` (attempt ${t.attempts})` : ''}`);
  } else L.push('Tasks: no plan yet');
  const latest = latestEvidence(s);
  L.push('Required checks:');
  if (!ctx.required.length) L.push('  (none defined — run `mis init`)');
  for (const name of ctx.required) {
    const e = latest.get(name);
    L.push(e ? `  ${name}  ${evidenceStatus(e, ctx)}  ${e.id}` : `  ${name}  MISSING`);
  }
  const reviews = currentReviews(s, ctx.treeHash);
  L.push('Reviews on current code:');
  for (const k of requiredReviews(s)) {
    const r = reviews.get(k);
    L.push(r ? `  ${k}  ${r.blocking} blocking / ${r.major} major` : `  ${k}  missing`);
  }
  const open = (s.interview ?? []).filter((q) => !q.answer);
  if (open.length) {
    L.push('Open questions:');
    for (const q of open) L.push(`  ${q.id} (${q.impact}) ${q.question}`);
  }
  const decide = [];
  if (s.state === 'AWAITING_APPROVAL') decide.push('approve the plan (mis approve plan)');
  for (const q of open) if (q.impact === 'HIGH') decide.push(`answer ${q.id}: ${q.question}`);
  if (s.state === 'BLOCKED') decide.push(`resolve blocker: ${s.blockedReason}`);
  if (decide.length) {
    L.push('Needs your decision:');
    for (const d of decide) L.push(`  - ${d}`);
  }
  const v = verdict(s, ctx);
  L.push(`Verdict now: ${v.verdict}`);
  for (const r of v.reasons) L.push(`  - ${r}`);
  return L.join('\n') + '\n';
}

const list = (items, empty) => (items.length ? items.map((i) => `- ${i}`).join('\n') : empty);

/**
 * @param data {state, ctx, verdict, changes: {status,path}[], generatedAt}
 */
export function renderReport(templatePath, { state: s, ctx, verdict: v, changes, generatedAt }) {
  const latest = latestEvidence(s);
  const tasks = s.plan?.tasks ?? [];
  const evRows = (s.evidence ?? []).map((e) => `| ${e.id} | ${e.check} | \`${(e.argv ?? []).join(' ')}\` | ${e.exitCode ?? '—'} | ${e.status}${e.reason ? ` (${e.reason})` : ''} | ${evidenceStatus(e, ctx)} | ${e.endedAt ?? ''} |`);
  const checks = evRows.length
    ? ['| ID | check | 명령(argv) | exit | 기록 당시 | 현재 코드 기준 | 종료 시각 |', '|---|---|---|---|---|---|---|', ...evRows].join('\n')
    : '실행된 check가 없다.';
  const reviews = (s.reviews ?? []).map((r) => `${r.kind}: blocking ${r.blocking}, major ${r.major} — ${r.treeHash === ctx.treeHash || r.kind === 'plan-critic' ? '현재 코드 기준' : '이전 코드 기준(무효)'} (\`${r.file}\`)`);
  const unverified = [];
  for (const name of ctx.required) {
    const e = latest.get(name);
    if (!e) unverified.push(`필수 check \`${name}\`: 실행하지 않음`);
    else if (e.status === 'BLOCKED') unverified.push(`필수 check \`${name}\`: 실행 불가 — ${e.reason}`);
  }
  for (const r of v.reasons) if (!/check/.test(r)) unverified.push(r);
  const stale = (s.evidence ?? []).filter((e) => e.status !== 'BLOCKED' && evidenceStatus(e, ctx) === 'STALE')
    .map((e) => `${e.id} \`${e.check}\` (${e.status}) — 이후 코드 또는 설정이 바뀌어 무효`);
  const decisions = [];
  if (v.verdict !== 'VERIFIED') decisions.push(`판정이 ${v.verdict}이므로 아직 배포 대상이 아니다. 6절의 항목을 먼저 해결해야 한다.`);
  for (const q of (s.interview ?? []).filter((x) => !x.answer)) decisions.push(`미해결 질문 ${q.id} (${q.impact}): ${q.question}`);
  for (const r of (s.reviews ?? []).filter((x) => x.major > 0 && x.treeHash === ctx.treeHash)) decisions.push(`${r.kind} 리뷰의 major 이슈 ${r.major}건 확인 필요 (\`${r.file}\`)`);
  if (s.blockedReason) decisions.push(`차단 사유: ${s.blockedReason}`);
  if (ctx.changedManifests?.length) decisions.push(`의존성 매니페스트 변경: ${ctx.changedManifests.join(', ')}`);
  decisions.push('원격 push·PR·배포는 사용자 승인 후에만 수행한다.');
  const howto = [...(s.plan?.howToRun ?? []).map((c) => `\`${c}\``),
    ...ctx.required.map((n) => latest.get(n)?.argv).filter(Boolean).map((a) => `\`${a.join(' ')}\` (필수 check 재실행)`)];
  const fields = {
    runId: s.runId, verdict: v.verdict, treeHash: ctx.treeHash, mode: `${s.mode ?? 'unset'}${s.modeReasons?.length ? ` — ${s.modeReasons.join('; ')}` : ''}`,
    generatedAt,
    readiness: v.verdict === 'VERIFIED' ? '배포 준비 완료 (정의된 검증 범위 안에서)' : '배포 준비 완료 아님',
    goal: s.plan ? `목표: ${s.plan.goal}\n\n달성 여부: ${v.verdict === 'VERIFIED' ? '수용 조건과 필수 검증이 현재 코드 기준으로 충족됨' : `미달성 또는 미확인 (${v.verdict})`}${s.plan.constraints?.length ? `\n\n제약: ${s.plan.constraints.join('; ')}` : ''}` : '계획이 기록되지 않았다.',
    tasks: tasks.length ? tasks.map((t) => `- [${t.status}] ${t.id} ${t.title} — 수용 기준: ${t.acceptance.join('; ')}`).join('\n') : '작업 없음',
    changes: list(changes.map((c) => `${c.status} \`${c.path}\``), '기준 커밋 이후 변경된 파일이 없다.'),
    checks,
    reviews: list(reviews, '기록된 리뷰가 없다.'),
    unverified: list(unverified, '없음'),
    stale: list(stale, '없음'),
    decisions: list(decisions, '없음'),
    howto: list(howto, '기록된 실행 방법이 없다.'),
  };
  return readFileSync(templatePath, 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => String(fields[k] ?? ''));
}
