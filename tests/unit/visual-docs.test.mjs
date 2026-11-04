// Visual documents and slides (user decision 2026-11-04): mermaid blocks in markdown → inline SVG, CSP-locked HTML, Marp-style decks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { markdownToHtml, markdownToSlides, splitSlides } from '../../scripts/lib/markdown.mjs';

const CSP = /^<!doctype html><html lang="\w+"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="([^"]+)">/;
const offline = (html) => assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/);

test('doc: mermaid diagram and chart blocks render as inline SVG; other code stays code', () => {
  const md = '# T\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\npie\n  "Dogs" : 3\n  "Cats" : 1\n```\n\n```js\nconst a = 1;\n```\n';
  const r = markdownToHtml(md, { lang: 'ko' });
  assert.equal(r.visuals, 2);
  assert.deepEqual(r.errors, []);
  assert.equal((r.html.match(/<svg/g) ?? []).length, 2);
  assert.match(r.html, /Dogs/);
  assert.doesNotMatch(r.html, /[};]text\{/, 'inline SVG styles are page-global: the diagram scopes its text rule, else chart labels grow');
  assert.match(r.html, /<code class="language-js">const a = 1;/);
  assert.match(r.html, /^<!doctype html><html lang="ko">/);
  assert.match(r.html, /prefers-color-scheme: dark/);
  offline(r.html);
});

test('doc: a broken mermaid block keeps its source, shows an error box and is reported with its line', () => {
  const md = 'intro\n\n```mermaid\nflowchart LR\n```\n\n```mermaid\nnotachart <x>\n```\n';
  const r = markdownToHtml(md);
  assert.equal(r.visuals, 0);
  assert.equal(r.errors.length, 2);
  assert.deepEqual(r.errors.map((e) => [e.index, e.line]), [[1, 3], [2, 7]]);
  assert.ok(r.errors.every((e) => typeof e.message === 'string' && e.message));
  assert.match(r.html, /<pre><code class="language-mermaid">notachart &lt;x&gt;/);
  assert.equal((r.html.match(/<div class="blocked">mermaid:/g) ?? []).length, 2);
});

test('doc: CSP meta comes first and blocks scripts from document content; https only with allowNetwork', () => {
  const md = '# x\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n';
  const { html } = markdownToHtml(md, { baseDir: '/docs' });
  const [, csp] = html.match(CSP);
  assert.equal(csp, "default-src 'none'; style-src 'unsafe-inline'; img-src file: data:");
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<base href'), 'CSP before <base>');
  assert.match(html, /<script>alert\(1\)<\/script>/); // passed through by marked, inert under the CSP
  assert.equal(markdownToHtml(md, { allowNetwork: true }).html.match(CSP)[1], "default-src 'none'; style-src 'unsafe-inline'; img-src file: data: https:");
});

test('slides: split on --- outside fences and front matter; a fenced --- stays', () => {
  const md = '---\nmarp: true\ntitle: Deck\n---\n\n# One\n\n```\n---\n```\n\n---\n\n# Two\n\n~~~md\n---\n~~~\n---\n# Three\n';
  const { front, slides } = splitSlides(md);
  assert.deepEqual(front, { marp: 'true', title: 'Deck' });
  assert.equal(slides.length, 3);
  assert.match(slides[0], /```\n---\n```/);
  assert.match(slides[1], /~~~md\n---\n~~~/);
  assert.deepEqual(splitSlides('# A\n---\n# B').slides.length, 2); // no front matter
});

test('slides: Marp subset — title, paginate, notes, directives ignored, mermaid, nav script allowed by hash only', () => {
  const md = [
    '---', 'marp: true', 'title: My deck', 'paginate: true', 'theme: gaia', '---', '',
    '# Hello', '', '<!-- say hi first -->', '', '---', '',
    '<!-- _paginate: false -->', '<!-- backgroundColor: aqua -->', '## Flow', '', '```mermaid', 'flowchart LR', '  A --> B', '```', '',
    '```html', '<!-- not a note -->', '```', '', '---', '', '## End', '', '<script>alert(1)</script>', '',
  ].join('\n');
  const r = markdownToSlides(md);
  assert.equal(r.title, 'My deck');
  assert.equal(r.slides, 3);
  assert.equal(r.visuals, 1);
  assert.deepEqual(r.notes, [['say hi first'], [], []]);
  const h = r.html;
  assert.equal((h.match(/<section class="slide"/g) ?? []).length, 3);
  assert.match(h, /<title>My deck<\/title>/);
  assert.match(h, /<aside class="notes">say hi first<\/aside>/);
  assert.match(h, /&lt;!-- not a note --&gt;/);
  assert.doesNotMatch(h, /backgroundColor/);
  assert.equal((h.match(/class="page"/g) ?? []).length, 2, 'paginate on slides 1 and 3; _paginate: false on 2');
  assert.match(h, /@page \{ size: 13\.333in 7\.5in; margin: 0 \}/);
  const scripts = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2); // ours and the deck's (blocked)
  const ours = scripts.find((s) => /keydown/.test(s));
  for (const k of ['ArrowRight', 'ArrowLeft', 'PageUp', 'PageDown', 'Home', 'End', "' '"]) assert.ok(ours.includes(k), k);
  const csp = h.match(CSP)[1];
  assert.equal(csp, `default-src 'none'; style-src 'unsafe-inline'; img-src file: data:; script-src 'sha256-${createHash('sha256').update(ours).digest('base64')}'`);
  offline(h);
});
