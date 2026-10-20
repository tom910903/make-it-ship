// Release helpers (absorbs gstack gstack-version-bump, gstack-next-version, gstack-pr-title-rewrite, gstack-diff-scope,
// gstack-repo-mode; OMC release). Pure where possible; file writes only in bumpVersion.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
export const LEVELS = ['patch', 'minor', 'major'];

/** VERSION file first, then package.json; null when the project has no version. */
export function currentVersion(root) {
  const vf = join(root, 'VERSION');
  if (existsSync(vf)) return readFileSync(vf, 'utf8').trim() || null;
  const pj = join(root, 'package.json');
  if (existsSync(pj)) { try { return JSON.parse(readFileSync(pj, 'utf8')).version ?? null; } catch { return null; } }
  return null;
}

/** The version as committed at a ref (VERSION, then package.json); null when absent. */
export function versionAt(root, ref) {
  const show = (p) => { const r = spawnSync('git', ['show', `${ref}:${p}`], { cwd: root, encoding: 'utf8' }); return r.status === 0 ? r.stdout : null; };
  const v = show('VERSION');
  if (v !== null) return v.trim() || null;
  try { return JSON.parse(show('package.json') ?? 'null')?.version ?? null; } catch { return null; }
}

export function nextVersion(v, level) {
  if (!LEVELS.includes(level)) throw new Error(`level must be one of ${LEVELS.join('|')}`);
  const m = (v ?? '0.0.0').match(SEMVER);
  if (!m) throw new Error(`version "${v}" is not MAJOR.MINOR.PATCH`);
  const [a, b, c] = m.slice(1).map(Number);
  return level === 'major' ? `${a + 1}.0.0` : level === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}

/** Keep-a-Changelog: the [Unreleased] section becomes the release; a fresh empty [Unreleased] goes above it. */
export function changelogRelease(text, version, date) {
  const head = `## [${version}] - ${date}`;
  if (/^## \[Unreleased\][^\n]*$/m.test(text)) return text.replace(/^## \[Unreleased\][^\n]*$/m, `## [Unreleased]\n\n${head}`);
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^# /.test(l));
  lines.splice(at + 1, 0, '', head, '', '- (no entries recorded)');
  return lines.join('\n');
}

/** Deterministic bump of VERSION / package.json / CHANGELOG.md. Without either version file, VERSION is created. */
export function bumpVersion(root, level, date) {
  const from = currentVersion(root);
  const to = nextVersion(from, level);
  const files = [];
  const vf = join(root, 'VERSION'), pj = join(root, 'package.json'), cl = join(root, 'CHANGELOG.md');
  if (existsSync(vf) || !existsSync(pj)) { writeFileSync(vf, `${to}\n`); files.push('VERSION'); }
  if (existsSync(pj)) {
    const t = readFileSync(pj, 'utf8');
    // Text replace keeps the file's formatting; only the top-level "version" (first occurrence) changes.
    const n = /"version"\s*:\s*"[^"]*"/.test(t) ? t.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${to}"`) : null;
    if (n && n !== t) { writeFileSync(pj, n); files.push('package.json'); }
  }
  if (existsSync(cl)) { writeFileSync(cl, changelogRelease(readFileSync(cl, 'utf8'), to, date)); files.push('CHANGELOG.md'); }
  return { from, to, level, files };
}

/** PR titles start with v<version> (gstack pr-title-rewrite); an existing v-prefix is replaced. */
export const prTitle = (title, version) => (version ? `v${version} ${String(title).replace(/^v\d+(\.\d+)*\s+/, '')}` : String(title));

const TEST = /(^|\/)(tests?|__tests__|spec|specs|e2e)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py|rb)$|(^|\/)test_[^/]+\.py$/i;
const DOCS = /\.(md|mdx|rst|adoc|txt)$|(^|\/)docs?\//i;
const CONFIG = /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|Dockerfile|Makefile|\.make-it-ship\.json|go\.(mod|sum)|Cargo\.(toml|lock)|pyproject\.toml|requirements[^/]*\.txt)$|(^|\/)\.[^/]+$|(^|\/)\.github\/|\.(ya?ml|toml|ini|cfg|conf|env)$/i;

/** code / test / docs / config per file (test wins over docs, docs over config). */
export function classifyPath(p) {
  if (TEST.test(p)) return 'test';
  if (DOCS.test(p)) return 'docs';
  if (CONFIG.test(p)) return 'config';
  return 'code';
}

export function diffScope(files) {
  const out = { code: [], test: [], docs: [], config: [] };
  for (const f of files) out[classifyPath(f)].push(f);
  return out;
}

/** solo when the top author made >= 80% of the commits in the window (gstack-repo-mode heuristic). */
export function repoMode(root, days = 90) {
  const r = spawnSync('git', ['log', `--since=${days}.days`, '--format=%ae'], { cwd: root, encoding: 'utf8' });
  const authors = r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
  if (!authors.length) return { mode: 'unknown', commits: 0, authors: 0, days };
  const counts = {};
  for (const a of authors) counts[a.toLowerCase()] = (counts[a.toLowerCase()] ?? 0) + 1;
  const top = Math.max(...Object.values(counts));
  return { mode: top / authors.length >= 0.8 ? 'solo' : 'collaborative', commits: authors.length, authors: Object.keys(counts).length, topShare: Math.round((top / authors.length) * 100) / 100, days };
}
