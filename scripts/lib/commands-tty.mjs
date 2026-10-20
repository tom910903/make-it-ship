// mis tty (M9-C C2, absorbs OMC qa-tester's tmux driving; own implementation): run an interactive program in a tmux
// session, send input, wait for output, and save the successful steps as a replay check script under qa/.
// Steps are recorded in <MIS_STATE_HOME or ~/.make-it-ship>/tty/<name>.json.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmux, requireTmux, attachHint } from './commands-team.mjs';
import { readHome, writeHome } from './home.mjs';
import { repoRoot } from './tree-hash.mjs';

const fail = (msg) => { throw new Error(msg); };
const USAGE = 'usage: mis tty start <name> [--cwd <dir>] -- <command...> | send <name> <text> [--no-enter] | keys <name> <key...> | expect <name> <regex> [--timeout ms] | capture <name> | save <name> qa/<file>.sh | stop <name>';
const DEFAULT_TIMEOUT = 15_000;
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const session = (name) => `mis-tty-${name}`;
// shortcut: tty state is per user, not per repo, so one name used in two repos at once collides; key it by repo if that happens.
const stateFile = (name) => `tty/${name}.json`;

function load(name) {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name ?? '')) fail('tty name must be kebab-case');
  const st = readHome(stateFile(name));
  if (!st) fail(`no tty session "${name}" (start it with mis tty start ${name} -- <command>)`);
  return st;
}
const save = (name, st) => writeHome(stateFile(name), st);

/** Full pane history, wrapped lines joined, trailing spaces kept (prompts end in one), trailing blank rows dropped. */
function capture(name) {
  const r = tmux('capture-pane', '-p', '-J', '-N', '-S', '-', '-t', session(name));
  if (r.status !== 0) fail(`tmux capture-pane failed: ${r.stderr.trim()}`);
  return r.stdout.replace(/\n+$/, '');
}

function start(args, cwd) {
  const name = args[0], dd = args.indexOf('--');
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name ?? '')) fail('tty name must be kebab-case');
  if (dd < 0 || dd === args.length - 1) fail(USAGE);
  const ci = args.indexOf('--cwd');
  const dir = resolve(cwd, ci >= 0 && ci < dd ? args[ci + 1] : '.');
  const argv = args.slice(dd + 1);
  requireTmux('test the program without an interactive session');
  const s = session(name);
  tmux('kill-session', '-t', s);
  // Keep the pane after the program exits, so its last output can still be captured and asserted.
  for (const c of [['new-session', '-d', '-s', s, '-x', '200', '-y', '50', '-c', dir, 'sleep 86400'], ['set-window-option', '-t', s, 'remain-on-exit', 'on'], ['respawn-pane', '-k', '-t', s, '-c', dir, argv.map(sq).join(' ')]]) {
    const r = tmux(...c);
    if (r.status !== 0) { tmux('kill-session', '-t', s); fail(`tmux ${c[0]} failed: ${r.stderr.trim()}`); }
  }
  save(name, { session: s, cwd: dir, argv, mark: 0, steps: [] });
  return { name, session: s, cwd: dir, attach: attachHint(s) };
}

function send(args, enter = true) {
  const [name, ...rest] = args;
  const st = load(name);
  const noEnter = rest.includes('--no-enter');
  const text = rest.filter((a) => a !== '--no-enter').join(' ');
  st.mark = capture(name).length; // later expects only look at output after this input
  if (tmux('send-keys', '-t', st.session, '-l', text).status !== 0) fail('tmux send-keys failed');
  if (enter && !noEnter) tmux('send-keys', '-t', st.session, 'Enter');
  st.steps.push({ send: text, enter: enter && !noEnter });
  save(name, st);
  return { sent: text };
}

function keys([name, ...ks]) {
  const st = load(name);
  if (!ks.length) fail(USAGE);
  st.mark = capture(name).length;
  if (tmux('send-keys', '-t', st.session, ...ks).status !== 0) fail('tmux send-keys failed');
  st.steps.push({ keys: ks });
  save(name, st);
  return { keys: ks };
}

async function expect(args) {
  const [name, pattern] = args;
  const st = load(name);
  if (pattern === undefined) fail(USAGE);
  const ti = args.indexOf('--timeout');
  const timeout = ti >= 0 ? Number(args[ti + 1]) : DEFAULT_TIMEOUT;
  if (!(timeout > 0)) fail('--timeout must be a positive number of milliseconds');
  const re = new RegExp(pattern, 'm');
  const until = Date.now() + timeout;
  let out = '';
  for (;;) {
    out = capture(name).slice(st.mark);
    const m = out.match(re);
    if (m) {
      st.steps.push({ expect: pattern, timeout });
      save(name, st);
      return { match: m[0] };
    }
    if (Date.now() > until) break;
    await sleep(100);
  }
  return fail(`/${pattern}/ did not appear within ${timeout} ms. Pane output since the last input:\n${out.split('\n').slice(-20).join('\n')}`);
}

function saveScript([name, file], cwd) {
  const st = load(name);
  if (!file) fail(USAGE);
  let root; try { root = repoRoot(cwd); } catch { root = cwd; }
  const path = resolve(cwd, file);
  if (!path.startsWith(join(root, 'qa') + sep) || !path.endsWith('.sh')) fail('the replay script must be a .sh file under qa/ in the repository');
  const startCmd = `mis tty start ${name}${st.cwd === root ? '' : ` --cwd ${sq(st.cwd)}`} -- ${st.argv.map(sq).join(' ')}`;
  const lines = st.steps.map((s) =>
    s.expect !== undefined ? `mis tty expect ${name} ${sq(s.expect)} --timeout ${s.timeout}`
      : s.keys ? `mis tty keys ${name} ${s.keys.map(sq).join(' ')}`
        : `mis tty send ${name} ${sq(s.send)}${s.enter ? '' : ' --no-enter'}`);
  const script = ['#!/bin/sh',
    `# Replays an interactive session recorded with \`mis tty\` and fails if the expected output does not appear.`,
    '# Run it through `mis check` (which sets MIS_CLI). Needs tmux.',
    'set -e',
    'mis() { node "${MIS_CLI:?MIS_CLI is not set; run this through mis check}" "$@"; }',
    `trap 'mis tty stop ${name} >/dev/null 2>&1 || true' EXIT`,
    startCmd, ...lines, ''].join('\n');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return { path, steps: st.steps.length };
}

function stop([name]) {
  const st = load(name);
  const killed = tmux('kill-session', '-t', st.session).status === 0;
  return { name, killed };
}

async function tty([sub, ...args], cwd) {
  if (sub === 'start') return start(args, cwd);
  if (sub === 'send') return send(args);
  if (sub === 'keys') return keys(args);
  if (sub === 'expect') return expect(args);
  if (sub === 'capture') { load(args[0]); return { text: capture(args[0]) }; }
  if (sub === 'save') return saveScript(args, cwd);
  if (sub === 'stop') return stop(args);
  return fail(USAGE);
}

export const ttyCommands = { tty };
