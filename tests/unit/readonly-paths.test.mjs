// PermissionRequest auto-allows only read-only commands whose paths stay inside the repository and are not secret-like.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo } from '../helpers.mjs';

const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'mis-home-')));
process.env.HOME = HOME;
process.env.CLAUDE_CONFIG_DIR = join(HOME, '.claude');
process.env.MIS_STATE_HOME = join(HOME, '.make-it-ship');
const { permissionDecision } = await import('../../scripts/lib/readonly.mjs');

const REPO = makeRepo({ 'README.md': '# x\n', 'src/a.js': 'x\n' });
mkdirSync(join(HOME, '.ssh')); writeFileSync(join(HOME, '.ssh', 'id_rsa'), 'k');
const OUT = realpathSync(mkdtempSync(join(tmpdir(), 'mis-out-')));
writeFileSync(join(OUT, 'notes.txt'), 'x');
symlinkSync(OUT, join(REPO, 'link-out'));
symlinkSync(join(HOME, '.ssh', 'id_rsa'), join(REPO, 'key-link'));
const allowed = (command, cwd = REPO) => permissionDecision({ tool_name: 'Bash', tool_input: { command }, cwd })?.hookSpecificOutput?.decision?.behavior === 'allow';

test('read-only commands on paths inside the repository are still auto-allowed', () => {
  for (const c of ['ls', 'ls -la src', 'cat README.md', `cat ${REPO}/README.md`, 'head -n 5 src/a.js', 'grep -rn foo src', 'rg foo', 'find . -name "*.js"',
    'wc -l README.md src/a.js', 'git status', 'git log --oneline -5', 'git diff HEAD~1', 'git show HEAD:README.md', 'pwd', 'cat src/../README.md']) assert.ok(allowed(c), c);
  assert.ok(allowed('cat ../README.md', join(REPO, 'src')), 'relative to a subdirectory');
});

test('paths outside the repository (~, absolute, .., symlinks) get no decision', () => {
  for (const c of ['cat ~/.ssh/id_rsa', 'cat ~/notes.txt', `cat ${OUT}/notes.txt`, 'cat /etc/hosts', 'cat ../x', 'ls ..', 'ls /', 'head -n 3 /etc/passwd',
    'grep -r foo ~', `grep -rn foo ${OUT}`, 'grep -f ~/.ssh/id_rsa src', 'grep --file=/etc/hosts x src', 'find / -name x', 'find ~ -name "*.pem"',
    'cat link-out/notes.txt', 'ls link-out', 'git diff --no-index /etc/hosts README.md', 'rg foo /etc', 'tail ~', 'stat ~/.ssh']) {
    assert.equal(allowed(c), false, c);
  }
});

test('secret-like files get no decision even inside the repository', () => {
  for (const c of ['cat .env', 'cat .env.local', 'cat config/.env.production', 'cat key.pem', 'cat certs/server.key', 'cat id_rsa', 'cat id_ed25519.pub', 'cat .netrc',
    'cat .aws/credentials', 'ls .ssh', 'cat credentials.json', 'cat .npmrc', 'cat .git-credentials', 'git show HEAD:.env', 'git log -p -- .env', 'head key-link',
    'grep -r token .env', 'cat .e*', 'cat secrets.yaml', 'find .ssh']) {
    assert.equal(allowed(c), false, c);
  }
});
