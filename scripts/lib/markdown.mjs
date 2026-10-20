// Markdown → print-ready HTML for `mis pdf` (absorbs gstack make-pdf). Parsing by vendored marked (MIT, vendor/marked).
import { Marked } from '../../vendor/marked/marked.esm.js';
import { pathToFileURL } from 'node:url';

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

/** @returns {{html:string, title:string}} a complete HTML document; relative links resolve against baseDir */
export function markdownToHtml(md, { baseDir, title, allowNetwork = false } = {}) {
  const marked = new Marked({ gfm: true });
  marked.use({ renderer: {
    image({ href, text }) {
      if (/^https?:/i.test(href) && !allowNetwork) return `<span class="blocked">[remote image blocked: ${esc(text || href)}] (use --allow-network)</span>`;
      return false;
    },
  } });
  const tokens = marked.lexer(md);
  marked.walkTokens(tokens, (t) => { if (t.type === 'text' && !t.tokens && !t.escaped) t.text = smart(t.text); });
  const h1 = tokens.find((t) => t.type === 'heading' && t.depth === 1);
  const docTitle = title ?? (h1 ? smart(h1.text.replace(/[*_`]/g, '')) : 'Document');
  const base = baseDir ? `<base href="${esc(pathToFileURL(baseDir).href.replace(/\/?$/, '/'))}">` : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(docTitle)}</title>${base}<style>${PRINT_CSS}</style></head><body>${marked.parser(tokens)}</body></html>`;
  return { html, title: docTitle };
}
