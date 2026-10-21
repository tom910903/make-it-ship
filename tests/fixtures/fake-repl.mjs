// Fixture REPL for `mis tty` tests: "a+b" prints the sum, "quit" exits, anything else prints an error.
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'calc> ' });
rl.prompt();
rl.on('line', (line) => {
  const m = line.trim().match(/^(-?\d+)\s*\+\s*(-?\d+)$/);
  if (line.trim() === 'quit') { rl.close(); return; }
  console.log(m ? String(Number(m[1]) + Number(m[2])) : `error: cannot parse "${line.trim()}"`);
  rl.prompt();
});
