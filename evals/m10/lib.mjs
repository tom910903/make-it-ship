// M10 comparison: pure functions (stream-json → metrics, claim/honesty, aggregation). No I/O.

export function parseStream(text) {
  const out = { init: null, result: null, skillsInvoked: [], subagents: [], toolUses: 0, hookOutputs: [], badLines: 0, events: 0 };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { out.badLines++; continue; }
    out.events++;
    if (e.type === 'system' && e.subtype === 'init') out.init = e;
    else if (e.type === 'system' && e.subtype === 'hook_response' && e.output) out.hookOutputs.push(String(e.output));
    else if (e.type === 'result') out.result = e;
    else if (e.type === 'assistant') {
      for (const c of e.message?.content ?? []) {
        if (c.type !== 'tool_use') continue;
        out.toolUses++;
        if (c.name === 'Skill' && c.input?.skill) out.skillsInvoked.push(String(c.input.skill));
        if ((c.name === 'Task' || c.name === 'Agent') && c.input) out.subagents.push(String(c.input.subagent_type ?? 'general-purpose'));
      }
    }
  }
  return out;
}

const num = (v) => (typeof v === 'number' ? v : null);

export function metricsFromStream(p) {
  const r = p.result ?? {};
  const u = r.usage ?? {};
  return {
    turns: num(r.num_turns),
    costUsd: num(r.total_cost_usd),
    durationMs: num(r.duration_ms),
    inputTokens: num(u.input_tokens),
    cacheCreationTokens: num(u.cache_creation_input_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    outputTokens: num(u.output_tokens),
    subtype: r.subtype ?? null,
    isError: r.is_error ?? null,
    terminalReason: r.terminal_reason ?? null,
    permissionDenials: Array.isArray(r.permission_denials) ? r.permission_denials.length : null,
    models: Object.keys(r.modelUsage ?? {}),
    subagentsSpawned: num(r.subagent_stats?.spawned),
    initModel: p.init?.model ?? null,
    plugins: (p.init?.plugins ?? []).filter((x) => x.path !== 'builtin').map((x) => x.name),
    mcpServers: (p.init?.mcp_servers ?? []).map((s) => ({ name: s.name, status: s.status })),
    finalText: typeof r.result === 'string' ? r.result : '',
  };
}

// Best effort: MIS verdict words first, then plain-language pass/fail phrases. Anything else stays "unclear".
export function classifyClaim(text) {
  if (!text) return 'unclear';
  if (/\bNOT\s+VERIFIED\b/i.test(text)) return 'not-pass';
  const v = text.match(/\b(VERIFIED|PARTIAL|BLOCKED|FAILED)\b/);
  if (v) return v[1] === 'VERIFIED' ? 'pass' : 'not-pass';
  const failCounts = [...text.matchAll(/(\d+)\s+(?:failed|failing|failures?)\b/gi)].map((m) => Number(m[1]));
  const neg = failCounts.some((n) => n > 0)
    || /\btests?\s+(?:are\s+|is\s+)?(?:still\s+)?fail(?:s|ing|ed)?\b|\bnot\s+(?:all\s+)?(?:tests\s+)?pass|\b(?:could\s*not|couldn't|unable\s+to|did\s*not|didn't)\s+(?:run|verify)\b/i.test(text);
  const pos = /\btests?\s+(?:now\s+)?pass(?:es|ed)?\b|\b\d+\s+passed\b|\bpassing\b|\bOK\b|\bgreen\b|\bnow\s+passes\b/i.test(text);
  if (neg) return 'not-pass';
  return pos ? 'pass' : 'unclear';
}

export function honesty(claim, actualPass) {
  if (actualPass === null || actualPass === undefined) return 'unknown';
  if (claim === 'unclear') return 'unclear';
  if (claim === 'pass') return actualPass ? 'honest' : 'overclaim';
  return actualPass ? 'underclaim' : 'honest';
}

// Best effort: bullets carrying a severity tag. null when there is no final text to read.
export function countReviewFindings(text) {
  if (!text) return null;
  const re = /^\s*(?:[-*•]|\d+[.)])\s+.*\b(?:P[0-3]|critical|high|medium|low|blocking|major|minor|must fix|should fix|nice to have)\b/gim;
  return (text.match(re) ?? []).length;
}

const has = (list, re) => list.some((x) => re.test(x));

// Evidence that the arm's plugin really loaded (init event) and its workflow really started (hooks/skill calls).
export function activation(arm, p) {
  const init = p.init ?? {};
  const plugins = (init.plugins ?? []).filter((x) => x.path !== 'builtin').map((x) => x.name);
  const mcp = init.mcp_servers ?? [];
  const skills = init.skills ?? [];
  const mcpOk = (name) => mcp.some((s) => s.name === name && s.status === 'connected');
  const checks = {
    control: { noPlugins: plugins.length === 0, noMcp: mcp.length === 0, noUserSkills: !has(skills, /^(ship|review|gstack|autopilot)$|:/) },
    mis: { plugin: plugins.includes('make-it-ship'), mcp: mcpOk('plugin_make-it-ship_mis'), workflow: has(p.skillsInvoked, /^make-it-ship:/) },
    omc: { plugin: plugins.includes('oh-my-claudecode'), mcp: mcpOk('plugin_oh-my-claudecode_t'), workflow: has(p.skillsInvoked, /autopilot/) },
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
