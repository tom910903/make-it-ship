// Markdown → print-ready HTML for `mis pdf` (absorbs gstack make-pdf). Parsing by vendored marked (MIT, vendor/marked).
import { Marked } from '../../vendor/marked/marked.esm.js';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { renderDiagram } from './diagram.mjs';
import { parseChart, chartToSvg } from './chart.mjs';

/** Curly quotes and dashes ("---" em, "--" en) for prose; code is never passed through here. */
export function smart(s) {
  return s.replace(/---/g, '—').replace(/--/g, '–')
    .replace(/(^|[\s([{—–])"/g, '$1“').replace(/"/g, '”')
    .replace(/(^|[\s([{—–])'/g, '$1‘').replace(/'/g, '’');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const PRINT_CSS = `
html { font-family: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  font-size: 11pt; line-height: 1.5; color: #111; }
body { margin: 0; text-align: left; hyphens: auto; }
h1, h2, h3, h4 { line-height: 1.2; font-weight: 700; break-after: avoid; margin: 1.4em 0 .5em; }
h1 { font-size: 22pt; break-before: page; margin-top: 0; } h1:first-of-type { break-before: auto; }
h2 { font-size: 15pt; } h3 { font-size: 12.5pt; } h4 { font-size: 11pt; }
p, li { orphans: 3; widows: 3; } p { margin: 0 0 .8em; }
a { color: inherit; text-decoration: underline; text-decoration-thickness: .5pt; }
code, pre { font-family: Menlo, Consolas, "Liberation Mono", monospace; font-size: 9pt; }
pre { background: #f5f5f3; padding: .7em .9em; border-radius: 3px; white-space: pre-wrap; break-inside: avoid; }
:not(pre) > code { background: #f2f2f0; padding: 0 .2em; border-radius: 2px; }
blockquote { margin: 1em 0; padding-left: 1em; border-left: 2px solid #999; color: #444; }
table { border-collapse: collapse; margin: 1em 0; break-inside: avoid; } th, td { border-bottom: .5pt solid #bbb; padding: .3em .6em; text-align: left; }
img { max-width: 100%; height: auto; } hr { border: 0; border-top: .5pt solid #999; margin: 2em 0; }
.blocked { display: inline-block; border: 1px dashed #c00; color: #c00; padding: .2em .5em; font-size: 9pt; }
`;

// Screen-only additions for the HTML doc: print output (mis pdf) is unchanged; inline SVGs switch to dark themselves.
const SCREEN_CSS = `
figure.visual { margin: 1em 0; break-inside: avoid; } figure.visual svg { max-width: 100%; height: auto; }
@media screen { body { max-width: 46em; margin: 2em auto; padding: 0 1em; } }
@media screen and (prefers-color-scheme: dark) { html { background: #0d1117; color: #e6edf3; } pre, :not(pre) > code { background: #161b22; } blockquote { color: #9da7b3; } }
`;

/** Repository markdown is untrusted and marked passes raw HTML through: nothing in it may run, fetch or change the base; our own script only by its hash.
 * No file: images (Chrome cannot limit them to a folder): local images are inlined as data: URIs by the caller's resolver, which checks the repository. */
export const csp = (allowNetwork = false, script) => `default-src 'none'; style-src 'unsafe-inline'; img-src data:${allowNetwork ? ' https:' : ''}; base-uri 'none'; form-action 'none'; frame-src 'none'`
  + (script ? `; script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'` : '');

// Raw tags that navigate or fetch without any script (meta refresh, a foreign base, frames, plugins, forms): shown as text, never as markup.
const NAVIGATES = /<\s*\/?\s*(meta|base|link|i?frame|frameset|object|embed|applet|form|portal)\b/i;
const SCHEME = /^[a-z][\w+.-]*:/i;

/** A mermaid fence → SVG: pie and xychart-beta by chart.mjs, every other kind by diagram.mjs. */
const visual = (src) => (/^(?:\s*%%.*\n)*\s*(pie|xychart-beta)\b/.test(src) ? chartToSvg(parseChart(src)) : renderDiagram(src).svg);

/** Lex + render one markdown text. A broken mermaid block keeps its source plus an error box and lands in errors (never thrown).
 * comment(text) receives every whole HTML comment (slides: notes and directives), which is then dropped from the output. */
function render(md, { allowNetwork = false, comment, image, marp = false } = {}) {
  const marked = new Marked({ gfm: true }), errors = [], lines = [];
  let visuals = 0, n = 0;
  const local = (href) => !SCHEME.test(href) && image?.(href);
  marked.use({ renderer: {
    image({ href, text, title }) {
      if (/^https?:/i.test(href) && !allowNetwork) return `<span class="blocked">[remote image blocked: ${esc(text || href)}] (use --allow-network)</span>`;
      const src = /^(https?|data):/i.test(href) ? href : local(href);
      if (!src) return `<span class="blocked">[local image blocked: ${esc(text || href)}] (outside the repository, not found, or over 10 MB)</span>`;
      // Marp decks: `w:640` `height:30cm` keywords in the alt text size the image (CSS lengths only)
      const size = [], alt = !marp ? text : text.replace(/(^|\s)(w|width|h|height):(auto|\d+(?:\.\d+)?(?:px|cm|mm|in|pt|pc|em|rem|%)?)(?=\s|$)/g, (m, sp, k, v) => {
        size.push(`${k[0] === 'w' ? 'width' : 'height'}:${/\d$/.test(v) ? `${v}px` : v}`);
        return '';
      }).trim();
      return `<img src="${esc(src)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''}${size.length ? ` style="${size.join(';')}"` : ''}>`;
    },
    html({ text }) {
      if (NAVIGATES.test(text)) return esc(text);
      // shortcut: only the quoted src of a raw <img> is inlined (an unresolved local one is emptied); other local image references stay and the CSP blocks them
      return text.replace(/(<img\b[^>]*?\ssrc\s*=\s*)(["'])([^"']*)\2/gi, (all, pre, q, href) => (SCHEME.test(href) ? all : `${pre}"${esc(local(href) || '')}"`));
    },
    code({ text, lang }) {
      if (lang !== 'mermaid') return false;
      const i = n++;
      try { const svg = visual(text); visuals++; return `<figure class="visual">${svg}</figure>\n`; } catch (e) {
        errors.push({ index: i + 1, ...(lines[i] ? { line: lines[i] } : {}), message: e.message });
        return `<pre><code class="language-mermaid">${esc(text)}\n</code></pre><div class="blocked">mermaid: ${esc(e.message)}</div>\n`;
      }
    },
  } });
  const tokens = marked.lexer(md);
  let from = 0;
  marked.walkTokens(tokens, (t) => {
    if (t.type === 'text' && !t.tokens && !t.escaped) t.text = smart(t.text);
    if (t.type === 'code' && t.lang === 'mermaid') { // line of the fence for the error report (none for blocks nested in quotes)
      const at = md.indexOf(t.raw, from);
      lines.push(at < 0 ? undefined : md.slice(0, at).split('\n').length);
      if (at >= 0) from = at + t.raw.length;
    }
    const c = comment && t.type === 'html' && t.text.match(/^\s*<!--([\s\S]*?)-->\s*$/);
    if (c) { comment(c[1].trim()); t.text = ''; }
  });
  return { tokens, body: marked.parser(tokens), visuals, errors };
}

// our <base> goes before the CSP: base-uri 'none' then refuses only a later one from the document
const head = (lang, policy, title, base, css) => `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8">${base}<meta http-equiv="Content-Security-Policy" content="${policy}"><title>${esc(title)}</title><style>${css}</style></head>`;
const baseTag = (baseHref, baseDir) => { const h = baseHref ?? (baseDir && pathToFileURL(baseDir).href.replace(/\/?$/, '/')); return h ? `<base href="${esc(h)}">` : ''; };

/** @returns {{html:string, title:string, visuals:number, errors:{index:number, line?:number, message:string}[]}} a complete HTML document;
 * relative links resolve against baseDir (absolute file URL, for a temp copy) or baseHref (relative, for a file kept in the repository);
 * image(href) → data: URI or null for a local image (no resolver: every local image is blocked) */
export function markdownToHtml(md, { baseDir, baseHref, title, allowNetwork = false, lang = 'en', image } = {}) {
  const r = render(md, { allowNetwork, image });
  const h1 = r.tokens.find((t) => t.type === 'heading' && t.depth === 1);
  const docTitle = title ?? (h1 ? smart(h1.text.replace(/[*_`]/g, '')) : 'Document');
  const html = `${head(lang, csp(allowNetwork), docTitle, baseTag(baseHref, baseDir), PRINT_CSS + SCREEN_CSS)}<body>${r.body}</body></html>`;
  return { html, title: docTitle, visuals: r.visuals, errors: r.errors };
}

// ---------------------------------------------------------------- slides (Marp's common subset, checked against the marp-team/marpit docs)

const keyValues = (lines) => Object.fromEntries(lines.map((l) => l.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^(["'])(.*)\1$/, '$2')]));

// CommonMark thematic breaks (Marpit splits on all of them); `-` only ones directly under paragraph text are setext underlines (an <h2>) instead.
const RULER = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/, UNDERLINE = /^ {0,3}-+[ \t]*$/;
// lines that are not paragraph text: headings, quotes, list items, fences, HTML, tables, rulers
const NOT_TEXT = /^\s{0,3}(?:#{1,6}(?:\s|$)|>|[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$)|`{3,}|~{3,}|<|\|)/;

/** Front matter (`---` … `---` from line 1) and the slides, split on thematic breaks outside code fences (markdown-it's rule, as Marp). */
export function splitSlides(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n'), slides = [[]];
  let front = {}, i = 0, fence = null, para = false;
  if (/^---\s*$/.test(lines[0])) { const end = lines.findIndex((l, k) => k > 0 && /^---\s*$/.test(l)); if (end > 0) { front = keyValues(lines.slice(1, end)); i = end + 1; } }
  for (; i < lines.length; i++) {
    const l = lines[i], f = l.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (f && !fence) fence = f[1];
    else if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) { fence = null; slides.at(-1).push(l); para = false; continue; }
    const split = !fence && RULER.test(l) && !(para && UNDERLINE.test(l));
    if (split) slides.push([]); else slides.at(-1).push(l);
    // shortcut: lazy continuation lines of quotes and list items count as paragraph text; a --- under them stays in the slide
    para = !fence && !split && !(para && UNDERLINE.test(l)) && !!l.trim() && !NOT_TEXT.test(l) && !RULER.test(l);
  }
  return { front, slides: slides.map((s) => s.join('\n')) };
}

// Marp/Marpit directive names: a comment made only of these is a directive, any other comment is a presenter note.
const DIRECTIVES = new Set(['marp', 'theme', 'style', 'headingDivider', 'lang', 'size', 'math', 'title', 'author', 'description', 'image', 'keywords', 'url',
  'transition', 'paginate', 'header', 'footer', 'class', 'backgroundColor', 'backgroundImage', 'backgroundPosition', 'backgroundRepeat', 'backgroundSize', 'color']);
const directives = (text) => {
  const lines = text.split('\n').filter((l) => l.trim()), kv = keyValues(lines);
  return lines.length && Object.keys(kv).length === lines.length && Object.keys(kv).every((k) => DIRECTIVES.has(k.replace(/^_/, ''))) ? kv : null;
};
const LOCAL = ['paginate', 'header', 'footer', 'class'];

const NAV = "(()=>{const s=[...document.querySelectorAll('.slide')],c=document.getElementById('counter');let i=0;"
  + "const go=(n)=>{i=Math.max(0,Math.min(s.length-1,n));s.forEach((x,k)=>x.classList.toggle('active',k===i));c.textContent=(i+1)+' / '+s.length};"
  + "document.body.classList.add('present');addEventListener('keydown',(e)=>{const d={ArrowRight:1,ArrowDown:1,PageDown:1,' ':1,ArrowLeft:-1,ArrowUp:-1,PageUp:-1}[e.key];"
  + "if(d)go(i+d);else if(e.key==='Home')go(0);else if(e.key==='End')go(s.length-1);else return;e.preventDefault()});go(0)})()";

// 16:9 slides: stacked without the script, one at a time with it (body.present), one per 13.333in × 7.5in page in print.
const SLIDES_CSS = `
html, body { background: #444; } .notes { display: none; }
.slide { box-sizing: border-box; position: relative; width: 100vw; height: 56.25vw; max-width: 177.78vh; max-height: 100vh; margin: 0 auto 1vh; padding: 4% 6%;
  overflow: hidden; background: #fff; color: #111; font-size: min(2.6vw, 4.62vh); display: flex; flex-direction: column; justify-content: safe center; }
.slide h1 { font-size: 2.2em; break-before: auto; margin: 0 0 .4em; } .slide h2 { font-size: 1.6em; margin: 0 0 .4em; } .slide h3 { font-size: 1.25em; }
.slide pre, .slide :not(pre) > code { font-size: .75em; } .slide figure.visual { margin: .4em 0; text-align: center; } .slide svg { max-width: 100%; height: auto; max-height: min(36vw, 64vh); }
.slide > .page, .slide > .mfoot, .slide > .mhead { position: absolute; font-size: .55em; color: #888; } .slide > .page { right: 3%; bottom: 3%; }
.slide > .mfoot { left: 6%; bottom: 3%; } .slide > .mhead { left: 6%; top: 3%; }
body.present { height: 100vh; overflow: hidden; } body.present .slide { display: none; position: absolute; inset: 0; margin: auto; } body.present .slide.active { display: flex; }
#counter { position: fixed; right: 1em; bottom: .5em; font: 12px sans-serif; color: #aaa; }
@media screen and (prefers-color-scheme: dark) { html, body { background: #000; } .slide { background: #0d1117; color: #e6edf3; } .slide pre, .slide :not(pre) > code { background: #161b22; } }
@page { size: 13.333in 7.5in; margin: 0 }
@media print { html, body { background: #fff; } body.present { height: auto; overflow: visible; } #counter { display: none; }
  .slide, body.present .slide { display: flex !important; position: relative; inset: auto; width: 13.333in; height: 7.5in; max-width: none; max-height: none; margin: 0; font-size: 25pt; }
  .slide + .slide { break-before: page; } .slide svg { max-height: 4.6in; } }
`;

/** Marp-style deck → one self-contained HTML. Supported: front matter and comment directives marp, title, lang, paginate, header, footer, class
 * (`_x` for one slide) and `<!-- notes -->`. shortcut: theme, size, backgrounds (directives and `![bg]` images, drawn inline) and the other Marp directives are ignored and header/footer are
 * plain text; render with Marp itself when a deck needs them. */
export function markdownToSlides(md, { baseDir, baseHref, title, image } = {}) {
  const { front, slides } = splitSlides(md), state = Object.fromEntries(LOCAL.map((k) => [k, front[k]]));
  const notes = [], errors = [], sections = [];
  let visuals = 0, firstHeading;
  slides.forEach((src, k) => {
    const mine = [], spot = {};
    const r = render(src, { image, marp: true, comment: (c) => {
      const d = directives(c);
      if (!d) return mine.push(c);
      for (const [key, v] of Object.entries(d)) if (key[0] === '_') spot[key.slice(1)] = v; else if (LOCAL.includes(key)) state[key] = v;
    } });
    const d = { ...state, ...spot };
    firstHeading ??= r.tokens.find((t) => t.type === 'heading')?.text;
    visuals += r.visuals; notes.push(mine); errors.push(...r.errors.map((e) => ({ slide: k + 1, ...e })));
    sections.push(`<section class="slide${d.class ? ` ${esc(d.class)}` : ''}" id="s${k + 1}">${d.header ? `<div class="mhead">${esc(d.header)}</div>` : ''}${r.body}`
      + `${d.footer ? `<div class="mfoot">${esc(d.footer)}</div>` : ''}${d.paginate === 'true' ? `<div class="page">${k + 1}</div>` : ''}`
      + `${mine.length ? `<aside class="notes">${mine.map(esc).join('\n\n')}</aside>` : ''}</section>`);
  });
  const deckTitle = title ?? front.title ?? (firstHeading ? smart(firstHeading.replace(/[*_`]/g, '')) : 'Slides');
  const html = `${head(front.lang ?? 'en', csp(false, NAV), deckTitle, baseTag(baseHref, baseDir), PRINT_CSS + SLIDES_CSS)}<body>\n${sections.join('\n')}\n<div id="counter"></div><script>${NAV}</script></body></html>`;
  return { html, title: deckTitle, slides: slides.length, visuals, errors, notes };
}
