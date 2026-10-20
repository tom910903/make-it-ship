// Secret scan (absorbs gstack gstack-redact / gstack-redact-prepush). Findings name file:line and the kind of
// secret, never the value. Used by `mis redact scan`, `mis decision add` and the guard's pre-push check.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RULES = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/],
  ['api-key-sk', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['secret-assignment', /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)["']?\s*[=:]\s*["'][^\s"']{12,}["']/i],
];

/** Kinds of secret found in one line (empty when clean). */
export function secretKinds(line) {
  return RULES.filter(([, re]) => re.test(line)).map(([k]) => k);
}

export function scanText(text, file) {
  const out = [];
  text.split('\n').forEach((l, i) => { for (const kind of secretKinds(l)) out.push({ file, line: i + 1, kind }); });
  return out;
}

/** Added lines of a unified diff (git log -p / git diff), with commit (from `commit <sha>` markers) and new-file line numbers. */
export function scanPatch(patch) {
  const out = [];
  let commit = null, file = null, line = 0;
  for (const l of patch.split('\n')) {
    if (l.startsWith('commit ')) { commit = l.slice(7, 19); continue; }
    if (l.startsWith('+++ ')) { file = l === '+++ /dev/null' ? null : l.slice(4).replace(/^b\//, ''); continue; }
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (h) { line = Number(h[1]); continue; }
    if (!file) continue;
    if (l.startsWith('+')) { for (const kind of secretKinds(l.slice(1))) out.push({ ...(commit ? { commit } : {}), file, line, kind }); line++; }
    else if (!l.startsWith('-') && !l.startsWith('\\')) line++;
  }
  return out;
}

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 60_000 });

/** Working tree: tracked and untracked (not ignored) text files up to 1 MB. */
export function scanTree(root) {
  const r = git(root, ['ls-files', '-co', '--exclude-standard', '-z']);
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  const out = [];
  for (const f of r.stdout.split('\0').filter(Boolean)) {
    const p = join(root, f);
    if (!existsSync(p) || statSync(p).size > 1024 * 1024) continue;
    const buf = readFileSync(p);
    if (buf.includes(0)) continue; // binary
    out.push(...scanText(buf.toString('utf8'), f));
  }
  return out;
}

/** Every commit reachable from any ref (secrets stay in history after the file is fixed). */
export function scanHistory(root) {
  const r = git(root, ['log', '-p', '--all', '--format=commit %H', '--no-color', '--no-ext-diff']);
  if (r.status !== 0) throw new Error(`git log failed: ${r.stderr}`);
  return scanPatch(r.stdout);
}

/** Commits a push would send: reachable from HEAD but from no remote-tracking branch (a first push scans all of HEAD).
 *  shortcut: always scans HEAD, not the refspec being pushed; scan the pushed ref when pushing other branches matters. */
export function prePushScan(root) {
  const r = spawnSync('git', ['log', '-p', '--format=commit %H', '--no-color', '--no-ext-diff', 'HEAD', '--not', '--remotes'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 10_000 });
  if (r.status !== 0 || r.error) throw new Error(r.error?.message ?? r.stderr.trim());
  return { findings: scanPatch(r.stdout), commits: (r.stdout.match(/^commit /gm) ?? []).length };
}

export const describeFindings = (fs, max = 5) =>
  fs.slice(0, max).map((f) => `${f.file}:${f.line} (${f.kind}${f.commit ? `, ${f.commit}` : ''})`).join(', ') + (fs.length > max ? ` and ${fs.length - max} more` : '');
