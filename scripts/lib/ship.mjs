// mis ship: PR draft, changelog draft, release checklist. Never pushes; push/PR stay behind the guard.
import { execFileSync } from 'node:child_process';
import { currentVersion, versionAt, prTitle } from './release.mjs';

const git = (root, ...a) => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

/** v<version> prefix only when this run bumped the version (gstack bumps on every ship; Make It Ship only on a release). */
function releasedVersion(root, base) {
  const now = currentVersion(root);
  return now && base && now !== versionAt(root, base) ? now : null;
}

export function renderShip({ root, state: s, verdict: v, ctx, changes, debt }) {
  const branch = git(root, 'branch', '--show-current');
  const base = s.baseCommit;
  const commits = base ? git(root, 'log', '--oneline', `${base}..HEAD`) : '';
  const dirty = git(root, 'status', '--porcelain', '--', '.', ':(exclude)docs/make-it-ship');
  const changelogTouched = changes.some((c) => /(^|\/)CHANGELOG\.md$/i.test(c.path));
  const ready = v.verdict === 'VERIFIED';
  const tasks = s.plan?.tasks ?? [];
  const isFix = /^\s*(fix|resolve|repair)\b|\b(bug|regression)\b/i.test(`${s.plan?.goal ?? ''} ${s.input?.text ?? ''}`);
  const latest = new Map((s.evidence ?? []).map((e) => [e.check, e]));
  const checks = ctx.required.map((n) => latest.get(n)).filter(Boolean).map((e) => `- \`${(e.argv ?? []).join(' ')}\` → ${e.status} (${e.id})`);
  const box = (ok, text) => `- [${ok ? 'x' : ' '}] ${text}`;
  const L = [];
  L.push(`# Ship 준비 — ${s.runId}`, '');
  L.push(ready ? '**READY** — 판정 VERIFIED. 아래 체크리스트의 수동 항목과 사용자 승인 후 push·PR을 진행한다.'
    : `**NOT READY** — 판정 ${v.verdict}. 배포 준비 완료 아님. 먼저 해결할 것:\n${v.reasons.map((r) => `  - ${r}`).join('\n')}`, '');
  L.push('## PR 초안', '', `**제목**: ${prTitle(s.plan?.goal ?? s.runId, releasedVersion(root, base))}`, '', '**본문**:', '', '### Summary', ...(tasks.map((t) => `- ${t.title} (${t.status})`)), '');
  L.push('### Changes', ...(changes.length ? changes.map((c) => `- ${c.status} \`${c.path}\``) : ['- (없음)']), '');
  L.push('### Verification (machine-checked by `mis check`)', ...(checks.length ? checks : ['- (필수 check 없음)']), `- Verdict: **${v.verdict}** (tree \`${ctx.treeHash.slice(0, 12)}\`)`, '');
  const notVerified = [...v.reasons, ...(ctx.surfaces ?? []).filter((p) => !ctx.required.includes(`qa-${p.profile}`)
    && !(s.evidence ?? []).some((e) => e.check === `qa-${p.profile}` && e.status === 'PASS' && e.treeHash === ctx.treeHash))
    .map((p) => `${p.profile} 표면: 실사용 QA 미실행 (Quick 모드에서는 필수 아님)`), ...(debt.length ? [`shortcut 표식 ${debt.length}개 (보고서 10절)`] : [])];
  L.push('### Not verified / risks', ...(notVerified.length ? notVerified.map((r) => `- ${r}`) : ['- 없음']), '');
  if (commits) L.push('### Commits', '```', commits, '```', '');
  L.push('## CHANGELOG 항목 초안', '', `## [Unreleased] - ${new Date().toISOString().slice(0, 10)}`, `### ${isFix ? 'Fixed' : 'Added'}`, ...tasks.map((t) => `- ${t.title}`), '');
  L.push('## 릴리스 체크리스트', '',
    box(ready, `판정 VERIFIED (현재: ${v.verdict})`),
    box(!dirty, '작업 트리 커밋됨'),
    box(branch && !['main', 'master'].includes(branch), `기본 브랜치가 아님 (${branch || 'detached'})`),
    box(changelogTouched, 'CHANGELOG.md 갱신 — ship part A(verify 전)에서 반영. 보고 후라면 follow-up run으로'),
    box(false, '사용자 대상 문서(README 등)가 바뀐 동작과 일치 — 수동 확인'),
    box(false, '원격 push·PR 생성 — 사용자 승인 필요 (guard가 확인 창을 띄움): `git push -u origin <branch>`, `gh pr create`'),
    '');
  return { ready, markdown: L.join('\n') };
}
