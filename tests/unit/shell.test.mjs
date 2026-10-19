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
