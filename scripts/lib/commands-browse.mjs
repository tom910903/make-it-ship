// mis commands of the built-in browser (M8-A): browse (gstack browse), pdf (gstack make-pdf), visual-verdict (OMC visual-verdict);
// doc and slides (visual documents, 2026-11-04) live here so every PDF goes through the one Chrome path.
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browseDir, send, status, stop, ensureDaemon } from './browse/client.mjs';
import { alwaysAskIn } from './browse/util.mjs';
import { EXTENSION_DIR } from './browse/actions.mjs';
import { listCookieDomains, readBrowserCookies } from './browse/cookies.mjs';
import { browserSkill, skillify, domainSkill } from './browse/skills.mjs';
import { markdownToHtml, markdownToSlides } from './markdown.mjs';
import { inRepo } from './commands-flow.mjs';
import { repoRoot } from './tree-hash.mjs';
import { loadConfig } from './config.mjs';
import { DEFAULT_DOCS } from './layout.mjs';
import { decodePng, encodePng, compareImages } from './png.mjs';

const USAGE = `usage: mis browse <command> [args] [--remote]
  lifecycle   start [--local-only] | status | stop | restart  (--local-only: only this machine is reachable; plain upload runs only there)
  navigate    goto <url|file> | load-html <file> | back | forward | reload | url | wait <sel|--networkidle|--load> [--timeout ms]
  read        text [sel] | html [sel] | links | forms | accessibility | data [--jsonld|--og|--meta|--twitter]
  inspect     js <expr> | eval <file> | css <sel> <prop> | attrs <sel> | is <prop> <sel> | console [--errors|--clear]
              network [--clear] | dialog [--clear] | storage [set <k> <v>] | perf | cdp <Domain.method> [json]
  interact    click <sel> | fill <sel> <value> | select <sel> <value> | hover <sel> | type <text> | press <key>
              scroll [sel] | viewport [WxH] [--scale n] | upload <sel> <file...> | dialog-accept [text] | dialog-dismiss
  visual      screenshot [--viewport|--selector css|--clip x,y,w,h] [sel|@ref] [path] | responsive [prefix]
              pdf [path] [--format letter|a4|legal] [--margins 0.5in] [--landscape] | diff <url1> <url2>
              media [--images|--videos|--audio] [sel] | inspect [sel] [--all] | ux-audit
  style       style <sel> <prop> <value> | style --undo [N] | cleanup [--ads|--cookies|--sticky|--social|--all]
              prettyscreenshot [--scroll-to sel|text] [--cleanup] [--hide sel]... [--width px] [path]
  snapshot    snapshot [-i] [-c] [-C] [-d N] [-s sel] [-D] [-a] [-o path] | snapshot -H '{"@e1":"green"}' [-o path]
              (@e refs, and @c refs from -C, for click/fill/...)
  tabs        tabs | tab <id> | newtab [url] | closetab [id] | tab-each <command> [args] | frame <sel|@ref|--name n|--url part|main>
  meta        chain '<json>'|<file>|- | handoff [reason] | resume | watch [--interval s] | watch stop | history [--clear]
  headed      connect [--profile-dir d] [--no-extension] | disconnect | focus [sel] | inbox [--clear] | extension | memory
  ask always  cookies | cookie <name>=<value> | cookie-import <file.json> | cookie-import-browser [chrome|chromium|edge|brave|arc]
              [--domain host]... [--profile Default|--profile-dir d] | header <name>:<value>|--clear | useragent <ua>
              state save|load <name> | download <url|sel> [path] | scrape <images|videos|media> [--dir d] [--limit N] | archive [path]
  skills      skill list|show|run|test|rm <name> [--arg inputN=v] | skillify <name> [--steps N] [--expect text] [--global]
              domain-skill save|list|show|edit|promote-to-global|rollback|rm [host]
  --remote    allow storage/js/eval/upload on a non-local page (the guard asks the user)`;

function take1(args, name) { const i = args.indexOf(name); if (i < 0) return undefined; if (args[i + 1] === undefined) throw new Error(`${name} needs a value`); return args.splice(i, 2)[1]; }

/** cookie-import-browser: list the store's domains, or decrypt the named domains' cookies (in this process) for the daemon. */
async function browserCookies(a) {
  const args = [...a];
  const domains = [];
  for (let d = take1(args, '--domain'); d !== undefined; d = take1(args, '--domain')) domains.push(d);
  const opts = { browser: args.find((w) => !w.startsWith('-')) ?? 'chrome', profile: take1(args, '--profile') ?? 'Default', profileDir: take1(args, '--profile-dir'), domains };
  if (!domains.length) return { domains: await listCookieDomains(opts), note: 'nothing imported; rerun with --domain <host> for the sites you need (values are never printed)' };
  return readBrowserCookies(opts);
}

function cookieFile(file, cwd) {
  if (!file) throw new Error('usage: mis browse cookie-import <cookies.json> (an array of {name, value, domain, path?, secure?, httpOnly?, sameSite?, expires?})');
  const j = JSON.parse(readFileSync(resolve(cwd, file), 'utf8'));
  const cookies = Array.isArray(j) ? j : j.cookies;
  if (!Array.isArray(cookies) || !cookies.every((c) => c?.name && c.value !== undefined && (c.domain || c.url))) throw new Error('cookie-import: expected an array of cookies with name, value and domain');
  return { cookies: cookies.map(({ url, ...c }) => ({ ...c, domain: c.domain ?? new URL(url).hostname })), source: file };
}

const EXTENSION_HELP = () => ({ path: EXTENSION_DIR,
  automatic: '`mis browse connect` starts a visible Chrome with this extension loaded (its own profile); the toolbar icon opens the side panel.',
  manual: ['Open chrome://extensions in your Chrome', 'Turn on Developer mode', `Click "Load unpacked" and pick ${EXTENSION_DIR}`, 'Pin "Make It Ship" and click it to open the side panel'],
  sidePanel: 'Notes to the agent (read with `mis browse inbox`) and an element picker that sends the CSS selector of the element you click. No terminal (see README).' });

function readChain(arg, cwd) {
  const text = arg === undefined || arg === '-' ? readFileSync(0, 'utf8') : existsSync(resolve(cwd, arg)) ? readFileSync(resolve(cwd, arg), 'utf8') : arg;
  try { return JSON.parse(text); } catch (e) { throw new Error(`chain: invalid JSON (${e.message})`); }
}

async function browse(args, cwd) {
  const remote = args.includes('--remote');
  const [sub, ...a] = args.filter((x) => x !== '--remote');
  if (!sub || sub === 'help' || sub === '--help') return USAGE;
  // the guard cannot see what a `mis check` QA script runs, so the always-ask commands only run where it can ask
  if (process.env.MIS_CLI && alwaysAskIn([sub, ...a]).length) throw new Error(`mis browse ${alwaysAskIn([sub, ...a])[0]} cannot run inside a check script (MIS_CLI is set); run it yourself so the guard can ask`);
  const dir = browseDir(cwd);
  const to = (body) => send(dir, { cwd, remote, ...body });
  if (sub === 'extension') return EXTENSION_HELP();
  if (sub === 'skill') return browserSkill(a, cwd, to);
  if (sub === 'skillify') return skillify(a, cwd, to);
  if (sub === 'domain-skill') return domainSkill(a, cwd, to);
  if (sub === 'cookie-import') return to({ cmd: sub, args: a, data: cookieFile(a[0], cwd) });
  if (sub === 'cookie-import-browser') {
    const r = await browserCookies(a);
    if (!r.cookies) return r;
    const done = await to({ cmd: sub, args: [], data: { cookies: r.cookies, source: r.source } });
    return { ...done, ...(r.skipped.length ? { skipped: r.skipped } : {}) };
  }
  if (sub === 'status') return status(dir);
  if (sub === 'stop') return stop(dir);
  if (sub === 'restart') { const { localOnly } = await status(dir); await stop(dir); await ensureDaemon(dir, { localOnly }); return status(dir); }
  if (sub === 'start') { // the mode is fixed per daemon: another mode means a restart
    const localOnly = a.includes('--local-only'), s = await status(dir);
    if (s.running && !!s.localOnly !== localOnly) await stop(dir);
    await ensureDaemon(dir, { localOnly });
    return status(dir);
  }
  return send(dir, { cmd: sub, args: sub === 'chain' ? [readChain(a[0], cwd)] : a, cwd, remote });
}

function take(args, names, isFlag = false) {
  const i = args.findIndex((a) => names.includes(a));
  if (i < 0) return undefined;
  if (isFlag) { args.splice(i, 1); return true; }
  if (args[i + 1] === undefined) throw new Error(`${names[0]} needs a value`);
  return args.splice(i, 2)[1];
}

/** mis pdf <file.md> [-o out.pdf] [--title t] [--page-size letter|a4|legal] [--margins 1in] [--no-page-numbers] [--allow-network] */
async function pdf(argv, cwd) {
  const args = [...argv];
  const o = { out: take(args, ['-o', '--out']), title: take(args, ['--title']), format: take(args, ['--page-size', '--format']),
    margins: take(args, ['--margins']), noNumbers: take(args, ['--no-page-numbers'], true), allowNetwork: take(args, ['--allow-network'], true),
    landscape: take(args, ['--landscape'], true) };
  const [file] = args;
  if (!file || args.length > 1) throw new Error('usage: mis pdf <file.md> [-o out.pdf] [--title t] [--page-size letter|a4|legal] [--margins 1in] [--no-page-numbers] [--allow-network]');
  const md = resolve(cwd, file);
  if (!existsSync(md)) throw new Error(`no such file: ${file}`);
  const out = resolve(cwd, o.out ?? join(dirname(md), `${basename(md).replace(/\.(md|markdown)$/i, '')}.pdf`));
  const { html, title, visuals, errors } = markdownToHtml(readFileSync(md, 'utf8'), { baseDir: dirname(md), title: o.title, allowNetwork: o.allowNetwork });
  mkdirSync(dirname(out), { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'mis-pdf-'));
  const htmlFile = join(tmp, 'doc.html');
  writeFileSync(htmlFile, html);
  try {
    const r = await printHtml(cwd, htmlFile, out, docPdfOpts(title, o));
    return { pdf: out, title, pages: r.pages, bytes: r.bytes, visuals, errors };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** The one Chrome PDF path (mis pdf, doc, slides): print an HTML file through the browse daemon, network blocked unless allowed. */
const printHtml = (cwd, htmlFile, out, opts) => send(browseDir(cwd), { cmd: '_render-pdf', cwd, args: [{ html: pathToFileURL(htmlFile).href, out, opts }] });
function docPdfOpts(title, o) {
  const small = 'font: 8pt Helvetica, Arial, sans-serif; color: #666; width: 100%; padding: 0 1in;';
  return { format: o.format ?? 'letter', margins: o.margins ?? '1in', landscape: o.landscape, allowNetwork: o.allowNetwork,
    header: `<div style="${small}">${title.replace(/</g, '&lt;')}</div>`,
    footer: o.noNumbers ? '<span></span>' : `<div style="${small} text-align: right;"><span class="pageNumber"></span> of <span class="totalPages"></span></div>` };
}
/** <x>.html → <x>.pdf next to it; without a browser the PDF is reported BLOCKED and the HTML stands. */
async function pdfOrBlocked(cwd, htmlFile, opts) {
  const out = htmlFile.replace(/\.html$/i, '.pdf');
  try { return { pdf: relative(cwd, out), pages: (await printHtml(cwd, htmlFile, out, opts)).pages }; } catch (e) {
    if (/BLOCKED:/.test(e.message)) return { pdf: null, blocked: e.message };
    throw e;
  }
}
// A file written next to its source needs no <base>; elsewhere a relative one keeps the HTML free of this machine's paths.
const relBase = (html, src) => { const r = relative(dirname(html), dirname(src)); return r ? `${r.split(sep).join('/')}/` : undefined; };

/** mis doc <file.md> [--pdf] [-o out.html] [--allow-network] (user decision 2026-11-04): the doc and every translation (x.md + x.<lang>.md)
 * → self-contained HTML with charts and diagrams inline, optionally PDF; inside the repository only. */
async function doc(argv, cwd) {
  const args = [...argv];
  const out = take(args, ['-o', '--out']), wantPdf = take(args, ['--pdf'], true), allowNetwork = take(args, ['--allow-network'], true);
  const [file] = args;
  if (!file || args.length > 1 || !/\.md$/i.test(file) || (out && !/\.html$/i.test(out))) throw new Error('usage: mis doc <file.md> [--pdf] [-o out.html] [--allow-network]  (translations x.<lang>.md → out.<lang>.html)');
  const src = resolve(cwd, file);
  if (!existsSync(src)) throw new Error(`no such file: ${file}`);
  // pairs as in layout: en is x.md, every other language x.<lang>.md; missing ones count only when the project lists its languages
  const configured = loadConfig(repoRoot(cwd)).config?.layout?.docs?.languages, langs = configured ?? DEFAULT_DOCS.languages;
  const m = src.match(/^(.*)\.([a-z]{2,3}(?:-[a-z0-9]+)?)\.md$/);
  const stem = m && langs.includes(m[2]) && m[2] !== 'en' ? m[1] : src.slice(0, -3), outStem = out ? resolve(cwd, out).slice(0, -5) : stem;
  const all = langs.map((lang) => { const s = lang === 'en' ? '' : `.${lang}`; return { lang, md: `${stem}${s}.md`, html: `${outStem}${s}.html` }; });
  const docs = all.filter((d) => existsSync(d.md));
  inRepo(cwd, ...docs.flatMap((d) => [d.md, d.html]));
  const results = [], errors = [];
  let visuals = 0;
  for (const d of docs) {
    const r = markdownToHtml(readFileSync(d.md, 'utf8'), { baseHref: relBase(d.html, d.md), allowNetwork, lang: d.lang });
    mkdirSync(dirname(d.html), { recursive: true });
    writeFileSync(d.html, r.html);
    visuals += r.visuals; errors.push(...r.errors.map((e) => ({ file: relative(cwd, d.md), ...e })));
    results.push({ lang: d.lang, source: relative(cwd, d.md), html: relative(cwd, d.html), ...(wantPdf ? await pdfOrBlocked(cwd, d.html, docPdfOpts(r.title, { allowNetwork })) : {}) });
  }
  return { docs: results, visuals, errors, missingTranslations: configured?.length > 1 ? all.filter((d) => !existsSync(d.md)).map((d) => relative(cwd, d.md)) : [] };
}

/** mis slides <deck.md> [-o deck.html] [--pdf]: Marp-style deck → one HTML (16:9, keyboard navigation), PDF one slide per page. */
async function slides(argv, cwd) {
  const args = [...argv];
  const out = take(args, ['-o', '--out']), wantPdf = take(args, ['--pdf'], true);
  const [file] = args;
  if (!file || args.length > 1 || !/\.md$/i.test(file) || (out && !/\.html$/i.test(out))) throw new Error('usage: mis slides <deck.md> [-o deck.html] [--pdf]');
  const src = resolve(cwd, file);
  if (!existsSync(src)) throw new Error(`no such file: ${file}`);
  const html = resolve(cwd, out ?? src.replace(/\.md$/i, '.html'));
  inRepo(cwd, src, html);
  const r = markdownToSlides(readFileSync(src, 'utf8'), { baseHref: relBase(html, src) });
  mkdirSync(dirname(html), { recursive: true });
  writeFileSync(html, r.html);
  return { html: relative(cwd, html), title: r.title, slides: r.slides, visuals: r.visuals, errors: r.errors, notes: r.notes.flat().length,
    ...(wantPdf ? await pdfOrBlocked(cwd, html, { preferCSSPageSize: true, margins: '0in' }) : {}) };
}

/** mis visual-verdict <screenshot.png> <reference.png> [--tolerance 16] [--threshold 90] [-o diff.png]; exit 1 unless it passes. */
function visualVerdict(argv, cwd) {
  const args = [...argv];
  const tolerance = Number(take(args, ['--tolerance']) ?? 16), threshold = Number(take(args, ['--threshold']) ?? 90), outArg = take(args, ['-o', '--out']);
  const [shot, ref] = args;
  if (!shot || !ref || args.length > 2) throw new Error('usage: mis visual-verdict <screenshot.png> <reference.png> [--tolerance 0-255] [--threshold 0-100] [-o diff.png]');
  const a = decodePng(readFileSync(resolve(cwd, shot))), b = decodePng(readFileSync(resolve(cwd, ref)));
  const r = compareImages(a, b, { tolerance });
  const diffImage = resolve(cwd, outArg ?? `${resolve(cwd, shot).replace(/\.png$/i, '')}.diff.png`);
  writeFileSync(diffImage, encodePng(r.diff));
  const verdict = r.score >= threshold ? 'pass' : r.score >= 50 ? 'revise' : 'fail';
  const offset = r.shift && { dx: -r.shift.dx || 0, dy: -r.shift.dy || 0 }; // where the screenshot's content sits relative to the reference
  const pct = Math.round((r.diffPixels * 1000) / Math.max(1, r.contentPixels)) / 10;
  const differences = [
    ...(r.sizeMatch ? [] : [`size differs: screenshot ${a.width}x${a.height}, reference ${b.width}x${b.height}`]),
    ...(offset ? [`the screenshot's content is offset from the reference by ${offset.dx}px horizontally, ${offset.dy}px vertically (compared after aligning; each px costs a point)`] : []),
    ...r.hotspots.map((h) => `region x ${h.x}-${h.x + h.width}, y ${h.y}-${h.y + h.height}: ${h.percent}% of its pixels differ`),
  ];
  const suggestions = [
    ...(r.sizeMatch ? [] : [`capture at the reference size (e.g. mis browse viewport ${b.width}x${b.height}, then screenshot --viewport)`]),
    ...(r.diffPixels ? ['open diffImage (red = different) and fix the listed regions, largest first; then re-run visual-verdict'] : []),
  ];
  process.exitCode = verdict === 'pass' ? 0 : 1;
  return { score: r.score, verdict, pass: verdict === 'pass', threshold, differences, suggestions,
    reasoning: `${r.diffPixels} of ${r.contentPixels} content pixels (${pct}%; the shared background is not counted) differ beyond tolerance ${tolerance}; score ${r.score} ${verdict === 'pass' ? '>=' : '<'} ${threshold}.`,
    note: 'The pixel score is only an aid. Read both images (and diffImage) and judge yourself whether the screenshot matches the reference; a pass here is not a visual verdict.',
    diffImage, width: Math.max(a.width, b.width), height: Math.max(a.height, b.height), sizeMatch: r.sizeMatch, diffPixels: r.diffPixels, contentPixels: r.contentPixels, totalPixels: r.totalPixels, tolerance, hotspots: r.hotspots, ...(offset ? { offset } : {}) };
}

/** mis open-url <url|file.html>: open a page in the user's default browser (gstack gstack-open-url). argv only, never a shell. */
function openUrl([target, ...rest], cwd) {
  if (!target || rest.length) throw new Error('usage: mis open-url <http(s)-url | file.html>');
  let url;
  if (/^https?:\/\//i.test(target)) url = new URL(target).href;
  else {
    const p = resolve(cwd, target.replace(/^file:\/\//, ''));
    if (!/\.html?$/i.test(p) || !existsSync(p) || !statSync(p).isFile()) throw new Error('open-url opens http(s) URLs and existing local .html files only');
    url = pathToFileURL(p).href;
  }
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['explorer.exe', [url]] : ['xdg-open', [url]];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return { opened: url, with: cmd };
}

export const browseCommands = { browse, pdf, doc, slides, 'visual-verdict': visualVerdict, 'open-url': openUrl };
