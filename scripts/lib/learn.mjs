// mis learn (Spec §14 learn): project learnings in docs/make-it-ship/learnings.jsonl (append-only, latest wins),
// rendered to learnings.md. Learnings never change the process by themselves; proposals need user approval.
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPORT_DIR } from './tree-hash.mjs';

const TYPES = ['pattern', 'pitfall', 'preference', 'architecture', 'tool', 'operational'];
const SOURCES = ['observed', 'user-stated', 'inferred', 'cross-model'];

export function validateLearning(e) {
  const errs = [];
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['learning must be an object'];
  for (const k of Object.keys(e)) if (!['type', 'key', 'insight', 'confidence', 'source', 'files'].includes(k)) errs.push(`unknown key: ${k}`);
  if (!TYPES.includes(e.type)) errs.push(`type must be one of ${TYPES.join('|')}`);
  if (typeof e.key !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(e.key)) errs.push('key must be kebab-case (2-64 chars)');
  if (typeof e.insight !== 'string' || !e.insight.trim()) errs.push('insight must be a non-empty string');
  if (!Number.isInteger(e.confidence) || e.confidence < 1 || e.confidence > 10) errs.push('confidence must be an integer 1-10');
  if (!SOURCES.includes(e.source)) errs.push(`source must be one of ${SOURCES.join('|')}`);
  if (e.files !== undefined && !(Array.isArray(e.files) && e.files.every((f) => typeof f === 'string'))) errs.push('files must be a string array');
  return errs;
}

const paths = (root) => ({ jsonl: join(root, REPORT_DIR, 'learnings.jsonl'), md: join(root, REPORT_DIR, 'learnings.md') });

export function listLearnings(root) {
  const { jsonl } = paths(root);
  if (!existsSync(jsonl)) return [];
  const latest = new Map();
  for (const l of readFileSync(jsonl, 'utf8').split('\n').filter(Boolean)) {
    const e = JSON.parse(l);
    latest.set(`${e.type}/${e.key}`, e);
  }
  return [...latest.values()].map((e) => ({ ...e, stale: (e.files ?? []).some((f) => !existsSync(join(root, f))) }));
}

export function addLearning(root, e) {
  const errs = validateLearning(e);
  if (errs.length) throw new Error(`learning invalid: ${errs.join('; ')}`);
  const { jsonl, md } = paths(root);
  mkdirSync(join(root, REPORT_DIR), { recursive: true });
  appendFileSync(jsonl, JSON.stringify({ ...e, at: new Date().toISOString() }) + '\n');
  return refreshLearnings(root);
}

/** Re-render learnings.md from the ledger (STALE recomputed). */
export function refreshLearnings(root) {
  const { md } = paths(root);
  const entries = listLearnings(root);
  if (!entries.length) return entries;
  const L = ['# Project learnings (Make It Ship)', '', '`mis learn add`로 기록. 같은 key는 최신 기록이 우선. STALE = 참조 파일이 사라짐.', ''];
  for (const t of TYPES) {
    const es = entries.filter((x) => x.type === t);
    if (!es.length) continue;
    L.push(`## ${t[0].toUpperCase()}${t.slice(1)}`, ...es.map((x) => `- **${x.key}**: ${x.insight} (confidence ${x.confidence}/10, ${x.source}${x.stale ? ', STALE' : ''})`), '');
  }
  writeFileSync(md, L.join('\n'));
  return entries;
}
