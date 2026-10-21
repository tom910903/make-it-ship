// Codebase map for SessionStart (absorbs Ponytail map; see THIRD_PARTY_NOTICES.md): top-level names per folder so
// "reuse what exists" costs no search. shortcut: regex per language, not a parser; misses nested/dynamic definitions.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

const SRC = /\.(py|js|jsx|mjs|cjs|ts|tsx|go|rs|rb|java|kt|php|swift|cs|c|h|cpp|hpp)$/;
const SKIP = /(^|\/)(node_modules|\.git|dist|build|out|vendor|venv|\.venv|__pycache__|coverage|\.next|target|fixtures|tests?|__tests__|spec)(\/|$)|(^|\/)(test_[^/]*|[^/]*(_test|\.test|\.spec|\.min|\.d)\.[a-z]+)$/;
const SHARED = /(util|helper|lib|common|shared|service|component|hook|core|model|schema|api)/i;
const JS = [/^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm];
const RE = {
  js: JS, py: [/^(?:async\s+)?def\s+([A-Za-z]\w*)/gm, /^class\s+([A-Za-z]\w*)/gm],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm, /^type\s+([A-Z]\w*)/gm],
  rs: [/^pub\s+(?:async\s+)?(?:fn|struct|enum|trait|type)\s+(\w+)/gm],
  rb: [/^\s*(?:def|class|module)\s+([A-Za-z][\w.]*)/gm],
  jvm: [/^\s*(?:public\s+)?(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:class|interface|enum|record|struct)\s+(\w+)/gm],
  c: [/^(?:static\s+)?(?:inline\s+)?[A-Za-z_][\w\s*]*?\b([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/gm],
};
const LANG = { js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', py: 'py', go: 'go', rs: 'rs', rb: 'rb',
  java: 'jvm', kt: 'jvm', swift: 'jvm', cs: 'jvm', php: 'jvm', c: 'c', h: 'c', cpp: 'c', hpp: 'c' };

function names(file, text) {
  const out = [];
  for (const re of RE[LANG[extname(file).slice(1)]] ?? []) {
    for (const m of text.matchAll(re)) if (!m[1].startsWith('_') && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export function buildCodeMap(root, budget = 2000) {
  let files;
  try { files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).split('\n'); }
  catch { return ''; }
  files = files.filter((f) => SRC.test(f) && !SKIP.test(f)).slice(0, 4000)
    .sort((a, b) => (SHARED.test(dirname(b)) - SHARED.test(dirname(a))) || a.localeCompare(b));
  const dirs = new Map();
  for (const f of files) {
    let text;
    try { if (!lstatSync(join(root, f)).isFile()) continue; text = readFileSync(join(root, f), 'utf8').slice(0, 65536); } catch { continue; }
    const n = names(f, text);
    if (n.length) dirs.set(dirname(f), [...(dirs.get(dirname(f)) ?? []), n]);
  }
  const lines = [];
  let used = 0, skipped = 0;
  for (const [dir, perFile] of dirs) {
    const all = [...new Set(perFile.flatMap((n) => n.slice(0, perFile.length > 8 ? 1 : 3)))];
    const line = `${dir}/: ${all.slice(0, 30).join(', ')}${all.length > 30 ? ', ...' : ''}`;
    if (used + line.length > budget) { skipped++; continue; }
    lines.push(line);
    used += line.length + 1;
  }
  if (!lines.length) return '';
  return `Codebase map (what already exists; reuse it, read a file only when you need details):\n${lines.join('\n')}${skipped ? `\n(${skipped} more folders not listed)` : ''}`;
}
