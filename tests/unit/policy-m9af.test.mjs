// M9 round-1 A/B/C/F verifier defects (D1, D2, D8, D9, D10, D13 trust) in the guard policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Never the real home: policy resolves ~, ~/.claude and ~/.make-it-ship from these.
const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'mis-home-')));
process.env.HOME = HOME;
process.env.CLAUDE_CONFIG_DIR = join(HOME, '.claude');
process.env.MIS_STATE_HOME = join(HOME, '.make-it-ship');
const REPO = join(HOME, 'work', 'repo');
mkdirSync(REPO, { recursive: true });

const { classify, NON_SENSITIVE_CONFIG } = await import('../../scripts/lib/policy.mjs');
const { CONFIG_KEYS } = await import('../../scripts/lib/commands-setup.mjs');

const M = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"';
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command }, cwd: REPO });
const both = [{ repoRoot: REPO, activeRun: true, currentBranch: 'feature' }, { repoRoot: REPO, activeRun: false, currentBranch: null }];
const decide = (input) => { const ds = both.map((c) => classify(input, c).decision); assert.equal(ds[0], ds[1], `same with and without a run: ${JSON.stringify(input)}`); return ds[0]; };
const expectAll = (want, cmds) => { for (const c of cmds) assert.equal(decide(typeof c === 'string' ? bash(c) : c), want, typeof c === 'string' ? c : JSON.stringify(c)); };

test('D1: mis config set of a key that runs a command or contacts a URL asks; other keys pass; the guard list matches the schema', () => {
  expectAll('ask', [`${M} config set statusLine.chain "touch /tmp/x"`, `${M} config set update.source http://example.invalid/v`,
    `${M} config set telemetry.endpoint https://example.invalid`, `${M} config set $K x`, `${M} config set bogus.key 1`,
    `${M} telemetry endpoint https://example.invalid`, `mis config set statusLine.chain x`]);
  expectAll('allow', [`${M} config set style.default lite`, `${M} config set proactive false`, `${M} config set simplifier.enabled true`,
    `${M} config get statusLine.chain`, `${M} config get`, `${M} telemetry endpoint`.replace('endpoint', 'status')]);
  const schemaSafe = Object.entries(CONFIG_KEYS).filter(([, s]) => !s.sensitive).map(([k]) => k).sort();
  assert.deepEqual([...NON_SENSITIVE_CONFIG].sort(), schemaSafe, 'guard allow-list = non-sensitive keys of the config schema');
  for (const k of ['statusLine.chain', 'update.source', 'telemetry.endpoint']) assert.equal(CONFIG_KEYS[k].sensitive, true, k);
  for (const [k, s] of Object.entries(CONFIG_KEYS)) assert.ok(typeof s.doc === 'string' && s.doc.length > 10 && typeof s.check === 'function', `${k} has a doc and a check`);
});

test('D1: user-scope skills, repository trust, and direct claude mcp/plugin changes ask; reads and validate pass', () => {
  expectAll('ask', [`${M} skill add s.md --scope user`, `${M} skill edit x s.md --scope user`, `${M} skill add - --scope=user`, `${M} skill trust`,
    'claude mcp add x -- npx y', 'claude mcp add --scope user x -- npx y', 'claude mcp add-json x {}', 'claude mcp remove x',
    'claude plugin install make-it-ship@m', 'claude plugin uninstall make-it-ship', 'claude plugin update x', 'claude plugin enable x', 'claude plugin disable x',
    'claude plugin marketplace add o/r', 'claude plugin marketplace remove m', 'claude plugin marketplace update', 'cd /tmp && claude mcp add x -- y']);
  expectAll('allow', [`${M} skill add s.md`, `${M} skill add s.md --scope project`, `${M} skill list`, `${M} skill trust --remove`, `${M} skill remove x --scope user`,
    'claude plugin validate .', 'claude plugin list', 'claude plugin marketplace list', 'claude mcp list', 'claude mcp get x', 'claude --version', 'claude -p "hi"']);
});

test('D2: mis tty keys is classified like the text it types; tmux options in keys ask; plain key names pass', () => {
  expectAll('ask', [`${M} tty keys sh 'rm -rf ~' Enter`, `${M} tty keys sh 'rm -rf ~'`, `${M} tty keys sh r 'm -rf ~' C-m`, `${M} tty keys sh rm Space -rf Space '~' Enter`,
    `${M} tty keys sh 'node /x/mis.mjs uninstall --yes' Enter`, `${M} tty keys sh 'git reset --hard' Enter`,
    `${M} tty keys sh -H 72 6d`, `${M} tty keys sh -t other 'ls' Enter`, `${M} tty keys sh -l x`]);
  expectAll('allow', [`${M} tty keys sh Enter`, `${M} tty keys sh C-c`, `${M} tty keys sh Up Up Enter`, `${M} tty keys sh 'ls -la' Enter`, `${M} tty keys sh q`, `${M} tty keys sh Escape :wq Enter`]);
  assert.equal(decide(bash(`${M} tty keys sh 'git push --force origin main' Enter`)), 'deny', 'a denied command typed by keys is denied');
});

test('D8: writes to Claude Code settings, global or foreign CLAUDE.md and Make It Ship user config ask (tools, MCP, shell)', () => {
  const C = join(HOME, '.claude');
  const targets = [join(C, 'settings.json'), join(C, 'settings.local.json'), join(C, 'CLAUDE.md'), join(HOME, '.claude.json'),
    join(REPO, '.claude', 'settings.json'), join(REPO, '.claude', 'settings.local.json'), join(HOME, 'other', '.claude', 'settings.json'),
    join(HOME, 'other', 'CLAUDE.md'), join(HOME, '.make-it-ship', 'config.json'), join(HOME, '.make-it-ship', 'skills', 'x', 'SKILL.md')];
  for (const p of targets) {
    for (const tool of ['Write', 'Edit', 'MultiEdit']) assert.equal(decide({ tool_name: tool, tool_input: { file_path: p }, cwd: REPO }), 'ask', `${tool} ${p}`);
    assert.equal(decide({ tool_name: 'mcp__filesystem__write_file', tool_input: { path: p, content: '{}' }, cwd: REPO }), 'ask', `mcp ${p}`);
  }
  expectAll('ask', ["echo '{}' > ~/.claude/settings.json", 'echo x >> ~/.claude/CLAUDE.md', 'echo x > $HOME/.claude.json', 'echo x > "${HOME}/.claude/settings.json"',
    "sed -i '' s/a/b/ ~/.claude/CLAUDE.md", 'sed -i s/a/b/ .claude/settings.json', 'cp /tmp/s.json ~/.claude/settings.json', 'mv /tmp/s.json .claude/settings.local.json',
    'mv ~/.claude/settings.json /tmp/old', 'echo x | tee ~/.claude/settings.json', 'echo x | tee -a ../other/CLAUDE.md', 'cd ~/.claude && echo x > settings.json',
    'ln -sf /tmp/evil ~/.claude/settings.json', 'echo {} > ~/.make-it-ship/config.json', 'cp -t ~/.claude a.json settings.json', `dd if=/tmp/x of=${join(C, 'settings.json')}`,
    'rm ~/.claude/settings.json']);
  expectAll('allow', ['cat ~/.claude/settings.json', 'cp ~/.claude/settings.json /tmp/backup.json', 'echo x > CLAUDE.md', 'echo x > docs/CLAUDE.md', 'sed -n p ~/.claude/CLAUDE.md',
    'echo x > notes.txt', 'grep x .claude/settings.json']);
  expectAll('allow', [{ tool_name: 'Write', tool_input: { file_path: join(REPO, 'CLAUDE.md') }, cwd: REPO }, { tool_name: 'Edit', tool_input: { file_path: join(REPO, 'sub', 'CLAUDE.md') }, cwd: REPO },
    { tool_name: 'Write', tool_input: { file_path: join(REPO, '.claude', 'rules', 'a.md') }, cwd: REPO }, { tool_name: 'mcp__filesystem__read_file', tool_input: { path: join(C, 'settings.json') }, cwd: REPO }]);
});

test('D9: mis.mjs run by nodejs, bun, deno or through xargs is recognized', () => {
  expectAll('ask', ['nodejs /x/mis.mjs uninstall --yes', 'bun /x/mis.mjs uninstall --yes', 'bun run /x/mis.mjs setup --write', 'deno run -A /x/mis.mjs setup --write',
    'deno run --allow-all /x/mis.mjs uninstall --yes', "echo 'setup --write' | xargs node /x/mis.mjs", 'xargs -n 2 node /x/mis.mjs < args.txt', '/usr/local/bin/bun /x/mis.mjs doctor --fix']);
  expectAll('allow', ['bun /x/mis.mjs status', 'deno run -A /x/mis.mjs status', 'nodejs /x/mis.mjs status', 'bun test', 'deno test', 'ls | xargs wc -l']);
});

test('D10: mis launch without permission prompts asks; a plain launch passes', () => {
  expectAll('ask', [`${M} launch --dangerously-skip-permissions -p x`, `${M} launch --allow-dangerously-skip-permissions`,
    `${M} launch --permission-mode bypassPermissions`, `${M} launch --permission-mode=bypassPermissions`]);
  expectAll('allow', [`${M} launch`, `${M} launch --resume`, `${M} launch --permission-mode plan`]);
});
