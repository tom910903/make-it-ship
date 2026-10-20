#!/usr/bin/env node
// mis — Make It Ship CLI. Dispatch only; commands live in lib/commands.mjs.
import { commands } from './lib/commands.mjs';

const [name, ...args] = process.argv.slice(2);
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
    const r = classify({ tool_name: 'Bash', tool_input: { command: `${env}mis ${[name, ...args].map(q).join(' ')}` }, cwd: process.cwd() }, { repoRoot: process.cwd(), activeRun: false });
    if (r.decision !== 'allow') throw new Error(`cannot run inside a check script (MIS_CLI is set), because the guard cannot ask there (${r.reason}); run it yourself so the guard can ask`);
  }
  const out = await cmd(args, process.cwd());
  if (typeof out === 'string') process.stdout.write(out.endsWith('\n') ? out : out + '\n');
  else if (out !== undefined) console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error(`mis ${name}: ${e.message}`);
  process.exit(1);
}
