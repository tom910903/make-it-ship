// M0 smoke: log every PreToolUse call and return deny/ask for marker commands.
import { appendFileSync } from 'node:fs';

const log = process.env.MIS_SMOKE_LOG || '/tmp/mis-smoke.log';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || '{}');
const cmd = input.tool_input?.command ?? '';
appendFileSync(log, JSON.stringify({
  at: new Date().toISOString(),
  argv1: process.argv[2],
  envRoot: process.env.CLAUDE_PLUGIN_ROOT,
  tool: input.tool_name,
  permissionMode: input.permission_mode,
  cmd,
}) + '\n');

const decide = (permissionDecision, permissionDecisionReason) =>
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason } }));

if (cmd.includes('MIS_DENY_TEST')) decide('deny', 'make-it-ship smoke: deny marker');
else if (cmd.includes('MIS_ASK_TEST')) decide('ask', 'make-it-ship smoke: ask marker');
