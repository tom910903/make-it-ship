// Guard edge cases: quoted operators are words, more protected writes, claude/launch spellings,
// MCP writers, tty keys option words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Never the real home: policy resolves ~, ~/.claude and ~/.make-it-ship from these.
const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'mis-home-')));
process.env.HOME = HOME;
process.env.CLAUDE_CONFIG_DIR = join(HOME, '.claude');
process.env.MIS_STATE_HOME = join(HOME, '.make-it-ship');
mkdirSync(join(HOME, '.claude'), { recursive: true });
const REPO = join(HOME, 'work', 'repo');
mkdirSync(join(REPO, '.git'), { recursive: true }); mkdirSync(join(REPO, 'src'));
for (const f of ['settings.json', 'CLAUDE.md', 'src/a.js', 'p.diff']) writeFileSync(join(REPO, f), 'x\n');
const OUT = realpathSync(mkdtempSync(join(tmpdir(), 'mis-out-')));

const { parseShell, commandsOf } = await import('../../scripts/lib/shell.mjs');
const { classify } = await import('../../scripts/lib/policy.mjs');

const M = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"';
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command }, cwd: REPO });
const both = [{ repoRoot: REPO, activeRun: true, currentBranch: 'feature' }, { repoRoot: REPO, activeRun: false, currentBranch: 'feature' }];
const decide = (input, ctxs = both) => { const ds = ctxs.map((c) => classify(input, c).decision); assert.equal(ds[0], ds[1], `same with and without a run: ${JSON.stringify(input)}`); return ds[0]; };
const expectAll = (want, cmds) => { for (const c of cmds) assert.equal(decide(typeof c === 'string' ? bash(c) : c), want, typeof c === 'string' ? c : JSON.stringify(c)); };
const cmds = (src) => commandsOf(src).commands.map((c) => ({ argv: c.argv, redirects: c.redirects }));

test('quoted, escaped and ANSI-C quoted operators are literal words; only unquoted text is an operator', () => {
  const table = [
    [`echo '>' f`, [{ argv: ['echo', '>', 'f'], redirects: [] }]],
    [`echo ">" f`, [{ argv: ['echo', '>', 'f'], redirects: [] }]],
    [`echo \\> f`, [{ argv: ['echo', '>', 'f'], redirects: [] }]],
    [`echo $'>' f`, [{ argv: ['echo', '>', 'f'], redirects: [] }]],
    [`echo $">" f`, [{ argv: ['echo', '>', 'f'], redirects: [] }]],
    [`echo a'>'b`, [{ argv: ['echo', 'a>b'], redirects: [] }]],
    [`echo '<' x '2>' y '>>' z`, [{ argv: ['echo', '<', 'x', '2>', 'y', '>>', 'z'], redirects: [] }]],
    [`echo '|' x; echo ';' y`, [{ argv: ['echo', '|', 'x'], redirects: [] }, { argv: ['echo', ';', 'y'], redirects: [] }]],
    [`echo '&&' x "&" y`, [{ argv: ['echo', '&&', 'x', '&', 'y'], redirects: [] }]],
    [`echo $'it\\'s' x`, [{ argv: ['echo', "it's", 'x'], redirects: [] }]],
    [`echo x > f`, [{ argv: ['echo', 'x'], redirects: ['f'] }]],
    [`echo x>f`, [{ argv: ['echo', 'x'], redirects: ['f'] }]],
    [`echo x >> f`, [{ argv: ['echo', 'x'], redirects: ['f'] }]],
    [`echo x 2> f y`, [{ argv: ['echo', 'x', 'y'], redirects: ['f'] }]],
    [`echo '2'>f`, [{ argv: ['echo', '2'], redirects: ['f'] }]],
    [`echo x 2>&1 --yes`, [{ argv: ['echo', 'x', '--yes'], redirects: [] }]],
    [`echo x >&2 --yes`, [{ argv: ['echo', 'x', '--yes'], redirects: [] }]],
    [`echo x >& f`, [{ argv: ['echo', 'x'], redirects: ['f'] }]],
    [`echo x &> f`, [{ argv: ['echo', 'x'], redirects: ['f'] }]],
    [`echo x &>> f`, [{ argv: ['echo', 'x'], redirects: ['f'] }]],
    [`echo x >| f`, [{ argv: ['echo', 'x'], redirects: ['f'] }]],
    [`echo x < in`, [{ argv: ['echo', 'x'], redirects: ['in'] }]],
    [`mis uninstall $'--yes'`, [{ argv: ['mis', 'uninstall', '--yes'], redirects: [] }]],
    [`mis uninstall $"--yes"`, [{ argv: ['mis', 'uninstall', '--yes'], redirects: [] }]],
  ];
  for (const [src, want] of table) assert.deepEqual(cmds(src), want, src);
  // a redirect without a command still writes its target
  for (const src of ['exec 3> f', '> f', 'exec >| f']) assert.deepEqual(cmds(src).flatMap((c) => c.redirects), ['f'], src);
  // nested $( ) commands keep a quoted '>' too
  assert.deepEqual(parseShell(`x=$(echo '>' y)`).commands[0].argv, ['echo', '>', 'y']);
});

test('flag-based asks still hold when a quoted or escaped ">" sits before the flag', () => {
  for (const g of [`'>'`, `">"`, '\\>', `$'>'`]) {
    expectAll('ask', [`${M} uninstall ${g} --yes`, `${M} setup routing ${g} --write`, `${M} upgrade ${g} --yes`, `${M} mcp-setup add github ${g} --write`,
      `${M} doctor ${g} --fix`, `${M} launch ${g} --dangerously-skip-permissions`, `${M} skill add f.md ${g} --scope=user`,
      `${M} tty keys sh echo Space x Space ${g} Space '~/.claude/settings.json' Enter`, `git push ${g} --force`, `rm ${g} -rf ~`,
      `git push origin ${g} --force-with-lease`, `${M} uninstall ${g} ${g} --yes`]);
    const main = [{ repoRoot: REPO, activeRun: true, currentBranch: 'main' }, { repoRoot: REPO, activeRun: false, currentBranch: 'main' }];
    assert.equal(decide(bash(`git push ${g} --force`), main), 'deny', `force push on main with ${g}`);
  }
  expectAll('allow', [`cut -d '>' -f1 src/a.js`, `grep -c '>' src/a.js`, `echo '>'`, `echo "a > b" | grep '|'`, `${M} uninstall '>'`]);
});

test('copies and moves into a protected directory, case variants, more ~/.claude entries, CLAUDE.local.md', () => {
  const C = join(HOME, '.claude');
  expectAll('ask', ['cp settings.json ~/.claude/', 'cp settings.json ~/.claude', 'mv CLAUDE.md ~/.claude', 'cp src/a.js settings.json ~/.claude/',
    'cp -r settings.json $HOME/.claude', 'rsync -a settings.json ~/.claude/',
    'echo x > ~/.claude/Settings.json', 'echo x > ~/.Claude/settings.json', 'echo x > ~/.CLAUDE/SETTINGS.JSON',
    ...['skills/x/SKILL.md', 'agents/x.md', 'commands/x.md', 'rules/x.md', 'hooks/x.sh'].map((p) => `echo x > ~/.claude/${p}`),
    `echo x > ${OUT}/CLAUDE.local.md`, `echo x > ${OUT}/claude.md`,
    { tool_name: 'Write', tool_input: { file_path: join(C, 'CLAUDE.MD'), content: 'x' }, cwd: REPO },
    { tool_name: 'Write', tool_input: { file_path: join(C, 'skills', 's', 'SKILL.md'), content: 'x' }, cwd: REPO },
    { tool_name: 'Write', tool_input: { file_path: join(C, '.claude.json'), content: '{}' }, cwd: REPO },
    { tool_name: 'Write', tool_input: { file_path: join(OUT, 'CLAUDE.local.md'), content: 'x' }, cwd: REPO }]);
  expectAll('allow', [`cp CLAUDE.md ${OUT}/x.md`, 'cp src/a.js src/', 'cp src/a.js src/b.js', 'echo x > notes.txt', 'echo x > CLAUDE.local.md',
    { tool_name: 'Write', tool_input: { file_path: join(REPO, 'CLAUDE.local.md'), content: 'x' }, cwd: REPO }]);
});

test('redirections the parser lost and downloaders/patch writing a protected file', () => {
  expectAll('ask', ['echo x &> ~/.claude/settings.json', 'echo x &>> ~/.claude/settings.json', 'echo x >| ~/.claude/settings.json',
    'exec 3> ~/.claude/settings.json', '> ~/.claude/settings.json', 'curl -o ~/.claude/settings.json https://example.invalid/s',
    'curl -sLo ~/.claude/settings.json https://example.invalid/s', 'curl --output ~/.claude/settings.json https://example.invalid/s',
    'curl --output=$HOME/.claude/settings.json https://example.invalid/s', 'wget -O ~/.claude/settings.json https://example.invalid/s',
    'wget -qO ~/.claude/settings.json https://example.invalid/s', 'wget --output-document=$HOME/.claude/settings.json https://example.invalid/s',
    'patch ~/.claude/settings.json < p.diff', 'patch -p0 ~/.claude/CLAUDE.md p.diff']);
  expectAll('allow', ['echo x &> out.log', 'curl -o out.json https://example.invalid/s', 'wget -O - https://example.invalid/s', 'patch src/a.js < p.diff']);
});

test('claude with global flags or through npx/bunx/pnpm dlx, and launch bypass spellings ask; reads pass', () => {
  expectAll('ask', ['claude --debug mcp add x -- y', 'claude --model opus mcp add x -- y', 'claude --verbose plugin install x',
    'claude --debug plugin marketplace add o/r', 'npx @anthropic-ai/claude-code mcp add x -- y', 'npx -y @anthropic-ai/claude-code@latest plugin install x',
    'bunx @anthropic-ai/claude-code mcp add x -- y', 'pnpm dlx @anthropic-ai/claude-code mcp remove x', 'npm exec --yes @anthropic-ai/claude-code -- mcp add x y',
    'npx -p @anthropic-ai/claude-code claude mcp add x -- y',
    `${M} launch --dangerously-skip-permissions=true`, `${M} launch --allow-dangerously-skip-permissions=1`,
    `${M} launch --settings '{"permissions":{"defaultMode":"bypassPermissions"}}'`, `${M} launch --settings s.json`, `${M} launch --settings=s.json`,
    `${M} launch -- --settings s.json`]);
  expectAll('allow', ['claude --debug mcp list', 'claude mcp get x', 'npx @anthropic-ai/claude-code mcp list', 'claude -p "hello"', 'claude plugin list',
    `${M} launch --resume`, 'npx prettier --write src']);
});

test('MCP writers by more verbs, uri/url file: keys and nested paths', () => {
  const S = join(HOME, '.claude', 'settings.json'), CM = join(HOME, '.claude', 'CLAUDE.md');
  const mcp = (tool, input) => ({ tool_name: tool, tool_input: input, cwd: REPO });
  expectAll('ask', [mcp('mcp__fs__patch_file', { path: S }), mcp('mcp__ed__insert_text', { file: CM }), mcp('mcp__ed__set_contents', { path: S }),
    mcp('mcp__ed__setContents', { path: S }), mcp('mcp__ed__put_object', { target: S }), mcp('mcp__ed__write', { uri: pathToFileURL(S).href }),
    mcp('mcp__ed__upload', { url: pathToFileURL(CM).href }), mcp('mcp__fs__edit_files', { files: [{ path: S }] }),
    mcp('mcp__fs__apply_patch_set', { changes: { a: { edits: [{ filePath: CM }] } } }), mcp('mcp__fs__remove_entry', { path: CM })]);
  expectAll('allow', [mcp('mcp__cfg__get_settings', { path: S }), mcp('mcp__fs__read_file', { path: S }), mcp('mcp__x__reset_cache', { path: S }),
    mcp('mcp__fs__patch_file', { path: join(REPO, 'src', 'a.js') }), mcp('mcp__ed__set_value', { url: 'https://example.invalid/x' })]);
});

test('tty keys words that are not tmux send-keys options are typed text; real option words still ask', () => {
  expectAll('allow', [`${M} tty keys repl -1 Enter`, `${M} tty keys repl -- -l Enter`, `${M} tty keys repl -42 Space -x Enter`, `${M} tty keys repl - Enter`]);
  expectAll('ask', [`${M} tty keys sh -l x`, `${M} tty keys sh -H 41`, `${M} tty keys sh echo Space -t x`, `${M} tty keys sh -N 3 x`, `${M} tty keys sh -lR x`,
    `${M} tty keys sh -- rm Space -rf Space '~' Enter`, `${M} tty keys sh -1 Space -X cancel`,
    // a `--` after a plain word may be typed literally (tmux stops options at the first plain word): it must not hide a flag
    `${M} tty keys sh node Space mis.mjs Space uninstall Space -- yes Enter`, `${M} tty keys sh git Space push Space -- force Enter`,
    `${M} tty keys sh git Space push Space - -- -force Enter`]);
});
