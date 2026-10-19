#!/usr/bin/env node
// Copy a demo fixture into a fresh temp git repo and print its path.
// usage: node evals/setup-demo.mjs <a|b|...> [destDir]
import { cpSync, mkdtempSync, existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [demo, dest] = process.argv.slice(2);
const src = join(dirname(fileURLToPath(import.meta.url)), 'demos', demo ?? '');
if (!demo || !existsSync(src)) {
  console.error('usage: node evals/setup-demo.mjs <demo> [destDir]');
  process.exit(2);
}
const dir = dest ?? realpathSync(mkdtempSync(join(tmpdir(), `mis-demo-${demo}-`)));
cpSync(src, dir, { recursive: true });
const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
git('init', '-q', '-b', 'main');
git('config', 'user.name', 'Demo');
git('config', 'user.email', 'demo@example.com');
git('config', 'commit.gpgsign', 'false');
git('add', '-A');
git('commit', '-qm', `demo ${demo} fixture`);
console.log(dir);
