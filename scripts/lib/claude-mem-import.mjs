// claude-mem import (user decision 2026-11-10): a project without a claude-mem marker gets its rows from ~/.claude-mem/claude-mem.db
// (opened read-only with node:sqlite) in the background at session start; `mis memory import claude-mem [--all]` does it by hand.
// claude-mem labels projects by folder name, so this project's rows are the ones under its name. Ids get a "cm" prefix,
// every text field is masked and folded to one line (claude-mem never masked them), and a second run adds nothing.
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dirFor, projectDir, projectKey, readMeta, writeMeta } from './memstore.mjs';
import { clean, readJsonl } from './summarize.mjs';

export const claudeMemDb = () => process.env.MIS_CLAUDE_MEM_DB || join(homedir(), '.claude-mem', 'claude-mem.db');
const list = (v, k, n) => { try { const a = JSON.parse(v ?? '[]'); return Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, k).map((x) => clean(x, n)).filter(Boolean) : []; } catch { return []; } };
const iso = (ms) => new Date(Number(ms) || 0).toISOString();

async function openDb(path) {
  const emit = process.emitWarning; // node:sqlite is experimental on Node 22 and says so on stderr
  process.emitWarning = (w, ...a) => (/SQLite/i.test(String(w)) ? undefined : emit.call(process, w, ...a));
  try { const { DatabaseSync } = await import('node:sqlite'); return new DatabaseSync(path, { readOnly: true }); } finally { process.emitWarning = emit; }
}

function importRows(db, name, dir) {
  const seen = new Set([...readJsonl(join(dir, 'memories.jsonl')), ...readJsonl(join(dir, 'summaries.jsonl'))].map((r) => String(r.id)));
  let observations = 0, summaries = 0;
  for (const o of db.prepare('SELECT * FROM observations WHERE project = ? ORDER BY created_at_epoch').all(name)) {
    const id = `cm${o.id}`;
    if (seen.has(id)) continue;
    appendFileSync(join(dir, 'memories.jsonl'), JSON.stringify({ id, at: iso(o.created_at_epoch), session: o.memory_session_id ?? undefined, type: clean(o.type, 20) || 'discovery', title: clean(o.title, 160) || '(untitled)',
      subtitle: clean(o.subtitle, 200), facts: list(o.facts, 6, 300), narrative: clean(o.narrative, 1200), concepts: list(o.concepts, 5, 40),
      files: [...list(o.files_read, 10, 200), ...list(o.files_modified, 10, 200)].slice(0, 10), work: Number(o.discovery_tokens) || 0, source: 'claude-mem' }) + '\n');
    observations++;
  }
  for (const s of db.prepare('SELECT * FROM session_summaries WHERE project = ? ORDER BY created_at_epoch').all(name)) {
    const id = `cmS${s.id}`;
    if (seen.has(id)) continue;
    appendFileSync(join(dir, 'summaries.jsonl'), JSON.stringify({ id, at: iso(s.created_at_epoch), session: s.memory_session_id ?? undefined, request: clean(s.request, 600), investigated: clean(s.investigated, 600),
      learned: clean(s.learned, 600), completed: clean(s.completed, 600), next_steps: clean(s.next_steps, 600), source: 'claude-mem' }) + '\n');
    summaries++;
  }
  writeMeta(dir, { claudeMem: { at: new Date().toISOString(), observations, summaries } });
  return { project: name, observations, summaries };
}

/** This project's claude-mem rows; with all, every other claude-mem project too (under the key claude-mem:<name>). */
export async function importClaudeMem(cwd, { all = false, dbPath = claudeMemDb() } = {}) {
  const dir = projectDir(cwd), { name } = projectKey(cwd);
  if (!existsSync(dbPath)) return { error: `no claude-mem database at ${dbPath}` };
  let db;
  try { db = await openDb(dbPath); } catch (e) {
    const error = `cannot read the claude-mem database (${String(e?.message ?? e).slice(0, 120)}); needs Node 22.5 or later`;
    writeMeta(dir, { claudeMem: { at: new Date().toISOString(), error } }); // no retry every session
    return { error };
  }
  try {
    const mine = importRows(db, name, dir);
    // an earlier --all filed these rows under claude-mem:<name>; now they live here
    if (!all) { rmSync(dirFor({ key: `claude-mem:${name}`, name }), { recursive: true, force: true }); return mine; }
    const projects = [mine];
    for (const { project } of db.prepare('SELECT DISTINCT project FROM observations WHERE project IS NOT NULL').all()) {
      if (project === name) continue;
      const d = dirFor({ key: `claude-mem:${project}`, name: project });
      mkdirSync(d, { recursive: true });
      if (!readMeta(d)) writeMeta(d, { key: `claude-mem:${project}`, name: project, created: new Date().toISOString() });
      projects.push(importRows(db, project, d));
    }
    return { projects };
  } finally { db.close(); }
}
