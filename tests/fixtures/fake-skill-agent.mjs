// Fake subagent for `mis skill test` (stands in for `claude -p`): reads the prompt on stdin.
// It "complies" (answers OPTION A) only when the skill text is in its prompt; otherwise it rationalizes (OPTION C).
import { readFileSync } from 'node:fs';

if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_SESSION_ID) { console.error('inherited the lead Claude Code session env'); process.exit(1); }
const prompt = readFileSync(0, 'utf8');
console.log(prompt.includes('ALWAYS-PICK-A') ? 'I follow the skill: OPTION A' : 'Time is short, so OPTION C this once');
