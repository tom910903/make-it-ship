import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShell } from '../../scripts/lib/shell.mjs';
import { classify } from '../../scripts/lib/policy.mjs';

const argvs = (src) => parseShell(src).commands.map((c) => c.argv);

test('tokenizer: quotes, separators, subshells, substitutions, heredoc bodies excluded', () => {
  assert.deepEqual(argvs(`echo "a b" 'c d' e\\ f`), [['echo', 'a b', 'c d', 'e f']]);
  assert.deepEqual(argvs('a; b && c || d | e & f'), [['a'], ['b'], ['c'], ['d'], ['e'], ['f']]);
  assert.deepEqual(argvs('(cd x && git push)'), [['cd', 'x'], ['git', 'push']]);
  assert.deepEqual(argvs('out=$(git push 2>&1); echo `git status`').map((a) => a[0]), ['git', 'out=$(…)', 'git', 'echo']);
  const h = parseShell("cat <<'EOF' > f.txt\ngit push --force origin main\nrm -rf /\nEOF\nls");
  assert.deepEqual(h.commands.map((c) => c.argv[0]), ['cat', 'ls']);
  assert.doesNotMatch(h.text, /git push/);
  assert.deepEqual(argvs('cat <<-X\n\tgit push\n\tX\necho ok').map((a) => a[0]), ['cat', 'echo']);
});

// Combination tests: every container × wrapper × dangerous command.
const REPO = '/work/repo';
const ctx = { repoRoot: REPO, activeRun: true, currentBranch: 'feature' };
const decide = (command) => classify({ tool_name: 'Bash', tool_input: { command }, cwd: REPO }, ctx).decision;
const MIS = '/p/scripts/mis.mjs';
const WRAPPERS = ['', 'sudo ', 'sudo -E ', 'sudo -n ', 'sudo -u bob ', 'env ', 'env -i ', 'env FOO=1 ', 'nice -n 5 ', 'nice ',
  'time ', 'time -p ', 'timeout 120 ', 'timeout -s KILL 30 ', 'nohup ', 'command ', 'exec ', 'GIT_SSH_COMMAND="ssh -v" ', 'X=1 Y=2 '];
const CONTAINERS = [(c) => c, (c) => `(${c})`, (c) => `{ ${c}; }`, (c) => `out=$(${c} 2>&1)`, (c) => `echo \`${c}\``,
  (c) => `bash -c "${c.replace(/["$`\\]/g, '\\$&')}"`, (c) => `bash -lc '${c}'`, (c) => `sh -e -c '${c}'`, (c) => `if true; then ${c}; fi`,
  (c) => `for b in x; do ${c}; done`, (c) => `git status && ${c}`, (c) => `ls | ${c}`, (c) => `while false; do :; done; ${c} &`];
const CASES = [
  ['git push origin feature', 'ask'], ['git push --force origin main', 'deny'], ['git push -f origin refs/heads/master', 'deny'],
  ['npm install left-pad', 'ask'], ['gh pr create --fill', 'ask'], ['git reset --hard', 'ask'], [`node ${MIS} approve plan`, 'ask'],
];
for (const [cmd, want] of CASES) {
  test(`combinations: ${cmd} → ${want}`, () => {
    const bad = [];
    for (const wrap of CONTAINERS) for (const w of WRAPPERS) {
      const src = wrap(w + cmd);
      if (decide(src) !== want) bad.push(src);
    }
    assert.deepEqual(bad, []);
  });
}

test('approve through a variable, a function, or a variable subcommand asks', () => {
  for (const c of [`MIS=${MIS}; node $MIS approve plan`, `MIS="${MIS}"; node "\${MIS}" approve plan`,
    `mis(){ node "${MIS}" "$@"; }; mis approve plan`, `A=approve; node ${MIS} $A plan`, `${MIS} approve plan`]) {
    assert.equal(decide(c), 'ask', c);
  }
});

test('legitimate commands that mention approve, push or state paths in data do not trigger', () => {
  for (const c of [
    `node ${MIS} plan set - <<'MIS'\n{"goal":"$100 approve flow","tasks":[{"id":"T1","title":"approve","acceptance":["git push --force origin main is rejected"]}]}\nMIS`,
    `node ${MIS} review add quality - <<'MIS'\nBLOCKING: 0\nMAJOR: 0\nQuoted: git push --force origin main\nSee .git/make-it-ship/runs for state.\n$ROLE approve\nMIS`,
    `cat > notes.md <<EOF\n$ROLE approve\nnpm install x\nEOF`,
    `git commit -m "git push docs; approve button"`, `grep -rn "approve" src`, `echo approved`, `node ${MIS} status`,
    `node ${MIS} interview add '{"question":"Who can approve?","impact":"HIGH"}'`,
  ]) {
    assert.equal(decide(c), 'allow', c);
  }
});

test('state forgery outside heredoc data is denied', () => {
  for (const c of ['echo x > .git/make-it-ship/runs/r/state.json', 'cd .git/make-it-ship && echo x > runs/r/s.json',
    `node ${MIS} status; cp f .git/make-it-ship/current`, 'out=$(cat .git/make-it-ship/runs/r/state.json)']) {
    assert.equal(decide(c), 'deny', c);
  }
});

test('fuzz: the tokenizer and policy never throw and stay fast on arbitrary input', () => {
  const alphabet = [' ', '\t', '\n', ';', '&', '|', '(', ')', '{', '}', '$', '`', "'", '"', '\\', '<', '>', '<<', '<<-', '$(', 'EOF', '-',
    'git', 'push', 'sh', '-c', 'eval', 'node', 'mis.mjs', 'approve', 'a', '=', '*', '#', '~', '.git/make-it-ship'];
  let seed = 42;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const pathological = ['', '"', "'", '`', '$(', '$((', '((', '))', '<<', '<<-', "<<'", 'a<<', 'cat <<EOF', 'cat <<EOF\nx', '\\', '"\\',
    "'$(", '$(\'', '"$(echo "', 'sh -c', 'bash -c "', 'eval', 'f(){', 'f() {', '}{', '((((((((((', ')))))))))'];
  const t0 = Date.now();
  for (const src of pathological) assert.doesNotThrow(() => decide(src), src);
  for (let i = 0; i < 4000; i++) {
    let src = '';
    for (let k = rnd(20); k >= 0; k--) src += alphabet[rnd(alphabet.length)];
    assert.doesNotThrow(() => decide(src), JSON.stringify(src));
  }
  assert.ok(Date.now() - t0 < 10000, `took ${Date.now() - t0}ms`);
});

test('every command shape the skills and phases tell the model to run is allowed (no false asks)', () => {
  const M = 'node "/Users/x/.claude/plugins/make-it-ship/scripts/mis.mjs"';
  const shapes = [
    `${M} doctor`, `${M} init`, `${M} start --input docs/feature-request.md`, `${M} start --input "add a greet function"`,
    `${M} plan set - <<'MIS'\n{"goal":"g","tasks":[{"id":"T1","title":"t","acceptance":["a"],"files":["src/a.ts"]}],"plannedFiles":["src/**"],"riskFlags":[],"howToRun":["npm test"],"ui":false}\nMIS`,
    `${M} mode set standard --reason "new feature, no risk flags"`,
    `${M} interview add '{"question":"Which locale?","impact":"HIGH","why":"changes output"}'`, `${M} interview resolve Q1 "en-US only"`,
    `${M} review add plan-critic - <<'MIS'\nVERDICT: ACCEPT\nBLOCKING: 0\nMAJOR: 0\n\nThe plan pushes nothing; git push stays manual.\nMIS`,
    `${M} review add quality - <<'MIS'\nVERDICT: SHIP\nBLOCKING: 0\nMAJOR: 1\nrm -rf / is never called. Users can approve refunds.\nMIS`,
    `${M} task T1 start`, `${M} task T1 done`, `${M} task T1 fail`, `${M} task T1 retry`, `${M} check unit`, `${M} verdict`,
    `${M} status`, `${M} status --json`, `${M} report`, `${M} note dep "zod validates config input"`,
    `${M} note rootcause T1 - <<'MIS'\nREPRODUCTION: npm test fails\nHYPOTHESIS: floor instead of round\nEVIDENCE: 157.5 → 157\nMIS`,
    `${M} block "needs a physical device"`, `${M} resume`,
    'git diff abc123', 'git status --porcelain', 'git diff --stat abc123', 'git log --oneline -5', 'npm test', 'python3 -m unittest discover -s tests -v',
    'git add src/a.ts test/a.test.ts && git commit -m "T1: add slugify"', 'node --test "test/**/*.test.ts"',
  ];
  for (const c of shapes) assert.equal(decide(c), 'allow', c);
});

test('documented choice: text naming runs/ or current is denied even in a commit message; the bare dir name is not', () => {
  assert.equal(decide('git commit -m "docs: explain .git/make-it-ship/runs layout"'), 'deny');
  assert.equal(decide('git commit -m "docs: explain the .git/make-it-ship layout"'), 'allow');
});

// Residual risks, folded into the matrix as new classes.
test('node runtime flags and xargs before mis.mjs approve still ask', () => {
  for (const c of [`node --no-warnings ${MIS} approve plan`, `node -- ${MIS} approve plan`, `node --trace-warnings --max-old-space-size 4096 ${MIS} approve plan`,
    `echo plan | xargs node ${MIS} approve`, `xargs -n 1 node ${MIS} approve < f`]) assert.equal(decide(c), 'ask', c);
  assert.equal(decide(`node --no-warnings ${MIS} status`), 'allow');
});

test('shell comments are not commands, and do not hide the next line', () => {
  assert.equal(decide('npm test # done; npm install x'), 'allow');
  assert.equal(decide("echo done # don't forget\ngit push --force origin main"), 'deny');
  assert.equal(decide('echo a#b && git push'), 'ask', '# inside a word is not a comment');
});

test('shell options with values, HEAD on main, package-manager global flags, shell reading a heredoc', () => {
  assert.equal(decide('bash -o pipefail -c "git push origin x"'), 'ask');
  assert.equal(decide('bash +o errexit -e -c "git push origin x"'), 'ask');
  assert.equal(classify({ tool_name: 'Bash', tool_input: { command: 'git push --force origin HEAD' }, cwd: REPO }, { ...ctx, currentBranch: 'main' }).decision, 'deny');
  assert.equal(decide('git push --force origin HEAD'), 'ask', 'HEAD on a feature branch');
  for (const c of ['npm --prefix sub install x', 'pnpm -C sub add x', 'pnpm --filter web add x', 'yarn --cwd sub add x', 'pip3 --disable-pip-version-check install x', 'npm -w pkg i x']) {
    assert.equal(decide(c), 'ask', c);
  }
  assert.equal(decide('bash <<EOF\ngit push --force origin main\nEOF'), 'deny');
  assert.equal(decide("sh -s <<'X'\ngit push origin y\nX"), 'ask');
  assert.equal(decide("cat <<'X'\ngit push origin y\nX"), 'allow', 'cat reads data, not a script');
});

const MORE_WRAPPERS = ['xargs ', 'xargs -n 1 '];
const MORE_CONTAINERS = [(c) => `echo start # note: careful\n${c}`, (c) => `bash -o pipefail -c '${c}'`, (c) => `bash <<'EOF'\n${c}\nEOF`];
for (const [cmd, want] of CASES) {
  test(`extended combinations: ${cmd} → ${want}`, () => {
    const bad = [];
    for (const wrap of [...CONTAINERS, ...MORE_CONTAINERS]) for (const w of [...WRAPPERS, ...MORE_WRAPPERS]) {
      const src = wrap(w + cmd);
      if (decide(src) !== want) bad.push(src);
    }
    assert.deepEqual(bad, []);
  });
}

test('read-only commands that merely mention the state dir in a pattern are allowed; runs/current paths stay denied', () => {
  assert.equal(decide("git ls-files | grep -v '^\\.git/make-it-ship'"), 'allow');
  assert.equal(decide('cat .git/make-it-ship/runs/r/state.json'), 'deny');
  assert.equal(decide('cd .git/make-it-ship && ls'), 'deny');
});

test('deleting or moving the run state dir is denied (reads of the bare dir name stay allowed)', () => {
  for (const c of ['rm -rf .git/make-it-ship', 'mv .git/make-it-ship /tmp/x', 'rm -r ./.git/make-it-ship/', 'cp -r x .git/make-it-ship']) assert.equal(decide(c), 'deny', c);
  assert.equal(decide("git ls-files | grep -v '^\\.git/make-it-ship'"), 'allow');
});
