// mis commands of the built-in browser (M8-A): browse (gstack browse), pdf (gstack make-pdf), visual-verdict (OMC visual-verdict).
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browseDir, send, status, stop, ensureDaemon } from './browse/client.mjs';
import { markdownToHtml } from './markdown.mjs';
import { decodePng, encodePng, compareImages } from './png.mjs';

const USAGE = `usage: mis browse <command> [args] [--remote]
  lifecycle   status | stop | restart
  navigate    goto <url|file> | load-html <file> | back | forward | reload | url | wait <sel|--networkidle|--load> [--timeout ms]
  read        text [sel] | html [sel] | links | forms | accessibility | data [--jsonld|--og|--meta|--twitter]
  inspect     js <expr> | eval <file> | css <sel> <prop> | attrs <sel> | is <prop> <sel> | console [--errors|--clear]
              network [--clear] | dialog [--clear] | storage [set <k> <v>] | perf | cdp <Domain.method> [json]
  interact    click <sel> | fill <sel> <value> | select <sel> <value> | hover <sel> | type <text> | press <key>
              scroll [sel] | viewport [WxH] [--scale n] | upload <sel> <file...> | dialog-accept [text] | dialog-dismiss
  visual      screenshot [--viewport|--selector css|--clip x,y,w,h] [sel|@ref] [path] | responsive [prefix]
              pdf [path] [--format letter|a4|legal] [--margins 0.5in] [--landscape] | diff <url1> <url2>
  snapshot    snapshot [-i] [-c] [-d N] [-s sel] [-D] [-a] [-o path]   (@e refs for click/fill/...)
  tabs        tabs | tab <id> | newtab [url] | closetab [id] | frame <sel|@ref|--name n|--url part|main>
  meta        chain '<json>'|<file>|- | handoff [reason] | resume
  --remote    allow storage/js/eval on a non-local page (the guard asks the user)`;

function readChain(arg, cwd) {
  const text = arg === undefined || arg === '-' ? readFileSync(0, 'utf8') : existsSync(resolve(cwd, arg)) ? readFileSync(resolve(cwd, arg), 'utf8') : arg;
  try { return JSON.parse(text); } catch (e) { throw new Error(`chain: invalid JSON (${e.message})`); }
}

async function browse(args, cwd) {
  const remote = args.includes('--remote');
  const [sub, ...a] = args.filter((x) => x !== '--remote');
  if (!sub || sub === 'help' || sub === '--help') return USAGE;
  const dir = browseDir(cwd);
  if (sub === 'status') return status(dir);
  if (sub === 'stop') return stop(dir);
  if (sub === 'restart') { await stop(dir); await ensureDaemon(dir); return status(dir); }
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
  const { html, title } = markdownToHtml(readFileSync(md, 'utf8'), { baseDir: dirname(md), title: o.title, allowNetwork: o.allowNetwork });
  mkdirSync(dirname(out), { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'mis-pdf-'));
  const htmlFile = join(tmp, 'doc.html');
  writeFileSync(htmlFile, html);
  const small = 'font: 8pt Helvetica, Arial, sans-serif; color: #666; width: 100%; padding: 0 1in;';
  try {
    const r = await send(browseDir(cwd), { cmd: '_render-pdf', cwd, args: [{ html: pathToFileURL(htmlFile).href, out, opts: {
      format: o.format ?? 'letter', margins: o.margins ?? '1in', landscape: o.landscape, allowNetwork: o.allowNetwork,
      header: `<div style="${small}">${title.replace(/</g, '&lt;')}</div>`,
      footer: o.noNumbers ? '<span></span>' : `<div style="${small} text-align: right;"><span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    } }] });
    return { pdf: out, title, pages: r.pages, bytes: r.bytes };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
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
  const pct = Math.round((r.diffPixels * 1000) / r.totalPixels) / 10;
  const differences = [
    ...(r.sizeMatch ? [] : [`size differs: screenshot ${a.width}x${a.height}, reference ${b.width}x${b.height}`]),
    ...r.hotspots.map((h) => `region x ${h.x}-${h.x + h.width}, y ${h.y}-${h.y + h.height}: ${h.percent}% of its pixels differ`),
  ];
  const suggestions = [
    ...(r.sizeMatch ? [] : [`capture at the reference size (e.g. mis browse viewport ${b.width}x${b.height}, then screenshot --viewport)`]),
    ...(r.diffPixels ? ['open diffImage (red = different) and fix the listed regions, largest first; then re-run visual-verdict'] : []),
  ];
  process.exitCode = verdict === 'pass' ? 0 : 1;
  return { score: r.score, verdict, pass: verdict === 'pass', threshold, differences, suggestions,
    reasoning: `${r.diffPixels} of ${r.totalPixels} pixels (${pct}%) differ beyond tolerance ${tolerance}; score ${r.score} ${verdict === 'pass' ? '>=' : '<'} ${threshold}.`,
    diffImage, width: Math.max(a.width, b.width), height: Math.max(a.height, b.height), sizeMatch: r.sizeMatch, diffPixels: r.diffPixels, totalPixels: r.totalPixels, tolerance, hotspots: r.hotspots };
}

export const browseCommands = { browse, pdf, 'visual-verdict': visualVerdict };
