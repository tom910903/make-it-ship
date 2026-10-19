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
  const out = await cmd(args, process.cwd());
  if (typeof out === 'string') process.stdout.write(out.endsWith('\n') ? out : out + '\n');
  else if (out !== undefined) console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error(`mis ${name}: ${e.message}`);
  process.exit(1);
}
