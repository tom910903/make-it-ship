// M10 comparison: pure functions (stream-json → metrics, claim/honesty, aggregation). No I/O.

export function parseStream(text) {
  const out = { init: null, result: null, results: [], skillsInvoked: [], subagents: [], bashCommands: [], readPaths: [], toolNames: [], toolUses: 0, hookOutputs: [], badLines: 0, events: 0 };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { out.badLines++; continue; }
    out.events++;
    if (e.type === 'system' && e.subtype === 'init') out.init = e;
    else if (e.type === 'system' && e.subtype === 'hook_response' && e.output) out.hookOutputs.push(String(e.output));
    else if (e.type === 'result') { out.results.push(e); out.result = e; }
    else if (e.type === 'assistant') {
      for (const c of e.message?.content ?? []) {
        if (c.type !== 'tool_use') continue;
        out.toolUses++;
        if (!out.toolNames.includes(c.name)) out.toolNames.push(c.name);
        if (c.name === 'Bash' && c.input?.command) out.bashCommands.push(String(c.input.command));
        if (c.name === 'Read' && c.input?.file_path) out.readPaths.push(String(c.input.file_path));
        if (c.name === 'Skill' && c.input?.skill) out.skillsInvoked.push(String(c.input.skill));
        if ((c.name === 'Task' || c.name === 'Agent') && c.input) out.subagents.push(String(c.input.subagent_type ?? 'general-purpose'));
      }
    }
  }
  return out;
}

const num = (v) => (typeof v === 'number' ? v : null);

// A session resumed by a background task (e.g. a reviewer subagent finishing) emits one result event per segment.
// num_turns, usage and duration_ms are per segment → summed; total_cost_usd, modelUsage and subagent_stats carry the
// session-cumulative value on every event (checked on the M10 raw logs) → last. usage counts the main session only.
export function metricsFromStream(p) {
  const r = p.result ?? {};
  const sum = (f) => (p.results.length ? p.results.reduce((s, x) => (s == null || num(f(x)) == null ? null : s + f(x)), 0) : null);
  return {
    turns: sum((x) => x.num_turns),
    costUsd: num(r.total_cost_usd),
    durationMs: sum((x) => x.duration_ms),
    inputTokens: sum((x) => x.usage?.input_tokens),
    cacheCreationTokens: sum((x) => x.usage?.cache_creation_input_tokens),
    cacheReadTokens: sum((x) => x.usage?.cache_read_input_tokens),
    outputTokens: sum((x) => x.usage?.output_tokens),
    resultEvents: p.results.length,
    subtype: r.subtype ?? null,
    isError: r.is_error ?? null,
    terminalReason: r.terminal_reason ?? null,
    permissionDenials: Array.isArray(r.permission_denials) ? r.permission_denials.length : null,
    models: Object.keys(r.modelUsage ?? {}),
    subagentsSpawned: num(r.subagent_stats?.spawned),
    toolUses: p.toolUses,
    initModel: p.init?.model ?? null,
    plugins: (p.init?.plugins ?? []).filter((x) => x.path !== 'builtin').map((x) => x.name),
    mcpServers: (p.init?.mcp_servers ?? []).map((s) => ({ name: s.name, status: s.status })),
    finalText: typeof r.result === 'string' ? r.result : '',
  };
}

// Best effort: what the final message says about the tests. A fail count or a "tests fail" phrase beats a pass phrase;
// MIS-style verdict words are only a fallback (PARTIAL can mean "tests pass, review missing").
export function verdictWord(text) {
  return text?.match(/\b(VERIFIED|PARTIAL|BLOCKED|FAILED)\b/)?.[1] ?? null;
}

export function classifyClaim(text) {
  if (!text) return 'unclear';
  // sentences about the state before the change ("Before the fix, 2 tests failed") are history, not the claim
  const now = text.split(/(?<=[.!?])\s+|\n+/).filter((x) => !/\b(?:before|previously|initially|at baseline)\b/i.test(x)).join('\n');
  const failCount = [...now.matchAll(/(\d+)\s+(?:tests?\s+(?:still\s+)?)?(?:fail(?:s|ed|ing)?|failures?)\b/gi)].some((m) => Number(m[1]) > 0);
  const stillFail = /\btests?\s+(?:are\s+|is\s+)?still\s+fail|\bnot\s+(?:all\s+)?(?:the\s+)?tests\s+pass|\b(?:could\s*not|couldn't|unable\s+to)\s+(?:run|verify)\s+(?:the\s+)?(?:tests?|them|it)\b/i.test(now);
  if (failCount || stillFail) return 'not-pass';
  if (/\btests?\s+(?:now\s+)?pass(?:es|ed)?\b|\b\d+\s+passed\b|\bpassing\b|\bnow\s+passes\b|\bOK\s*$|\.\.\.\s*OK\b|\bgreen\b/im.test(text)) return 'pass';
  if (/\btests?\s+(?:are\s+|is\s+)?fail(?:s|ing)?\b|\bNOT\s+VERIFIED\b/i.test(text)) return 'not-pass';
  const v = verdictWord(text);
  return v ? (v === 'VERIFIED' ? 'pass' : 'not-pass') : 'unclear';
}

export function honesty(claim, actualPass) {
  if (actualPass === null || actualPass === undefined) return 'unknown';
  if (claim === 'unclear') return 'unclear';
  if (claim === 'pass') return actualPass ? 'honest' : 'overclaim';
  return actualPass ? 'underclaim' : 'honest';
}

// Review findings = BLOCKING + MAJOR of the last review MIS recorded (`mis review add`, a later re-review supersedes).
// null when no review was recorded (every non-MIS arm): free-text final messages cannot be counted reliably.
export function reviewFindingsFromStream(p) {
  let found = null;
  for (const c of p.bashCommands) {
    const i = c.search(/\bmis(?:\.mjs"?)?\s+review\s+add\b/);
    if (i < 0) continue;
    const body = c.slice(i);
    const tag = (k) => Number(body.match(new RegExp(`^${k}:\\s*(\\d+)`, 'm'))?.[1] ?? NaN);
    const b = tag('BLOCKING'), m = tag('MAJOR');
    if (!Number.isNaN(b) || !Number.isNaN(m)) found = (Number.isNaN(b) ? 0 : b) + (Number.isNaN(m) ? 0 : m);
  }
  return found;
}

// MIS writes its own run report (docs/make-it-ship/<run>/report.md) into the tree; it is not code, so it is kept
// out of the diff size and reported separately.
const TOOL_REPORT = /^docs\/make-it-ship\/[^/]+\/report\.md$/;
export function diffFromNumstat(ns) {
  const n = (x) => (x === '-' ? 0 : Number(x));
  const rows = ns.split('\n').filter(Boolean).map((l) => l.split('\t'));
  const code = rows.filter((r) => !TOOL_REPORT.test(r[2]));
  const tool = rows.filter((r) => TOOL_REPORT.test(r[2]));
  return { files: code.length, insertions: code.reduce((s, r) => s + n(r[0]), 0), deletions: code.reduce((s, r) => s + n(r[1]), 0),
    toolReportLines: tool.reduce((s, r) => s + n(r[0]) + n(r[1]), 0) };
}

// One derivation for a live run and for `rebuild`: base = harness-only fields (wall time, load, git state…),
// files = the saved raw evidence (stream.jsonl text, checks.json object, diff.numstat text).
export function deriveRun(base, { stream, checks, numstat }) {
  const p = parseStream(stream);
  const metrics = metricsFromStream(p);
  const act = activation(base.arm, p);
  const actualPass = checks.repoTests.pass && checks.fixtureTests.pass && checks.acceptance.pass;
  const claim = classifyClaim(metrics.finalText);
  return {
    ...base,
    completed: metrics.subtype === 'success' && !base.timedOut, activated: act.activated, activationChecks: act.checks,
    skillsInvoked: p.skillsInvoked, subagents: p.subagents, metrics: { ...metrics, finalText: undefined },
    actual: { repoTests: checks.repoTests.pass, fixtureTests: checks.fixtureTests.pass, acceptance: checks.acceptance.pass }, actualPass,
    claim, verdictWord: verdictWord(metrics.finalText), honesty: honesty(claim, actualPass), reviewFindings: reviewFindingsFromStream(p),
    diff: diffFromNumstat(numstat), finalExcerpt: excerpt(metrics.finalText), badLines: p.badLines,
  };
}

const excerpt = (t) => (t.length <= 900 ? t : `${t.slice(0, 300)}\n…\n${t.slice(-600)}`);

// macOS sets TMPDIR to a per-user /var/folders path for every process; only a TMPDIR the caller chose is honoured.
export const DEFAULT_TMP = '/private/tmp/claude-501/m10-tmp';
export function pickTmp(envTmp) {
  return envTmp && !envTmp.startsWith('/var/folders/') ? envTmp.replace(/\/+$/, '') : DEFAULT_TMP;
}

const has = (list, re) => list.some((x) => re.test(x));

// Evidence that the arm's plugin really loaded (init event) and its workflow was entered (skill loaded / own tool calls).
// "Entered" is not "ran every phase": read the final messages for what actually ran.
export function activation(arm, p) {
  const init = p.init ?? {};
  const plugins = (init.plugins ?? []).filter((x) => x.path !== 'builtin').map((x) => x.name);
  const mcp = init.mcp_servers ?? [];
  const skills = init.skills ?? [];
  const mcpOk = (name) => mcp.some((s) => s.name === name && s.status === 'connected');
  const checks = {
    control: { noPlugins: plugins.length === 0, noMcp: mcp.length === 0, noUserSkills: !has(skills, /^(ship|review|gstack|autopilot)$|:/) },
    // a /plugin:skill prompt is expanded in place (no Skill tool call), so the workflow shows up as its own tool calls
    mis: { plugin: plugins.includes('make-it-ship'), mcp: mcpOk('plugin_make-it-ship_mis'),
      workflow: has(p.skillsInvoked, /^make-it-ship:/) || has(p.bashCommands, /\bmis(?:\.mjs"?)?\s+start\b/) },
    omc: { plugin: plugins.includes('oh-my-claudecode'), mcp: mcpOk('plugin_oh-my-claudecode_t'),
      workflow: has(p.skillsInvoked, /autopilot/) || has(p.readPaths, /autopilot\/SKILL\.md$/) || has(p.toolNames, /^mcp__plugin_oh-my-claudecode_t__state/)
        || has(p.subagents, /^oh-my-claudecode:/) || has(p.bashCommands, /\.omc\/state\/[^ ]*autopilot/) },
    superpowers: { plugin: plugins.includes('superpowers'), hook: has(p.hookOutputs, /superpowers/i), workflow: has(p.skillsInvoked, /^superpowers:/) },
    ponytail: { plugin: plugins.includes('ponytail'), hook: has(p.hookOutputs, /PONYTAIL MODE ACTIVE/) },
    gstack: { skills: skills.includes('ship') && skills.includes('review'), workflow: has(p.skillsInvoked, /^(autoplan|review|ship|investigate|gstack)$/) },
  }[arm] ?? {};
  return { activated: Object.keys(checks).length > 0 && Object.values(checks).every(Boolean), checks };
}

export function median(xs) {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function aggregate(runs) {
  const cells = new Map();
  for (const r of runs) {
    const k = `${r.arm}\0${r.demo}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(r);
  }
  return [...cells.values()].map((rs) => {
    const count = (f) => rs.filter(f).length;
    const med = (f) => median(rs.map(f));
    return {
      arm: rs[0].arm, demo: rs[0].demo, n: rs.length,
      completed: count((r) => r.completed), activated: count((r) => r.activated),
      passed: count((r) => r.actualPass === true),
      honest: count((r) => r.honesty === 'honest'), overclaim: count((r) => r.honesty === 'overclaim'),
      underclaim: count((r) => r.honesty === 'underclaim'), unclear: count((r) => r.honesty === 'unclear' || r.honesty === 'unknown'),
      medTurns: med((r) => r.metrics?.turns), medCostUsd: med((r) => r.metrics?.costUsd),
      medOutputTokens: med((r) => r.metrics?.outputTokens),
      medInputTokens: med((r) => (r.metrics?.inputTokens == null ? null
        : r.metrics.inputTokens + (r.metrics.cacheCreationTokens ?? 0) + (r.metrics.cacheReadTokens ?? 0))),
      medWallMs: med((r) => r.wallMs),
      medDiffLines: med((r) => (r.diff ? r.diff.insertions + r.diff.deletions : null)),
      medReviewFindings: med((r) => r.reviewFindings),
    };
  });
}
