// `mis browse <command>` handlers, run inside the daemon. Each gets (browser, tab, args, ctx{cwd, remote, inChain}).
import { readFileSync, writeFileSync, existsSync, statSync, realpathSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { toUrl, lineDiff, toInches, isLocalOrigin } from './util.mjs';

const INTERACTIVE = new Set(['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'treeitem']);
const HIDDEN_ROLES = new Set(['generic', 'none', 'presentation', 'InlineTextBox', 'LineBreak', 'RootWebArea']);
const USAGE_ERR = (u) => new Error(`usage: mis browse ${u}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (ctx, p, fallback) => { const f = resolve(ctx.cwd, p ?? fallback); mkdirSync(dirname(f), { recursive: true }); return f; };
const tmpName = (name) => resolve(tmpdir(), `mis-browse-${Date.now()}-${name}`);
const fmt = (v) => (typeof v === 'string' ? v : v === undefined ? 'undefined' : JSON.stringify(v, null, 2));

function flags(args, spec) {
  const o = {}, rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (spec[a] === true) o[a] = true;
    else if (spec[a] === 1) { if (args[i + 1] === undefined) throw new Error(`${a} needs a value`); o[a] = args[++i]; }
    else rest.push(a);
  }
  return [o, rest];
}

const looksLikeSelector = (a) => /^[@.#[]/.test(a);

// ── snapshot ───────────────────────────────────────────────────────────────────────────────────────────────
function refFor(tab, backendId) {
  if (!backendId) return '';
  let r = tab.nodeRef.get(backendId);
  if (!r) { r = `@e${++tab.refSeq}`; tab.nodeRef.set(backendId, r); tab.refs.set(r, backendId); }
  return r;
}

function props(n) {
  let s = '';
  for (const p of n.properties ?? []) {
    const v = p.value?.value;
    if (p.name === 'level') s += ` [level=${v}]`;
    else if (['checked', 'pressed'].includes(p.name) && v && v !== 'false') s += v === 'mixed' ? ` [${p.name}=mixed]` : ` [${p.name}]`;
    else if (['disabled', 'required', 'selected', 'readonly'].includes(p.name) && v) s += ` [${p.name}]`;
    else if (p.name === 'expanded') s += ` [expanded=${v}]`;
  }
  const value = n.value?.value;
  if (value !== undefined && value !== '' && ['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider'].includes(n.role?.value)) s += `: "${String(value).slice(0, 80)}"`;
  return s;
}

async function axTree(b, tab, { interactive, compact, depth, scope, refs = true, all = false }) {
  const { nodes } = await b.send(tab, 'Accessibility.getFullAXTree', tab.frameId ? { frameId: tab.frameId } : {});
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  let root = nodes.find((n) => !n.parentId) ?? nodes[0];
  if (scope) {
    const { node } = await b.send(tab, 'DOM.describeNode', { objectId: await b.element(tab, scope) });
    root = nodes.find((n) => n.backendDOMNodeId === node.backendNodeId);
    if (!root) throw new Error(`${scope} is not in the accessibility tree`);
  }
  const lines = [], shownRefs = [];
  const clip = (s) => (s.length > 100 ? `${s.slice(0, 97)}...` : s);
  const visit = (n, d, parentName) => {
    const role = n.role?.value ?? '', name = String(n.name?.value ?? '').replace(/\s+/g, ' ').trim();
    if (role === 'StaticText') {
      if (!interactive && !compact && name && name !== parentName && (depth === undefined || d <= depth)) lines.push(`${'  '.repeat(d)}"${clip(name)}"`);
      return;
    }
    let shown = !n.ignored && (all ? role !== 'InlineTextBox' : !HIDDEN_ROLES.has(role) || (role === 'generic' && name && n !== root));
    if (interactive && !INTERACTIVE.has(role)) shown = false;
    if (compact && shown && !name && !INTERACTIVE.has(role) && !['heading', 'img', 'listitem', 'row', 'cell'].includes(role)) shown = false;
    let next = d;
    if (shown) {
      if (depth !== undefined && d > depth) return;
      const ref = refs ? refFor(tab, n.backendDOMNodeId) : '';
      if (ref) shownRefs.push(ref);
      lines.push(`${interactive ? '' : '  '.repeat(d)}${ref ? `${ref} ` : ''}[${role}]${name ? ` "${clip(name)}"` : ''}${props(n)}`);
      next = d + 1;
    }
    for (const id of n.childIds ?? []) { const c = byId.get(id); if (c) visit(c, next, shown ? name : parentName); }
  };
  visit(root, 0, '');
  return { text: lines.join('\n'), refs: shownRefs };
}

async function annotate(b, tab, refs, file) {
  const boxes = [];
  for (const r of refs) {
    const q = (await b.send(tab, 'DOM.getContentQuads', { backendNodeId: tab.refs.get(r) }).catch(() => ({ quads: [] }))).quads?.[0];
    if (q) boxes.push({ r, x: Math.min(q[0], q[6]), y: Math.min(q[1], q[3]), w: Math.max(q[2], q[4]) - Math.min(q[0], q[6]), h: Math.max(q[5], q[7]) - Math.min(q[1], q[3]) });
  }
  const frame = tab.frameId; tab.frameId = null; // overlays go into the top document
  try {
    await b.evaluate(tab, `(() => { const c = document.createElement('div'); c.id = '__mis_annotate'; c.style.cssText = 'position:absolute;left:0;top:0;z-index:2147483647;pointer-events:none';
      for (const o of ${JSON.stringify(boxes)}) { const d = document.createElement('div'); d.style.cssText = 'position:absolute;border:2px solid #e00;box-sizing:border-box;left:' + (o.x + scrollX) + 'px;top:' + (o.y + scrollY) + 'px;width:' + o.w + 'px;height:' + o.h + 'px';
        const l = document.createElement('span'); l.textContent = o.r; l.style.cssText = 'position:absolute;left:0;top:-14px;background:#e00;color:#fff;font:10px/12px monospace;padding:0 2px'; d.append(l); c.append(d); }
      document.documentElement.append(c); })()`);
    writeFileSync(file, await capture(b, tab, {}));
  } finally {
    await b.evaluate(tab, `document.getElementById('__mis_annotate')?.remove()`).catch(() => {});
    tab.frameId = frame;
  }
}

// ── screenshots ────────────────────────────────────────────────────────────────────────────────────────────
async function capture(b, tab, { viewport, clip, target }) {
  let params = { format: 'png' };
  if (target) {
    const objectId = await b.element(tab, target);
    await b.callOn(tab, objectId, function () { this.scrollIntoView({ block: 'center', behavior: 'instant' }); });
    const { quads } = await b.send(tab, 'DOM.getContentQuads', { objectId }).catch(() => ({ quads: [] }));
    if (!quads?.length) throw new Error(`${target} is not visible (it has no layout box)`);
    const xs = quads.flatMap((q) => [q[0], q[2], q[4], q[6]]), ys = quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
    const { cssVisualViewport: vv } = await b.send(tab, 'Page.getLayoutMetrics');
    const x = Math.min(...xs), y = Math.min(...ys);
    clip = { x: x + vv.pageX, y: y + vv.pageY, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  if (clip) params = { ...params, captureBeyondViewport: true, clip: { ...clip, scale: 1 } };
  else if (!viewport) {
    const m = await b.send(tab, 'Page.getLayoutMetrics');
    const c = m.cssContentSize ?? m.contentSize;
    params = { ...params, captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(c.width), height: Math.ceil(c.height), scale: 1 } };
  }
  const { data } = await b.send(tab, 'Page.captureScreenshot', params, 60000);
  return Buffer.from(data, 'base64');
}

const PAPER = { letter: [8.5, 11], a4: [8.27, 11.69], legal: [8.5, 14] };
/** printToPDF with page size, margins and optional header/footer templates; shared by `pdf` and `mis pdf`. */
export async function printPdf(b, tab, o = {}) {
  const [w, h] = PAPER[o.format ?? 'letter'] ?? (() => { throw new Error(`unknown page format ${o.format} (letter|a4|legal)`); })();
  const m = o.margins !== undefined ? toInches(o.margins) : 0.4;
  const { data } = await b.send(tab, 'Page.printToPDF', {
    paperWidth: w, paperHeight: h, landscape: !!o.landscape, printBackground: true, preferCSSPageSize: false,
    marginTop: m, marginBottom: m, marginLeft: m, marginRight: m, generateTaggedPDF: true, generateDocumentOutline: true,
    displayHeaderFooter: !!(o.header || o.footer), headerTemplate: o.header ?? '<span></span>', footerTemplate: o.footer ?? '<span></span>',
  }, 120000);
  return Buffer.from(data, 'base64');
}

// ── keyboard ───────────────────────────────────────────────────────────────────────────────────────────────
const KEYS = { Enter: [13, '\r'], Tab: [9], Escape: [27], Backspace: [8], Delete: [46], ArrowUp: [38], ArrowDown: [40], ArrowLeft: [37],
  ArrowRight: [39], Home: [36], End: [35], PageUp: [33], PageDown: [34], Space: [32, ' '], Insert: [45] };
const MODS = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Cmd: 4, Shift: 8 };
function keyEvent(spec) {
  const parts = spec.split('+'), key = parts.pop() || '+';
  let modifiers = 0;
  for (const m of parts) { if (!MODS[m]) throw new Error(`unknown modifier ${m} (Alt, Control, Meta, Shift)`); modifiers |= MODS[m]; }
  const named = KEYS[key];
  if (!named && key.length !== 1) throw new Error(`unknown key ${key} (e.g. Enter, Tab, Escape, ArrowDown, a, Shift+Tab)`);
  const vk = named ? named[0] : key.toUpperCase().charCodeAt(0);
  const code = named ? (key === 'Space' ? 'Space' : key) : /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : /\d/.test(key) ? `Digit${key}` : '';
  const text = (modifiers & 6) ? undefined : named ? named[1] : (modifiers & 8 ? key.toUpperCase() : key);
  return { key: key === 'Space' ? ' ' : key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, ...(text ? { text, unmodifiedText: text } : {}) };
}
async function press(b, tab, spec) {
  const e = keyEvent(spec);
  await b.send(tab, 'Input.dispatchKeyEvent', { type: e.text ? 'keyDown' : 'rawKeyDown', ...e });
  await b.send(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', ...e });
}

// ── page-side readers (run in the page) ───────────────────────────────────────────────────────────────────
const JS = {
  links: `[...document.querySelectorAll('a[href]')].map(a => (a.innerText.trim().replace(/\\s+/g, ' ') || a.getAttribute('aria-label') || '(no text)') + ' → ' + a.href).join('\\n')`,
  forms: `[...document.forms].map(f => ({ id: f.id || null, name: f.getAttribute('name'), action: f.action, method: (f.method || 'get').toUpperCase(),
    fields: [...f.elements].filter(e => e.tagName !== 'FIELDSET').map(e => ({ tag: e.tagName.toLowerCase(), type: e.type, name: e.name || null, id: e.id || null,
      label: (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || e.placeholder || '').trim() || null,
      value: e.type === 'password' ? (e.value ? '[redacted]' : '') : (e.type === 'checkbox' || e.type === 'radio') ? e.checked : e.value,
      required: e.required, disabled: e.disabled, ...(e.tagName === 'SELECT' ? { options: [...e.options].map(o => o.value) } : {}) })) }))`,
  data: `(() => { const meta = {}, og = {}, twitter = {};
    for (const m of document.querySelectorAll('meta[name], meta[property]')) { const k = m.getAttribute('property') || m.getAttribute('name'), v = m.content;
      if (k.startsWith('og:')) og[k] = v; else if (k.startsWith('twitter:')) twitter[k] = v; else meta[k] = v; }
    const jsonld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { return JSON.parse(s.textContent); } catch { return { invalid: s.textContent.slice(0, 200) }; } });
    return { title: document.title, jsonld, og, twitter, meta }; })()`,
  storage: `(() => { const dump = (s) => Object.fromEntries(Array.from({ length: s.length }, (_, i) => [s.key(i), s.getItem(s.key(i))]));
    return { localStorage: dump(localStorage), sessionStorage: dump(sessionStorage) }; })()`,
  perf: `(async () => { const nav = performance.getEntriesByType('navigation')[0] || {}, res = performance.getEntriesByType('resource');
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const lcp = await new Promise(r => { try { new PerformanceObserver(l => r(l.getEntries().at(-1)?.startTime)).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { r(undefined); } setTimeout(() => r(undefined), 300); });
    const ms = (v) => v === undefined ? null : Math.round(v);
    return { url: location.href, ttfbMs: ms(nav.responseStart - nav.requestStart), domInteractiveMs: ms(nav.domInteractive), domCompleteMs: ms(nav.domComplete),
      loadMs: ms(nav.loadEventEnd), fcpMs: ms(fcp?.startTime), lcpMs: ms(lcp), documentBytes: nav.transferSize ?? null,
      resources: res.map(r => ({ name: r.name, type: r.initiatorType, size: r.transferSize, ms: Math.round(r.duration) })) }; })()`,
};

const HANDLERS = {
  // ── navigation
  async goto(b, tab, [target], ctx) {
    if (!target) throw USAGE_ERR('goto <url|file>');
    const url = toUrl(target, ctx.cwd);
    const status = await b.navigate(tab, url);
    return `Navigated to ${tab.url}${status ? ` (${status})` : ''}`;
  },
  async 'load-html'(b, tab, [file], ctx) {
    if (!file) throw USAGE_ERR('load-html <file.html>');
    const p = resolve(ctx.cwd, file);
    if (!['.html', '.htm', '.xhtml', '.svg'].includes(extname(p).toLowerCase())) throw new Error('load-html takes .html, .htm, .xhtml or .svg files');
    if (statSync(p).size > 50 * 1024 * 1024) throw new Error('file is larger than 50MB');
    const html = readFileSync(p, 'utf8');
    // as a file: URL, not about:blank + setDocumentContent: the page keeps a local (file) origin and its relative links work
    await b.navigate(tab, pathToFileURL(p).href);
    return `Loaded ${p} (${html.length} chars)`;
  },
  async back(b, tab) { return history(b, tab, -1); },
  async forward(b, tab) { return history(b, tab, 1); },
  async reload(b, tab) {
    await b.waitNav(tab, () => b.send(tab, 'Page.reload', {}), 30000);
    return `Reloaded ${tab.url}`;
  },
  async url(b, tab) { return tab.frameId ? tab.frameUrl : tab.url; },
  async wait(b, tab, args) {
    const [o, [sel]] = flags(args, { '--networkidle': true, '--load': true, '--timeout': 1 });
    const timeout = Number(o['--timeout'] ?? 15000), deadline = Date.now() + timeout;
    const until = async (cond, what) => { while (!(await cond())) { if (Date.now() > deadline) throw new Error(`timed out after ${timeout}ms waiting for ${what}`); await sleep(100); } };
    if (o['--networkidle']) await until(() => tab.inflight === 0 && Date.now() - tab.lastNet > 500, 'network idle');
    else if (o['--load']) await until(async () => (await b.evaluate(tab, 'document.readyState')) === 'complete', 'page load');
    else if (sel) await until(async () => !!(await b.evaluate(tab, `!!document.querySelector(${JSON.stringify(sel)})`)), sel);
    else throw USAGE_ERR('wait <selector|--networkidle|--load> [--timeout ms]');
    return 'ok';
  },

  // ── reading
  async text(b, tab, [sel]) {
    if (!sel) return b.evaluate(tab, 'document.body ? document.body.innerText : ""');
    return b.callOn(tab, await b.element(tab, sel), function () { return this.innerText; });
  },
  async html(b, tab, [sel]) {
    if (!sel) return b.evaluate(tab, 'document.documentElement.outerHTML');
    return b.callOn(tab, await b.element(tab, sel), function () { return this.innerHTML; });
  },
  async links(b, tab) { return b.evaluate(tab, JS.links); },
  async forms(b, tab) { return b.evaluate(tab, JS.forms); },
  async accessibility(b, tab) { return (await axTree(b, tab, { refs: false, all: true })).text; },
  async data(b, tab, args) {
    const d = await b.evaluate(tab, JS.data);
    const pick = { '--jsonld': 'jsonld', '--og': 'og', '--twitter': 'twitter', '--meta': 'meta' }[args[0]];
    return pick ? d[pick] : d;
  },

  // ── inspection
  async js(b, tab, args) {
    const expr = args.join(' ');
    if (!expr) throw USAGE_ERR('js <expression>');
    if (!/\bawait\b/.test(expr)) return fmt(await b.evaluate(tab, expr));
    try { return fmt(await b.evaluate(tab, `(async () => (${expr}))()`)); }
    catch (e) { if (!/SyntaxError/.test(e.message)) throw e; return fmt(await b.evaluate(tab, `(async () => { ${expr} })()`)); }
  },
  async eval(b, tab, [file], ctx) {
    if (!file) throw USAGE_ERR('eval <file.js>');
    const p = realpathSync(resolve(ctx.cwd, file));
    const roots = [ctx.cwd, tmpdir()].map((r) => realpathSync(r) + sep);
    if (!roots.some((r) => p.startsWith(r))) throw new Error('eval files must be under the working directory or the temp dir');
    const src = readFileSync(p, 'utf8').trim();
    const multi = src.includes('\n');
    return fmt(await b.evaluate(tab, multi && /\bawait\b/.test(src) ? `(async () => { ${src} })()` : src));
  },
  async css(b, tab, [sel, prop]) {
    if (!prop) throw USAGE_ERR('css <selector> <property>');
    return b.callOn(tab, await b.element(tab, sel), function (p) { return getComputedStyle(this).getPropertyValue(p); }, prop);
  },
  async attrs(b, tab, [sel]) {
    if (!sel) throw USAGE_ERR('attrs <selector|@ref>');
    return b.callOn(tab, await b.element(tab, sel), function () { return Object.fromEntries([...this.attributes].map((a) => [a.name, a.value])); });
  },
  async is(b, tab, [prop, sel]) {
    if (!sel) throw USAGE_ERR('is <visible|hidden|enabled|disabled|checked|editable|focused> <selector|@ref>');
    return String(await b.callOn(tab, await b.element(tab, sel, 0), function (p) {
      const s = getComputedStyle(this), r = this.getBoundingClientRect();
      const visible = s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
      const editable = !this.disabled && !this.readOnly && (this.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(this.tagName));
      const v = { visible, hidden: !visible, enabled: !this.disabled, disabled: !!this.disabled, checked: !!this.checked, editable, focused: document.activeElement === this }[p];
      if (v === undefined) throw new Error(`unknown property ${p}`);
      return v;
    }, prop));
  },
  async console(b, tab, args) {
    if (args.includes('--clear')) { tab.console.length = 0; return 'cleared'; }
    const rows = tab.console.filter((c) => !args.includes('--errors') || c.type === 'error');
    return rows.map((c) => `[${c.type}] ${c.text}${c.url ? ` (${c.url}${c.line ? `:${c.line}` : ''})` : ''}`).join('\n') || '(no console messages)';
  },
  async network(b, tab, args) {
    if (args.includes('--clear')) { tab.network.length = 0; return 'cleared'; }
    return tab.network.map((r) => `${r.method} ${r.failed ? `FAILED(${r.failed})` : r.status ?? '...'} ${r.url} (${r.type ?? '?'}, ${r.size}B, ${r.ms ?? '?'}ms)`).join('\n') || '(no requests)';
  },
  async dialog(b, tab, args) {
    if (args.includes('--clear')) { tab.dialogs.length = 0; return 'cleared'; }
    return tab.dialogs.map((d) => `${d.type}: ${d.message}${d.accepted === null ? ' (left to the user)' : d.accepted ? ' (accepted)' : ' (dismissed)'}`).join('\n') || '(no dialogs)';
  },
  async storage(b, tab, args) {
    if (args[0] === 'set') {
      if (args.length < 3) throw USAGE_ERR('storage set <key> <value>');
      await b.evaluate(tab, `localStorage.setItem(${JSON.stringify(args[1])}, ${JSON.stringify(args.slice(2).join(' '))})`);
      return `localStorage[${args[1]}] set`;
    }
    return b.evaluate(tab, JS.storage);
  },
  async perf(b, tab) {
    const p = await b.evaluate(tab, JS.perf);
    const reqs = tab.network.filter((r) => r.start >= tab.navTs);
    const sum = (f) => reqs.filter(f).reduce((s, r) => s + (r.size || 0), 0);
    const byType = {};
    for (const r of reqs) byType[r.type ?? 'Other'] = (byType[r.type ?? 'Other'] ?? 0) + 1;
    const largest = [...reqs].sort((x, y) => (y.size || 0) - (x.size || 0)).slice(0, 10).map((r) => ({ url: r.url, type: r.type, size: r.size, ms: r.ms }));
    delete p.resources;
    return { ...p, requests: reqs.length, transferBytes: sum(() => true), jsBytes: sum((r) => r.type === 'Script'), cssBytes: sum((r) => r.type === 'Stylesheet'),
      imageBytes: sum((r) => r.type === 'Image'), failedRequests: reqs.filter((r) => r.failed || r.status >= 400).length, byType, largest };
  },
  async cdp(b, tab, [method, json]) {
    if (!/^\w+\.\w+$/.test(method ?? '')) throw USAGE_ERR('cdp <Domain.method> [json-params]');
    return b.send(tab, method, json ? JSON.parse(json) : {});
  },

  // ── interaction
  async click(b, tab, [sel]) {
    if (!sel) throw USAGE_ERR('click <selector|@ref>');
    const at = await b.center(tab, await b.element(tab, sel), sel);
    await b.mouse(tab, 'mouseMoved', at, { button: 'none' });
    await b.mouse(tab, 'mousePressed', at);
    await b.mouse(tab, 'mouseReleased', at);
    const before = tab.url;
    await b.settle(tab);
    return `Clicked ${sel}${tab.url !== before ? ` → ${tab.url}` : ''}`;
  },
  async fill(b, tab, [sel, ...v]) {
    if (!sel || !v.length) throw USAGE_ERR('fill <selector|@ref> <value>');
    const value = v.join(' '), objectId = await b.element(tab, sel);
    await b.callOn(tab, objectId, function () {
      this.focus();
      if (typeof this.select === 'function') this.select(); else document.execCommand('selectAll');
    });
    if (value) await b.send(tab, 'Input.insertText', { text: value });
    else await press(b, tab, 'Delete');
    await b.callOn(tab, objectId, function () { this.dispatchEvent(new Event('change', { bubbles: true })); });
    return `Filled ${sel}`;
  },
  async select(b, tab, [sel, ...v]) {
    if (!sel || !v.length) throw USAGE_ERR('select <selector|@ref> <value|label>');
    const chosen = await b.callOn(tab, await b.element(tab, sel), function (want) {
      const o = [...this.options].find((x) => x.value === want) ?? [...this.options].find((x) => x.label === want || x.text.trim() === want);
      if (!o) throw new Error(`no option "${want}"`);
      this.value = o.value;
      this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true }));
      return o.value;
    }, v.join(' '));
    return `Selected ${chosen}`;
  },
  async hover(b, tab, [sel]) {
    if (!sel) throw USAGE_ERR('hover <selector|@ref>');
    await b.mouse(tab, 'mouseMoved', await b.center(tab, await b.element(tab, sel), sel), { button: 'none' });
    return `Hovered ${sel}`;
  },
  async type(b, tab, args) {
    const text = args.join(' ');
    if (!text) throw USAGE_ERR('type <text>');
    for (const ch of text) {
      if (ch === '\n') { await press(b, tab, 'Enter'); continue; }
      await b.send(tab, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
      await b.send(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
    return `Typed ${text.length} chars`;
  },
  async press(b, tab, [key]) {
    if (!key) throw USAGE_ERR('press <key> (Enter, Tab, Escape, ArrowDown, Shift+Tab, ...)');
    const before = tab.url;
    await press(b, tab, key);
    await b.settle(tab);
    return `Pressed ${key}${tab.url !== before ? ` → ${tab.url}` : ''}`;
  },
  async scroll(b, tab, [sel]) {
    if (!sel) { await b.evaluate(tab, 'window.scrollTo(0, document.documentElement.scrollHeight)'); return 'Scrolled to bottom'; }
    await b.callOn(tab, await b.element(tab, sel), function () { this.scrollIntoView({ block: 'center', behavior: 'instant' }); });
    return `Scrolled to ${sel}`;
  },
  async viewport(b, tab, args) {
    const [o, [size]] = flags(args, { '--scale': 1 });
    if (!size && !o['--scale']) return `${b.viewport.width}x${b.viewport.height} @${b.viewport.scale}x`;
    const m = size ? /^(\d+)x(\d+)$/.exec(size) : null;
    if (size && !m) throw USAGE_ERR('viewport <WxH> [--scale 1-3]');
    const scale = o['--scale'] ? Number(o['--scale']) : b.viewport.scale;
    if (!(scale >= 1 && scale <= 3)) throw new Error('--scale must be between 1 and 3');
    b.viewport = { width: m ? Number(m[1]) : b.viewport.width, height: m ? Number(m[2]) : b.viewport.height, scale };
    for (const t of b.tabs.values()) await b.applyViewport(t);
    return `Viewport ${b.viewport.width}x${b.viewport.height} @${scale}x`;
  },
  async upload(b, tab, [sel, ...files], ctx) {
    if (!sel || !files.length) throw USAGE_ERR('upload <selector|@ref> <file> [file...]');
    const abs = files.map((f) => resolve(ctx.cwd, f));
    for (const f of abs) if (!existsSync(f)) throw new Error(`no such file: ${f}`);
    const objectId = await b.element(tab, sel);
    if (!ctx.remote) {
      // M8 R2-1: judge where the file goes, not only the page: the form's action and any submit button's formaction
      const dests = await b.callOn(tab, objectId, function () {
        const f = this.form;
        return f ? [f.action, ...[...f.elements].filter((e) => e.hasAttribute?.('formaction')).map((e) => e.formAction)] : [];
      });
      const away = dests.filter((d) => !isLocalOrigin(d));
      if (away.length) throw new Error(`upload: the form sends the file to ${away.join(', ')}, which is not local: data would leave this machine; rerun with --remote (the guard asks the user first)`);
      await b.holdLocalOnly(tab); // script-driven uploads: the browser refuses non-local requests while this page holds the file
    }
    await b.send(tab, 'DOM.setFileInputFiles', { files: abs, objectId });
    await b.settle(tab);
    return `Uploaded ${abs.length} file(s) to ${sel}`;
  },
  async 'dialog-accept'(b, tab, args) { tab.dialogPolicy = { accept: true, text: args.join(' ') }; return 'Dialogs will be accepted'; },
  async 'dialog-dismiss'(b, tab) { tab.dialogPolicy = { accept: false, text: '' }; return 'Dialogs will be dismissed'; },

  // ── visuals
  async screenshot(b, tab, args, ctx) {
    const [o, rest] = flags(args, { '--viewport': true, '--selector': 1, '--clip': 1 });
    const target = o['--selector'] ?? rest.find(looksLikeSelector);
    const path = rest.find((a) => !looksLikeSelector(a));
    if ([target, o['--clip'], o['--viewport']].filter(Boolean).length > 1) throw new Error('use only one of a selector, --clip and --viewport');
    const clip = o['--clip'] ? (([x, y, width, height]) => ({ x, y, width, height }))(o['--clip'].split(',').map(Number)) : undefined;
    const file = out(ctx, path, tmpName('screenshot.png'));
    writeFileSync(file, await capture(b, tab, { viewport: o['--viewport'], clip, target }));
    return file;
  },
  async responsive(b, tab, [prefix], ctx) {
    const saved = { ...b.viewport }, files = [];
    const base = out(ctx, prefix, tmpName('responsive'));
    try {
      for (const [name, width, height] of [['mobile', 375, 812], ['tablet', 768, 1024], ['desktop', 1280, 720]]) {
        b.viewport = { width, height, scale: 1 };
        await b.applyViewport(tab);
        await sleep(150); // let media queries and layout settle
        const f = `${base}-${name}.png`;
        writeFileSync(f, await capture(b, tab, {}));
        files.push(f);
      }
    } finally { b.viewport = saved; await b.applyViewport(tab); }
    return files;
  },
  async pdf(b, tab, args, ctx) {
    const [o, [path]] = flags(args, { '--format': 1, '--margins': 1, '--landscape': true });
    const file = out(ctx, path, tmpName('page.pdf'));
    writeFileSync(file, await printPdf(b, tab, { format: o['--format'], margins: o['--margins'], landscape: o['--landscape'] }));
    return file;
  },
  async diff(b, tab, [u1, u2], ctx) {
    if (!u2) throw USAGE_ERR('diff <url1> <url2>');
    const t = await b.newTab();
    try {
      const texts = [];
      for (const u of [u1, u2]) { await b.navigate(t, toUrl(u, ctx.cwd)); texts.push(await b.evaluate(t, 'document.body ? document.body.innerText : ""')); }
      const d = lineDiff(...texts);
      return d.length ? [`--- ${u1}`, `+++ ${u2}`, ...d].join('\n') : '(no text differences)';
    } finally {
      await b.cdp.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
      b.tabs.delete(t.id); b.active = tab.id;
    }
  },

  // ── snapshot
  async snapshot(b, tab, args, ctx) {
    const [o] = flags(args, { '-i': true, '-c': true, '-d': 1, '-s': 1, '-D': true, '-a': true, '-o': 1 });
    const { text, refs } = await axTree(b, tab, { interactive: o['-i'], compact: o['-c'], depth: o['-d'] !== undefined ? Number(o['-d']) : undefined, scope: o['-s'] });
    let result = text || '(empty: no matching elements)';
    if (o['-D']) {
      const prev = tab.lastSnapshot;
      result = prev === null ? `(baseline stored)\n${result}` : lineDiff(prev, text).join('\n') || '(no changes)';
    }
    tab.lastSnapshot = text;
    if (o['-a'] || o['-o']) {
      const file = out(ctx, o['-o'], tmpName('annotated.png'));
      await annotate(b, tab, refs, file);
      result += `\n\n[annotated screenshot: ${file}]`;
    }
    return result;
  },

  // ── tabs and frames
  async tabs(b) {
    const list = [];
    for (const t of b.tabs.values()) {
      const title = await b.send(t, 'Runtime.evaluate', { expression: 'document.title', returnByValue: true }).then((r) => r.result.value).catch(() => '');
      list.push({ id: t.id, active: t.id === b.active, title, url: t.url });
    }
    return list;
  },
  async tab(b, tab, [id]) {
    const t = b.tabs.get(Number(id));
    if (!t) throw new Error(`no tab ${id} (see mis browse tabs)`);
    b.active = t.id;
    await b.cdp.send('Target.activateTarget', { targetId: t.targetId }).catch(() => {});
    return `Switched to tab ${t.id}: ${t.url}`;
  },
  async newtab(b, tab, [url], ctx) {
    const t = await b.newTab(url ? toUrl(url, ctx.cwd) : undefined);
    return `Opened tab ${t.id}${url ? `: ${t.url}` : ''}`;
  },
  async closetab(b, tab, [id]) {
    const t = id ? b.tabs.get(Number(id)) : tab;
    if (!t) throw new Error(`no tab ${id}`);
    await b.cdp.send('Target.closeTarget', { targetId: t.targetId });
    b.tabs.delete(t.id); b.bySession.delete(t.sessionId);
    if (!b.tabs.size) await b.newTab();
    if (b.active === t.id || !b.tabs.has(b.active)) b.active = [...b.tabs.keys()].at(-1);
    return `Closed tab ${t.id}`;
  },
  async frame(b, tab, args) {
    const [o, [sel]] = flags(args, { '--name': 1, '--url': 1 });
    if (sel === 'main') { tab.frameId = null; tab.frameUrl = null; return 'Switched to the main frame'; }
    let frameId;
    if (sel) {
      tab.frameId = null; // look the iframe element up in the top document
      ({ node: { frameId } } = await b.send(tab, 'DOM.describeNode', { objectId: await b.element(tab, sel) }));
      if (!frameId) throw new Error(`${sel} is not an iframe`);
    } else if (o['--name'] || o['--url']) {
      const { frameTree } = await b.send(tab, 'Page.getFrameTree');
      const all = [], walk = (n) => { all.push(n.frame); (n.childFrames ?? []).forEach(walk); };
      walk(frameTree);
      frameId = all.find((f) => f.parentId && (o['--name'] ? f.name === o['--name'] : f.url.includes(o['--url'])))?.id;
      if (!frameId) throw new Error('no frame matches');
    } else throw USAGE_ERR('frame <selector|@ref|--name n|--url part|main>');
    const deadline = Date.now() + 5000;
    while (!tab.contexts.get(frameId)) { if (Date.now() > deadline) throw new Error('frame has no document yet'); await sleep(50); }
    const { frameTree } = await b.send(tab, 'Page.getFrameTree');
    const find = (n) => n.frame.id === frameId ? n.frame : (n.childFrames ?? []).map(find).find(Boolean);
    tab.frameId = frameId; tab.frameUrl = find(frameTree)?.url ?? null;
    return `Switched to frame ${tab.frameUrl}`;
  },

  // ── handoff
  async handoff(b, tab, args) {
    if (b.handoff) return `HANDOFF: already waiting for the user at ${tab.url}`;
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !b.headlessOnly) {
      throw new Error('BLOCKED: no display for a visible browser window (set DISPLAY or run on a desktop session)');
    }
    const urls = await b.tabUrls();
    b.lastTabs = urls;
    await b.relaunch(false, urls);
    b.handoff = { reason: args.join(' ') || 'user action needed', at: new Date().toISOString() };
    return [`HANDOFF: visible browser opened at ${urls[0] ?? 'about:blank'}`, `MESSAGE: ${b.handoff.reason}`,
      'STATUS: waiting for the user. Ask them to finish in that window, then run `mis browse resume`.'].join('\n');
  },
  async resume(b) {
    if (!b.handoff) throw new Error('no handoff in progress');
    const urls = await b.tabUrls();
    await b.relaunch(true, urls);
    b.handoff = null;
    const t = b.current();
    return `RESUMED at ${t.url}\n${(await axTree(b, t, { interactive: true })).text}`;
  },
};

async function history(b, tab, delta) {
  const { currentIndex, entries } = await b.send(tab, 'Page.getNavigationHistory');
  const e = entries[currentIndex + delta];
  if (!e) throw new Error(`no ${delta < 0 ? 'previous' : 'next'} page in history`);
  await b.waitNav(tab, () => b.send(tab, 'Page.navigateToHistoryEntry', { entryId: e.id }));
  return `${delta < 0 ? 'Back' : 'Forward'} to ${tab.url}`;
}

// Page JavaScript and storage can read a logged-in site's cookies/tokens, and upload sends a local file to the site:
// on non-local pages they need --remote, which the guard (policy.mjs) asks the user about. Raw CDP is asked every
// time, so it may not hide inside a chain.
const GATED = new Set(['storage', 'js', 'eval', 'upload']);

export async function runCommand(b, cmd, args, ctx) {
  if (cmd === 'chain') return chain(b, args[0], ctx);
  const h = HANDLERS[cmd];
  if (!h) throw new Error(`unknown browse command "${cmd}". Commands: ${Object.keys(HANDLERS).join(', ')}, chain, status, stop, restart`);
  if (cmd === 'cdp' && ctx.inChain) throw new Error('cdp is not allowed inside chain; run `mis browse cdp ...` on its own so the guard can ask');
  const tab = b.current();
  const seen = b.blocked.length;
  const result = await gated(b, tab, h, cmd, args, ctx);
  const blocked = [...new Set(b.blocked.slice(seen))]; // a popup's request is seen by both of its sessions
  if (blocked.length) {
    throw new Error(`${cmd} ran, but a page that holds a file attached without --remote made requests to non-local hosts, and the browser blocked them: ${blocked.join('; ')}. `
      + 'Such a file may only go to local hosts, and the page stays held (non-local requests of every tab are blocked) until its tab is closed. '
      + 'To send a file on purpose: `newtab <url>`, `closetab <id of the holding tab>`, then `upload ... --remote` in the new tab (the guard asks the user first)');
  }
  return result;
}

async function gated(b, tab, h, cmd, args, ctx) {
  if (!GATED.has(cmd) || ctx.remote) return h(b, tab, args.map(String), ctx);
  // Judge the document the command will actually run in, by the origin the browser reports for it, and run the
  // command pinned to that same document: if it navigates in between, the command fails instead of running elsewhere.
  const c = await b.pageContext(tab);
  if (!c.local) {
    const real = /^[a-z][\w+.-]*:\/\/[^/]/i.test(c.origin);
    const what = !real ? 'cannot be shown to be local (about:, data: and sandboxed documents have no origin of their own)'
      : cmd === 'upload' ? 'sends a local file to it' : 'can read or change its cookies and storage';
    throw new Error(`${cmd} on a non-local page (${real ? c.origin : 'opaque origin'}) ${what}; rerun with --remote (the guard asks the user first)`);
  }
  tab.pinned = c.uniqueId;
  try { return await h(b, tab, args.map(String), ctx); } finally { tab.pinned = null; }
}

async function chain(b, steps, ctx) {
  if (!Array.isArray(steps) || !steps.every((s) => Array.isArray(s) && s.length && s.every((x) => typeof x === 'string'))) {
    throw new Error('chain takes a JSON array of commands, e.g. [["goto","http://localhost:3000"],["snapshot","-i"]]');
  }
  const results = [];
  for (const [i, [cmd, ...args]] of steps.entries()) {
    if (cmd === 'chain') throw new Error('chain cannot be nested');
    try { results.push({ cmd: [cmd, ...args].join(' '), result: await runCommand(b, cmd, args, { ...ctx, inChain: true }) }); }
    catch (e) { throw new Error(`chain stopped at step ${i + 1} (${[cmd, ...args].join(' ')}): ${e.message}`); }
  }
  return results;
}
