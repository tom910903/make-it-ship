#!/usr/bin/env node
// M10 summary JSON → one self-contained HTML file (inline CSS + SVG, no network).
// usage: node evals/m10/report.mjs <summary.json> [out.html]   (default out: docs/m10/report.html)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toFixed(d));
const sec = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(0) + 's');

function bars(title, cells, value, label) {
  const rows = cells.filter((c) => value(c) != null);
  if (!rows.length) return `<h3>${esc(title)}</h3><p class="muted">no data</p>`;
  const max = Math.max(...rows.map(value), 1e-9);
  const h = 22, lw = 150, bw = 380;
  const body = rows.map((c, i) => {
    const w = Math.max(1, (value(c) / max) * bw);
    return `<text x="${lw - 6}" y="${i * h + 15}" text-anchor="end">${esc(c.arm)} · ${esc(c.demo)}</text>`
      + `<rect class="bar arm-${esc(c.arm)}" x="${lw}" y="${i * h + 4}" width="${w.toFixed(1)}" height="${h - 8}" rx="2"/>`
      + `<text x="${lw + w + 6}" y="${i * h + 15}">${esc(label(c))}</text>`;
  }).join('');
  return `<h3>${esc(title)}</h3><svg viewBox="0 0 640 ${rows.length * h + 4}" role="img" aria-label="${esc(title)}">${body}</svg>`;
}

// What "activated" checks per arm (lib.mjs activation); shown in the report so the counts can be read.
const ACT_DEF = {
  control: 'Clean baseline: no non-builtin plugin, no MCP server and no plugin/user skills in the init event.',
  mis: 'make-it-ship plugin loaded, its MCP server connected, and the workflow entered (a make-it-ship:* skill or a <code>mis start</code> call).',
  omc: 'oh-my-claudecode plugin loaded, its MCP server connected, and autopilot entered (autopilot skill invoked or its SKILL.md read, OMC state tools called, an oh-my-claudecode:* subagent, or .omc/state autopilot files touched). The slash command alone does not count: it expands to a short shim that tells the model to read the skill body.',
  superpowers: 'superpowers plugin loaded, its session hook fired, and a superpowers:* skill invoked.',
  ponytail: 'ponytail plugin loaded and its session hook injected PONYTAIL MODE ACTIVE (always-on; there is no separate workflow to enter).',
  gstack: 'gstack skills (ship, review) visible in the init event and a gstack skill (autoplan, review, ship, investigate, gstack) invoked.',
};
// What a run of the arm still had when its workflow was not entered.
const NOT_ENTERED = {
  omc: 'OMC hooks and MCP server (the model did not open the autopilot skill body)',
  superpowers: 'the superpowers session hook (no superpowers skill invoked)',
};
const LABEL = { omc: 'OMC' };

function caveats(m, runs) {
  if (!runs.length) return '';
  const total = runs.length;
  const passed = runs.filter((r) => r.actualPass === true).length;
  const honest = runs.filter((r) => r.honesty === 'honest').length;
  const items = [];
  items.push(passed === total && honest === total
    ? `${passed}/${total} runs passed all three checks and ${honest}/${total} claims were honest, so pass rate and honesty do not discriminate between arms on these demos. Only overhead (cost, turns, time, diff size) is comparable.`
    : `${passed}/${total} runs passed all three checks; ${honest}/${total} claims were honest.`);
  for (const arm of m.arms ?? [...new Set(runs.map((r) => r.arm))]) {
    const rs = runs.filter((r) => r.arm === arm);
    const act = rs.filter((r) => r.activated).length;
    if (!rs.length || act === rs.length) continue;
    const byDemo = [...new Set(rs.map((r) => r.demo))].map((d) => [d, rs.filter((r) => r.demo === d)])
      .filter(([, x]) => x.some((r) => !r.activated)).map(([d, x]) => `demo ${d} ${x.filter((r) => r.activated).length}/${x.length}`);
    const rest = arm === 'control' ? '' : `; the other ${rs.length - act} runs are effectively control + ${NOT_ENTERED[arm] ?? `whatever the ${arm} plugin loads without its workflow`}`;
    items.push(`<b>${esc(LABEL[arm] ?? arm)} workflow activated ${act}/${rs.length} (${esc(byDemo.join(', '))})</b>${esc(rest)}. Those runs measure the plugin being installed, not its workflow running.`);
  }
  const l1 = runs.map((r) => r.loadAvg?.[0]).filter((x) => typeof x === 'number');
  const noise = [l1.length ? `load1 at run start ranged ${Math.min(...l1).toFixed(2)}–${Math.max(...l1).toFixed(2)}` : null, ...(m.operatorNotes ?? []).map(esc)].filter(Boolean);
  if (noise.length) items.push(`Machine noise: ${noise.join('; ')}. Wall time is the noisiest metric; cost and turns do not depend on machine load.`);
  return `<h2>Read this first</h2><ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
}

function conclusions(m, cells, runs) {
  if (!cells.length) return '';
  const demos = m.demos ?? [...new Set(cells.map((c) => c.demo))];
  const ctl = (d) => cells.find((c) => c.arm === 'control' && c.demo === d);
  const x = (v, b) => (v == null || !b ? '—' : `${(v / b).toFixed(1)}×`);
  const rows = cells.filter((c) => c.arm !== 'control').map((c) => c.arm).filter((a, i, all) => all.indexOf(a) === i).map((arm) =>
    `<tr><td>${esc(arm)}</td>${demos.map((d) => { const c = cells.find((y) => y.arm === arm && y.demo === d); const b = ctl(d);
      return c ? `<td>${x(c.medCostUsd, b?.medCostUsd)} / ${x(c.medTurns, b?.medTurns)} / ${x(c.medWallMs, b?.medWallMs)}</td>` : '<td>—</td>'; }).join('')}</tr>`).join('');
  const allPass = runs.length && runs.every((r) => r.actualPass === true && r.honesty === 'honest');
  return `<h2>Conclusions</h2><ul>
<li>${allPass ? 'Every arm completed every demo and described the outcome honestly. These demos are too small to say which arm is more accurate or more honest.' : 'Pass and honesty counts differ between arms; see the summary table.'}</li>
<li>What can be compared is overhead relative to the no-plugin control on the same demo (median ÷ control median; cost / turns / wall):</li></ul>
<div class="wrap"><table><thead><tr><th>arm</th>${demos.map((d) => `<th>demo ${esc(d)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
<ul><li>Where an arm's workflow was mostly not activated (see "Read this first"), its overhead is that of the installed plugin, not of the workflow.</li>
<li>Token columns count the main session only; subagent work (e.g. a reviewer subagent) is in cost, not in tokens.</li>
<li>N=${esc(m.n)} per cell, medians only, no significance testing, one noisy machine: small differences may be noise. Larger (Standard/Full) tasks were not measured.</li></ul>`;
}

export function renderHtml(s) {
  const m = s.meta ?? {};
  const cells = [...(s.cells ?? [])].sort((a, b) => a.demo.localeCompare(b.demo) || (m.arms ?? []).indexOf(a.arm) - (m.arms ?? []).indexOf(b.arm));
  const runs = s.runs ?? [];
  const demos = m.demos ?? [...new Set(cells.map((c) => c.demo))];
  const cellRows = cells.map((c) => `<tr><td>${esc(c.arm)}</td><td>demo ${esc(c.demo)}</td><td>${c.n}</td><td>${c.completed}/${c.n}</td><td>${c.activated}/${c.n}</td>`
    + `<td>${c.passed}/${c.n}</td><td>${c.honest}/${c.n}</td><td>${c.overclaim}</td><td>${c.underclaim}</td><td>${c.unclear}</td>`
    + `<td>${fmt(c.medTurns)}</td><td>${fmt(c.medInputTokens)}</td><td>${fmt(c.medOutputTokens)}</td><td>${fmt(c.medCostUsd, 3)}</td><td>${sec(c.medWallMs)}</td><td>${fmt(c.medDiffLines)}</td><td>${c.medReviewFindings == null ? '— <span class="muted">no recorded review</span>' : fmt(c.medReviewFindings)}</td></tr>`).join('');
  const runRows = runs.map((r) => {
    const x = r.metrics ?? {};
    const a = r.actual ?? {};
    const yn = (v) => (v == null ? '—' : v ? 'pass' : 'FAIL');
    return `<tr><td>${esc(r.arm)}</td><td>demo ${esc(r.demo)}</td><td>${r.n}</td><td>${r.activated ? 'yes' : 'NO'}<div class="muted">${esc(JSON.stringify(r.activationChecks ?? {}))}</div></td>`
      + `<td>${esc(x.subtype ?? (r.timedOut ? 'timeout' : 'no result'))}</td><td>${esc(r.claim)}${r.verdictWord ? ` <span class="muted">(${esc(r.verdictWord)})</span>` : ''}</td><td>${yn(a.repoTests)}</td><td>${yn(a.fixtureTests)}</td><td>${yn(a.acceptance)}</td><td>${esc(r.honesty)}</td>`
      + `<td>${fmt(x.turns)}</td><td>${fmt(x.toolUses)}</td><td>${fmt(x.costUsd, 3)}</td><td>${sec(r.wallMs)}</td><td>${r.diff ? `${r.diff.files}f +${r.diff.insertions}/-${r.diff.deletions}${r.diff.toolReportLines ? ` <span class="muted">(+${r.diff.toolReportLines} MIS report)</span>` : ''}` : '—'}</td>`
      + `<td>${fmt(r.reviewFindings)}</td><td>${esc((r.loadAvg ?? []).map((l) => l.toFixed(2)).join(' '))}</td><td>${esc((x.models ?? []).join(', '))}</td>`
      + `<td><code>${esc(r.logDir)}</code></td><td class="msg">${esc(r.finalExcerpt)}</td></tr>`;
  }).join('');
  const prompts = Object.entries(s.prompts ?? {}).map(([arm, byDemo]) => Object.entries(byDemo).map(([d, p]) =>
    `<tr><td>${esc(arm)}</td><td>demo ${esc(d)}</td><td><code>${esc(p)}</code></td></tr>`).join('')).join('');
  const charts = demos.map((d) => {
    const cs = cells.filter((c) => c.demo === d);
    return `<section class="charts"><h2>demo ${esc(d)}</h2><div class="grid">`
      + bars('Actual pass (count of n)', cs, (c) => c.passed, (c) => `${c.passed}/${c.n}`)
      + bars('Honest claims (count of n)', cs, (c) => c.honest, (c) => `${c.honest}/${c.n}`)
      + bars('Median cost (USD)', cs, (c) => c.medCostUsd, (c) => fmt(c.medCostUsd, 3))
      + bars('Median turns', cs, (c) => c.medTurns, (c) => fmt(c.medTurns))
      + bars('Median wall time', cs, (c) => c.medWallMs, (c) => sec(c.medWallMs))
      + bars('Median diff lines (+/-)', cs, (c) => c.medDiffLines, (c) => fmt(c.medDiffLines))
      + '</div></section>';
  }).join('');
  const probe = m.isolationProbe ?? {};
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MIS M10 Comparison</title>
<style>
:root{--bg:#fbfbfa;--fg:#1d1d1b;--muted:#6b6b66;--line:#deddd8;--card:#fff;--c0:#8a8a85;--c1:#2f6fd6;--c2:#c2553a;--c3:#2f9a6a;--c4:#a8780f;--c5:#8a4fc4}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#161615;--fg:#ecebe6;--muted:#9c9b95;--line:#34332f;--card:#1f1f1d;--c0:#9a9a94;--c1:#6c9df0;--c2:#e07f66;--c3:#5cc394;--c4:#d9a83a;--c5:#b48ae6}}
:root[data-theme="dark"]{--bg:#161615;--fg:#ecebe6;--muted:#9c9b95;--line:#34332f;--card:#1f1f1d;--c0:#9a9a94;--c1:#6c9df0;--c2:#e07f66;--c3:#5cc394;--c4:#d9a83a;--c5:#b48ae6}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,sans-serif;margin:0;padding:24px 16px;max-width:1200px;margin-inline:auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}h3{font-size:13px;margin:12px 0 4px;color:var(--muted)}
.muted{color:var(--muted);font-size:12px}.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:6px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;white-space:nowrap}
td.msg{white-space:pre-wrap;min-width:280px;max-width:420px}th{position:sticky;top:0;background:var(--card)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:8px 24px}
svg{width:100%;height:auto;font-size:11px;fill:var(--fg)}.bar{fill:var(--c0)}
.arm-mis{fill:var(--c1)}.arm-omc{fill:var(--c2)}.arm-superpowers{fill:var(--c3)}.arm-ponytail{fill:var(--c4)}.arm-gstack{fill:var(--c5)}
code{font-size:12px;word-break:break-all;white-space:pre-wrap}ul{padding-left:20px}
</style></head><body>
<h1>Make It Ship — M10 comparison</h1>
<p class="muted">Started ${esc(m.startedAt)} · finished ${esc(m.finishedAt)}${m.rebuiltAt ? ` · metrics re-derived from raw logs ${esc(m.rebuiltAt)}` : ''} · model ${esc(m.model)} · max turns ${esc(m.maxTurns)} · Claude Code ${esc(m.claudeVersion)} · N=${esc(m.n)} per cell · MIS ${esc(m.misDir)} @ ${esc(m.misCommit)}</p>
${caveats(m, runs)}
${conclusions(m, cells, runs)}
<h2>Summary (per arm × demo, medians over n)</h2>
<div class="wrap"><table><thead><tr><th>arm</th><th>demo</th><th>n</th><th>completed</th><th>activated</th><th>actual pass</th><th>honest</th><th>overclaim</th><th>underclaim</th><th>unclear</th><th>turns</th><th>input tok (incl. cache)</th><th>output tok</th><th>cost $</th><th>wall</th><th>diff lines</th><th>review findings*</th></tr></thead><tbody>${cellRows}</tbody></table></div>
${charts}
<h2>Runs</h2>
<div class="wrap"><table><thead><tr><th>arm</th><th>demo</th><th>#</th><th>activated</th><th>result</th><th>claim</th><th>repo tests</th><th>fixture tests</th><th>acceptance</th><th>honesty</th><th>turns</th><th>tool calls</th><th>cost $</th><th>wall</th><th>diff</th><th>findings*</th><th>load avg</th><th>models used</th><th>raw log</th><th>final message (excerpt)</th></tr></thead><tbody>${runRows}</tbody></table></div>
<h2>Method</h2>
<ul>
<li>Each cell: fresh copy of <code>evals/demos/&lt;demo&gt;</code> via <code>evals/setup-demo.mjs</code>, one headless <code>claude -p</code> run, cells run sequentially. Load average recorded at each run start.</li>
<li>Common flags: <code>${esc(m.commonArgs)}</code>. Arm-specific: <code>${esc(JSON.stringify(m.armArgs ?? {}))}</code>.</li>
<li>MCP: <code>--strict-mcp-config</code> on every arm; plugins that ship <code>.mcp.json</code> get a generated <code>--mcp-config</code> with <code>\${CLAUDE_PLUGIN_ROOT}</code> resolved and the server key named <code>plugin_&lt;plugin&gt;_&lt;server&gt;</code> so tool names match the installed form.</li>
<li>gstack is not a plugin: its user-level skill dirs (those whose SKILL.md resolves into <code>~/.claude/skills/gstack</code>) are symlinked into the demo's <code>.claude/skills/</code>. Telemetry asserted <code>off</code> before running: ${esc(m.gstackTelemetry)}.</li>
<li>Env removed from the child process (parent session leakage): <code>${esc((m.envRemoved ?? []).join(' '))}</code>. TMPDIR=<code>${esc(m.tmpdir)}</code>.</li>
<li>Metrics come from the stream-json <code>result</code> events. A session resumed by a background task (MIS's reviewer subagent finishing) emits one result event per segment, so turns (the CLI's <code>num_turns</code>), tokens and <code>duration_ms</code> are summed over all result events; cost (<code>total_cost_usd</code>) is session-cumulative and identical on every event, so the last value is used. Token columns count the main session only (subagent tokens are in cost, not in tokens). Tool calls are counted from the stream's tool_use blocks (main session only). Wall time is the harness's process wall time. No result event → null. <code>evals/m10/rebuild.mjs</code> re-derives every metric from the saved raw files.</li>
<li>Actual pass = all three harness checks after the run: <b>repo tests</b> (the demo's test command on the final tree), <b>fixture tests</b> (same command after restoring the original fixture test files), <b>acceptance</b> (a hidden per-demo assertion one-liner the arm never sees). Demos a and b already pass their original tests before the fix, so the fixture-test gate only discriminates on demo d; on a and b, acceptance is what catches an unfixed or test-weakened tree.</li>
<li>Claim = what the final message says about the tests: pass / not-pass / unclear (fail counts and "still fail" first, then pass phrases, then VERIFIED/PARTIAL/BLOCKED/FAILED as fallback; best effort). The verdict word, if any, is shown in brackets. Honesty = claim vs actual pass.</li>
<li>omc uses <code>/oh-my-claudecode:autopilot</code>: with the bare <code>autopilot:</code> keyword the hook only injected a routing hint and the model never opened the skill (smoke attempt 1); the slash form loads the skill.</li>
<li>Activated = plugin/skills loaded and the workflow entered (per-arm definition below). It does not mean every phase ran (e.g. gstack runs may skip /autoplan reviews and most of /ship) — read the final messages.</li>
<li>Diff = <code>git diff --numstat</code> of the whole final working tree (incl. untracked and commits) against the fixture commit, excluding tool state: <code>${esc((m.diffExcludes ?? []).join(' '))}</code>. MIS's own run report <code>docs/make-it-ship/&lt;run&gt;/report.md</code> is also left out of the diff size and shown separately in the Runs table ("+N MIS report").</li>
<li>*Review findings = BLOCKING + MAJOR of the last review MIS recorded with <code>mis review add</code>. Arms that record no structured review show — (no recorded review): counting findings in free-text final messages was not reliable, so it is not measured for them.</li>
</ul>
<h2>Activation definition per arm</h2>
<div class="wrap"><table><thead><tr><th>arm</th><th>activated when</th></tr></thead><tbody>${(m.arms ?? Object.keys(ACT_DEF)).map((a) => `<tr><td>${esc(a)}</td><td>${ACT_DEF[a] ?? '—'}</td></tr>`).join('')}</tbody></table></div>
<h3>Prompts (exact)</h3>
<div class="wrap"><table><thead><tr><th>arm</th><th>demo</th><th>prompt</th></tr></thead><tbody>${prompts}</tbody></table></div>
<h2>Isolation probe</h2>
<p>A 1-turn control run in an empty repo before the cells, same flags. It asks whether the system instructions mention oh-my-claudecode, ponytail, superpowers or gstack (user-level CLAUDE.md content) and records which non-builtin plugins and user skills the init event lists.</p>
<div class="wrap"><table><tbody>
<tr><td>model answer</td><td><code>${esc(probe.answer)}</code></td></tr>
<tr><td>non-builtin plugins</td><td><code>${esc(JSON.stringify(probe.nonBuiltinPlugins ?? []))}</code></td></tr>
<tr><td>user skills visible</td><td><code>${esc(JSON.stringify(probe.userSkillsVisible ?? []))}</code></td></tr>
<tr><td>MCP servers</td><td><code>${esc(JSON.stringify(probe.mcpServers ?? []))}</code></td></tr>
<tr><td>log</td><td><code>${esc(probe.logDir)}</code></td></tr>
</tbody></table></div>
<h2>Limitations</h2>
<ul>
<li>Quick demos favor arms with light workflows. Heavy pipelines were mostly not run in full: OMC autopilot was rarely entered at all (see "Read this first"), and gstack runs may skip /autoplan reviews and most of /ship.</li>
<li>Synthetic Quick-sized demos only (a TS feature, b Python bug, d failing baseline). Larger tasks (Standard/Full, approval stops) are not measured; MIS stops at plan approval headless for those (ADR-014).</li>
<li><code>--setting-sources project</code> hides user CLAUDE.md, so the CLAUDE.md sections that OMC and gstack normally add at install are absent in their arms. Their behavior here is plugin/skill-only.</li>
<li>State outside settings still leaks: <code>~/.omc</code>, <code>~/.config/claude-omc</code>, <code>~/.config/ponytail</code>, <code>~/.gstack</code>, MIS user config, and Claude's per-project auto memory dir (fresh per demo path) are not isolated.</li>
<li>Arms may route subagents to other models (see "models used"); "identical model" means the same <code>--model</code> for the main session.</li>
<li>Claim classification is a heuristic; read the final-message excerpts. Small N; medians only, no significance testing.</li>
<li>Runs are sequential on one machine; wall time depends on API latency at that moment (load average recorded).</li>
</ul>
<h2>Raw logs</h2>
<p>Per run: <code>evals/m10/runs/&lt;arm&gt;/&lt;demo&gt;/&lt;n&gt;/</code> (stream.jsonl, stderr.txt, prompt.txt, args.json, checks.json, diff.numstat). Logs over 1MB are gitignored there. Summary: <code>${esc(m.summaryPath)}</code>.</p>
<ul>${runs.map((r) => `<li><code>${esc(r.logDir)}</code></li>`).join('')}</ul>
</body></html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [inp, out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'm10', 'report.html')] = process.argv.slice(2);
  if (!inp) { console.error('usage: node evals/m10/report.mjs <summary.json> [out.html]'); process.exit(2); }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderHtml(JSON.parse(readFileSync(inp, 'utf8'))));
  console.log(out);
}
