// M9-A global install (absorbs OMC omc-setup/install/setup, gstack settings-hook, Ponytail's status-line hint):
// plan changes to files outside the repository (~/.claude/settings.json, ~/.claude/CLAUDE.md, ~/.make-it-ship/config.json),
// show them as a diff, and write only when asked (the guard asks before `mis setup --write`). Never auto-applied.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeDir, homeDir, readHome, writeHome } from './home.mjs';

export const PLUGIN_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
export const statusLineCommand = (root = PLUGIN_ROOT) => `node "${join(root, 'scripts', 'statusline.mjs')}"`;
/** A statusLine command that runs this install's statusline.mjs (any checkout name) or some Make It Ship install's (possibly an old version's path). */
export const isOurStatusLine = (cmd) => typeof cmd === 'string' && (cmd === statusLineCommand() || /make-it-ship[^"]*\/scripts\/statusline\.mjs/.test(cmd));

const START = '<!-- MIS:START -->', END = '<!-- MIS:END -->';
// The CLI path is absolute: Claude Code substitutes CLAUDE_PLUGIN_ROOT only in plugin content (skills, hooks, MCP config),
// not in the user's own CLAUDE.md (M9 r1 D12; same as the statusLine command).
export const misBlock = (root = PLUGIN_ROOT) => `${START}
# Make It Ship

Make It Ship is the one installed workflow plugin (it replaces oh-my-claudecode, Superpowers, Ponytail and gstack).
- Skills: \`/make-it-ship:<name>\` (run, status, loop, style, review, qa, ship, team, session, browse, setup, cancel, ...). When one applies, invoke it before answering.
- CLI: \`node "${join(root, 'scripts', 'mis.mjs')}" <command>\` (the installed plugin's path; \`mis setup\` updates it after an upgrade). Only \`mis check\` records evidence and only \`mis verdict\` decides done.
- Tools: MCP server \`mcp__plugin_make-it-ship_mis__*\` (notepad, project memory, state, wiki, LSP, ast-grep, python_repl, trace).
- Keywords: ralph:, ulw, ralplan, deep interview, tdd, code review, security review, deslop, cancelomc (\`mis test-prompt "<text>"\` shows what a prompt triggers).
- Memory: \`<remember>...</remember>\` (7 days), \`<remember priority>...</remember>\` (permanent).
- Diagnose with \`mis doctor\`; change this setup with \`mis setup\`.
${END}`;
export const MIS_BLOCK = misBlock();

// Both forms occur in real files: OMC writes `<!--`, some editors escaped it to `<\!--`.
/** {marketplace, name, version} when root is a version folder in Claude Code's plugin cache (a marketplace install), else null. */
export function cacheInstall(root = PLUGIN_ROOT) {
  const rel = relative(join(claudeDir(), 'plugins', 'cache'), root).split(sep);
  return rel.length === 3 && !rel[0].startsWith('..') ? { marketplace: rel[0], name: rel[1], version: rel[2] } : null;
}

const OMC_BLOCK = /<\\?!-- OMC:START -->[\s\S]*?<\\?!-- OMC:END -->[^\S\n]*\n?/g;
export const MIS_RE = /<!-- MIS:START -->[\s\S]*?<!-- MIS:END -->/;
/** References to the removed plugins (shown for manual review, never rewritten). */
const REMOVED = /oh-my-claudecode|\/omc-|superpowers:|\bponytail\b|\bgstack\b/i;

/** CLAUDE.md with the OMC blocks removed and exactly one Make It Ship block (in place if present, else on top). */
export function migrateClaudeMd(text, root = PLUGIN_ROOT) {
  const had = MIS_RE.test(text);
  let t = text.replace(OMC_BLOCK, '');
  if (had) return t.replace(MIS_RE, misBlock(root));
  t = t.replace(/^\s+/, '');
  return `${misBlock(root)}\n${t ? `\n${t}` : ''}`;
}

const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const readJsonFile = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

function readSettings(p) {
  const text = readText(p);
  if (text === null) return { text: null, json: {} };
  try { return { text, json: JSON.parse(text) }; } catch { throw new Error(`${p} is not valid JSON; fix it by hand first (nothing was changed)`); }
}

/** Unified diff of two texts (git diff --no-index), labeled with the real path. */
export function diffText(file, before, after) {
  const d = mkdtempSync(join(tmpdir(), 'mis-diff-'));
  try {
    writeFileSync(join(d, 'a'), before ?? ''); writeFileSync(join(d, 'b'), after);
    const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--', join(d, 'a'), join(d, 'b')], { encoding: 'utf8' });
    return r.stdout.split('\n').map((l) => l.startsWith('--- ') ? `--- ${before === null ? '/dev/null' : file}` : l.startsWith('+++ ') ? `+++ ${file}` : l)
      .filter((l) => !/^diff --git |^index |^new file mode /.test(l)).join('\n');
  } finally { rmSync(d, { recursive: true, force: true }); }
}

function rulesReview() {
  const out = [];
  const walk = (d) => {
    let names = []; try { names = readdirSync(d); } catch { return; }
    for (const n of names.sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.md')) readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (REMOVED.test(l)) out.push({ file: p, line: i + 1, text: l.trim() }); });
    }
  };
  walk(join(claudeDir(), 'rules'));
  return out;
}

/** Planned edits: [{file, before, after, diff}] plus lines to review by hand. Reads only. */
export function planSetup({ root = PLUGIN_ROOT } = {}) {
  const changes = [];
  const sp = join(claudeDir(), 'settings.json');
  const { text: sText, json } = readSettings(sp);
  let next = json;
  const want = { type: 'command', command: statusLineCommand(root) };
  const cur = json.statusLine;
  if (cur?.command !== want.command) next = { ...next, statusLine: cur && typeof cur === 'object' ? { ...cur, ...want } : want };
  // A marketplace install turns on Claude Code's auto-update for its marketplace (off by default for a GitHub marketplace);
  // session start then moves the paths above to each new version folder (update.mjs followUpgrade).
  const m = cacheInstall(root), mk = m && json.extraKnownMarketplaces?.[m.marketplace];
  const source = mk?.source ?? (m && readJsonFile(join(claudeDir(), 'plugins', 'known_marketplaces.json'))?.[m.marketplace]?.source);
  if (source && mk?.autoUpdate !== true) next = { ...next, extraKnownMarketplaces: { ...json.extraKnownMarketplaces, [m.marketplace]: { ...mk, source, autoUpdate: true } } };
  if (next !== json) changes.push({ file: sp, before: sText, after: JSON.stringify(next, null, 2) + '\n' });
  if (cur?.command !== want.command) {
    // A status line the user already had keeps running after ours (statusline.mjs statusLine.chain).
    if (cur?.command && !isOurStatusLine(cur.command)) {
      const cp = join(homeDir(), 'config.json');
      const c = readHome('config.json', {}) ?? {};
      if (c.statusLine?.chain !== cur.command) changes.push({ file: cp, before: readText(cp), after: JSON.stringify({ ...c, statusLine: { ...c.statusLine, chain: cur.command } }, null, 2) + '\n' });
    }
  }
  const mp = join(claudeDir(), 'CLAUDE.md');
  const mBefore = readText(mp);
  const mAfter = migrateClaudeMd(mBefore ?? '', root);
  if (mAfter !== mBefore) changes.push({ file: mp, before: mBefore, after: mAfter });
  for (const c of changes) c.diff = diffText(c.file, c.before, c.after);
  // References left in CLAUDE.md (outside our block) and in rules files: listed for the user, never rewritten.
  const review = [];
  let inBlock = false;
  mAfter.split('\n').forEach((l, i) => {
    if (l === START) inBlock = true;
    else if (l === END) inBlock = false;
    else if (!inBlock && REMOVED.test(l)) review.push({ file: mp, line: i + 1, text: l.trim() });
  });
  review.push(...rulesReview());
  return { changes, review };
}

/** Write planned changes atomically, each existing file backed up first. */
export function applyChanges(changes, stamp = new Date().toISOString().replace(/[:.]/g, '-')) {
  const backups = [];
  for (const c of changes) {
    mkdirSync(dirname(c.file), { recursive: true });
    if (c.before !== null && c.after !== null) { const b = `${c.file}.mis-backup-${stamp}`; copyFileSync(c.file, b); backups.push(b); }
    if (c.after === null) { rmSync(c.file, { force: true }); continue; }
    const tmp = `${c.file}.${process.pid}.tmp`;
    writeFileSync(tmp, c.after); renameSync(tmp, c.file);
  }
  return backups;
}

const today = () => new Date().toISOString().slice(0, 10);

/** SessionStart hint (Ponytail ponytail-activate): no statusLine configured → one line, at most once a day. */
export function statusLineNotice() {
  let s; try { s = JSON.parse(readFileSync(join(claudeDir(), 'settings.json'), 'utf8')); } catch { s = {}; }
  if (s?.statusLine) return null;
  const n = readHome('notices.json', {}) ?? {};
  if (n.statusLine === today()) return null;
  writeHome('notices.json', { ...n, statusLine: today() });
  return 'The Make It Ship status line is not set. Tell the user once: `mis setup` shows the settings change (statusLine, CLAUDE.md block) and `mis setup --write` applies it after they approve.';
}

// ---- MCP servers (absorbs OMC mcp-setup). Commands are shown first and run only with --write (guard asks).
export const KNOWN_MCP = {
  context7: { about: 'up-to-date library docs', args: ['--', 'npx', '-y', '@upstash/context7-mcp'] },
  github: { about: 'GitHub issues, PRs, code search', env: ['GITHUB_PERSONAL_ACCESS_TOKEN'], args: ['--', 'npx', '-y', '@modelcontextprotocol/server-github'] },
  filesystem: { about: 'file access under one directory', args: ['--', 'npx', '-y', '@modelcontextprotocol/server-filesystem', '<dir>'] },
  exa: { about: 'web search', env: ['EXA_API_KEY'], args: ['--', 'npx', '-y', 'exa-mcp-server'] },
};

/** Registered MCP servers by scope: user (~/.claude.json or $CLAUDE_CONFIG_DIR/.claude.json), local (its projects entry), project (.mcp.json). */
export function mcpRegistrations(root) {
  const cj = process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(dirname(claudeDir()), '.claude.json');
  const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } };
  const user = read(cj);
  return { user: Object.keys(user.mcpServers ?? {}), local: Object.keys(user.projects?.[root]?.mcpServers ?? {}), project: root ? Object.keys(read(join(root, '.mcp.json')).mcpServers ?? {}) : [] };
}
