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
    'gh pr create --fill', 'gh pr merge 3', 'gh release create v1', 'gh -R o/r pr create -t x', 'gh --repo=o/r pr merge 3', 'gh --repo o/r release create v1',
    'npm install lodash', 'npm i', 'npm add x', 'pnpm add x', 'yarn add x', 'pip install x', 'pip3 install -r r.txt',
    'python -m pip install x', 'brew install jq', 'cargo add serde',
    'rm -rf /', 'rm -rf ~', 'rm -rf ~/foo', 'rm -fr /tmp/x', 'rm -rf ../other', 'rm -rf $HOME', 'rm -r -f /etc', `rm -rf ${REPO}`,
    'cd /tmp && rm -rf x', 'rm -rf .',
    'git reset --hard', 'git reset --hard HEAD~1', 'git clean -fdx', 'git clean -xfd',
    'node "/p/scripts/mis.mjs" approve plan', 'node /p/scripts/mis.mjs init --write',
    'echo {} > .make-it-ship.json', "sed -i '' s/a/b/ .make-it-ship.json",
    'node /p/scripts/mis.mjs setup routing --write',
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

// M1 verification defects H-1, M-1..M-3, L-5: habitual (non-adversarial) variants
const MORE = {
  ask: [
    'MIS=/p/scripts/mis.mjs; node $MIS approve plan',                       // H-1 variable
    'mis(){ node "/p/scripts/mis.mjs" "$@"; }; mis approve plan',            // H-1 shell function
    '(cd sub && git push)', 'GIT_TRACE=1 git push', 'time git push', 'nohup git push &', 'sudo git push',
    'env FOO=1 npm install x', 'command git push', '/usr/bin/git push origin x', 'bash -c "git push origin x"',
    'git -c core.x=y push',
  ],
  deny: [
    'node /p/scripts/mis.mjs status; echo x > .git/make-it-ship/runs/r/state.json', // M-1
    'git push --force origin refs/heads/main', 'git push -f origin HEAD:refs/heads/master', // M-2
    'git status; (git push --force origin main)',                                       // M-3
    'cd .git/make-it-ship && echo x > runs/r/state.json',                              // L-5
  ],
  allow: ['grep -rn approval src', 'node /p/scripts/mis.mjs status', 'echo approved > /dev/null'],
};
for (const [want, cmds] of Object.entries(MORE)) {
  for (const c of cmds) test(`bash variant ${want}: ${c}`, () => assert.equal(d(bash(c)), want));
}

// M1 round-2 defects: N-1 (approve false positives) and N-2 (more habitual shell shapes)
const ROUND2 = {
  allow: [
    `node /p/scripts/mis.mjs plan set - <<'MIS'\n{"goal":"let admins approve refunds","tasks":[{"id":"T1","title":"approve endpoint","acceptance":["approve works"]}]}\nMIS`,
    `node /p/scripts/mis.mjs review add quality - <<'MIS'\nBLOCKING: 0\nMAJOR: 0\nThe approve flow looks right.\nMIS`,
    `node /p/scripts/mis.mjs interview add '{"question":"Who can approve?","impact":"HIGH"}'`,
    `git commit -m "add approve button" && node /p/scripts/mis.mjs check unit`,
  ],
  ask: [
    'if true; then git push origin x; fi', 'for b in x; do git push origin $b; done', 'sudo -u bob git push',
    'env -i git push', 'nice -n 5 git push', 'time -p git push', 'bash -lc "git push origin x"',
    'MIS="/p/scripts/mis.mjs"; node "$MIS" approve plan', 'node ${MIS} approve plan',
  ],
  deny: ['for b in x; do git push --force origin main; done'],
};
for (const [want, cmds] of Object.entries(ROUND2)) {
  for (const c of cmds) test(`bash round2 ${want}: ${c.split('\n')[0]}`, () => assert.equal(d(bash(c)), want));
}
test('edits outside the plan\'s planned files ask (scope change, PRD 8.2)', () => {
  const c = { ...ctx, plannedFiles: ['src/**', 'test/*.test.ts', 'README.md'] };
  const w = (file_path) => d({ tool_name: 'Write', tool_input: { file_path }, cwd: REPO }, c);
  assert.equal(w(`${REPO}/src/a/b.ts`), 'allow');
  assert.equal(w('src/x.ts'), 'allow');
  assert.equal(w(`${REPO}/test/x.test.ts`), 'allow');
  assert.equal(w(`${REPO}/README.md`), 'allow');
  assert.equal(w(`${REPO}/test/deep/x.test.ts`), 'ask');
  assert.equal(w(`${REPO}/package.json`), 'ask');
  assert.equal(w('/tmp/scratch.txt'), 'allow', 'outside the repo is not a scope question');
  const r = classify({ tool_name: 'Edit', tool_input: { file_path: `${REPO}/lib/z.js` }, cwd: REPO }, c);
  assert.equal(r.decision, 'ask');
  assert.match(r.reason, /outside the approved plan/);
  assert.equal(d({ tool_name: 'Write', tool_input: { file_path: `${REPO}/anything.js` }, cwd: REPO }, { ...ctx, plannedFiles: null }), 'allow', 'no plan scope → no check');
});

test('glob matcher', async () => {
  const { globToRegExp } = await import('../../scripts/lib/policy.mjs');
  const m = (g, p) => globToRegExp(g).test(p);
  assert.ok(m('src/**', 'src/a/b/c.ts'));
  assert.ok(m('**/*.py', 'a/b/c.py'));
  assert.ok(m('**/*.py', 'c.py'));
  assert.ok(!m('src/*.ts', 'src/a/b.ts'));
  assert.ok(m('src/*.ts', 'src/b.ts'));
  assert.ok(m('a?.md', 'ab.md'));
  assert.ok(!m('a.md', 'aXmd'));
});

test('careful rules apply with or without a run (M6-07): destructive commands ask, force push to main is denied', () => {
  const idle = { ...ctx, activeRun: false };
  for (const c of [ctx, idle]) {
    assert.equal(d(bash('git push --force origin main'), c), 'deny');
    assert.equal(d(bash('git push -f origin feature'), c), 'ask', 'force push elsewhere rewrites history');
    assert.equal(d(bash('git reset --hard HEAD~1'), c), 'ask');
    assert.equal(d(bash('git clean -fd'), c), 'ask');
    assert.equal(d(bash('git checkout -- .'), c), 'ask');
    assert.equal(d(bash('git restore .'), c), 'ask');
    assert.equal(d(bash('rm -rf ~/projects'), c), 'ask');
    assert.equal(d(bash('psql -c "DROP TABLE users"'), c), 'ask');
    assert.equal(d(bash('mysql -e "truncate table logs"'), c), 'ask');
    assert.equal(d(bash('kubectl delete pod web-1'), c), 'ask');
    assert.equal(d(bash('docker system prune -af'), c), 'ask');
    assert.equal(d(bash('docker rm -f web'), c), 'ask');
    assert.equal(d(bash('codex exec "review this"'), c), 'ask', 'external model is always asked (data leaves the company)');
  }
  // Safe or run-only things stay allowed without a run.
  for (const cmd of ['git push origin feature', 'npm install lodash', 'gh pr create -t x', 'rm -rf dist', 'truncate -s 0 log.txt', 'git checkout main', 'git restore src/a.js', 'git commit -m "drop table support"'])
    assert.equal(d(bash(cmd), idle), 'allow', cmd);
  assert.equal(d(bash('git push origin feature')), 'ask', 'inside a run a normal push still asks');
});

test('freeze boundary (M6-07): edits outside the frozen directory are denied, with or without a run', () => {
  const frozen = { ...ctx, activeRun: false, freezeDir: `${REPO}/src` };
  const w = (p, c = frozen) => d({ tool_name: 'Write', tool_input: { file_path: p }, cwd: REPO }, c);
  assert.equal(w(`${REPO}/src/a.js`), 'allow');
  assert.equal(w(`${REPO}/src/deep/b.js`), 'allow');
  assert.equal(w(`${REPO}/srcx/c.js`), 'deny', 'prefix sibling is outside');
  assert.equal(w(`${REPO}/README.md`), 'deny');
  assert.equal(w('src/rel.js'), 'allow', 'relative paths resolve against cwd');
  assert.equal(w(`${REPO}/README.md`, { ...frozen, activeRun: true }), 'deny');
  assert.match(classify({ tool_name: 'Edit', tool_input: { file_path: `${REPO}/x.js` }, cwd: REPO }, frozen).reason, /mis unfreeze/);
});

test('own MCP tools (M7): memory-style writes are not treated as external writes; file-writing tools ask in a run and respect freeze', () => {
  const t = (name, input = {}, c = ctx) => d({ tool_name: `mcp__plugin_make-it-ship_mis__${name}`, tool_input: input, cwd: REPO }, c);
  for (const n of ['notepad_write_priority', 'state_write', 'wiki_delete', 'shared_memory_delete', 'project_memory_write']) assert.equal(t(n), 'allow', n);
  assert.equal(d({ tool_name: 'mcp__other__wiki_delete', tool_input: {}, cwd: REPO }), 'ask', 'other servers keep the external-write rule');
  assert.equal(t('ast_grep_replace', { apply: false }), 'allow', 'dry run');
  assert.equal(t('ast_grep_replace', { apply: true, paths: ['src'] }), 'ask');
  assert.equal(t('lsp_rename', { apply: true }), 'ask');
  assert.equal(t('lsp_code_action_resolve', {}), 'ask');
  const idle = { ...ctx, activeRun: false };
  assert.equal(t('ast_grep_replace', { apply: true, paths: ['src'] }, idle), 'allow');
  const frozen = { ...idle, freezeDir: `${REPO}/src` };
  assert.equal(t('ast_grep_replace', { apply: true, paths: ['src/a.js'] }, frozen), 'allow');
  assert.equal(t('ast_grep_replace', { apply: true, paths: ['lib'] }, frozen), 'deny');
  assert.equal(t('lsp_rename', { apply: true, file: `${REPO}/src/a.js` }, frozen), 'deny', 'rename may touch any file → frozen means no');
});

test('M6 D8: unstaging is not a discard', () => {
  assert.equal(d(bash('git restore --staged .')), 'allow');
  assert.equal(d(bash('git restore --staged --worktree .')), 'ask');
  assert.equal(d(bash('git restore -S .')), 'allow');
});

test('M8 browse: raw CDP and --remote storage/JS on real sites ask, with or without a run; other browse commands pass', () => {
  const idle = { ...ctx, activeRun: false };
  const MIS = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"';
  for (const c of [`${MIS} browse cdp Network.getAllCookies`, 'node "$MIS" browse cdp Page.getLayoutMetrics', 'node /p/scripts/mis.mjs browse cdp X.y',
    `${MIS} browse storage --remote`, `${MIS} browse js document.cookie --remote`, `${MIS} browse --remote eval x.js`,
    `${MIS} browse chain '[["storage"]]' --remote`, 'mis() { node /p/scripts/mis.mjs "$@"; }; mis browse cdp X.y']) {
    for (const c2 of [ctx, idle]) assert.equal(d(bash(c), c2), 'ask', c);
  }
  assert.match(classify(bash(`${MIS} browse cdp X.y`), idle).reason, /cookies/);
  for (const c of [`${MIS} browse goto http://localhost:3000`, `${MIS} browse storage`, `${MIS} browse js document.title`,
    `${MIS} browse snapshot -i`, `${MIS} browse click @e3`, `${MIS} browse screenshot /tmp/a.png`, 'echo browse cdp']) {
    assert.equal(d(bash(c), idle), 'allow', c);
  }
});

test('M8 R2-3: browser launch overrides (extra Chrome flags, another browser executable) on a mis browse command ask', () => {
  const idle = { ...ctx, activeRun: false };
  for (const c of [ctx, idle]) {
    for (const cmd of ["MIS_BROWSE_CHROME_ARGS='--remote-debugging-port=0' node /p/scripts/mis.mjs browse goto http://127.0.0.1:5/",
      'export MIS_BROWSE_CHROME_ARGS="--disable-web-security"; node /p/scripts/mis.mjs browse goto x',
      'MIS_BROWSER=/tmp/wrapper.sh node /p/scripts/mis.mjs browse goto x', 'MIS_BROWSER_EXE=/tmp/c node /p/scripts/mis.mjs browse status']) {
      assert.equal(d(bash(cmd), c), 'ask', cmd);
    }
    assert.equal(d(bash('node /p/scripts/mis.mjs browse goto http://127.0.0.1:5/'), c), 'allow');
  }
  // M8 r4 N1: pdf, doc/slides --pdf, canary and pair-agent start the same browser daemon
  for (const cmd of ['MIS_BROWSER=/tmp/w node /p/scripts/mis.mjs pdf doc.md', 'MIS_BROWSER=/tmp/w node /p/scripts/mis.mjs doc doc.md --pdf', 'MIS_BROWSER=/tmp/w node /p/scripts/mis.mjs slides deck.md --pdf', "MIS_BROWSE_CHROME_ARGS='--x' node /p/scripts/mis.mjs canary http://127.0.0.1:5/",
    'export MIS_BROWSER_EXE=/tmp/c; node /p/scripts/mis.mjs pair-agent start --local']) assert.equal(d(bash(cmd), idle), 'ask', cmd);
  assert.match(classify(bash("MIS_BROWSE_CHROME_ARGS='--x' node /p/scripts/mis.mjs browse goto x"), ctx).reason, /browser launch/);
});

test('M8 R3-3: launch overrides are judged on the parsed environment, not the raw text: split, quoted, escaped and exported names ask', () => {
  const idle = { ...ctx, activeRun: false }, M = 'node /p/scripts/mis.mjs browse goto x';
  for (const cmd of [`env MIS_BROWSE_CHROME_""ARGS='--x' ${M}`, `export MIS_BROWSE_CHROME_ARG\\S='--x'; ${M}`, `export 'MIS_BROWSER'=/tmp/w; ${M}`,
    `env MIS_BROWSER$'_EXE'=/tmp/w ${M}`, `MIS_BROWSER=/x; export MIS_BROWSER; ${M}`, `set -a; MIS_BROWSER=/x; ${M}`, `declare -x MIS_BROWSER=/x; ${M}`,
    `typeset -x MIS_BROWSER_EXE=/x; ${M}`, `f() { MIS_BROWSER=/x ${M}; }; f`, `sh -c "MIS_BROWSER=/x ${M}"`]) {
    assert.equal(d(bash(cmd), idle), 'ask', cmd);
  }
  for (const cmd of [`echo MIS_BROWSER=/x; ${M}`, `FOO=1 ${M}`, "MIS_BROWSER=/x node -e 1"]) assert.equal(d(bash(cmd), idle), 'allow', cmd);
});

test('M8: team workers on other models ask (code leaves the company), with or without a run; claude workers pass', () => {
  const idle = { ...ctx, activeRun: false };
  for (const c of [ctx, idle]) {
    assert.equal(d(bash('node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" team start 2 "x" --worker codex'), c), 'ask');
    assert.equal(d(bash('node /p/scripts/mis.mjs team start 3 "x" --worker=gemini'), c), 'ask');
    assert.equal(d(bash('MIS_TEAM_WORKER_CMD="codex exec x" node /p/scripts/mis.mjs team start 1 "x"'), c), 'ask', 'worker command override');
    assert.equal(d(bash('export MIS_TEAM_WORKER_CMD=gemini; node /p/scripts/mis.mjs team start 1 "x"'), c), 'ask');
    assert.equal(d(bash('node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" team start 2 "x"'), c), 'allow');
    assert.equal(d(bash('node /p/scripts/mis.mjs team start 2 "x" --worker claude'), c), 'allow');
    assert.equal(d(bash('node /p/scripts/mis.mjs team status'), c), 'allow');
  }
  assert.match(classify(bash('node /p/scripts/mis.mjs team start 2 "x" --worker codex'), ctx).reason, /external model/);
});

test('M9 D0: registered external mis subcommands ask with or without a run; telemetry is off by default', async () => {
  const { EXTERNAL_MIS } = await import('../../scripts/lib/policy.mjs');
  EXTERNAL_MIS.push([['example-sync', 'push'], 'example sync uploads data']);
  try {
    for (const c of [ctx, { ...ctx, activeRun: false }]) {
      assert.equal(d(bash('node /p/scripts/mis.mjs example-sync push --all'), c), 'ask');
      assert.equal(d(bash('node /p/scripts/mis.mjs example-sync status'), c), 'allow');
    }
  } finally { EXTERNAL_MIS.pop(); }
});

test('M9-C: what mis tty runs or types is classified like the same Bash command; a custom skill-test agent asks', () => {
  const mis = 'node /p/scripts/mis.mjs';
  for (const c of [`${mis} tty start x -- git push origin main`, `${mis} tty send sh 'npm install foo'`, `${mis} tty start r -- sh -c 'rm -rf /'`,
    `MIS_SKILL_TEST_CMD="codex exec" ${mis} skill test a s.json`]) assert.equal(d(bash(c)), 'ask', c);
  assert.equal(d(bash(`${mis} tty send sh 'rm -rf ~'`), { ...ctx, activeRun: false }), 'ask', 'careful rules apply without a run too');
  assert.equal(d(bash(`${mis} tty send sh 'cat .git/make-it-ship/runs/r/state.json'`)), 'deny');
  for (const c of [`${mis} tty start calc -- node repl.mjs`, `${mis} tty send calc '2+3'`, `${mis} tty expect calc '^5$'`, `${mis} skill test a s.json`]) assert.equal(d(bash(c)), 'allow', c);
});

test('M9-A: mis commands that change files outside the repo (settings, CLAUDE.md, MCP config, the plugin) ask with or without a run; their dry runs pass', () => {
  const idle = { ...ctx, activeRun: false };
  const M = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"';
  for (const c of [ctx, idle]) {
    for (const cmd of [`${M} setup --write`, `${M} setup --apply`, `${M} doctor --fix`, `${M} mcp-setup add context7 --write`,
      `${M} upgrade --yes`, `${M} uninstall --yes`, `${M} uninstall --yes --purge-runs`]) {
      assert.equal(d(bash(cmd), c), 'ask', cmd);
      assert.match(classify(bash(cmd), c).reason, /outside this repository|approval/);
    }
    for (const cmd of [`${M} setup`, `${M} doctor`, `${M} doctor --json`, `${M} doctor session`, `${M} mcp-setup list`, `${M} mcp-setup add context7`,
      `${M} upgrade`, `${M} uninstall`, `${M} uninstall --dry-run`, `${M} update-check`, `${M} version`, `${M} config get`, `${M} cancel --all`]) {
      assert.equal(d(bash(cmd), c), 'allow', cmd);
    }
  }
  assert.equal(d(bash(`${M} setup team --write`), ctx), 'ask', 'writes .make-it-ship.json during a run');
  assert.equal(d(bash(`${M} setup team --write`), idle), 'allow');
});

test('M8 D5: mis wrappers (functions with ${…} in the body, function keyword, subshell body, alias, wrapper of a wrapper, prefixed args) are seen through', () => {
  const idle = { ...ctx, activeRun: false };
  const P = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"';
  const asks = [
    `mis() { ${P} "$@"; }; mis browse cdp X`,
    `mis() { ${P} "$@"; }\nmis browse cdp X`,
    'mis() { node ${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs "$@"; }; mis browse cdp X',
    `function mis { ${P} "$@"; }; mis browse cdp X`,
    `function mis() { ${P} "$@"; }; mis browse cdp X`,
    `mis() ( ${P} "$@" ); mis browse cdp X`,
    `mis() { ${P} "$@"; }; m2() { mis "$@"; }; m2 browse cdp X`,
    `mis() { local x="\${1:-}"; ${P} "$@"; }; mis browse cdp X`,
    `mb() { ${P} browse "$@"; }; mb cdp X`,
    `alias mis='node \${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs'\nmis browse cdp X`,
    `mis() { ${P} "$@"; }; mis team start 2 x --worker codex`,
    `mis() { ${P} "$@"; }; mis browse js document.cookie --remote`,
    'mis browse cdp X', // a `mis` defined outside the command (shell profile) counts as mis.mjs
  ];
  for (const c of asks) assert.equal(d(bash(c), idle), 'ask', c);
  assert.equal(d(bash(`mis() { ${P} "$@"; }; mis approve plan`)), 'ask');
  for (const c of [`mis() { ${P} "$@"; }; mis browse goto http://localhost:3000`, `mis() { ${P} "$@"; }; mis status`]) assert.equal(d(bash(c), idle), 'allow', c);
});

test('remote upload: mis browse upload --remote asks (a local file leaves the machine to a non-local site); plain goto to a real site does not', () => {
  const idle = { ...ctx, activeRun: false };
  const MIS = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"';
  for (const c of [`${MIS} browse upload '#f' ~/.ssh/id_rsa --remote`, `${MIS} browse chain '[["upload","#f","x"]]' --remote`]) {
    const r = classify(bash(c), idle);
    assert.equal(r.decision, 'ask', c);
    assert.match(r.reason, /upload|sends? (a )?(local )?files?/i, c);
  }
  assert.equal(d(bash(`${MIS} browse goto https://example.com`), idle), 'allow');
});

test('M8 R3-1: an upload without --remote asks unless this workspace runs the local-only browser (read from the daemon state)', async () => {
  const { makeRepo } = await import('../helpers.mjs');
  const { browseDir } = await import('../../scripts/lib/browse/client.mjs');
  const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const idle = { ...ctx, activeRun: false }, repo = makeRepo(), sd = browseDir(repo);
  const at = (command) => classify({ tool_name: 'Bash', tool_input: { command }, cwd: repo }, idle);
  const P = 'node /p/scripts/mis.mjs browse';
  const uploads = [`${P} upload '#f' a.txt`, `${P} tab-each upload '#f' a.txt`, `${P} chain '[["goto","http://localhost:3"],["upload","#f","a.txt"]]'`];
  for (const c of uploads) {
    const r = at(c);
    assert.equal(r.decision, 'ask', c);
    assert.match(r.reason, /page script can send the file anywhere[\s\S]*--local-only/, c);
  }
  mkdirSync(sd, { recursive: true });
  const state = (s) => writeFileSync(join(sd, 'state.json'), JSON.stringify(s));
  state({ pid: process.pid, port: 1, localOnly: false });
  for (const c of uploads) assert.equal(at(c).decision, 'ask', `normal daemon: ${c}`);
  state({ pid: process.pid, port: 1, localOnly: true });
  for (const c of uploads) assert.equal(at(c).decision, 'allow', `local-only daemon: ${c}`);
  for (const c of uploads.map((u) => `${u} --remote`)) {
    const r = at(c);
    assert.equal(r.decision, 'ask', `--remote still asks: ${c}`);
    assert.match(r.reason, /uploads local files[\s\S]*page script can send the file anywhere/, c);
  }
  state({ pid: 2 ** 22 + 7, port: 1, localOnly: true });
  assert.equal(at(uploads[0]).decision, 'ask', 'a dead daemon (stale state) is not local-only');
  rmSync(repo, { recursive: true, force: true });
});

test('M9-F8: debug scope asks (not denies) for edits outside it, with or without a run; files and dirs both count', () => {
  const sc = { ...ctx, activeRun: false, debugScope: [`${REPO}/src/parser`, `${REPO}/lib/x.js`] };
  const w = (p) => classify({ tool_name: 'Edit', tool_input: { file_path: p }, cwd: REPO }, sc);
  assert.equal(w(`${REPO}/src/parser/a.js`).decision, 'allow');
  assert.equal(w(`${REPO}/lib/x.js`).decision, 'allow');
  assert.equal(w(`${REPO}/src/parser2/a.js`).decision, 'ask', 'prefix of a name is not inside');
  const o = w(`${REPO}/src/other.js`);
  assert.equal(o.decision, 'ask');
  assert.match(o.reason, /outside the debug scope/);
  assert.equal(classify({ tool_name: 'Write', tool_input: { file_path: `${REPO}/src/other.js` }, cwd: REPO }, { ...sc, activeRun: true }).decision, 'ask');
  assert.equal(classify({ tool_name: 'Write', tool_input: { file_path: `${REPO}/.git/make-it-ship/current` }, cwd: REPO }, sc).decision, 'deny', 'state forgery still denied');
  assert.equal(classify({ tool_name: 'Edit', tool_input: { file_path: `${REPO}/src/other.js` }, cwd: REPO }, { ...ctx, activeRun: false }).decision, 'allow', 'no scope → no ask');
});

test('M9-F10: mis setup --write asks even without a run; the dry run does not', () => {
  const noRun = { ...ctx, activeRun: false };
  assert.equal(d(bash('node /p/scripts/mis.mjs setup routing --write'), noRun), 'ask');
  assert.equal(d(bash('node /p/scripts/mis.mjs setup routing'), noRun), 'allow');
});

test('M9-E: browser credentials, real-Chrome connect, browser state and downloads ask every time (with or without a run), through every wrapper form', async () => {
  const { BROWSE_ALWAYS_ASK } = await import('../../scripts/lib/browse/util.mjs');
  const idle = { ...ctx, activeRun: false };
  const P = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"';
  const forms = (rest) => [
    `${P} browse ${rest}`, `node "$MIS_CLI" browse ${rest}`, `node /p/scripts/mis.mjs browse ${rest}`, `${P} browse --remote ${rest}`,
    `mis() { ${P} "$@"; }; mis browse ${rest}`, `function mis { ${P} "$@"; }; mis browse ${rest}`, `mb() { ${P} browse "$@"; }; mb ${rest}`,
    `alias mis='node \${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs'\nmis browse ${rest}`, `mis browse ${rest}`,
    `sh -c '${P} browse ${rest}'`, `cd /tmp && ${P} browse ${rest}`, `node /p/scripts/mis.mjs tty send sh 'node /p/scripts/mis.mjs browse ${rest}'`,
  ];
  const samples = { cookies: 'cookies', cookie: 'cookie sid=1', 'cookie-import': 'cookie-import c.json', 'cookie-import-browser': 'cookie-import-browser chrome --domain github.com',
    header: 'header Authorization:Bearer x', useragent: 'useragent X/1', connect: 'connect', state: 'state save s1', download: 'download https://x.test/a.zip', scrape: 'scrape images', archive: 'archive page.mhtml' };
  assert.deepEqual(Object.keys(samples).sort(), [...BROWSE_ALWAYS_ASK.keys()].sort(), 'every always-ask command has a sample here');
  for (const [cmd, rest] of Object.entries(samples)) {
    for (const c of [...forms(rest), `${P} browse chain '${JSON.stringify([['goto', 'http://localhost:3000'], rest.split(' ')])}'`, `${P} browse tab-each ${rest}`]) {
      for (const c2 of [ctx, idle]) {
        const r = classify(bash(c), c2);
        assert.equal(r.decision, 'ask', `${cmd}: ${c}`);
      }
    }
    assert.match(classify(bash(`${P} browse ${rest}`), idle).reason, new RegExp(`mis browse ${cmd}\\b`));
  }
  assert.match(classify(bash(`${P} browse cookie-import-browser chrome --domain x.com`), idle).reason, /Keychain|decrypt/);
  for (const c of ['disconnect', 'focus', 'memory', 'media --images', 'inspect h1', 'ux-audit', 'style h1 color red', 'cleanup --all', 'prettyscreenshot a.png',
    'tab-each text', 'snapshot -C', 'inbox', 'watch', 'watch stop', 'skill list', 'skill run hn', 'skillify hn', 'domain-skill list', 'extension',
    `chain '${JSON.stringify([['goto', 'http://localhost:3000'], ['text']])}'`, 'goto https://example.com']) {
    assert.equal(d(bash(`${P} browse ${c}`), idle), 'allow', c);
  }
  assert.equal(d(bash(`${P} open-url http://localhost:3000`), idle), 'allow');
});

test('M9-E: browser downloads are registered as external transfers', async () => {
  const { EXTERNAL_MIS } = await import('../../scripts/lib/policy.mjs');
  for (const sub of ['download', 'scrape']) assert.ok(EXTERNAL_MIS.some(([p]) => p.join(' ') === `browse ${sub}`), sub);
});

test('M9-D: every external or approval-gated mis subcommand asks with and without a run; read-only siblings pass', async () => {
  const { EXTERNAL_MIS, APPROVAL_MIS } = await import('../../scripts/lib/policy.mjs');
  const M = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"';
  const external = ['ask codex "q"', 'ask gemini "q" --file a.md', 'ccg "q"', 'benchmark-models "p" --models codex,gemini', 'interop',
    'telemetry sync', 'telemetry dashboard community', 'gbrain init', 'gbrain import docs', 'gbrain sync', 'gbrain query "x"',
    'gbrain restore git@x:y.git', 'gbrain artifacts-init git@x:y.git', 'gbrain ingest', 'design generate "brief"', 'design variants "b" --count 3',
    'design iterate s1 "darker"', 'design evolve shot.png "b"', 'pair-agent start', 'pair-agent start --local', 'ios daemon start --tailnet --target http://d', 'ios mint agent1',
    'android daemon start --tailnet', 'android mint agent1'];
  const approval = ['approve proposal p1', 'deploy setup --write --url https://x', 'deploy run', 'deploy run --auto-revert', 'canary https://example.com --checks 2', 'canary https://example.com --discover', 'ios sync --apply', 'redact file notes.md --apply', 'layout write'];
  const readOnly = ['second-opinion detect', 'second-opinion probe', 'telemetry status', 'telemetry on', 'telemetry log --skill qa', 'analytics',
    'gbrain detect', 'gbrain ingest --probe', 'gbrain policy get', 'gbrain enqueue a.md', 'gbrain uninstall', 'design compare', 'design gallery', 'pair-agent stop', 'pair-agent status',
    'ios daemon start --target http://127.0.0.1:9', 'ios daemon stop', 'ios sync', 'android daemon start', 'android tap 1 2', 'android boot Medium_Phone', 'deploy setup', 'deploy status', 'deploy run --dry-run', 'landing-report', 'mission-board',
    'wait --seconds 1', 'wait detect', 'wait auto --pane %3', 'detach -- npm test', 'detach --lock evals -- npm test', 'redact file notes.md', 'redact scan --pii --legal', 'research list', 'autoresearch status m', 'self-improve list', 'writer-memory status', 'layout', 'layout --json',
    'diagram design/a.mmd --out design', 'chart data.csv --out design', 'chart design/share.mmd', 'doc docs/guide.md --pdf', 'slides deck.md -o deck.html --pdf'];
  for (const c of [ctx, { ...ctx, activeRun: false }]) {
    for (const cmd of external) {
      const r = classify(bash(`${M} ${cmd}`), c);
      assert.equal(r.decision, 'ask', cmd);
      assert.match(r.reason, /leaves this machine/, cmd);
    }
    for (const cmd of approval) assert.equal(d(bash(`${M} ${cmd}`), c), 'ask', cmd);
    for (const cmd of readOnly) assert.equal(d(bash(`${M} ${cmd}`), c), c.activeRun && /^approve/.test(cmd) ? 'ask' : 'allow', cmd);
  }
  // the registry itself: deleting an entry fails here
  const names = (list) => list.map(([p]) => p.join(' '));
  for (const p of ['ask', 'ccg', 'benchmark-models', 'interop', 'telemetry sync', 'telemetry dashboard', 'gbrain sync', 'gbrain ingest', 'design generate', 'pair-agent start', 'ios daemon start', 'ios mint', 'android daemon start', 'android mint']) assert.ok(names(EXTERNAL_MIS).includes(p), p);
  for (const p of ['approve proposal', 'deploy setup', 'deploy run', 'canary', 'ios sync', 'redact file', 'layout write']) assert.ok(names(APPROVAL_MIS).includes(p), p);
  assert.match(classify(bash(`${M} deploy run --auto-revert`), ctx).reason, /rolls back/, 'the question names the revert');
});

test('M9-D: commands that mis runs later (wait/detach after --, tournament --bench, autoresearch --eval) are classified like the same Bash command', () => {
  const mis = 'node /p/scripts/mis.mjs', idle = { ...ctx, activeRun: false };
  for (const c of [ctx, idle]) {
    for (const cmd of [`${mis} detach -- rm -rf ~`, `${mis} wait --seconds 1 -- git push --force origin main`, `${mis} self-improve tournament --bench 'git push --force origin x' a.patch`,
      `${mis} autoresearch init m --mission x --eval 'rm -rf ~'`, `${mis} autoresearch init m --mission x --eval='codex exec review'`]) assert.notEqual(d(bash(cmd), c), 'allow', cmd);
    assert.equal(d(bash(`${mis} detach -- cat .git/make-it-ship/runs/r/state.json`), c), 'deny');
    for (const cmd of [`${mis} detach -- npm test`, `${mis} wait --seconds 1 -- echo hi`, `${mis} self-improve tournament --bench 'npm run bench' a.patch`, `${mis} autoresearch init m --mission x --eval 'node eval.js'`]) assert.equal(d(bash(cmd), c), 'allow', cmd);
  }
  assert.equal(d(bash(`${mis} wait --seconds 1 -- npm install x`)), 'ask', 'run-level rules apply with a run');
  // wait auto types --text into the stopped panes: classified like that command line
  for (const c of [ctx, idle]) {
    assert.notEqual(d(bash(`${mis} wait auto --text 'rm -rf ~'`), c), 'allow');
    assert.notEqual(d(bash(`${mis} wait auto --log s.log --text=continue -- git push --force origin main`), c), 'allow');
    assert.equal(d(bash(`${mis} wait auto --text continue`), c), 'allow');
  }
});

// ---- M9 fix1 (round-1 D/E verifier): stored commands, stored-command files, ask texts with destination and contents
const { mkdtempSync: mkd, mkdirSync: mkdir, writeFileSync: wf, realpathSync: rp, rmSync: rmf } = await import('node:fs');
const { tmpdir: tmp } = await import('node:os');
const { spawnSync: spawnSyncP } = await import('node:child_process');
const { join: pj } = await import('node:path');
function storedRepo(files) {
  // a real repository: guard and mis both find the root with git rev-parse (M9 r2 N1); an empty .git dir is not one
  const r = rp(mkd(pj(tmp(), 'mis-policy-'))); spawnSyncP('git', ['init', '-q'], { cwd: r });
  for (const [p, c] of Object.entries(files)) { mkdir(pj(r, p, '..'), { recursive: true }); wf(pj(r, p), typeof c === 'string' ? c : JSON.stringify(c)); }
  return r;
}
const M9F = 'node /p/scripts/mis.mjs';

test('M9 fix1 D1: writes to evaluator.json, deploy.json and self-improve proposals ask with or without a run, through Write/Edit/MultiEdit, any MCP writer and Bash', () => {
  const r = storedRepo({});
  const ev = pj(r, '.make-it-ship', 'autoresearch', 'm1', 'evaluator.json'), dep = pj(r, '.make-it-ship', 'deploy.json');
  const patch = pj(r, '.make-it-ship', 'self-improve', 'proposals', 'p1', 'change.patch');
  for (const c of [{ ...ctx, repoRoot: r }, { ...ctx, repoRoot: r, activeRun: false }]) {
    for (const f of [ev, dep, patch]) {
      for (const input of [{ tool_name: 'Write', tool_input: { file_path: f, content: '{"command":"codex exec leak"}' } }, { tool_name: 'Edit', tool_input: { file_path: f, old_string: 'a', new_string: 'codex exec leak' } },
        { tool_name: 'MultiEdit', tool_input: { file_path: f, edits: [{ old_string: 'a', new_string: 'codex exec leak' }] } }, { tool_name: 'mcp__filesystem__write_file', tool_input: { path: f, content: 'codex exec leak' } },
        { tool_name: 'mcp__filesystem__edit_file', tool_input: { path: f, edits: [] } }, { tool_name: 'mcp__filesystem__move_file', tool_input: { source: pj(r, 'x.json'), destination: f } },
        { tool_name: 'mcp__plugin_make-it-ship_mis__ast_grep_replace', tool_input: { paths: [f], apply: true } }]) {
        const v = classify({ ...input, cwd: r }, c);
        assert.equal(v.decision, 'ask', `${input.tool_name} ${f}`);
        assert.match(v.reason, /runs later/);
      }
    }
    assert.match(classify({ tool_name: 'Write', tool_input: { file_path: ev, content: '{"command":"codex exec leak"}' }, cwd: r }, c).reason, /codex exec leak/, 'the ask shows the new command');
    for (const cmd of [`cat > ${ev} <<EOF\n{"command":"codex exec x"}\nEOF`, `echo '{}' > .make-it-ship/deploy.json`, `cd .make-it-ship/autoresearch/m1 && tee evaluator.json < /tmp/x`,
      `cp /tmp/x .make-it-ship/deploy.json`, `sed -i '' s/a/b/ .make-it-ship/autoresearch/m1/evaluator.json`, `sh -c 'echo x >> .make-it-ship/deploy.json'`]) {
      assert.equal(classify({ tool_name: 'Bash', tool_input: { command: cmd }, cwd: r }, c).decision, 'ask', cmd);
    }
    for (const input of [{ tool_name: 'Bash', tool_input: { command: 'cat .make-it-ship/deploy.json' } }, { tool_name: 'mcp__filesystem__read_file', tool_input: { path: ev } },
      { tool_name: 'Edit', tool_input: { file_path: pj(r, '.make-it-ship', 'autoresearch', 'm1', 'mission.md'), old_string: 'a', new_string: 'b' } }]) {
      if (!c.activeRun) assert.equal(classify({ ...input, cwd: r }, c).decision, 'allow', JSON.stringify(input));
    }
  }
  rmf(r, { recursive: true, force: true });
});

test('M9 fix1 D1: autoresearch eval, check, bench, health and deploy run classify the command they will run from its stored file', () => {
  const r = storedRepo({
    '.make-it-ship/autoresearch/leak/evaluator.json': { command: `${M9F} ask codex leak-repo >/dev/null; echo '{"pass":true}'`, timeoutSec: 5, output: 'json' },
    '.make-it-ship/autoresearch/direct/evaluator.json': { command: 'codex exec review; echo {}', timeoutSec: 5, output: 'json' },
    '.make-it-ship/autoresearch/fine/evaluator.json': { command: `echo '{"pass":true}'`, timeoutSec: 5, output: 'json' },
    '.make-it-ship/autoresearch/loop/evaluator.json': { command: `${M9F} autoresearch eval loop`, timeoutSec: 5, output: 'json' },
    '.make-it-ship.json': { version: 1, checks: { unit: { argv: ['npm', 'test'] }, leak: { argv: ['codex', 'exec', 'x'] } } },
    '.make-it-ship/deploy.json': { mergeCmd: 'gh pr merge --squash', deployCmd: 'fly deploy --app shop', healthUrl: 'https://shop.example/health' },
    'sub/x.txt': 'x',
  });
  for (const c of [{ ...ctx, repoRoot: r }, { ...ctx, repoRoot: r, activeRun: false }]) {
    const v = (cmd, cwd = r) => classify({ tool_name: 'Bash', tool_input: { command: cmd }, cwd }, c);
    for (const name of ['leak', 'direct']) {
      const a = v(`${M9F} autoresearch eval ${name} --decision x`);
      assert.equal(a.decision, 'ask', name); assert.match(a.reason, /stored autoresearch evaluator command/); assert.match(a.reason, /codex/);
    }
    assert.equal(v(`${M9F} autoresearch eval leak --decision x`, pj(r, 'sub')).decision, 'ask', 'from a subdirectory too');
    assert.match(v(`${M9F} autoresearch eval leak`).reason, /ask codex leak-repo/, 'the ask shows the stored command');
    assert.equal(v(`${M9F} autoresearch eval loop`).decision, 'ask', 'a self-referencing evaluator fails closed');
    assert.equal(v(`${M9F} autoresearch eval fine --decision x`).decision, 'allow');
    for (const cmd of ['check leak', 'bench leak --runs 2', 'health', 'session create feature x']) assert.equal(v(`${M9F} ${cmd}`).decision, 'ask', cmd);
    for (const cmd of ['session create feature x --no-baseline', 'session list']) assert.equal(v(`${M9F} ${cmd}`).decision, 'allow', cmd);
    for (const cmd of ['check unit', 'bench unit']) assert.equal(v(`${M9F} ${cmd}`).decision, 'allow', cmd);
    const d = v(`${M9F} deploy run`);
    assert.equal(d.decision, 'ask'); assert.match(d.reason, /gh pr merge --squash/); assert.match(d.reason, /fly deploy --app shop/); assert.match(d.reason, /shop\.example\/health/);
    assert.match(v(`${M9F} deploy setup --write --deploy-cmd 'vercel --prod'`).reason, /vercel --prod/);
  }
  wf(pj(r, '.make-it-ship', 'deploy.json'), JSON.stringify({ deployCmd: 'git push --force origin main' }));
  assert.equal(classify({ tool_name: 'Bash', tool_input: { command: `${M9F} deploy run` }, cwd: r }, { ...ctx, repoRoot: r }).decision, 'deny', 'a stored command is decided like the same Bash command');
  rmf(r, { recursive: true, force: true });
});

test('M9 fix1 D6: external-transfer asks name the destination and what goes there', () => {
  const r = storedRepo({ '.make-it-ship/self-improve/proposals/p1/proposal.json': { id: 'p1', paths: ['.make-it-ship/deploy.json', 'skills/x/SKILL.md'] }, '.make-it-ship/wiki/w.md': '# w' });
  const home = rp(mkd(pj(tmp(), 'mis-policy-home-')));
  wf(pj(home, 'config.json'), JSON.stringify({ telemetry: { enabled: true, endpoint: 'https://telemetry.example/v1' } }));
  wf(pj(home, 'gbrain.json'), JSON.stringify({ artifactsRemote: 'git@brain.example:me/brain.git', queue: ['/r/docs/a.md', { path: '/r/docs/b.md' }] }));
  const saved = process.env.MIS_STATE_HOME;
  process.env.MIS_STATE_HOME = home;
  try {
    const why = (cmd) => classify({ tool_name: 'Bash', tool_input: { command: cmd }, cwd: r }, { ...ctx, repoRoot: r, activeRun: false }).reason;
    assert.match(why(`${M9F} telemetry sync`), /telemetry\.example\/v1/);
    assert.match(why(`${M9F} gbrain sync`), /brain\.example[\s\S]*\/r\/docs\/a\.md[\s\S]*\/r\/docs\/b\.md/);
    // the ask's file list caps each entry at 160 chars: under a long TMPDIR the file shows as its leading part
    const wiki = pj(r, '.make-it-ship', 'wiki', 'w.md'), ingest = why(`${M9F} gbrain ingest`);
    assert.ok(/wiki\/w\.md/.test(ingest) || (wiki.length > 160 && ingest.includes(wiki.slice(0, 150))), ingest);
    assert.match(why(`${M9F} canary https://shop.example --pages /,/cart`), /https:\/\/shop\.example\/cart/);
    assert.match(why(`${M9F} design generate "a logo"`), /api\.openai\.com/);
    assert.match(why(`MIS_OPENAI_BASE_URL=https://proxy.example ${M9F} design generate "a logo"`), /proxy\.example/);
    assert.match(why(`${M9F} approve proposal p1`), /\.make-it-ship\/deploy\.json/);
    assert.match(why(`${M9F} pair-agent start`), /tunnel command/);
    assert.match(why(`${M9F} ask codex "q"`), /codex CLI/);
  } finally {
    if (saved === undefined) delete process.env.MIS_STATE_HOME; else process.env.MIS_STATE_HOME = saved;
    rmf(r, { recursive: true, force: true }); rmf(home, { recursive: true, force: true });
  }
});

test('LAYOUT D1: the mis layout write question names the files it may write, from the configured AI docs folder', () => {
  const r = storedRepo({ '.make-it-ship.json': { version: 1, checks: {}, layout: { paths: ['**'], docs: { ai: '../escaped-ai' } } } });
  const a = classify({ tool_name: 'Bash', tool_input: { command: `${M9F} layout write` }, cwd: r }, { ...ctx, repoRoot: r, activeRun: false });
  assert.equal(a.decision, 'ask');
  assert.match(a.reason, /\.\.\/escaped-ai\/index\.md/);
  assert.match(a.reason, /\.\.\/escaped-ai\/decisions\.md/);
  assert.match(a.reason, /AGENTS\.md/);
  const plain = storedRepo({ '.make-it-ship.json': { version: 1, checks: {}, layout: { paths: ['**'] } } });
  assert.match(classify({ tool_name: 'Bash', tool_input: { command: `${M9F} layout write` }, cwd: plain }, { ...ctx, repoRoot: plain }).reason, /\.ai\/structure\.md/);
  rmf(r, { recursive: true, force: true }); rmf(plain, { recursive: true, force: true });
});
