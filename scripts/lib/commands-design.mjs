// M9-D D7: AI design mockups (absorbs gstack design/ binary: generate, variants, iterate, evolve, compare, gallery).
// Generation calls the OpenAI image API with the user's own key: the brief (and any input image) leaves the machine,
// the guard asks every time (policy.mjs EXTERNAL_MIS), and company policy may forbid it. Output: design/variants/.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fail, flag, rootOf, readJson, writeJson, slug, stamp, textArg } from './cli-util.mjs';
import { homeDir } from './home.mjs';

const apiBase = () => (process.env.MIS_OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
function apiKey() {
  const k = (process.env.OPENAI_API_KEY ?? '').trim() || readJson(join(homeDir(), 'openai.json'))?.api_key;
  if (!k) fail('BLOCKED: no OpenAI API key (set OPENAI_API_KEY or ~/.make-it-ship/openai.json {"api_key": "..."}). Without it, sketch the design as HTML instead.');
  return k;
}
const outDir = (cwd) => { const d = join(rootOf(cwd), 'design', 'variants'); mkdirSync(d, { recursive: true }); return d; };
const index = (cwd) => join(outDir(cwd), 'variants.json');

async function callImage(input, { size = '1536x1024', quality = 'high', previous } = {}) {
  const r = await fetch(`${apiBase()}/v1/responses`, {
    method: 'POST', headers: { authorization: `Bearer ${apiKey()}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(240000),
    body: JSON.stringify({ model: 'gpt-4o', input, ...(previous ? { previous_response_id: previous } : {}), tools: [{ type: 'image_generation', model: 'gpt-image-2', size, quality }] }),
  });
  if (!r.ok) fail(`image API error (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const img = data.output?.find((o) => o.type === 'image_generation_call')?.result;
  if (!img) fail(`no image in the response (output types: ${data.output?.map((o) => o.type).join(', ') || 'none'})`);
  return { responseId: data.id, png: Buffer.from(img, 'base64') };
}

function record(cwd, entry, png) {
  const file = join(outDir(cwd), `${slug(entry.name ?? entry.brief)}-${stamp()}.png`);
  writeFileSync(file, png);
  const list = readJson(index(cwd), []);
  const rec = { ...entry, file, at: new Date().toISOString() };
  list.push(rec);
  writeJson(index(cwd), list);
  return rec;
}

const opts = (args) => ({ size: flag(args, '--size'), quality: flag(args, '--quality'), name: flag(args, '--name') });

async function design([sub, ...argv], cwd) {
  const args = [...argv];
  if (sub === 'generate') {
    const o = opts(args), brief = args.length === 1 ? textArg(cwd, args[0]) : args.join(' ');
    if (!brief) fail('usage: mis design generate <brief|file> [--size 1536x1024] [--quality high] [--name n]');
    const { responseId, png } = await callImage(brief, o);
    return record(cwd, { kind: 'generate', brief, name: o.name, responseId }, png);
  }
  if (sub === 'variants') {
    const count = Number(flag(args, '--count') ?? 3), o = opts(args), brief = args.length === 1 ? textArg(cwd, args[0]) : args.join(' ');
    if (!brief || !Number.isInteger(count) || count < 1 || count > 8) fail('usage: mis design variants <brief|file> [--count 1-8]');
    const out = [];
    for (let k = 1; k <= count; k++) {
      const { responseId, png } = await callImage(`${brief}\n\nVariation ${k} of ${count}: take a clearly different layout, type and color direction from the other variations.`, o);
      out.push(record(cwd, { kind: 'variant', brief, name: `${o.name ?? slug(brief)}-v${k}`, responseId }, png));
    }
    return { variants: out, next: 'mis design compare, then open design/variants/board.html (mis browse goto file://...) and ask the user to pick.' };
  }
  if (sub === 'iterate') {
    const [ref, ...fb] = args, o = opts(fb), feedback = fb.join(' ');
    const prev = readJson(index(cwd), []).find((v) => v.responseId === ref || basename(v.file) === ref || v.file === resolve(cwd, ref ?? ''));
    if (!prev || !feedback) fail('usage: mis design iterate <responseId|variant.png> <feedback>');
    const { responseId, png } = await callImage(`Revise the previous design: ${feedback}`, { ...o, previous: prev.responseId });
    return record(cwd, { kind: 'iterate', brief: prev.brief, feedback, name: `${slug(prev.name ?? prev.brief)}-iter`, parent: prev.responseId, responseId }, png);
  }
  if (sub === 'evolve') {
    const [img, ...rest] = args, o = opts(rest), brief = rest.join(' ');
    if (!img || !existsSync(resolve(cwd, img)) || !brief) fail('usage: mis design evolve <screenshot.png> <brief>');
    const b64 = readFileSync(resolve(cwd, img)).toString('base64');
    const input = [{ role: 'user', content: [{ type: 'input_text', text: `Evolve this screen into a better design: ${brief}` }, { type: 'input_image', image_url: `data:image/png;base64,${b64}` }] }];
    const { responseId, png } = await callImage(input, o);
    return record(cwd, { kind: 'evolve', brief, source: resolve(cwd, img), name: `${slug(brief)}-evolved`, responseId }, png);
  }
  if (sub === 'gallery') return { variants: readJson(index(cwd), []) };
  if (sub === 'compare') {
    // shortcut: a static board; gstack's served board with live feedback capture is not implemented (feedback goes in chat).
    const list = readJson(index(cwd), []).filter((v) => existsSync(v.file));
    const pngs = existsSync(outDir(cwd)) ? readdirSync(outDir(cwd)).filter((f) => f.endsWith('.png')) : [];
    if (!pngs.length) fail('no variants in design/variants/ (mis design variants <brief>)');
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const cards = pngs.map((f, i) => { const v = list.find((x) => basename(x.file) === f); return `<figure><img src="${esc(f)}" alt="variant ${i + 1}"><figcaption><b>${String.fromCharCode(65 + (i % 26))}</b> ${esc(v?.name ?? f)}<br><small>${esc(v?.feedback ?? v?.brief ?? '')}</small></figcaption></figure>`; });
    const html = `<!doctype html><meta charset="utf-8"><title>Design variants</title><style>body{font:14px system-ui;margin:16px;background:#fafafa}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}figure{margin:0;background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px}img{width:100%;height:auto}</style><h1>Design variants</h1><main>${cards.join('')}</main>`;
    const board = join(outDir(cwd), 'board.html');
    writeFileSync(board, html);
    return { board, variants: pngs.length };
  }
  return fail('usage: mis design generate <brief> | variants <brief> [--count N] | iterate <id|png> <feedback> | evolve <png> <brief> | compare | gallery');
}

export const designCommands = { design };
