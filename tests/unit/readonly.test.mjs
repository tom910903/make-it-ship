import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOnlyCommand, permissionDecision } from '../../scripts/lib/readonly.mjs';
import { classify } from '../../scripts/lib/policy.mjs';
import { ROOT } from '../helpers.mjs';

process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'mis-cc-')); // never read the real ~/.claude
const REPO = '/work/repo';
const req = (command, cwd = REPO) => permissionDecision({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command }, cwd });
const allowed = (c) => req(c)?.hookSpecificOutput?.decision?.behavior === 'allow';

test('F3: plain read-only commands are auto-allowed', () => {
  for (const c of ['ls', 'ls -la src', 'git status', 'git status --short', 'git log --oneline -5', 'git diff HEAD~1', 'git show HEAD:README.md',
    'git branch', 'git branch -a', 'git branch --show-current', 'cat README.md', 'head -n 5 a.txt', 'grep -rn foo src', 'rg foo', 'find . -name "*.js"', 'pwd', 'wc -l a b']) {
    assert.ok(allowed(c), c);
    assert.deepEqual(req(c), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  }
});

test('F3: metacharacters, heredocs, redirects, wrappers, assignments and writers get no decision', () => {
  for (const c of ['ls; rm -rf x', 'ls && rm x', 'git log | head', 'cat a > b', 'cat < a', 'cat <<EOF\nx\nEOF', 'echo $(rm x)', 'echo `rm x`', 'echo $HOME',
    'ls\nrm x', 'ls &', '(ls)', '{ ls; }', 'cat a\\ b',
    'GIT_PAGER=sh git log', 'env git status', 'sudo ls', 'xargs rm', 'timeout 5 ls', 'nice ls', 'sh -c ls', 'bash -c "ls"', 'eval ls',
    'git -c core.pager=sh log', 'git -C /x status', 'git diff --output=x', 'git log --ext-diff', 'git branch new', 'git branch -D x', 'git branch -m a b',
    'git push', 'git commit -m x', 'git checkout .', 'git reset --hard', 'git tag v1', 'git stash',
    'find . -delete', 'find . -exec rm {} +', 'find . -fprint out', 'rg --pre ./x foo', 'sed -i s/a/b/ f', "sed -n 'w out' f", 'sort -o x y', 'tree -o x',
    'date -s 2020', 'rm x', 'npm test', 'node x.js', '/bin/ls', './ls', 'cat .git/make-it-ship/runs/r/state.json', '', '   ']) {
    assert.equal(req(c), null, JSON.stringify(c));
  }
  assert.equal(permissionDecision({ tool_name: 'Write', tool_input: { file_path: 'a' }, cwd: REPO }), null, 'only Bash');
  assert.equal(permissionDecision({}), null);
});

test('F3: no command the guard asks about or denies is ever auto-allowed (every literal in the guard tests)', () => {
  const lits = new Set();
  for (const f of ['tests/unit/policy.test.mjs', 'tests/integration/guard.test.mjs']) {
    for (const m of readFileSync(join(ROOT, f), 'utf8').matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) lits.add((m[1] ?? m[2]).replace(/\\(.)/g, '$1'));
  }
  let guarded = 0;
  for (const c of lits) {
    const ctxs = [{ repoRoot: REPO, activeRun: true, currentBranch: 'main' }, { repoRoot: REPO, activeRun: true, currentBranch: 'feature' }, { repoRoot: REPO, activeRun: false, currentBranch: null }];
    if (ctxs.every((x) => classify({ tool_name: 'Bash', tool_input: { command: c }, cwd: REPO }, x).decision === 'allow')) continue;
    guarded++;
    assert.equal(req(c), null, `guard asks/denies, so no auto-allow: ${c}`);
  }
  assert.ok(guarded > 50, `corpus covers the guard tables (${guarded})`);
});

test('F3: a user permissions.ask rule keeps the prompt', () => {
  const proj = mkdtempSync(join(tmpdir(), 'mis-proj-'));
  assert.ok(allowed('git log -1'));
  mkdirSync(join(proj, '.claude'));
  writeFileSync(join(proj, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { ask: ['Bash(git log:*)'] } }));
  assert.equal(req('git log -1', proj), null);
  assert.ok(req('git status', proj), 'other commands still allowed');
  writeFileSync(join(process.env.CLAUDE_CONFIG_DIR, 'settings.json'), JSON.stringify({ permissions: { ask: ['Bash(cat README.md)'] } }));
  assert.equal(req('cat README.md'), null);
  assert.ok(req('cat other.md'));
  writeFileSync(join(process.env.CLAUDE_CONFIG_DIR, 'settings.json'), '{}');
});

test('F3: readOnlyCommand is the parser-based check (exported for reuse)', () => {
  assert.equal(readOnlyCommand('git status'), true);
  assert.equal(readOnlyCommand('git status # note'), true, 'a comment is not a command');
  assert.equal(readOnlyCommand('ls x; rm y'), false);
});
