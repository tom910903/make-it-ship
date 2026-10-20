// PostToolUse helpers (absorbs OMC rules-injector, post-tool-verifier, post-tool-use-failure; see THIRD_PARTY_NOTICES.md).
// Session memory lives in the per-user home under sessions/<id>.json so each hint fires once per session.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { globToRegExp } from './policy.mjs';
import { readHome, writeHome, homeDir } from './home.mjs';

const sid = (id) => `sessions/${String(id || 'default').replace(/[^\w.-]/g, '_')}.json`;
export const readSession = (id) => readHome(sid(id), {}) ?? {};
export const writeSession = (id, s) => writeHome(sid(id), s);

// Claude Code loads .claude/rules and ~/.claude/rules natively, so only the formats it does not read are injected here.
const RULE_DIRS = [['.cursor', 'rules'], ['.github', 'instructions']];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(md|mdc)$/.test(e)) out.push(p);
  }
  return out;
}

function parseRule(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = fm?.[1] ?? '';
  const globs = [];
  for (const key of ['globs', 'paths', 'applyTo']) {
    const v = meta.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1];
    if (v) globs.push(...v.replace(/^\[|\]$/g, '').split(',').map((g) => g.trim().replace(/^["']|["']$/g, '')).filter(Boolean));
  }
  return { always: /^alwaysApply:\s*true\s*$/m.test(meta), globs, body: text.slice(fm ? fm[0].length : 0).trim() };
}

/** Rule texts that apply to `file` (absolute) under repo `root`. Returns [{path, hash, body}]. */
export function matchingRules(root, file) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const found = [];
  const single = join(root, '.github', 'copilot-instructions.md');
  if (existsSync(single)) found.push({ path: single, always: true, body: readFileSync(single, 'utf8').trim() });
  for (const parts of RULE_DIRS) {
    const d = join(root, ...parts);
    if (!existsSync(d)) continue;
    for (const p of walk(d)) {
      const r = parseRule(readFileSync(p, 'utf8'));
      if (r.always || r.globs.some((g) => globToRegExp(g.replace(/^\.\//, '')).test(rel))) found.push({ path: p, ...r });
    }
  }
  return found.map((r) => ({ path: r.path, body: r.body, hash: createHash('sha256').update(r.body).digest('hex').slice(0, 16) }));
}

const TEST_CMD = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bnode\s+--test\b|\bpytest\b|\bgo\s+test\b|\bcargo\s+test\b|\bmake\s+(test|check)\b|\bmis(\.mjs)?\s+check\b|\b(jest|vitest|mocha|rspec|phpunit|ctest|swift\s+test|xcodebuild\s+test|gradle\w*\s+test|mvn\s+test)\b/;
export const EDIT_REMINDER_EVERY = 8;

export function isTestCommand(cmd) { return TEST_CMD.test(String(cmd ?? '')); }

/** Drop per-session hint memory older than a week (called at SessionStart). */
export function pruneSessions(maxAgeMs = 7 * 864e5) {
  const d = join(homeDir(), 'sessions');
  if (!existsSync(d)) return;
  for (const f of readdirSync(d)) if (Date.now() - statSync(join(d, f)).mtimeMs > maxAgeMs) rmSync(join(d, f), { force: true });
}
