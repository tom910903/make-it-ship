#!/usr/bin/env node
// Recounts docs/research/gap-matrix.md from its rows (never by hand) and checks row integrity.
// `node scripts/gap-matrix.mjs` prints the counts; `--write` rewrites the generated blocks between the
// `<!-- gap-counts:NAME -->` / `<!-- /gap-counts:NAME -->` markers. tests/unit/gap-matrix.test.mjs keeps them in sync.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FILE = fileURLToPath(new URL('../docs/research/gap-matrix.md', import.meta.url));
export const STATUSES = ['ABSORBED', 'PARTIAL', 'MISSING', 'EXCLUDED-BY-USER', 'N/A'];
const SOURCES = {
  OMC: 'OMC (스킬 41 + 명령 2, 에이전트 19, 훅 27, MCP 도구 58, 키워드 18, HUD·CLI 24)',
  Superpowers: 'Superpowers (스킬 14 + visual companion 1, 훅·호스트 4)',
  Ponytail: 'Ponytail (스킬 6, 레벨·명령·키워드 7, 훅·상태줄·기타 13)',
  gstack: 'gstack (스킬 54, 훅·preamble 10, bin 74행 = 75개 파일, browse·기타 20)',
};
// Counts before M6 (develop @ 62df4ea), kept for comparison; history, not recomputed.
const BEFORE_M6 = { OMC: [9, 49, 125, 5, 1], Superpowers: [3, 9, 4, 0, 3], Ponytail: [1, 3, 18, 0, 4], gstack: [7, 52, 92, 0, 7] };
const GROUPS = { 'M9-A': '설치·수명주기', 'M9-B': '단독 계획·리뷰 스킬', 'M9-C': '에이전트·스킬 작성', 'M9-D': '연구·운영·배포·외부', 'M9-E': '브라우저 자격 증명·고급', 'M9-F': '남은 훅', M10: '원본 대비 비교 벤치마크' };

/** Cells split on unescaped `|` only (GitHub splits table cells there even inside code spans). */
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((s) => s.trim());

/** @returns {{rows: object[], errors: string[]}} */
export function parse(text) {
  const rows = [], errors = [];
  text.split('\n').forEach((line, i) => {
    const c = cells(line);
    if (!line.startsWith('|') || !SOURCES[c[0]]) return;
    const where = `line ${i + 1} (${c[0]} ${c[1]})`;
    if (c.length !== 7) errors.push(`${where}: ${c.length} cells, expected 7 (escape | inside a cell as \\|)`);
    if (!STATUSES.includes(c[4])) errors.push(`${where}: status "${c[4]}" is not one of ${STATUSES.join(', ')}`);
    const groups = [...c[6].matchAll(/→ (M9-[A-F]|M10)\b/g)].map((m) => m[1]);
    const open = c[4] === 'PARTIAL' || c[4] === 'MISSING';
    if (open && groups.length !== 1) errors.push(`${where}: a ${c[4]} row needs exactly one "→ M9-X" or "→ M10" in 남은 작업 (found ${groups.length})`);
    if (open && !/남음/.test(c[6])) errors.push(`${where}: a ${c[4]} row must say what is missing ("남음: …")`);
    if (open && !/사유/.test(c[6])) errors.push(`${where}: a ${c[4]} row must say why ("사유: …")`);
    rows.push({ source: c[0], feature: c[1], status: c[4], group: open ? groups[0] : null, policy: line.includes('[정책]') });
  });
  return { rows, errors };
}

export function counts(rows) {
  const bySource = Object.fromEntries(Object.keys(SOURCES).map((s) => [s, Object.fromEntries(STATUSES.map((st) => [st, 0]))]));
  for (const r of rows) bySource[r.source][r.status]++;
  const total = Object.fromEntries(STATUSES.map((st) => [st, rows.filter((r) => r.status === st).length]));
  const byGroup = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, { rows: 0, policy: 0 }]));
  for (const r of rows.filter((r) => r.group)) { byGroup[r.group].rows++; if (r.policy) byGroup[r.group].policy++; }
  return { bySource, total, rows: rows.length, byGroup };
}

export function blocks(c) {
  const open = c.total.PARTIAL + c.total.MISSING;
  const pct = Math.round((c.total.ABSORBED / c.rows) * 100);
  const final = `**M9 final** (\`m9-wip\`, M9-A4 이후, \`node scripts/gap-matrix.mjs\`가 행에서 센 값): ${c.rows}행 중 ABSORBED ${c.total.ABSORBED} (${pct}%), PARTIAL ${c.total.PARTIAL}, MISSING ${c.total.MISSING}, EXCLUDED-BY-USER ${c.total['EXCLUDED-BY-USER']}, N/A ${c.total['N/A']}. 남은 PARTIAL·MISSING ${open}행은 각 행의 "남은 작업"에 빠진 것(남음)과 이유(사유: 실기기 필요, 외부 서비스·[정책], 안전상 의도적 제외, M9에서 구현하지 않음)를 적었다. 묶음별 수는 §1.`;
  const head = '| 원본 | ABSORBED | PARTIAL | MISSING | EXCLUDED-BY-USER | N/A | 합계 |\n|---|---|---|---|---|---|---|';
  const srcRows = Object.entries(c.bySource).map(([s, v]) => `| ${SOURCES[s]} | ${STATUSES.map((st, i) => `${v[st]} (${BEFORE_M6[s][i]})`).join(' | ')} | ${STATUSES.reduce((n, st) => n + v[st], 0)} |`);
  const sum = STATUSES.map((st, i) => `**${c.total[st]} (${Object.values(BEFORE_M6).reduce((n, b) => n + b[i], 0)})**`).join(' | ');
  const summary = [head, ...srcRows, `| **합계** | ${sum} | **${c.rows}** |`].join('\n');
  const groups = ['| 묶음 | 남은 PARTIAL·MISSING 행 | 그중 [정책] |', '|---|---|---|',
    ...Object.entries(c.byGroup).map(([g, v]) => `| ${g} ${GROUPS[g]} | ${v.rows} | ${v.policy} |`),
    `| **합계** | **${open}** | **${Object.values(c.byGroup).reduce((n, v) => n + v.policy, 0)}** |`].join('\n');
  return { final, summary, groups };
}

export function render(text) {
  const { rows, errors } = parse(text);
  if (errors.length) throw new Error(`gap matrix rows are malformed:\n${errors.join('\n')}`);
  const b = blocks(counts(rows));
  let out = text;
  for (const [name, body] of Object.entries(b)) {
    const re = new RegExp(`(<!-- gap-counts:${name} -->\\n)[\\s\\S]*?(<!-- /gap-counts:${name} -->)`);
    if (!re.test(out)) throw new Error(`marker <!-- gap-counts:${name} --> missing`);
    out = out.replace(re, (_, a, z) => `${a}${body}\n${z}`);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = readFileSync(FILE, 'utf8');
  const { rows, errors } = parse(text);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  if (process.argv.includes('--write')) writeFileSync(FILE, render(text));
  console.log(JSON.stringify(counts(rows), null, 2));
}
