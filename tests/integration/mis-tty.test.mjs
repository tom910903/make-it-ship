// mis tty drives an interactive program in tmux (private socket, fixture REPL) and saves a replay check script.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { makeRepo, mis, MIS, ROOT } from '../helpers.mjs';

const HAS_TMUX = spawnSync('sh', ['-c', 'command -v tmux']).status === 0;
const SOCKET = `mis-tty-test-${process.pid}`;
const REPL = join(ROOT, 'tests', 'fixtures', 'fake-repl.mjs');
const home = mkdtempSync(join(tmpdir(), 'mis-home-'));
const env = { MIS_TMUX_SOCKET: SOCKET, MIS_STATE_HOME: home, TMUX: '' };
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };
const tmux = (...a) => spawnSync('tmux', ['-L', SOCKET, ...a], { encoding: 'utf8' });
after(() => { if (HAS_TMUX) tmux('kill-server'); rmSync(join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${process.getuid()}`, SOCKET), { force: true }); });

test('tty start without tmux reports BLOCKED and records nothing', () => {
  const dir = makeRepo();
  const bin = mkdtempSync(join(tmpdir(), 'mis-notmux-'));
  symlinkSync(spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim(), join(bin, 'git'));
  const r = mis(dir, ['tty', 'start', 'calc', '--', process.execPath, REPL], { env: { ...env, PATH: bin } });
  assert.equal(r.code, 1);
  assert.match(r.err, /BLOCKED: tmux is not installed/);
  assert.ok(!existsSync(join(home, 'tty', 'calc.json')));
});

test('tty argument validation', () => {
  const dir = makeRepo();
  assert.match(mis(dir, ['tty', 'start', 'Bad Name', '--', 'x'], { env }).err, /kebab-case/);
  assert.match(mis(dir, ['tty', 'start', 'calc'], { env }).err, /usage/);
  assert.match(mis(dir, ['tty', 'send', 'nope', 'x'], { env }).err, /no tty session "nope"/);
});

if (!HAS_TMUX) {
  test('tty is BLOCKED on this machine (no tmux)', () => {
    assert.match(mis(makeRepo(), ['tty', 'start', 'calc', '--', process.execPath, REPL], { env }).err, /BLOCKED: tmux is not installed/);
  });
} else {
  test('real tmux: drive the fixture REPL, save a replay script under qa/, the replay passes and a wrong expectation fails', () => {
    const dir = makeRepo();
    const s = ok(mis(dir, ['tty', 'start', 'calc', '--', process.execPath, REPL], { env }));
    assert.match(s.attach, new RegExp(`tmux -L ${SOCKET} attach -t mis-tty-calc`));
    ok(mis(dir, ['tty', 'expect', 'calc', 'calc> ', '--timeout', '30000'], { env }));
    ok(mis(dir, ['tty', 'send', 'calc', '2+3'], { env }));
    assert.match(ok(mis(dir, ['tty', 'expect', 'calc', '^5$', '--timeout', '30000'], { env })).match, /^5$/);
    ok(mis(dir, ['tty', 'send', 'calc', 'oops'], { env }));
    ok(mis(dir, ['tty', 'expect', 'calc', 'error: cannot parse', '--timeout', '30000'], { env }));
    // output from before the last send does not satisfy a later expect
    const miss = mis(dir, ['tty', 'expect', 'calc', '^5$', '--timeout', '300'], { env });
    assert.equal(miss.code, 1);
    assert.match(miss.err, /did not appear.*error: cannot parse/s, 'reports the pane tail');
    assert.match(ok(mis(dir, ['tty', 'capture', 'calc'], { env })).text, /calc> 2\+3\n5\n/);
    assert.match(mis(dir, ['tty', 'save', 'calc', '../escape.sh'], { env }).err, /under qa\//);
    const saved = ok(mis(dir, ['tty', 'save', 'calc', 'qa/calc-repl.sh'], { env }));
    const script = join(dir, 'qa', 'calc-repl.sh');
    assert.equal(saved.path, script);
    assert.ok(statSync(script).mode & 0o100, 'executable');
    const text = readFileSync(script, 'utf8');
    assert.ok(text.includes("'^5$' --timeout 30000"), text);
    assert.match(text, /MIS_CLI/);
    assert.match(text, /tty expect calc '\^5\$'/);
    assert.doesNotMatch(text, /--timeout 300\b/, 'failed expectations are not recorded');
    ok(mis(dir, ['tty', 'stop', 'calc'], { env }));
    assert.notEqual(tmux('has-session', '-t', 'mis-tty-calc').status, 0);

    const run = (file) => spawnSync('sh', [file], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env, MIS_CLI: MIS, PATH: `${dirname(process.execPath)}:${process.env.PATH}` } });
    const pass = run(script);
    assert.equal(pass.status, 0, pass.stderr + pass.stdout);
    assert.notEqual(tmux('has-session', '-t', 'mis-tty-calc').status, 0, 'the script stops its session');
    writeFileSync(join(dir, 'qa', 'wrong.sh'), text.replace("'^5$' --timeout 30000", () => "'^6$' --timeout 1000"));
    assert.notEqual(run(join(dir, 'qa', 'wrong.sh')).status, 0);
  });
}
