// mis commands of the always-on layer (M6): style level, HUD items. Run-independent; state lives in home.mjs.
import { currentStyle, setStyle, normalizeStyle } from './style.mjs';
import { globalConfig, setGlobalConfig, homeDir, envSession } from './home.mjs';
import { detectKeywords, styleSwitch, learnedSkills, promptContext } from './keywords.mjs';
import { repoRoot } from './tree-hash.mjs';
import { readLoop, startLoop, cancelLoop } from './loop.mjs';
import { readHome, writeHome } from './home.mjs';
import { HUD_GROUPS, HUD_ITEMS, PRESETS, isCustom, isItem, isPreset, presetName, resolveHudItems } from './hud-items.mjs';
import { lastInput } from './hud-sources.mjs';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { routingChange, sectionDiff } from './routing.mjs';
import { readTimeline, timelineLog, timelineText, sessionKind } from './timeline.mjs';
import { readObservations, searchObservations } from './observe.mjs';
import { memoryRecords, readJsonl, readMemories, readSummaries } from './summarize.mjs';
import { listProjects } from './memstore.mjs';
import { importClaudeMem } from './claude-mem-import.mjs';

function style([a, b]) {
  if (a === 'default') {
    const lvl = normalizeStyle(b);
    if (!lvl) throw new Error(`usage: mis style default <off|lite|full|ultra>`);
    setGlobalConfig({ style: { ...globalConfig().style, default: lvl } });
    return { default: lvl };
  }
  if (a !== undefined) return { level: setStyle(a, envSession()) };
  return { level: currentStyle(envSession()), default: globalConfig().style.default };
}

// Rendered when no status line refresh has been seen yet (mis hud previews).
const SAMPLE_INPUT = {
  session_id: 'mis-hud-preview', model: { display_name: 'Opus' }, effort: { level: 'high' }, context_window: { used_percentage: 42 },
  rate_limits: { five_hour: { used_percentage: 23 }, seven_day: { used_percentage: 41 } },
  cost: { total_cost_usd: 1.23, total_duration_ms: 2_520_000, total_lines_added: 120, total_lines_removed: 35 },
};

/**
 * mis hud [preset <name> | add|remove <item...> | set <item...> | reset | preview [--preset <name>]]: which status line
 * parts show. A preset plus add/remove (statusLine.preset/add/remove), or with `set` a fixed list (preset custom, items).
 * The output carries what /make-it-ship:hud asks from: the groups with each part on or off, and previews rendered from the
 * last status line input (colors off, statusLine.chain not run).
 */
async function hud([sub, ...names], cwd) {
  const c = readHome('config.json', {}) ?? {};
  const sl = c.statusLine ?? {};
  const { preset: _p, add: _a, remove: _r, items: _i, ...keep } = sl; // chain and anything else stay
  const save = (next) => { writeHome('config.json', { ...c, statusLine: { ...keep, ...next } }); return { ...keep, ...next }; };
  const known = (list, br) => {
    const bad = list.filter((n) => !isItem(n));
    if (bad.length) throw new Error(`unknown HUD item ${bad.join(', ')} (known: ${Object.keys(HUD_ITEMS).join(', ')})`);
    if (!br && list.includes('br')) throw new Error('br goes only in a custom list: mis hud set <item...> with br where a new row starts');
    return list;
  };
  const presets = Object.keys(PRESETS).join('|');
  const { statusLine } = await import('../statusline.mjs');
  const last = lastInput();
  const input = last ?? { ...SAMPLE_INPUT, cwd };
  const render = (items) => statusLine(input, { items, color: false, chain: false });
  let next = sl;
  if (sub === 'preset') {
    if (names.length !== 1 || !isPreset(names[0])) throw new Error(`usage: mis hud preset <${presets}>`);
    next = save({ preset: names[0] }); // add/remove were relative to the old preset
  } else if (sub === 'set') {
    if (!names.length) throw new Error('usage: mis hud set <item...> (br starts a new row)');
    next = save({ preset: 'custom', items: known(names, true) });
  } else if (sub === 'add' || sub === 'remove') {
    if (!names.length) throw new Error(`usage: mis hud ${sub} <item...>`);
    if (isCustom(sl)) {
      const cur = resolveHudItems(sl);
      known(names, true);
      next = save({ preset: 'custom', items: sub === 'add' ? [...cur.filter((n) => !names.includes(n) || n === 'br'), ...names] : cur.filter((n) => !names.includes(n)) });
    } else {
      known(names, false);
      const base = PRESETS[presetName(sl)];
      let add = (sl.add ?? []).filter(isItem), remove = (sl.remove ?? []).filter(isItem);
      for (const n of names) {
        if (sub === 'add') { remove = remove.filter((x) => x !== n); if (!base.includes(n) && !add.includes(n)) add.push(n); }
        else { add = add.filter((x) => x !== n); if (base.includes(n) && !remove.includes(n)) remove.push(n); }
      }
      next = save({ ...(sl.preset && { preset: sl.preset }), ...(add.length && { add }), ...(remove.length && { remove }) });
    }
  } else if (sub === 'reset') next = save({});
  else if (sub === 'preview') {
    const i = names.indexOf('--preset'), p = i >= 0 ? names[i + 1] : null;
    if (i >= 0 && !isPreset(p)) throw new Error(`usage: mis hud preview [--preset <${presets}>]`);
    return { preset: p ?? presetName(sl), preview: await render(p ? PRESETS[p] : resolveHudItems(sl)), previewSource: last ? 'last status line input' : 'sample input' };
  } else if (sub !== undefined) throw new Error(`usage: mis hud [preset <${presets}> | add <item...> | remove <item...> | set <item...> | reset | preview [--preset <name>]]`);
  const items = resolveHudItems(next), custom = isCustom(next);
  const out = {
    preset: presetName(next),
    ...(!custom && { add: next.add ?? [], remove: next.remove ?? [] }),
    items,
    groups: Object.entries(HUD_GROUPS).map(([group, ks]) => ({ group, items: ks.map((name) => ({ name, on: items.includes(name), doc: HUD_ITEMS[name] })) })),
    available: Object.entries(HUD_ITEMS).map(([name, doc]) => ({ name, on: items.includes(name), doc })),
    preview: await render(items),
  };
  if (sub === undefined) {
    out.presets = {};
    for (const [p, list] of Object.entries(PRESETS)) out.presets[p] = { items: list, preview: await render(list) };
  }
  return { ...out, previewSource: last ? 'last status line input' : 'sample input', next: 'shows on the next status line refresh; no restart needed' };
}

/** Dry run of the UserPromptSubmit router: what a prompt would trigger. Changes nothing. */
function testPrompt(args, cwd) {
  const prompt = args.join(' ');
  let root = null; try { root = repoRoot(cwd); } catch { /* not a repo */ }
  const matches = detectKeywords(prompt, { disabled: globalConfig().keywords.disabled });
  const style = styleSwitch(prompt), skills = learnedSkills(prompt, root, homeDir());
  return { matches: matches.map((m) => m.name), style, skills: skills.map((s) => s.name), context: promptContext(matches, style, skills) };
}

function loop([sub, ...rest], cwd) {
  if (sub === 'start') {
    let max = 20;
    if (rest[0] === '--max') { max = Number(rest[1]); rest = rest.slice(2); }
    return startLoop(cwd, rest.join(' ').trim(), max, envSession());
  }
  if (sub === 'cancel') return cancelLoop(cwd, envSession());
  if (sub === 'status' || sub === undefined) return readLoop(cwd);
  throw new Error('usage: mis loop start [--max N] <task> | status | cancel');
}

/** Freeze edits to one directory (absorbs gstack freeze); enforced by guard.mjs for Write/Edit. */
function freeze([d], cwd) {
  if (!d) return { freezeDir: readHome('freeze.json')?.dir ?? null };
  const abs = resolve(cwd, d);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`not a directory: ${d}`);
  const dir = realpathSync(abs);
  let root = null; try { root = realpathSync(repoRoot(cwd)); } catch { /* outside a repo: applies everywhere outside repos */ }
  writeHome('freeze.json', { dir, root, at: new Date().toISOString() });
  return { freezeDir: dir };
}

function unfreeze() {
  writeHome('freeze.json', null);
  return { freezeDir: null };
}

/** M9-F8: limit edits while debugging to the hypothesis' files/dirs (guard asks outside them, unlike freeze which denies). */
function debug([sub, ...rest], cwd) {
  if (sub !== 'scope') throw new Error('usage: mis debug scope <path…> | --clear');
  if (rest[0] === '--clear') { writeHome('debug-scope.json', null); return { debugScope: null }; }
  if (!rest.length) return { debugScope: readHome('debug-scope.json')?.paths ?? null };
  const paths = rest.map((p) => {
    const abs = resolve(cwd, p);
    if (!existsSync(abs)) throw new Error(`no such file or directory: ${p}`);
    return realpathSync(abs);
  });
  let root = null; try { root = realpathSync(repoRoot(cwd)); } catch { /* outside a repo */ }
  writeHome('debug-scope.json', { paths, root, at: new Date().toISOString() });
  return { debugScope: paths };
}

/** M9-F10: `mis setup routing` shows the project CLAUDE.md routing change; `--write` (guard asks) applies it. */
export function setupRouting([sub, ...rest], cwd) {
  if (sub !== 'routing') throw new Error('usage: mis setup routing [--write]');
  let root = cwd; try { root = repoRoot(cwd); } catch { /* not a repo: the current directory */ }
  const file = join(root, 'CLAUDE.md');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const { next, old, changed } = routingChange(text);
  if (!changed) return `${file}: the Skill routing section is already current; nothing to change.`;
  if (!rest.includes('--write')) return `${file} (dry run, nothing written)\n${old ? 'replaces the existing "## Skill routing" section' : 'appends a "## Skill routing" section'}:\n\n${sectionDiff(old)}\n\nApply with: mis setup routing --write (after the user approves this change)`;
  writeFileSync(file, next);
  return { written: file, replaced: Boolean(old) };
}

/** M9-F9: project timeline (events outside runs). `mis timeline [--last N]`, `mis timeline log <event> [key=value…]`. */
function timeline([sub, ...rest], cwd) {
  if (sub === 'log') {
    const [event, ...kv] = rest;
    if (!event) throw new Error('usage: mis timeline log <event> [key=value…]');
    const extra = Object.fromEntries(kv.map((p) => [p.split('=')[0], p.split('=').slice(1).join('=')]).filter(([k]) => /^\w+$/.test(k) && !['at', 'event'].includes(k)));
    timelineLog(cwd, { ...extra, event, session: envSession(), kind: sessionKind() });
    return { logged: event };
  }
  if (sub !== undefined && sub !== '--last') throw new Error('usage: mis timeline [--last N] | log <event> [key=value…]');
  const n = sub === '--last' ? Number(rest[0]) : 50;
  return readTimeline(cwd).slice(-n).map((e) => `${e.at}  ${timelineText(e)}`).join('\n') || 'no timeline events';
}

/** Observations and summarized memories (claude-mem, 2026-11-10): `mis memory [--last N]`, `mis memory get <id…>`, `mis memory search <words…> [--type T] [--since 7d] [--limit N]`. */
function memory([sub, ...rest], cwd) {
  const usage = 'usage: mis memory [--last N] | get <id…> | search <words…> [--type bugfix|feature|refactor|change|discovery|decision|read|test|commit|command|agent|skill|failure] [--since 7d|<date>] [--limit N] [--all | --project <text>] | projects | import claude-mem [--all]';
  if (sub === 'projects') {
    const n = (d, f) => readJsonl(join(d, f)).length;
    return listProjects().map(({ dir, meta }) => `${meta.name}  ${meta.key}  observations ${n(dir, 'observations.jsonl')}, memories ${n(dir, 'memories.jsonl')}, summaries ${n(dir, 'summaries.jsonl')}`).join('\n') || 'no projects yet';
  }
  if (sub === 'import') {
    if (rest[0] !== 'claude-mem' || rest.slice(1).some((a) => a !== '--all')) throw new Error(usage);
    return importClaudeMem(cwd, { all: rest.includes('--all') });
  }
  if (sub === 'get') {
    if (!rest.length) throw new Error(usage);
    const all = [...readMemories(cwd), ...readSummaries(cwd), ...readObservations(cwd)];
    return rest.map((id) => all.find((r) => String(r.id) === String(id).replace(/^#/, '')) ?? { id, missing: true });
  }
  if (sub === 'search') {
    const opts = {}, words = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--all') { opts.project = 'all'; continue; }
      const m = rest[i].match(/^--(type|since|limit|project)$/);
      if (m) { if (rest[i + 1] === undefined) throw new Error(usage); opts[m[1]] = m[1] === 'limit' ? Number(rest[++i]) : rest[++i]; } else words.push(rest[i]);
    }
    if (!words.length || (opts.limit !== undefined && !(opts.limit >= 1))) throw new Error(usage);
    return searchObservations(memoryRecords(cwd, opts.project), words.join(' '), opts);
  }
  if (sub !== undefined && !(sub === '--last' && Number(rest[0]) >= 1)) throw new Error(usage);
  const n = sub === '--last' ? Number(rest[0]) : 50;
  return readObservations(cwd).sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-n).map((o) => `${o.at}  ${o.type} ${o.title}${o.error ? ` — ${o.error}` : ''}`).join('\n') || 'no observations';
}

export const alwaysCommands = { freeze, unfreeze, style, hud, 'test-prompt': testPrompt, loop, debug, timeline, memory };
