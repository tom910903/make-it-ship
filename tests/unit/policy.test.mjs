import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../../scripts/lib/policy.mjs';

const REPO = '/work/repo';
const ctx = { repoRoot: REPO, activeRun: true, currentBranch: 'feature' };
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command }, cwd: REPO });
const d = (input, c = ctx) => classify(input, c).decision;

const BASH = {
  allow: [
    'npm test', 'git status', 'git log --oneline -5', 'ls -la', 'node "/p/scripts/mis.mjs" status',
    'node /p/scripts/mis.mjs check unit', 'rm -rf node_modules', 'rm -rf ./build dist', `rm -rf ${REPO}/tmp`,
    'rm file.txt', 'git commit -m "msg"', 'npm run build', 'pip list', 'git reset --soft HEAD~1', 'git clean -n',
    'cat README.md', 'node /p/scripts/mis.mjs init',
  ],
  ask: [
    'git push', 'git push origin feature', 'git -C /x push', 'cd sub && git push -u origin x', 'git push --force origin feature',
    'gh pr create --fill', 'gh pr merge 3', 'gh release create v1',
    'npm install lodash', 'npm i', 'npm add x', 'pnpm add x', 'yarn add x', 'pip install x', 'pip3 install -r r.txt',
    'python -m pip install x', 'brew install jq', 'cargo add serde',
    'rm -rf /', 'rm -rf ~', 'rm -rf ~/foo', 'rm -fr /tmp/x', 'rm -rf ../other', 'rm -rf $HOME', 'rm -r -f /etc', `rm -rf ${REPO}`,
    'cd /tmp && rm -rf x', 'rm -rf .',
    'git reset --hard', 'git reset --hard HEAD~1', 'git clean -fdx', 'git clean -xfd',
    'node "/p/scripts/mis.mjs" approve plan', 'node /p/scripts/mis.mjs init --write',
    'echo {} > .make-it-ship.json', "sed -i '' s/a/b/ .make-it-ship.json",
  ],
  deny: [
    'git push --force origin main', 'git push -f origin master', 'git push origin +main', 'git push --force-with-lease origin main',
    'cat .git/make-it-ship/runs/r1/state.json', 'echo x >> .git/make-it-ship/runs/r/events.jsonl',
    'echo r2 > .git/make-it-ship/current',
  ],
};
for (const [want, cmds] of Object.entries(BASH)) {
  for (const c of cmds) test(`bash ${want}: ${c}`, () => assert.equal(d(bash(c)), want));
}

test('force push without refspec on main → deny; on feature → ask', () => {
  assert.equal(d(bash('git push --force'), { ...ctx, currentBranch: 'main' }), 'deny');
  assert.equal(d(bash('git push -f')), 'ask');
});

test('state forgery via Write/Edit is denied even without an active run', () => {
  const noRun = { ...ctx, activeRun: false };
  for (const tool of ['Write', 'Edit', 'MultiEdit']) {
    assert.equal(d({ tool_name: tool, tool_input: { file_path: `${REPO}/.git/make-it-ship/runs/r/state.json` }, cwd: REPO }, noRun), 'deny');
  }
  assert.equal(d({ tool_name: 'Write', tool_input: { file_path: '.git/make-it-ship/current' }, cwd: REPO }, noRun), 'deny');
  assert.equal(d(bash('cp x .git/make-it-ship/runs/r/state.json'), noRun), 'deny');
});

test('config edits ask; normal edits pass', () => {
  assert.equal(d({ tool_name: 'Write', tool_input: { file_path: `${REPO}/.make-it-ship.json` }, cwd: REPO }), 'ask');
  assert.equal(d({ tool_name: 'Edit', tool_input: { file_path: '.make-it-ship.json' }, cwd: REPO }), 'ask');
  assert.equal(d({ tool_name: 'Write', tool_input: { file_path: `${REPO}/src/a.ts` }, cwd: REPO }), 'allow');
});

test('MCP writes ask, reads pass', () => {
  for (const n of ['mcp__claude_ai_Atlassian__createJiraIssue', 'mcp__github__push_files', 'mcp__slack__send_message',
    'mcp__x__updatePage', 'mcp__x__delete_item', 'mcp__gh__merge_pull_request', 'mcp__d__upload_file', 'mcp__j__transitionIssue',
    'mcp__f__edit_file', 'mcp__f__write_file']) {
    assert.equal(d({ tool_name: n, tool_input: {}, cwd: REPO }), 'ask', n);
  }
  for (const n of ['mcp__x__getJiraIssue', 'mcp__context7__resolve-library-id', 'mcp__f__read_file']) {
    assert.equal(d({ tool_name: n, tool_input: {}, cwd: REPO }), 'allow', n);
  }
});

test('without an active run only forgery is enforced', () => {
  const noRun = { ...ctx, activeRun: false };
  assert.equal(d(bash('git push'), noRun), 'allow');
  assert.equal(d(bash('npm install x'), noRun), 'allow');
  assert.equal(d({ tool_name: 'mcp__x__createIssue', tool_input: {}, cwd: REPO }, noRun), 'allow');
});

test('every non-allow decision carries a reason', () => {
  const r = classify(bash('git push'), ctx);
  assert.match(r.reason, /make-it-ship/);
});
