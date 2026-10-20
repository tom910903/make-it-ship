// Fake team worker (stands in for claude/codex/gemini in tests): reads its task, commits one file.
// The task text controls it: FAIL → exit 1, SLEEP → sleep 60 s (for timeout/shutdown tests).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_SESSION_ID) { console.error('inherited the lead Claude Code session env'); process.exit(1); }
const task = JSON.parse(readFileSync(process.env.MIS_TASK_FILE, 'utf8'));
const prompt = `${task.subject}\n${task.description}`;
readFileSync(process.env.MIS_TASK_PROMPT_FILE, 'utf8'); // the prompt file must exist
const id = process.env.MIS_TASK_ID;
console.log(`fake worker ${process.env.MIS_WORKER} on task ${id}`);
if (prompt.includes('SLEEP')) await new Promise((r) => setTimeout(r, 60_000));
if (prompt.includes('FAIL')) { console.error('failing on purpose'); process.exit(1); }
writeFileSync(`out-${id}.txt`, `${process.env.MIS_WORKER}\n`);
execFileSync('git', ['add', '-A']);
execFileSync('git', ['-c', 'user.name=W', '-c', 'user.email=w@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', `task ${id}`]);
