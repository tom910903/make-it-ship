// Secret scan (absorbs gstack gstack-redact / gstack-redact-prepush), plus opt-in personal data and legal markers.
// Findings name file:line and the kind, never the value. Used by `mis redact scan`, `mis decision add` and the guard's pre-push check.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { maskSecrets } from './mask.mjs';

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

export function scanText(text, file, kindsOf = secretKinds) {
  const out = [];
  text.split('\n').forEach((l, i) => { for (const kind of kindsOf(l)) out.push({ file, line: i + 1, kind }); });
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
export function scanTree(root, kindsOf = secretKinds) {
  const r = git(root, ['ls-files', '-co', '--exclude-standard', '-z']);
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  const out = [];
  for (const f of r.stdout.split('\0').filter(Boolean)) {
    const p = join(root, f);
    if (!existsSync(p) || statSync(p).size > 1024 * 1024) continue;
    const buf = readFileSync(p);
    if (buf.includes(0)) continue; // binary
    out.push(...scanText(buf.toString('utf8'), f, kindsOf));
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

// ---- personal data and legal markers (opt-in for scans; never part of the guard's pre-push secret check)
const luhn = (s) => { const d = s.replace(/\D/g, ''); let sum = 0; for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; } return d.length >= 13 && d.length <= 19 && sum % 10 === 0; };
const ALLOWED_EMAIL = /@(?:example\.(?:com|org|net)|users\.noreply\.github\.com|anthropic\.com$)|^no-?reply@/i;
// Earlier rules win where spans overlap (a resident number is not also read as a card or phone number).
const PII_RULES = [
  // Korean resident registration number: YYMMDD-Gnnnnnn with a real month/day; no checksum (numbers issued since 2020 do not follow it)
  ['kr-rrn', /(?<![\d-])\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])-[1-8]\d{6}(?![\d-])/g],
  ['us-ssn', /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g, (s) => { const [a, b, c] = s.split('-'); return a !== '000' && a !== '666' && a[0] !== '9' && b !== '00' && c !== '0000'; }],
  ['credit-card', /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g, luhn],
  ['phone', /(?<![\w.+-]|\d[ .-])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?|\d{2,4}[ .-])\d{3,4}[ .-]\d{4}(?![\w.-]|[ .-]\d)/g, (s) => { const n = s.replace(/\D/g, '').length; return n >= 9 && n <= 15; }],
  ['email', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (s) => !ALLOWED_EMAIL.test(s)],
];
const LEGAL_RULES = [
  ['confidential-marker', /\b(?:CONFIDENTIAL|UNDER NDA|ATTORNEY[- ]CLIENT|PRIVILEGED|DO NOT DISTRIBUTE|EYES ONLY|INTERNAL USE ONLY|PROPRIETARY)\b|Attorney[- ]Client Privilege|Do Not Distribute|Internal Use Only/g],
  ['confidential-marker-ko', /대외비|사내\s?한정|영업\s?비밀|외부\s?(?:유출|배포)\s?금지|기밀\s?(?:문서|정보|사항)/g],
];

/** Spans of personal data in a line: [{ kind, start, end }], non-overlapping. */
export function piiSpans(line) {
  const out = [];
  for (const [kind, re, ok = () => true] of PII_RULES) {
    for (const m of line.matchAll(re)) {
      const start = m.index, end = start + m[0].length;
      if (ok(m[0]) && !out.some((s) => start < s.end && end > s.start)) out.push({ kind, start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
export const legalKinds = (line) => LEGAL_RULES.filter(([, re]) => line.search(re) >= 0).map(([k]) => k);

/** Kinds of finding per line for the chosen categories (secrets always). */
export const kindsWith = ({ pii = false, legal = false } = {}) => (line) =>
  [...secretKinds(line), ...(pii ? [...new Set(piiSpans(line).map((s) => s.kind))] : []), ...(legal ? legalKinds(line) : [])];

/** Redact personal data and secrets in text; legal markers stay (they label the document, they are not the secret). */
export function redactText(text) {
  let count = 0;
  const lines = text.split('\n').map((l) => {
    let out = l;
    for (const s of piiSpans(l).reverse()) { out = `${out.slice(0, s.start)}[REDACTED-${s.kind.toUpperCase()}]${out.slice(s.end)}`; count++; }
    const masked = maskSecrets(out, {});
    if (masked !== out) count += (masked.match(/\*\*\*/g) ?? []).length - (out.match(/\*\*\*/g) ?? []).length;
    return masked;
  });
  return { text: lines.join('\n'), count };
}
