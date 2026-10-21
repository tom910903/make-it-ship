#!/usr/bin/env node
// Re-derive every run's metrics from the saved raw files (stream.jsonl, checks.json, diff.numstat, run.json) with the
// current lib.mjs, then rewrite summary.json and the HTML report. No model calls; runs/**/run.json stay as recorded.
// usage: node evals/m10/rebuild.mjs [summary.json] [out.html]   (defaults: evals/m10/summary.json, docs/m10/report.html)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveRun, aggregate } from './lib.mjs';
import { renderHtml } from './report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [inp = join(ROOT, 'evals', 'm10', 'summary.json'), out = join(ROOT, 'docs', 'm10', 'report.html')] = process.argv.slice(2);

const summary = JSON.parse(readFileSync(inp, 'utf8'));
const runs = summary.runs.map((old) => {
  const dir = join(ROOT, old.logDir);
  const base = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  if (base.harnessError) return base;
  return deriveRun(base, {
    stream: readFileSync(join(dir, 'stream.jsonl'), 'utf8'),
    checks: JSON.parse(readFileSync(join(dir, 'checks.json'), 'utf8')),
    numstat: readFileSync(join(dir, 'diff.numstat'), 'utf8'),
  });
});
const rebuilt = { ...summary, meta: { ...summary.meta, rebuiltAt: new Date().toISOString() }, runs, cells: aggregate(runs) };
writeFileSync(inp, JSON.stringify(rebuilt, null, 2));
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(resolve(out), renderHtml(rebuilt));
console.log(`rebuilt ${runs.length} runs → ${inp}, ${out}`);
