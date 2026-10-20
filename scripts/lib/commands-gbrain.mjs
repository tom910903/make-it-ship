// M9-D D6: gbrain family, core flow only (absorbs the core of gstack setup-gbrain, sync-gbrain, gstack-gbrain-detect,
// -repo-policy, gstack-brain-enqueue/-sync/-restore/-uninstall, gstack-artifacts-init/-url, gstack-memory-ingest).
// Wraps the user's own `gbrain` CLI; without it every command but detect/uninstall is BLOCKED with an install hint.
// Anything that writes to gbrain or a git remote asks first (policy.mjs EXTERNAL_MIS): the engine, its MCP server or the
// artifacts remote can be outside this machine, and company policy may forbid uploading repository content.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fail, bool, rootOf, readJson, writeJson, which, slug } from './cli-util.mjs';
import { homeDir } from './home.mjs';

const INSTALL = 'Install gbrain first (it is not bundled): git clone https://github.com/garrytan/gbrain.git && cd gbrain && bun install && bun link; then mis gbrain init.';
const cfgFile = () => join(homeDir(), 'gbrain.json');
const brainDir = () => join(homeDir(), 'brain');
const cfg = () => ({ policy: {}, queue: [], artifactsRemote: null, ...readJson(cfgFile(), {}) });
const save = (c) => { mkdirSync(homeDir(), { recursive: true }); writeJson(cfgFile(), c); return c; };
const gb = (args, opts = {}) => spawnSync('gbrain', args, { encoding: 'utf8', timeout: 10 * 60000, ...opts });
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
function need() { if (!which('gbrain')) fail(`BLOCKED: gbrain CLI is not on PATH. ${INSTALL}`); }
function run(args) { const r = gb(args); if (r.status !== 0) fail(`gbrain ${args[0]} failed: ${(r.stderr || r.stdout || r.error?.message || '').trim().slice(-500)}`); return r.stdout.trim(); }

const remoteOf = (cwd) => git(rootOf(cwd), 'remote', 'get-url', 'origin').stdout?.trim() || null;
/** Trust for this repository's remote: full (code and artifacts), artifacts-only, or deny (default: artifacts-only). */
const trustOf = (cwd) => cfg().policy[remoteOf(cwd) ?? 'local'] ?? 'artifacts-only';
/** Artifacts (path relative to its repository): Make It Ship files, docs and prose. Anything else counts as source code. */
export const isArtifact = (rel) => /^(\.make-it-ship|docs)(\/|$)/.test(rel) || /\.(md|markdown|mdx|txt)$/i.test(rel);
/** Why a file or directory may not go to gbrain under the trust of ITS repository's remote (null = it may). */
function trustRefusal(path) {
  const p = existsSync(path) ? realpathSync(path) : path; // git reports the real path of the repository
  const dir = existsSync(p) && statSync(p).isDirectory() ? p : dirname(p);
  const top = git(dir, 'rev-parse', '--show-toplevel'), root = top.status === 0 ? top.stdout.trim() : null;
  const remote = root ? git(root, 'remote', 'get-url', 'origin').stdout?.trim() || null : null;
  if (!root) return `${p} is not in a git repository; only files of a repository go to gbrain`;
  const trust = cfg().policy[remote ?? 'local'] ?? 'artifacts-only';
  if (trust === 'deny') return `the remote ${remote ?? 'local'} is set to deny (mis gbrain policy)`;
  const rel = relative(root, p) || '.';
  if (trust === 'artifacts-only' && (rel.startsWith('..') || isAbsolute(rel) || !isArtifact(rel))) {
    return `${rel} is not an artifact (docs/, .make-it-ship/ or .md/.txt files) and the remote ${remote ?? 'local'} is artifacts-only (mis gbrain policy set ${remote ?? 'local'} full allows source)`;
  }
  return null;
}

function ensureBrain() {
  const d = brainDir();
  if (!existsSync(join(d, '.git'))) { mkdirSync(d, { recursive: true }); git(d, 'init', '-q'); }
  return d;
}
function commitBrain(msg) {
  const d = brainDir();
  git(d, 'add', '-A');
  const changed = git(d, 'status', '--porcelain').stdout.trim().length > 0;
  if (changed) git(d, '-c', 'user.name=make-it-ship', '-c', 'user.email=make-it-ship@localhost', 'commit', '-qm', msg);
  const c = cfg();
  const pushed = c.artifactsRemote ? git(d, 'push', '-q', 'origin', 'HEAD:refs/heads/main').status === 0 : null;
  return { committed: changed, pushed };
}

/** Files ingest would hand to gbrain: wiki pages, reports, research reports (artifacts only, whatever the trust). */
export function ingestCandidates(root) {
  const out = [];
  const md = (d) => (existsSync(d) ? readdirSync(d, { recursive: true }).filter((f) => String(f).endsWith('.md')).map((f) => join(d, String(f))) : []);
  out.push(...md(join(root, '.make-it-ship', 'wiki')), ...md(join(root, 'docs', 'make-it-ship')));
  out.push(...md(join(root, '.make-it-ship', 'research')).filter((f) => basename(f) === 'report.md'));
  return out;
}

function gbrain([sub, ...argv], cwd) {
  const args = [...argv];
  if (sub === 'detect' || sub === undefined) {
    const on = which('gbrain');
    const v = on ? gb(['--version'], { timeout: 15000 }) : null;
    const c = cfg();
    // read-only: gbrain doctor may connect to a remote engine (Supabase/Postgres), so detect never runs it
    return { gbrainOnPath: !!on, version: v?.stdout.trim() || null, configExists: existsSync(join(process.env.HOME || homedir(), '.gbrain', 'config.json')),
      doctorOk: null, doctor: 'not run (it may connect to a remote engine); run gbrain doctor yourself to check the engine', brainRepo: existsSync(join(brainDir(), '.git')) ? brainDir() : null, artifactsRemote: c.artifactsRemote,
      queue: c.queue.length, trust: trustOf(cwd), ...(on ? {} : { blocked: `gbrain is not installed. ${INSTALL}` }) };
  }
  if (sub === 'uninstall') {
    const purge = bool(args, '--purge');
    rmSync(cfgFile(), { force: true });
    if (purge) rmSync(brainDir(), { recursive: true, force: true });
    return { removed: [cfgFile(), ...(purge ? [brainDir()] : [])], note: purge ? 'gbrain itself and its database are untouched (remove them with gbrain\'s own tools).' : `Brain repo kept at ${brainDir()} (--purge removes it).` };
  }
  need();
  switch (sub) {
    case 'init': return { output: run(['init', '--pglite']), note: 'Local PGLite brain. Remote engines (Postgres/Supabase) are set up with gbrain itself.' };
    case 'import': { const d = resolve(cwd, args[0] ?? '.'), no = trustRefusal(d); if (no) fail(`${no}; nothing was imported`); return { imported: d, output: run(['import', d]) }; }
    case 'query': { if (!args.length) fail('usage: mis gbrain query <question>'); return { output: run(['query', args.join(' ')]) }; }
    case 'policy': {
      const [op, remote, trust] = args, c = cfg();
      if (op === 'set') {
        if (!remote || !['full', 'artifacts-only', 'deny'].includes(trust)) fail('usage: mis gbrain policy set <remote-url|local> <full|artifacts-only|deny>');
        c.policy[remote] = trust; save(c); return { remote, trust };
      }
      return { policy: c.policy, thisRepo: { remote: remoteOf(cwd) ?? 'local', trust: trustOf(cwd) } };
    }
    case 'enqueue': {
      if (!args.length) fail('usage: mis gbrain enqueue <file...>');
      const c = cfg();
      for (const f of args) { const p = resolve(cwd, f); if (!existsSync(p)) fail(`no such file: ${f}`); const no = trustRefusal(p); if (no) fail(`${no}; nothing was queued`); if (!c.queue.includes(p)) c.queue.push(p); }
      save(c); return { queue: c.queue };
    }
    case 'artifacts-init': {
      const [url] = args;
      if (!url) fail('usage: mis gbrain artifacts-init <git remote url (private)>');
      const d = ensureBrain();
      git(d, 'remote', 'remove', 'origin');
      if (git(d, 'remote', 'add', 'origin', url).status !== 0) fail('git remote add failed');
      const c = cfg(); c.artifactsRemote = url; save(c);
      return { brainRepo: d, artifactsRemote: url };
    }
    case 'artifacts-url': return { artifactsRemote: cfg().artifactsRemote, brainRepo: brainDir() };
    case 'sync': {
      if (trustOf(cwd) === 'deny') fail(`this repository's remote is set to deny (mis gbrain policy); nothing was synced`);
      const c = cfg(), d = ensureBrain(), copied = [], refused = [];
      for (const q of c.queue) {
        const p = typeof q === 'string' ? q : q?.path;
        if (!p || !existsSync(p)) continue;
        const no = trustRefusal(p); // the trust may have changed since enqueue, and old queues were never checked
        if (no) { refused.push({ file: p, why: no }); continue; }
        const dest = join(d, 'queue', slug(remoteOf(cwd) ?? 'local'), basename(p)); mkdirSync(join(dest, '..'), { recursive: true }); cpSync(p, dest); copied.push(dest);
      }
      c.queue = []; save(c);
      const g = commitBrain(`sync ${copied.length} file(s)`);
      return { copied: copied.length, ...(refused.length ? { refused } : {}), ...g, output: run(['import', d]) };
    }
    case 'ingest': {
      const root = rootOf(cwd), probe = bool(args, '--probe'), files = ingestCandidates(root);
      if (probe) return { probe: true, wouldIngest: files.map((f) => relative(root, f)), trust: trustOf(cwd), note: 'Nothing was written.' };
      if (trustOf(cwd) === 'deny') fail(`this repository's remote is set to deny (mis gbrain policy); nothing was ingested`);
      const d = ensureBrain(), dest = join(d, 'ingest', slug(remoteOf(cwd) ?? basename(root)));
      for (const f of files) { const t = join(dest, relative(root, f)); mkdirSync(join(t, '..'), { recursive: true }); cpSync(f, t); }
      const g = commitBrain(`ingest ${files.length} file(s) from ${basename(root)}`);
      return { ingested: files.length, ...g, output: run(['import', d]) };
    }
    case 'restore': {
      const [url] = args;
      if (!url) fail('usage: mis gbrain restore <git remote url>');
      if (existsSync(brainDir()) && readdirSync(brainDir()).length) fail(`${brainDir()} is not empty; move it away first`);
      if (git(homeDir(), 'clone', '-q', url, brainDir()).status !== 0) fail('git clone failed');
      const c = cfg(); c.artifactsRemote = url; save(c);
      return { restored: brainDir(), output: run(['import', brainDir()]) };
    }
    default: return fail('usage: mis gbrain detect | init | import [dir] | query <q> | policy [set <remote> <trust>] | enqueue <file...> | sync | ingest [--probe] | artifacts-init <url> | artifacts-url | restore <url> | uninstall [--purge]');
  }
}

export const gbrainCommands = { gbrain };
