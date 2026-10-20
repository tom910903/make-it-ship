// M9-D D1: other-model executors (absorbs OMC ask, ccg, omc interop; gstack codex, codex-probe, benchmark-models,
// model-benchmark). Every command that runs another model sends the prompt and repository content to that model's
// service: the guard always asks (policy.mjs EXTERNAL_MIS), and company policy may forbid it. Results are files; they
// never change a run's verdict (record them with `mis note second-opinion` if a run should show them).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fail, flag, projectDir, slug, stamp, which, rootOf } from './cli-util.mjs';
import { tmux, requireTmux, attachHint, SESSION_VARS } from './commands-team.mjs';

/** How each provider CLI takes a one-shot prompt, and where its login lives (for the probe). */
export const PROVIDERS = {
  codex: { argv: (p) => ['codex', 'exec', p], keys: ['CODEX_API_KEY', 'OPENAI_API_KEY'], authFile: () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json') },
  gemini: { argv: (p) => ['gemini', '-p', p], keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], authFile: () => join(homedir(), '.gemini', 'oauth_creds.json') },
  claude: { argv: (p) => ['claude', '-p', p], keys: ['ANTHROPIC_API_KEY'], authFile: () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), '.credentials.json') },
};
const POLICY = 'Company policy may forbid sending repository content to this service; the guard asked before this ran.';

function providerOf(name) {
  if (!PROVIDERS[name]) fail(`unknown provider "${name}" (known: ${Object.keys(PROVIDERS).join(', ')})`);
  if (!which(name)) fail(`BLOCKED: ${name} CLI is not on PATH (install and log in to it first; mis second-opinion probe shows what is available)`);
  return PROVIDERS[name];
}

function prompt(args, cwd) {
  const file = flag(args, '--file');
  const q = args.join(' ').trim();
  if (!q) fail('a question or task is required');
  return file ? `${q}\n\n<context file="${file}">\n${readFileSync(resolve(cwd, file), 'utf8')}\n</context>` : q;
}

/** Run one provider and write `.make-it-ship/ask/second-opinion-<provider>-<slug>-<ts>.md`. */
function runProvider(name, text, cwd, timeoutSec) {
  const p = providerOf(name), argv = p.argv(text);
  const t0 = Date.now();
  const r = spawnSync(argv[0], argv.slice(1), { cwd: rootOf(cwd), encoding: 'utf8', timeout: timeoutSec * 1000, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024 });
  const ms = Date.now() - t0;
  const exit = r.error ? (r.error.code === 'ETIMEDOUT' ? 'timeout' : r.error.message) : r.status ?? r.signal;
  const file = join(projectDir(cwd, 'ask'), `second-opinion-${name}-${slug(text.split('\n')[0])}-${stamp()}.md`);
  writeFileSync(file, `# Second opinion: ${name}\n\n- command: \`${[...argv.slice(0, -1), '<prompt>'].join(' ')}\`\n- exit: ${exit}\n- duration: ${ms} ms\n- note: advisory only; it does not change a Make It Ship verdict. ${POLICY}\n\n## Prompt\n\n${text}\n\n## Output\n\n${(r.stdout ?? '').trim() || '(no output)'}\n${r.stderr?.trim() ? `\n## Stderr\n\n${r.stderr.trim().slice(-4000)}\n` : ''}`);
  return { provider: name, file, exit, ms, bytes: Buffer.byteLength(r.stdout ?? ''), output: r.stdout ?? '' };
}

const timeoutOf = (args) => Number(flag(args, '--timeout') ?? 600);

/** mis ask <codex|gemini|claude> <question...> [--file f] [--timeout sec] */
function ask(argv, cwd) {
  const args = [...argv], timeout = timeoutOf(args), [name] = args.splice(0, 1);
  if (!name) fail('usage: mis ask <codex|gemini|claude> <question...> [--file f] [--timeout sec]');
  const { output, ...r } = runProvider(name, prompt(args, cwd), cwd, timeout);
  if (r.exit !== 0) process.exitCode = 1;
  return { ...r, next: 'Read the file, weigh it as advice, and record it with mis note second-opinion - if a run should show it.' };
}

/** mis ccg <question...>: codex and gemini (whichever exist), plus one synthesis file for Claude to finish. */
function ccg(argv, cwd) {
  const args = [...argv], timeout = timeoutOf(args), text = prompt(args, cwd);
  const present = ['codex', 'gemini'].filter((n) => which(n));
  if (!present.length) fail('BLOCKED: neither codex nor gemini is on PATH; answer with Claude alone and say the external advisors were unavailable');
  const results = present.map((n) => runProvider(n, text, cwd, timeout));
  const missing = ['codex', 'gemini'].filter((n) => !present.includes(n));
  const file = join(projectDir(cwd, 'ask'), `ccg-${slug(text.split('\n')[0])}-${stamp()}.md`);
  writeFileSync(file, `# CCG: ${text.split('\n')[0]}\n\n${POLICY}\n${missing.length ? `\nMissing perspective: ${missing.join(', ')} (not installed).\n` : ''}\n${results.map((r) => `## ${r.provider} (exit ${r.exit}, ${r.ms} ms)\n\nSource: ${r.file}\n\n${r.output.trim() || '(no output)'}\n`).join('\n')}\n## Synthesis (Claude)\n\n- Agreed:\n- Conflicts:\n- Chosen direction and why:\n- Action checklist:\n`);
  return { file, advisors: results.map(({ output, ...r }) => r), missing };
}

/** mis benchmark-models <prompt|--file f> [--models codex,gemini,claude] [--timeout sec]: same prompt, time and exit per model. */
function benchmarkModels(argv, cwd) {
  const args = [...argv], timeout = timeoutOf(args);
  const models = (flag(args, '--models') ?? 'claude,codex,gemini').split(',').filter(Boolean);
  const text = prompt(args, cwd);
  const rows = models.map((m) => {
    if (!PROVIDERS[m]) return { model: m, status: 'unknown provider' };
    if (!which(m)) return { model: m, status: 'unavailable' };
    const r = runProvider(m, text, cwd, timeout);
    return { model: m, status: r.exit === 0 ? 'ok' : `failed (${r.exit})`, ms: r.ms, bytes: r.bytes, file: r.file };
  });
  const table = ['| model | status | time (ms) | output bytes |', '|---|---|---|---|', ...rows.map((r) => `| ${r.model} | ${r.status} | ${r.ms ?? '-'} | ${r.bytes ?? '-'} |`)].join('\n');
  const file = join(projectDir(cwd, 'ask'), `benchmark-models-${stamp()}.md`);
  writeFileSync(file, `# Model benchmark\n\nPrompt: ${text.split('\n')[0]}\n\n${table}\n\nQuality is not scored automatically: compare the linked outputs.\n`);
  return { file, rows, table };
}

/** Versions and login state of the other-model CLIs. Runs only `--version`; sends nothing. */
export function probeModels() {
  return { providers: Object.entries(PROVIDERS).map(([name, p]) => {
    const path = which(name);
    if (!path) return { name, installed: false };
    const v = spawnSync(name, ['--version'], { encoding: 'utf8', timeout: 15000 });
    const auth = p.keys.some((k) => (process.env[k] ?? '').trim()) ? 'env' : existsSync(p.authFile()) ? 'file' : null;
    return { name, installed: true, path, version: (v.stdout || v.stderr || '').trim().split('\n')[0] || null, auth: auth ? `AUTH_OK (${auth})` : 'AUTH_MISSING' };
  }) };
}

/** mis interop [--session name]: one tmux window, Claude on the left and Codex on the right (absorbs omc interop). */
function interop(argv, cwd) {
  const args = [...argv], session = flag(args, '--session') ?? 'mis-interop';
  requireTmux('run mis ask codex from this session instead');
  const clean = Object.keys(process.env).filter((k) => SESSION_VARS.test(k)).map((k) => `-u ${k}`).join(' ');
  const left = process.env.MIS_INTEROP_CLAUDE_CMD ?? 'claude', right = process.env.MIS_INTEROP_CODEX_CMD ?? 'codex';
  const root = rootOf(cwd);
  for (const s of [['new-session', '-d', '-s', session, '-c', root, `env ${clean} ${left}`], ['split-window', '-h', '-t', session, '-c', root, `env ${clean} ${right}`]]) {
    const r = tmux(...s);
    if (r.status !== 0) { tmux('kill-session', '-t', session); fail(`tmux ${s[0]} failed: ${r.stderr.trim()}`); }
  }
  return { session, panes: { left, right }, attach: attachHint(session), note: POLICY };
}

export const modelCommands = { ask, ccg, 'benchmark-models': benchmarkModels, interop };
