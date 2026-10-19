// Shortcut debt ledger (Ponytail ponytail-debt convention): `shortcut: <limit>, <when to upgrade>` comments.
import { spawnSync } from 'node:child_process';
import { REPORT_DIR } from './tree-hash.mjs';

/** @returns {{file:string, line:number, text:string, trigger:boolean}[]} */
export function shortcutDebt(root) {
  const r = spawnSync('git', ['grep', '--no-index', '--exclude-standard', '-nE', '(#|//|/[*]) ?(shortcut|ponytail):', '--', '.', `:(exclude)${REPORT_DIR}`],
    { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return []; // 1 = no matches
  return r.stdout.split('\n').filter(Boolean).map((l) => {
    const m = l.match(/^(.*?):(\d+):(.*)$/);
    const text = m[3].replace(/^.*?(?:#|\/\/|\/\*) ?(?:shortcut|ponytail):\s*/, '').replace(/\s*\*\/\s*$/, '').trim();
    return { file: m[1], line: Number(m[2]), text, trigger: text.includes(',') };
  });
}

export function renderDebt(items) {
  if (!items.length) return 'No shortcut debt.';
  const rows = items.map((d) => `- \`${d.file}:${d.line}\` — ${d.text}${d.trigger ? '' : ' (no-trigger)'}`);
  return [...rows, '', `${items.length} markers, ${items.filter((d) => !d.trigger).length} with no trigger.`].join('\n');
}
