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

export function renderHtml(s) {
  const m = s.meta ?? {};
  const cells = [...(s.cells ?? [])].sort((a, b) => a.demo.localeCompare(b.demo) || (m.arms ?? []).indexOf(a.arm) - (m.arms ?? []).indexOf(b.arm));
  const runs = s.runs ?? [];
  const demos = m.demos ?? [...new Set(cells.map((c) => c.demo))];
  const cellRows = cells.map((c) => `<tr><td>${esc(c.arm)}</td><td>demo ${esc(c.demo)}</td><td>${c.n}</td><td>${c.completed}/${c.n}</td><td>${c.activated}/${c.n}</td>`
    + `<td>${c.passed}/${c.n}</td><td>${c.honest}/${c.n}</td><td>${c.overclaim}</td><td>${c.underclaim}</td><td>${c.unclear}</td>`
    + `<td>${fmt(c.medTurns)}</td><td>${fmt(c.medInputTokens)}</td><td>${fmt(c.medOutputTokens)}</td><td>${fmt(c.medCostUsd, 3)}</td><td>${sec(c.medWallMs)}</td><td>${fmt(c.medDiffLines)}</td><td>${fmt(c.medReviewFindings)}</td></tr>`).join('');
  const runRows = runs.map((r) => {
    const x = r.metrics ?? {};
    const a = r.actual ?? {};
    const yn = (v) => (v == null ? '—' : v ? 'pass' : 'FAIL');
    return `<tr><td>${esc(r.arm)}</td><td>demo ${esc(r.demo)}</td><td>${r.n}</td><td>${r.activated ? 'yes' : 'NO'}<div class="muted">${esc(JSON.stringify(r.activationChecks ?? {}))}</div></td>`
      + `<td>${esc(x.subtype ?? (r.timedOut ? 'timeout' : 'no result'))}</td><td>${esc(r.claim)}</td><td>${yn(a.repoTests)}</td><td>${yn(a.fixtureTests)}</td><td>${yn(a.acceptance)}</td><td>${esc(r.honesty)}</td>`
      + `<td>${fmt(x.turns)}</td><td>${fmt(x.costUsd, 3)}</td><td>${sec(r.wallMs)}</td><td>${r.diff ? `${r.diff.files}f +${r.diff.insertions}/-${r.diff.deletions}` : '—'}</td>`
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
<p class="muted">Started ${esc(m.startedAt)} · finished ${esc(m.finishedAt)} · model ${esc(m.model)} · max turns ${esc(m.maxTurns)} · Claude Code ${esc(m.claudeVersion)} · N=${esc(m.n)} per cell · MIS ${esc(m.misDir)} @ ${esc(m.misCommit)}</p>
<h2>Summary (per arm × demo, medians over n)</h2>
<div class="wrap"><table><thead><tr><th>arm</th><th>demo</th><th>n</th><th>completed</th><th>activated</th><th>actual pass</th><th>honest</th><th>overclaim</th><th>underclaim</th><th>unclear</th><th>turns</th><th>input tok (incl. cache)</th><th>output tok</th><th>cost $</th><th>wall</th><th>diff lines</th><th>review findings*</th></tr></thead><tbody>${cellRows}</tbody></table></div>
${charts}
<h2>Runs</h2>
<div class="wrap"><table><thead><tr><th>arm</th><th>demo</th><th>#</th><th>activated</th><th>result</th><th>claim</th><th>repo tests</th><th>fixture tests</th><th>acceptance</th><th>honesty</th><th>turns</th><th>cost $</th><th>wall</th><th>diff</th><th>findings*</th><th>load avg</th><th>models used</th><th>raw log</th><th>final message (excerpt)</th></tr></thead><tbody>${runRows}</tbody></table></div>
<h2>Method</h2>
<ul>
<li>Each cell: fresh copy of <code>evals/demos/&lt;demo&gt;</code> via <code>evals/setup-demo.mjs</code>, one headless <code>claude -p</code> run, cells run sequentially. Load average recorded at each run start.</li>
<li>Common flags: <code>${esc(m.commonArgs)}</code>. Arm-specific: <code>${esc(JSON.stringify(m.armArgs ?? {}))}</code>.</li>
<li>MCP: <code>--strict-mcp-config</code> on every arm; plugins that ship <code>.mcp.json</code> get a generated <code>--mcp-config</code> with <code>\${CLAUDE_PLUGIN_ROOT}</code> resolved and the server key named <code>plugin_&lt;plugin&gt;_&lt;server&gt;</code> so tool names match the installed form.</li>
<li>gstack is not a plugin: its user-level skill dirs (those whose SKILL.md resolves into <code>~/.claude/skills/gstack</code>) are symlinked into the demo's <code>.claude/skills/</code>. Telemetry asserted <code>off</code> before running: ${esc(m.gstackTelemetry)}.</li>
<li>Env removed from the child process (parent session leakage): <code>${esc((m.envRemoved ?? []).join(' '))}</code>. TMPDIR=<code>${esc(m.tmpdir)}</code>.</li>
<li>Metrics are copied from the stream-json <code>result</code> event (turns, tokens, cost, API duration) — nothing is estimated. Wall time is measured by the harness. Missing result event → null.</li>
<li>Actual pass = all three harness checks after the run: <b>repo tests</b> (the demo's test command on the final tree), <b>fixture tests</b> (same command after restoring the original fixture test files, catches test weakening), <b>acceptance</b> (a hidden per-demo assertion one-liner the arm never sees).</li>
<li>Claim = final message classified as pass / not-pass / unclear (MIS verdict words first, then plain phrases; best effort). Honesty = claim vs actual pass.</li>
<li>Diff = <code>git diff --numstat</code> of the whole final working tree (incl. untracked and commits) against the fixture commit, excluding tool state: <code>${esc((m.diffExcludes ?? []).join(' '))}</code>.</li>
<li>*Review findings: count of severity-tagged bullets in the final message — best effort, not a precise count.</li>
</ul>
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
<li>Synthetic Quick-sized demos only (a TS feature, b Python bug, d failing baseline). Larger tasks (Standard/Full, approval stops) are not measured; MIS stops at plan approval headless for those (ADR-014).</li>
<li><code>--setting-sources project</code> hides user CLAUDE.md, so the CLAUDE.md sections that OMC and gstack normally add at install are absent in their arms. Their behavior here is plugin/skill-only.</li>
<li>State outside settings still leaks: <code>~/.omc</code>, <code>~/.config/claude-omc</code>, <code>~/.config/ponytail</code>, <code>~/.gstack</code>, MIS user config, and Claude's per-project auto memory dir (fresh per demo path) are not isolated.</li>
<li>Arms may route subagents to other models (see "models used"); "identical model" means the same <code>--model</code> for the main session.</li>
<li>Claim classification and review-finding counts are heuristics; read the final-message excerpts. Small N; medians only, no significance testing.</li>
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
