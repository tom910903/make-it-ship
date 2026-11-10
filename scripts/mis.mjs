#!/usr/bin/env node
// mis — Make It Ship CLI. Dispatch only; commands live in lib/commands.mjs.
import { commands } from './lib/commands.mjs';

const [name, ...args] = process.argv.slice(2);
// exit codes with --strict: 0 PASS/VERIFIED, 3 FAIL/FAILED, 4 BLOCKED, 5 timed out, 6 PARTIAL (1 stays a mis error, 2 usage)
const STRICT = {
  check: (o) => (o?.status === 'PASS' ? 0 : o?.status === 'FAIL' ? 3 : /^timed out/.test(o?.reason ?? '') ? 5 : 4),
  verdict: (o) => ({ VERIFIED: 0, FAILED: 3, BLOCKED: 4 })[o?.verdict] ?? 6,
};
const cmd = commands[name];
if (!cmd) {
  console.error(`usage: mis <${Object.keys(commands).join('|')}> ...`);
  process.exit(2);
}
try {
  // M9 fix1 D2: a script run by `mis check`/`mis bench` (MIS_CLI set) is out of the guard's sight, so anything the guard
  // would ask about (external transfers, approvals, stored external commands) is refused there, never run silently.
  if (process.env.MIS_CLI) {
    const { classify } = await import('./lib/policy.mjs');
    const q = (w) => `'${String(w).replace(/'/g, `'\\''`)}'`;
    const env = ['MIS_SKILL_TEST_CMD', 'MIS_TEAM_WORKER_CMD'].filter((k) => process.env[k]).map((k) => `${k}=set `).join('');
    const r = classify({ tool_name: 'Bash', tool_input: { command: `${env}mis ${[name, ...args].map(q).join(' ')}` }, cwd: process.cwd() }, { repoRoot: process.cwd(), activeRun: true }); // check and bench run inside a run: run-level rules (approve, init --write) apply
    if (r.decision !== 'allow') throw new Error(`cannot run inside a check script (MIS_CLI is set), because the guard cannot ask there (${r.reason}); run it yourself so the guard can ask`);
  }
  // --strict (review 2026-11-10, ISSUE-005): the result in the exit code for CI; without it 0 as before (skills read the JSON)
  const strict = STRICT[name] && args.includes('--strict');
  const out = await cmd(strict ? args.filter((a) => a !== '--strict') : args, process.cwd());
  if (typeof out === 'string') process.stdout.write(out.endsWith('\n') ? out : out + '\n');
  else if (out !== undefined) console.log(JSON.stringify(out, null, 2));
  if (strict) process.exitCode = STRICT[name](out);
} catch (e) {
  console.error(`mis ${name}: ${e.message}`);
  process.exit(1);
}
