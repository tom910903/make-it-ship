// Parallel waves (M3): tasks may run together only if their owned files cannot overlap
// and their dependencies are already done or in an earlier wave.
import { globToRegExp } from './policy.mjs';

const staticPrefix = (g) => g.split(/[*?]/)[0];
const isGlob = (g) => /[*?]/.test(g);

/** Conservative: true when two ownership lists could touch the same file. */
export function overlaps(a, b) {
  for (const x of a) for (const y of b) {
    if (x === y) return true;
    if (!isGlob(y) && isGlob(x) && globToRegExp(x).test(y)) return true;
    if (!isGlob(x) && isGlob(y) && globToRegExp(y).test(x)) return true;
    if (isGlob(x) && isGlob(y)) {
      const [p, q] = [staticPrefix(x), staticPrefix(y)];
      if (p.startsWith(q) || q.startsWith(p)) return true;
    }
  }
  return false;
}

/** @returns {{waves: string[][], notes: string[]}} */
export function planWaves(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const todo = tasks.filter((t) => t.status !== 'DONE');
  const notes = [];
  for (const t of todo) for (const d of t.dependsOn ?? []) if (!byId.has(d)) throw new Error(`task ${t.id} depends on unknown task ${d}`);
  const waveOf = new Map();
  const waves = [];
  const exclusive = new Set();
  const place = (t, stack = []) => {
    if (waveOf.has(t.id)) return waveOf.get(t.id);
    if (stack.includes(t.id)) throw new Error(`dependency cycle: ${[...stack, t.id].join(' -> ')}`);
    let w = 0;
    for (const d of t.dependsOn ?? []) {
      const dep = byId.get(d);
      if (dep.status !== 'DONE') w = Math.max(w, place(dep, [...stack, t.id]) + 1);
    }
    if (!t.files?.length) { exclusive.add(t.id); notes.push(`${t.id} has no files listed: it runs alone`); }
    for (; ; w++) {
      waves[w] ??= [];
      const clash = waves[w].some((o) => exclusive.has(o) || exclusive.has(t.id) || overlaps(t.files ?? [], byId.get(o).files ?? []));
      if (!clash) break;
    }
    waves[w].push(t.id);
    waveOf.set(t.id, w);
    return w;
  };
  for (const t of todo) place(t);
  return { waves: waves.filter((w) => w.length), notes };
}
