// M9-D D5: usage telemetry (absorbs gstack telemetry preamble, gstack-telemetry-log/-sync, gstack-analytics, community and
// security dashboards). OFF by default: nothing is written until `mis telemetry on`, and events stay in a local JSONL
// file. `sync` uploads only to an endpoint the user configured, and the guard always asks (company policy may forbid it).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail, flag } from './cli-util.mjs';
import { globalConfig, homeDir, readHome, writeHome } from './home.mjs';

const dir = () => join(homeDir(), 'telemetry');
const eventsFile = () => join(dir(), 'events.jsonl');
const settings = () => ({ enabled: false, endpoint: null, ...(globalConfig().telemetry ?? {}) });
function setSettings(patch) { const c = readHome('config.json', {}) ?? {}; writeHome('config.json', { ...c, telemetry: { ...settings(), ...patch } }); return settings(); }

/** Append one event when telemetry is on; a silent no-op when off (the default). Never throws. */
export function logEvent(e) {
  try {
    if (!settings().enabled) return false;
    mkdirSync(dir(), { recursive: true });
    appendFileSync(eventsFile(), JSON.stringify({ ts: new Date().toISOString(), ...e }) + '\n');
    return true;
  } catch { return false; }
}
export const readEvents = () => (existsSync(eventsFile()) ? readFileSync(eventsFile(), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

async function telemetry([sub, ...argv]) {
  const args = [...argv];
  if (sub === 'status' || sub === undefined) return { ...settings(), events: readEvents().length, file: eventsFile(), synced: Number(readHome('telemetry/cursor.json')?.line ?? 0) };
  if (sub === 'on') return { ...setSettings({ enabled: true }), note: 'Events are recorded locally only. Nothing is uploaded unless you run mis telemetry sync to an endpoint you set.' };
  if (sub === 'off') return setSettings({ enabled: false });
  if (sub === 'endpoint') {
    const [url] = args;
    if (url === 'none') return setSettings({ endpoint: null });
    if (!/^https?:\/\//.test(url ?? '')) fail('usage: mis telemetry endpoint <http(s)://url|none>');
    return setSettings({ endpoint: url });
  }
  if (sub === 'log') {
    const e = { event: flag(args, '--event') ?? 'skill_run', skill: flag(args, '--skill') ?? null, outcome: flag(args, '--outcome') ?? 'unknown' };
    const d = flag(args, '--duration');
    if (d !== undefined) e.durationSec = Number(d);
    return { logged: logEvent(e) };
  }
  if (sub === 'sync') {
    const { endpoint } = settings();
    if (!endpoint) fail('no endpoint (mis telemetry endpoint <url>); nothing was sent');
    const all = readEvents(), from = Number(readHome('telemetry/cursor.json')?.line ?? 0), batch = all.slice(from);
    if (!batch.length) return { sent: 0, endpoint };
    const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch), signal: AbortSignal.timeout(30000) });
    if (!r.ok) fail(`endpoint answered ${r.status}; cursor unchanged`);
    writeHome('telemetry/cursor.json', { line: from + batch.length, at: new Date().toISOString() });
    return { sent: batch.length, endpoint };
  }
  if (sub === 'dashboard') {
    const [kind] = args, { endpoint } = settings();
    if (!['community', 'security'].includes(kind)) fail('usage: mis telemetry dashboard <community|security>');
    if (!endpoint) fail('no endpoint (mis telemetry endpoint <url>); dashboards are read from <endpoint dir>/dashboard/<kind>');
    const r = await fetch(new URL(`dashboard/${kind}`, endpoint), { signal: AbortSignal.timeout(30000) });
    if (!r.ok) fail(`dashboard endpoint answered ${r.status}`);
    return r.json();
  }
  return fail('usage: mis telemetry status | on | off | endpoint <url|none> | log --skill s [--outcome o] [--duration sec] | sync | dashboard <community|security>');
}

/** mis analytics [--days N]: personal usage from the local JSONL only. */
function analytics(argv) {
  const args = [...argv], days = Number(flag(args, '--days') ?? 30), since = Date.now() - days * 86400000;
  const ev = readEvents().filter((e) => Date.parse(e.ts) >= since);
  const bySkill = {};
  for (const e of ev) {
    const s = (bySkill[e.skill ?? '(none)'] ??= { runs: 0, outcomes: {}, totalSec: 0, timed: 0 });
    s.runs++; s.outcomes[e.outcome] = (s.outcomes[e.outcome] ?? 0) + 1;
    if (Number.isFinite(e.durationSec)) { s.totalSec += e.durationSec; s.timed++; }
  }
  const skills = Object.entries(bySkill).map(([skill, s]) => ({ skill, runs: s.runs, outcomes: s.outcomes, avgSec: s.timed ? Math.round(s.totalSec / s.timed) : null })).sort((a, b) => b.runs - a.runs);
  return { days, events: ev.length, telemetry: settings().enabled ? 'on' : 'off (no new events are recorded)', skills };
}

export const telemetryCommands = { telemetry, analytics };
