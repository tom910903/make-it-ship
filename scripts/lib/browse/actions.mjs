// `mis browse <command>` handlers, run inside the daemon. Each gets (browser, tab, args, ctx{cwd, remote, inChain}).
import { readFileSync, writeFileSync, existsSync, statSync, realpathSync, mkdirSync, lstatSync, readlinkSync, readdirSync } from 'node:fs';
import { resolve, dirname, extname, sep, join, basename } from 'node:path';
import { tmpdir, hostname } from 'node:os';
import { browserDataDirs } from './cookies.mjs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { toUrl, lineDiff, toInches, BROWSE_ALWAYS_ASK, isLocalOrigin } from './util.mjs';

export const EXTENSION_DIR = fileURLToPath(new URL('../../../extension', import.meta.url));
const mb = (n) => Math.round(n / 1048576 * 10) / 10;

const realish = (p) => { let base = p, rest = ''; while (!existsSync(base) && dirname(base) !== base) { rest = join(basename(base), rest); base = dirname(base); } try { return join(realpathSync(base), rest).replace(/\/$/, ''); } catch { return p; } };

/** The existing ancestors of a path, nearest first (a profile dir may not exist yet). */
const ancestors = (p) => { const out = []; for (let d = resolve(p); ; d = dirname(d)) { if (existsSync(d)) out.push(d); if (dirname(d) === d) return out; } };
const sameDir = (a, b) => a.dev === b.dev && a.ino === b.ino;
/** M9 fix1 D4: the user's real browser data dir that holds this path, compared by device and inode (letter case,
 *  symlinks and .. cannot hide it), and by case-insensitive path on macOS for roots that do not exist yet. */
function ownBrowserData(profile) {
  const roots = browserDataDirs(), up = ancestors(profile).map((d) => statSync(d));
  for (const r of roots) if (existsSync(r) && up.some((s) => sameDir(s, statSync(r)))) return r;
  const real = realish(profile), fold = (x) => (process.platform === 'darwin' ? x.toLowerCase() : x);
  return roots.find((d) => fold(real) === fold(realish(d)) || fold(real).startsWith(fold(realish(d)) + sep)) ?? null;
}
const PROFILE_MARK = '.make-it-ship-profile';
/** Fail closed: a dir (or ancestor) with a Chrome "Local State" is some browser's user data, unless connect made it or
 *  it lies in Make It Ship's own state dir. */
function foreignUserData(profile, home) {
  const mine = home && ancestors(profile).some((d) => existsSync(home) && sameDir(statSync(d), statSync(home)));
  if (mine) return null;
  return ancestors(profile).find((d) => existsSync(join(d, 'Local State')) && !existsSync(join(d, PROFILE_MARK))) ?? null;
}
// M9 r2 N8: Chrome's credential and storage files. A copy of a profile (no Local State) or a hard link of the real files
// is still the user's data: refused in any dir connect did not create, and hard links of the real ones everywhere.
const PROFILE_DATA = new Set(['Cookies', 'Login Data', 'Web Data', 'Local Storage', 'Local State']);
function profileDataIn(dir, depth = 0, out = []) {
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (PROFILE_DATA.has(e.name)) out.push(join(dir, e.name));
    if (e.isDirectory() && depth < 3) profileDataIn(join(dir, e.name), depth + 1, out); // a Dirent of a symlink is not a directory
  }
  return out;
}
function copiedProfileData(profile, home) {
  if (existsSync(join(profile, PROFILE_MARK)) || (home && existsSync(home) && ancestors(profile).some((d) => sameDir(statSync(d), statSync(home))))) return null;
  return profileDataIn(profile)[0] ?? null;
}
/** A credential file in the profile that is a hard link of one in the user's real browser data (same device and inode). */
function hardlinkedRealData(profile) {
  const mine = profileDataIn(profile).map((f) => { try { return statSync(f); } catch { return null; } }).filter((st) => st?.isFile() && st.nlink > 1);
  if (!mine.length) return null;
  for (const root of browserDataDirs().filter((r) => existsSync(r))) {
    let subs = [];
    try { subs = readdirSync(root); } catch { continue; }
    for (const f of subs.flatMap((sd) => ['Cookies', 'Network/Cookies', 'Login Data', 'Web Data'].map((n) => join(root, sd, n)))) {
      try { const st = statSync(f); if (mine.some((m) => sameDir(m, st))) return f; } catch { /* none */ }
    }
  }
  return null;
}

/** A profile a running browser holds: SingletonLock is a symlink to "<host>-<pid>" (a dead pid on this host is a stale lock). */
function profileInUse(dir) {
  if (existsSync(join(dir, 'lockfile'))) return true; // Windows
  let target;
  try { if (!lstatSync(join(dir, 'SingletonLock')).isSymbolicLink()) return true; target = readlinkSync(join(dir, 'SingletonLock')); } catch { return false; }
  const m = /^(.*)-(\d+)$/.exec(target);
  if (!m || m[1] !== hostname()) return true;
  try { process.kill(Number(m[2]), 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

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

async function annotate(b, tab, refs, file, colors = {}) {
  const boxes = [];
  for (const r of refs) {
    const q = (await b.send(tab, 'DOM.getContentQuads', { backendNodeId: backendOf(tab, r) }).catch(() => ({ quads: [] }))).quads?.[0];
    if (q) boxes.push({ r, c: HEAT[colors[r]] ?? '#e00', fill: !!colors[r], x: Math.min(q[0], q[6]), y: Math.min(q[1], q[3]), w: Math.max(q[2], q[4]) - Math.min(q[0], q[6]), h: Math.max(q[5], q[7]) - Math.min(q[1], q[3]) });
  }
  const frame = tab.frameId; tab.frameId = null; // overlays go into the top document
  try {
    await b.evaluate(tab, `(() => { const c = document.createElement('div'); c.id = '__mis_annotate'; c.style.cssText = 'position:absolute;left:0;top:0;z-index:2147483647;pointer-events:none';
      for (const o of ${JSON.stringify(boxes)}) { const d = document.createElement('div'); d.style.cssText = 'position:absolute;border:2px solid ' + o.c + ';' + (o.fill ? 'background:' + o.c + '40;' : '') + 'box-sizing:border-box;left:' + (o.x + scrollX) + 'px;top:' + (o.y + scrollY) + 'px;width:' + o.w + 'px;height:' + o.h + 'px';
        const l = document.createElement('span'); l.textContent = o.r; l.style.cssText = 'position:absolute;left:0;top:-14px;background:' + o.c + ';color:#fff;font:10px/12px monospace;padding:0 2px'; d.append(l); c.append(d); }
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
    paperWidth: w, paperHeight: h, landscape: !!o.landscape, printBackground: true, preferCSSPageSize: !!o.preferCSSPageSize, // mis slides: the deck's @page size wins
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
  media: (scope) => `(() => { const root = ${JSON.stringify(scope ?? null)} ? document.querySelector(${JSON.stringify(scope ?? '')}) : document;
    if (!root) throw new Error(${JSON.stringify(`no element matches ${scope}`)});
    const abs = (u) => { try { return u ? new URL(u, document.baseURI).href : null; } catch { return null; } };
    const box = (e) => ({ width: e.clientWidth || null, height: e.clientHeight || null });
    return { images: [...root.querySelectorAll('img')].map(e => ({ src: abs(e.currentSrc || e.src), alt: e.alt, naturalWidth: e.naturalWidth, naturalHeight: e.naturalHeight, ...box(e), loading: e.loading || null })),
      videos: [...root.querySelectorAll('video')].map(e => ({ src: abs(e.currentSrc || e.src || e.querySelector('source')?.src), poster: abs(e.poster), duration: Number.isFinite(e.duration) ? e.duration : null,
        sources: [...e.querySelectorAll('source')].map(x => ({ src: abs(x.src), type: x.type || null })), ...box(e) })),
      audio: [...root.querySelectorAll('audio')].map(e => ({ src: abs(e.currentSrc || e.src || e.querySelector('source')?.src), duration: Number.isFinite(e.duration) ? e.duration : null })) }; })()`,
  uxAudit: `(() => { const t = (e) => (e.innerText || e.textContent || '').replace(/\\s+/g, ' ').trim();
    const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const navs = [...document.querySelectorAll('nav, header, [role=navigation]')];
    const links = [...new Set(navs.flatMap(n => [...n.querySelectorAll('a[href]')]))].filter(vis).slice(0, 40).map(a => ({ text: t(a).slice(0, 80), href: a.href }));
    const inter = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [onclick]')].filter(vis);
    return { site: { title: document.title, url: location.href, host: location.host, lang: document.documentElement.lang || null,
        description: document.querySelector('meta[name=description]')?.content || null, viewportMeta: document.querySelector('meta[name=viewport]')?.content || null },
      landmarks: Object.fromEntries(['header', 'nav', 'main', 'footer', 'aside'].map(k => [k, document.querySelectorAll(k + ', [role=' + ({ header: 'banner', nav: 'navigation', main: 'main', footer: 'contentinfo', aside: 'complementary' })[k] + ']').length])),
      navigation: links,
      headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(vis).slice(0, 60).map(h => ({ level: Number(h.tagName[1]), text: t(h).slice(0, 120) })),
      textBlocks: [...document.querySelectorAll('p, li, blockquote')].filter(vis).map(t).filter(x => x.length >= 40).slice(0, 20).map(x => x.slice(0, 240)),
      interactive: { count: inter.length, items: inter.slice(0, 60).map(e => ({ tag: e.tagName.toLowerCase(), type: e.type || null, text: (t(e) || e.getAttribute('aria-label') || e.placeholder || e.name || '').slice(0, 80), ...(e.href ? { href: e.href } : {}) })) },
      forms: [...document.forms].map(f => ({ action: f.action, method: (f.method || 'get').toUpperCase(), fields: [...f.elements].filter(e => e.name).map(e => e.name) })),
      issues: { imagesWithoutAlt: [...document.images].filter(i => !i.hasAttribute('alt')).length,
        inputsWithoutLabel: [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')].filter(e => !e.labels?.length && !e.getAttribute('aria-label') && !e.placeholder).length,
        h1Count: document.querySelectorAll('h1').length } }; })()`,
  cleanup: (kinds) => `(() => { const SEL = ${JSON.stringify(CLEANUP)}; const kinds = ${JSON.stringify(kinds)}, removed = {};
    const hide = (e) => { e.style.setProperty('display', 'none', 'important'); };
    for (const k of kinds) {
      if (k === 'sticky') { const els = [...document.querySelectorAll('body *')].filter(e => ['fixed', 'sticky'].includes(getComputedStyle(e).position) && e.getBoundingClientRect().height > 0);
        els.forEach(hide); removed.sticky = els.length; continue; }
      const els = new Set(); for (const s of SEL[k]) for (const e of document.querySelectorAll(s)) if (e !== document.body && e !== document.documentElement && !e.querySelector('main, article, h1')) els.add(e);
      els.forEach(hide); removed[k] = els.size; }
    return removed; })()`,
  cursor: `(() => { const native = 'a[href],button,input,select,textarea,summary,option,label,[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem],[role=option],[contenteditable=true]';
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (out.length >= 50) break;
      if (el.closest(native) || el.querySelector(native)) continue;
      const s = getComputedStyle(el), why = [];
      if (s.cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer')) why.push('cursor:pointer');
      if (el.hasAttribute('onclick')) why.push('onclick');
      if (el.hasAttribute('tabindex') && el.tabIndex >= 0) why.push('tabindex');
      const r = el.getBoundingClientRect();
      if (why.length && r.width > 0 && r.height > 0 && s.visibility !== 'hidden') { el.__misWhy = why; out.push(el); }
    }
    return out; })()`,
  perf: `(async () => { const nav = performance.getEntriesByType('navigation')[0] || {}, res = performance.getEntriesByType('resource');
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const lcp = await new Promise(r => { try { new PerformanceObserver(l => r(l.getEntries().at(-1)?.startTime)).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { r(undefined); } setTimeout(() => r(undefined), 300); });
    const ms = (v) => v === undefined ? null : Math.round(v);
    return { url: location.href, ttfbMs: ms(nav.responseStart - nav.requestStart), domInteractiveMs: ms(nav.domInteractive), domCompleteMs: ms(nav.domComplete),
      loadMs: ms(nav.loadEventEnd), fcpMs: ms(fcp?.startTime), lcpMs: ms(lcp), documentBytes: nav.transferSize ?? null,
      resources: res.map(r => ({ name: r.name, type: r.initiatorType, size: r.transferSize, ms: Math.round(r.duration) })) }; })()`,
};

// gstack-style clutter selectors (cleanup); sticky/fixed elements are found by computed style
const CLEANUP = {
  ads: ['ins.adsbygoogle', '[id^="google_ads"]', '[id^="div-gpt-ad"]', 'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]',
    '[class*="ad-banner"]', '[class*="ad-wrapper"]', '[class*="ad-container"]', '[class*="ad-slot"]', '[class*="ad-unit"]', '[id*="ad-banner"]',
    '[id*="ad-container"]', '[data-ad]', '[data-ad-slot]', '[class*="sponsored"]', '.ad', '.ads', '.advert', '.advertisement', '#ad', '#ads'],
  cookies: ['[class*="cookie-consent"]', '[class*="cookie-banner"]', '[class*="cookie-notice"]', '[id*="cookie-consent"]', '[id*="cookie-banner"]',
    '[id*="cookie-notice"]', '[class*="consent-banner"]', '[class*="consent-modal"]', '[class*="gdpr"]', '[id*="gdpr"]', '#onetrust-consent-sdk',
    '#onetrust-banner-sdk', '#CybotCookiebotDialog', '.qc-cmp2-container', '[class*="cc-banner"]', '[class*="cc-window"]', '[class*="privacy-banner"]'],
  social: ['[class*="social-share"]', '[class*="share-buttons"]', '[class*="share-bar"]', '[class*="social-widget"]', '[class*="social-icons"]',
    'iframe[src*="facebook.com/plugins"]', 'iframe[src*="platform.twitter"]', '[class*="addthis"]', '[class*="sharethis"]', '[class*="follow-us"]'],
};

/** Cookies through Storage (browser-wide), then read back: Chrome silently drops some (e.g. SameSite=None without Secure). */
async function setCookies(b, cookies) {
  const key = (c) => `${c.name}\u0000${(c.domain ?? (c.url ? new URL(c.url).hostname : '')).replace(/^\./, '')}`;
  await b.cdp.send('Storage.setCookies', { cookies });
  const have = new Set((await b.cdp.send('Storage.getCookies')).cookies.map(key));
  const set = cookies.filter((c) => have.has(key(c))).length;
  return { set, rejected: cookies.length - set };
}

/** M9 fix1: sites the browser holds imported (or restored) logged-in cookies for; browsing them off-machine needs --remote. */
function remember(b, domains) { b.credentialDomains = new Set([...(b.credentialDomains ?? []), ...domains.map((d) => String(d ?? '').replace(/^\./, '').toLowerCase()).filter(Boolean)]); }

/** cookie-import / cookie-import-browser: the CLI reads (and decrypts) the cookies and sends them as data; values are never echoed. */
async function importCookies(b, ctx) {
  const list = ctx.data?.cookies;
  if (!Array.isArray(list)) throw new Error('no cookies to import (run it as `mis browse cookie-import <file.json>` or `cookie-import-browser`)');
  const r = await setCookies(b, list.map((c) => ({ name: String(c.name), value: String(c.value), domain: c.domain, path: c.path ?? '/', secure: !!c.secure,
    httpOnly: !!c.httpOnly, ...(c.sameSite ? { sameSite: c.sameSite } : {}), ...(c.expires > 0 ? { expires: c.expires } : {}) })));
  const domains = [...new Set(list.map((c) => String(c.domain ?? '').replace(/^\./, '')))];
  remember(b, domains);
  return { imported: r.set, rejected: r.rejected, domains, ...(ctx.data.source ? { source: ctx.data.source } : {}) };
}

/** GET a URL the way the page would (its cookies; not limited by CORS) through the browser's network stack. */
async function fetchResource(b, tab, url) {
  const { resource: r } = await b.send(tab, 'Network.loadNetworkResource', { frameId: tab.mainFrameId, url, options: { disableCache: false, includeCredentials: true } }, 120000);
  if (!r.success) throw new Error(`cannot download ${url}: ${r.netErrorName ?? 'failed'}${r.httpStatusCode ? ` (HTTP ${r.httpStatusCode})` : ''}`);
  if (r.httpStatusCode >= 400) { if (r.stream) await b.send(tab, 'IO.close', { handle: r.stream }).catch(() => {}); throw new Error(`cannot download ${url}: HTTP ${r.httpStatusCode}`); }
  const parts = [];
  for (;;) {
    const c = await b.send(tab, 'IO.read', { handle: r.stream, size: 1 << 20 });
    parts.push(Buffer.from(c.data, c.base64Encoded ? 'base64' : 'utf8'));
    if (c.eof) break;
  }
  await b.send(tab, 'IO.close', { handle: r.stream }).catch(() => {});
  return { body: Buffer.concat(parts), status: r.httpStatusCode };
}

/** RSS of the browser and its helper processes (ps; empty where ps is missing). */
function browserRss(pid) {
  if (!pid) return null;
  try {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
    const ids = new Set([pid]);
    for (let grew = true; grew;) { grew = false; for (const [p, pp] of rows) if (ids.has(pp) && !ids.has(p)) { ids.add(p); grew = true; } }
    const procs = rows.filter(([p]) => ids.has(p));
    return { processes: procs.length, rssMB: mb(procs.reduce((s, r) => s + r[2] * 1024, 0)) };
  } catch { return null; }
}

/** -C: elements that act like controls (cursor:pointer, onclick, tabindex) but are not in the accessibility tree as one; @c refs. */
async function cursorScan(b, tab) {
  const arr = await b.evaluate(tab, JS.cursor, { byValue: false });
  const info = await b.callOn(tab, arr.objectId, function () { return this.map((e) => ({ tag: e.tagName.toLowerCase(), text: (e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60), why: e.__misWhy })); });
  const { result } = await b.send(tab, 'Runtime.getProperties', { objectId: arr.objectId, ownProperties: true });
  const lines = [];
  for (const [i, x] of info.entries()) {
    const objectId = result.find((p) => p.name === String(i))?.value?.objectId;
    const { node } = await b.send(tab, 'DOM.describeNode', { objectId });
    let ref = [...tab.crefs].find(([, id]) => id === node.backendNodeId)?.[0];
    if (!ref) { ref = `@c${++tab.crefSeq}`; tab.crefs.set(ref, node.backendNodeId); }
    lines.push(`${ref} [${x.tag}]${x.text ? ` "${x.text}"` : ''} (${x.why.join(', ')})`);
  }
  return lines;
}

const HEAT = { green: '#16a34a', yellow: '#eab308', red: '#dc2626', blue: '#2563eb', orange: '#ea580c', gray: '#6b7280' };
const backendOf = (tab, ref) => (ref[1] === 'c' ? tab.crefs : tab.refs).get(ref);

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
    // M8 R3-1: a page script can send an attached file anywhere (workers, other documents, unload beacons, WebRTC), so
    // without --remote (which the guard asks about) a file is attached only where the network reaches nothing but loopback
    if (!ctx.remote && !b.localOnly) throw new Error('upload without --remote runs only in the local-only browser: in a normal browser a page script can send the file anywhere. Run `mis browse start --local-only` (only this machine is reachable), or rerun with --remote (the guard asks the user first)');
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
    const [o] = flags(args, { '-i': true, '-c': true, '-d': 1, '-s': 1, '-D': true, '-a': true, '-o': 1, '-C': true, '-H': 1 });
    let heat = null;
    if (o['-H']) {
      try { heat = JSON.parse(o['-H']); } catch { throw new Error('-H takes a JSON map of refs to colors, e.g. \'{"@e1":"green","@c2":"red"}\''); }
      if (!heat || typeof heat !== 'object' || Array.isArray(heat)) throw new Error('-H takes a JSON object of refs to colors');
      for (const [r, c] of Object.entries(heat)) {
        if (!HEAT[c]) throw new Error(`-H: unknown color "${c}" for ${r} (${Object.keys(HEAT).join(', ')})`);
        if (!backendOf(tab, r)) throw new Error(`-H: unknown ref ${r}; take a snapshot (with -C for @c refs) first`);
      }
      const file = out(ctx, o['-o'], tmpName('heatmap.png'));
      await annotate(b, tab, Object.keys(heat), file, heat);
      return `[heatmap screenshot: ${file}]`;
    }
    const tree = await axTree(b, tab, { interactive: o['-i'], compact: o['-c'], depth: o['-d'] !== undefined ? Number(o['-d']) : undefined, scope: o['-s'] });
    let { text } = tree;
    const refs = [...tree.refs];
    if (o['-C']) {
      const lines = await cursorScan(b, tab);
      if (lines.length) { text += `${text ? '\n' : ''}── cursor-interactive (not in the accessibility tree) ──\n${lines.join('\n')}`; refs.push(...lines.map((l) => l.split(' ')[0])); }
    }
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

  // ── M9-E: reading, inspection, style and cleanup
  async media(b, tab, args) {
    const [o, [scope]] = flags(args, { '--images': true, '--videos': true, '--audio': true });
    const all = await b.evaluate(tab, JS.media(scope));
    const kinds = ['images', 'videos', 'audio'].filter((k) => o[`--${k}`]);
    return kinds.length ? Object.fromEntries(kinds.map((k) => [k, all[k]])) : all;
  },
  async inspect(b, tab, args) {
    const [o, [sel = 'body']] = flags(args, { '--all': true });
    await b.send(tab, 'CSS.enable').catch(() => {}); // lazily: the CSS domain costs on every style change once enabled
    await b.send(tab, 'DOM.getDocument', { depth: 0 }); // requestNode needs the document pushed first
    const { nodeId } = await b.send(tab, 'DOM.requestNode', { objectId: await b.element(tab, sel) });
    const [matched, { computedStyle }, box] = await Promise.all([b.send(tab, 'CSS.getMatchedStylesForNode', { nodeId }),
      b.send(tab, 'CSS.getComputedStyleForNode', { nodeId }), b.send(tab, 'DOM.getBoxModel', { nodeId }).catch(() => null)]);
    // only what the author wrote (shorthand expansions carry no text)
    const decls = (style) => (style?.cssProperties ?? []).filter((p) => !p.disabled && (p.text || p.range))
      .map((p) => ({ name: p.name, value: p.value, ...(p.important ? { important: true } : {}) }));
    const rules = (matched.matchedCSSRules ?? []).reverse().map(({ rule }) => ({
      selector: rule.selectorList.text, origin: rule.origin,
      source: rule.styleSheetId ? `${tab.sheets.get(rule.styleSheetId) || 'inline <style>'}${rule.style.range ? `:${rule.style.range.startLine + 1}` : ''}` : null,
      properties: decls(rule.style) }));
    const KEY = ['display', 'position', 'top', 'left', 'width', 'height', 'box-sizing', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'color', 'background-color', 'font-family', 'font-size', 'font-weight',
      'line-height', 'text-align', 'z-index', 'opacity', 'visibility', 'overflow', 'flex-direction', 'justify-content', 'align-items', 'gap'];
    const computed = Object.fromEntries(computedStyle.filter((p) => o['--all'] || KEY.includes(p.name)).map((p) => [p.name, p.value]));
    const side = (q) => q && { width: Math.round(q[2] - q[0]), height: Math.round(q[5] - q[1]) };
    const m = box?.model;
    return { selector: sel, inline: decls(matched.inlineStyle), rules, computed,
      boxModel: m ? { content: side(m.content), padding: side(m.padding), border: side(m.border), margin: side(m.margin) } : null };
  },
  async 'ux-audit'(b, tab) { return b.evaluate(tab, JS.uxAudit); },
  async style(b, tab, args) {
    if (args[0] === '--undo') {
      const n = Number(args[1] ?? 1);
      if (!(n >= 1)) throw USAGE_ERR('style --undo [N]');
      const undone = tab.styleUndo.splice(-n).reverse();
      if (!undone.length) throw new Error('nothing to undo (style changes reset on navigation)');
      for (const u of undone) {
        const id = await b.element(tab, u.ref ?? u.sel, 0).catch(() => null);
        if (id) await b.callOn(tab, id, function (p, v, pr) { if (v) this.style.setProperty(p, v, pr); else this.style.removeProperty(p); }, u.prop, u.value, u.priority);
      }
      return `Undid ${undone.length} style change(s)`;
    }
    const [sel, prop, ...v] = args;
    if (!sel || !prop || !v.length) throw USAGE_ERR('style <selector|@ref> <property> <value> | style --undo [N]');
    const id = await b.element(tab, sel);
    const prev = await b.callOn(tab, id, function (p, val) {
      const old = { value: this.style.getPropertyValue(p), priority: this.style.getPropertyPriority(p) };
      this.style.setProperty(p, val.replace(/\s*!important$/, ''), /!important$/.test(val) ? 'important' : '');
      return old;
    }, prop, v.join(' '));
    tab.styleUndo.push({ sel, prop, ...prev });
    return `Set ${prop} on ${sel} (undo: style --undo)`;
  },
  async cleanup(b, tab, args) {
    const [o] = flags(args, { '--ads': true, '--cookies': true, '--sticky': true, '--social': true, '--all': true });
    const pick = ['ads', 'cookies', 'sticky', 'social'].filter((k) => o[`--${k}`] || o['--all']);
    return b.evaluate(tab, JS.cleanup(pick.length ? pick : ['ads', 'cookies', 'sticky', 'social']));
  },
  async prettyscreenshot(b, tab, args, ctx) {
    const hide = [];
    for (let i = args.indexOf('--hide'); i >= 0; i = args.indexOf('--hide')) hide.push(...args.splice(i, 2).slice(1));
    const [o, [path]] = flags(args, { '--scroll-to': 1, '--cleanup': true, '--width': 1 });
    const saved = { ...b.viewport };
    const file = out(ctx, path, tmpName('pretty.png'));
    try {
      if (o['--cleanup']) await HANDLERS.cleanup(b, tab, ['--all']);
      if (hide.length) await b.evaluate(tab, `for (const s of ${JSON.stringify(hide)}) for (const e of document.querySelectorAll(s)) { e.dataset.misHidden = e.style.visibility; e.style.visibility = 'hidden'; }`);
      if (o['--width']) { b.viewport = { ...b.viewport, width: Number(o['--width']) }; await b.applyViewport(tab); await sleep(150); }
      const to = o['--scroll-to'];
      if (to) {
        const found = await b.evaluate(tab, `(() => { let e; try { e = document.querySelector(${JSON.stringify(to)}); } catch {}
          e ??= [...document.querySelectorAll('body *')].find((x) => !x.children.length && x.textContent.includes(${JSON.stringify(to)}));
          if (!e) return false; e.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
        if (!found) throw new Error(`--scroll-to: nothing matches ${to}`);
      }
      writeFileSync(file, await capture(b, tab, { viewport: !!to }));
    } finally {
      if (hide.length) await b.evaluate(tab, `for (const e of document.querySelectorAll('[data-mis-hidden]')) { e.style.visibility = e.dataset.misHidden; delete e.dataset.misHidden; }`).catch(() => {});
      if (o['--width']) { b.viewport = saved; await b.applyViewport(tab); }
    }
    return file;
  },

  // ── M9-E: credentials and request identity (the guard asks for each of these every time)
  async cookies(b) { return (await b.cdp.send('Storage.getCookies')).cookies; },
  async cookie(b, tab, [pair]) {
    const i = pair?.indexOf('=') ?? -1;
    if (i < 1) throw USAGE_ERR('cookie <name>=<value>');
    const url = tab.url;
    if (!/^https?:/.test(url)) throw new Error('cookie sets a cookie for the current page; open an http(s) page first');
    const r = await setCookies(b, [{ name: pair.slice(0, i), value: pair.slice(i + 1), url }]);
    return `Cookie ${pair.slice(0, i)} set for ${new URL(url).hostname}${r.set ? '' : ' (the browser rejected it)'}`;
  },
  async 'cookie-import'(b, tab, args, ctx) { return importCookies(b, ctx); },
  async 'cookie-import-browser'(b, tab, args, ctx) { return importCookies(b, ctx); },
  async header(b, tab, args) {
    if (args[0] === '--clear') b.headers = {};
    else {
      const i = args.join(' ').indexOf(':');
      if (i < 1) throw USAGE_ERR('header <name>:<value> | header --clear');
      const line = args.join(' ');
      b.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    for (const t of b.tabs.values()) await b.applyNetwork(t);
    return `Extra request headers: ${Object.keys(b.headers).join(', ') || '(none)'} (values hidden)`;
  },
  async useragent(b, tab, args) {
    if (!args.length) throw USAGE_ERR('useragent <string>');
    b.userAgent = args.join(' ');
    for (const t of b.tabs.values()) await b.applyNetwork(t);
    return `User agent set (new requests use it): ${b.userAgent}`;
  },
  async state(b, tab, [op, name], ctx) {
    if (!['save', 'load'].includes(op) || !/^[\w.-]{1,64}$/.test(name ?? '') || /^\.+$/.test(name)) throw USAGE_ERR('state save|load <name> (letters, digits, . _ -)');
    const dir = join(ctx.stateDir, 'states'), file = join(dir, `${name}.json`);
    if (op === 'save') {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const s = { savedAt: new Date().toISOString(), urls: (await b.tabUrls()).filter((u) => /^(https?|file):/.test(u)), cookies: (await b.cdp.send('Storage.getCookies')).cookies };
      writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
      return `Saved ${s.cookies.length} cookies and ${s.urls.length} page(s) to ${file}`;
    }
    if (!existsSync(file)) throw new Error(`no saved state "${name}"`);
    const s = JSON.parse(readFileSync(file, 'utf8'));
    await b.cdp.send('Storage.setCookies', { cookies: s.cookies });
    remember(b, s.cookies.map((c) => c.domain));
    const [first, ...rest] = s.urls;
    if (first) await b.navigate(b.current(), first);
    for (const u of rest) await b.newTab(u);
    if (first) b.active = [...b.tabs.values()].find((t) => t.url === first)?.id ?? b.active;
    return `Loaded ${s.cookies.length} cookies and ${s.urls.length} page(s) from ${name}`;
  },

  // ── M9-E: extraction (asks every time)
  async download(b, tab, [target, path], ctx) {
    if (!target) throw USAGE_ERR('download <url|selector|@ref> [path]');
    const url = looksLikeSelector(target) ? await b.callOn(tab, await b.element(tab, target), function () { return this.currentSrc || this.src || this.href || ''; })
      : new URL(target, tab.url).href;
    if (!url) throw new Error(`${target} has no src or href`);
    const data = await fetchResource(b, tab, url);
    const file = out(ctx, path, tmpName(basename(new URL(url).pathname) || 'download'));
    writeFileSync(file, data.body);
    return { path: file, url, bytes: data.body.length, status: data.status };
  },
  async scrape(b, tab, args, ctx) {
    const [o, [kind]] = flags(args, { '--selector': 1, '--dir': 1, '--limit': 1 });
    if (!['images', 'videos', 'media'].includes(kind)) throw USAGE_ERR('scrape <images|videos|media> [--selector sel] [--dir path] [--limit N]');
    const m = await b.evaluate(tab, JS.media(o['--selector']));
    const items = [...(kind !== 'videos' ? m.images : []), ...(kind !== 'images' ? [...m.videos, ...m.audio] : [])];
    const urls = [...new Set(items.flatMap((x) => x.src ? [x.src] : []).filter((u) => /^(https?|file):/.test(u)))].slice(0, Number(o['--limit'] ?? 50));
    const dir = out(ctx, o['--dir'], tmpName('scrape'));
    mkdirSync(dir, { recursive: true });
    const manifest = [];
    for (const [i, url] of urls.entries()) {
      const file = join(dir, `${String(i + 1).padStart(3, '0')}-${(basename(new URL(url).pathname) || 'file').replace(/[^\w.-]/g, '_').slice(0, 80)}`);
      try { const d = await fetchResource(b, tab, url); writeFileSync(file, d.body); manifest.push({ url, file, bytes: d.body.length }); }
      catch (e) { manifest.push({ url, error: e.message }); }
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { dir, saved: manifest.filter((x) => x.file).length, failed: manifest.filter((x) => x.error).length, manifest: join(dir, 'manifest.json') };
  },
  async archive(b, tab, [path], ctx) {
    const { data } = await b.send(tab, 'Page.captureSnapshot', { format: 'mhtml' }, 120000);
    const file = out(ctx, path, tmpName('page.mhtml'));
    writeFileSync(file, data);
    return { path: file, bytes: Buffer.byteLength(data) };
  },

  // ── M9-E: tabs, headed browser and observation
  async 'tab-each'(b, tab, [cmd, ...args], ctx) {
    if (!cmd || ['tab-each', 'chain', 'tab', 'newtab', 'closetab'].includes(cmd)) throw USAGE_ERR('tab-each <command> [args...] (not chain, tab-each or tab commands)');
    const results = [];
    for (const t of [...b.tabs.values()]) {
      b.active = t.id;
      try { results.push({ tab: t.id, url: t.url, result: await runCommand(b, cmd, args, { ...ctx, inChain: true }) }); }
      catch (e) { results.push({ tab: t.id, url: t.url, error: e.message }); }
    }
    b.active = tab.id;
    return results;
  },
  async connect(b, tab, args, ctx) {
    const [o] = flags(args, { '--profile-dir': 1, '--no-extension': true });
    if (b.handoff) throw new Error('a handoff is in progress; run `mis browse resume` first');
    // a persistent profile is for logging into real sites (unreachable here), and its extensions could change the proxy
    if (b.localOnly) throw new Error('connect is not available in the local-only browser: it opens a persistent profile for real sites, which local-only mode cannot reach, and that profile\'s extensions could change the proxy. Run `mis browse stop` first');
    const profile = resolve(ctx.cwd, o['--profile-dir'] ?? join(ctx.home, 'chrome-profile'));
    // never the user's own browser data (Chrome 136+ refuses DevTools there, and its logins must not be driven from here);
    // to use those sessions, import one site's cookies with cookie-import-browser
    const own = ownBrowserData(profile);
    if (own) throw new Error(`${profile} is inside your browser's own data (${own}); connect uses its own profile. Pick another --profile-dir, or import a site's cookies with cookie-import-browser`);
    const data = foreignUserData(profile, ctx.home);
    if (data) throw new Error(`${profile} looks like a browser's user data (${data} has a Chrome "Local State" file) that connect did not create; connect only uses its own profiles. Pick an empty --profile-dir`);
    const copied = copiedProfileData(profile, ctx.home);
    if (copied) throw new Error(`${profile} holds browser profile data (${copied}) that connect did not create (a copied profile?); connect only uses its own profiles. Pick an empty --profile-dir`);
    const linked = hardlinkedRealData(profile);
    if (linked) throw new Error(`${profile} contains a hard link of your browser's own data (${linked}, the same file); connect never uses the real browser's credentials. Remove it or pick an empty --profile-dir`);
    // a running browser owns its profile (a second instance just hands the URL to it)
    if (profileInUse(profile)) throw new Error(`${profile} is in use by a running browser; quit it or pick another --profile-dir`);
    mkdirSync(profile, { recursive: true, mode: 0o700 });
    if (!existsSync(join(profile, PROFILE_MARK))) writeFileSync(join(profile, PROFILE_MARK), 'A profile made by mis browse connect.\n');
    const urls = await b.tabUrls();
    b.connected = { profile, extension: o['--no-extension'] ? null : EXTENSION_DIR };
    try { await b.relaunch(false, urls); } catch (e) { b.connected = null; await b.relaunch(true, urls).catch(() => {}); throw e; }
    return { mode: 'connected', profile, extensionId: b.extensionId, headless: b.headlessOnly,
      note: `A visible Chrome on ${profile}; logins you make there stay in that profile. ${b.extensionId ? `Side panel: click the Make It Ship toolbar icon (extension ${b.extensionId}); \`mis browse inbox\` reads its messages.` : ''} \`mis browse disconnect\` returns to headless.` };
  },
  async disconnect(b) {
    if (!b.connected) return 'not connected (already headless)';
    const urls = await b.tabUrls();
    b.connected = null;
    await b.relaunch(true, urls);
    return `Disconnected; headless again at ${b.current().url}`;
  },
  async focus(b, tab, [sel]) {
    await b.send(tab, 'Page.bringToFront');
    await b.cdp.send('Target.activateTarget', { targetId: tab.targetId }).catch(() => {});
    if (sel) await b.callOn(tab, await b.element(tab, sel), function () { this.scrollIntoView({ block: 'center', behavior: 'instant' }); this.focus(); });
    return `Focused tab ${tab.id}${sel ? ` and ${sel}` : ''}`;
  },
  async memory(b) {
    const tabs = [];
    for (const t of b.tabs.values()) {
      const h = await b.send(t, 'Runtime.getHeapUsage').catch(() => null);
      tabs.push({ id: t.id, url: t.url, jsHeapUsedMB: h ? mb(h.usedSize) : null, jsHeapTotalMB: h ? mb(h.totalSize) : null,
        buffers: { console: t.console.length, network: t.network.length, dialogs: t.dialogs.length } });
    }
    return { daemon: Object.fromEntries(Object.entries(process.memoryUsage()).map(([k, v]) => [`${k}MB`, mb(v)])), tabs, browser: browserRss(b.proc?.pid) };
  },
  async watch(b, tab, args) {
    const [o, [op]] = flags(args, { '--interval': 1 });
    const shot = async () => {
      const t = b.current();
      const text = (await axTree(b, t, { compact: true, refs: false })).text;
      const w = b.watch, last = w.entries.at(-1);
      if (!last || last.url !== t.url || last.text !== text) { w.entries.push({ at: new Date().toISOString(), url: t.url, text }); if (w.entries.length > 50) w.entries.shift(); }
    };
    if (op === 'stop') {
      if (!b.watch) throw new Error('not watching (start with `mis browse watch`)');
      clearInterval(b.watch.timer);
      await shot().catch(() => {});
      const { entries, started } = b.watch;
      b.watch = null;
      return { started, stopped: new Date().toISOString(), snapshots: entries.map((e, i) => ({ at: e.at, url: e.url,
        changes: i && entries[i - 1].url === e.url ? lineDiff(entries[i - 1].text, e.text).join('\n') : e.text })) };
    }
    if (op) throw USAGE_ERR('watch [--interval seconds] | watch stop');
    if (b.watch) return `watching since ${b.watch.started} (${b.watch.entries.length} snapshot(s)); \`mis browse watch stop\` for the summary`;
    const sec = Number(o['--interval'] ?? 5);
    if (!(sec >= 1)) throw new Error('--interval must be at least 1 second');
    b.watch = { started: new Date().toISOString(), entries: [] };
    await shot();
    b.watch.timer = setInterval(() => { if (b.watch) shot().catch(() => {}); }, sec * 1000); // errors (navigation, closed tab) only skip a tick
    b.watch.timer.unref?.();
    return `Watching: a snapshot every ${sec}s while you browse; \`mis browse watch stop\` returns what changed`;
  },
  async inbox(b, tab, args) {
    if (!b.extensionId) throw new Error('no side panel: run `mis browse connect` (it loads the Make It Ship extension) first');
    const clear = args.includes('--clear');
    const expr = `chrome.storage.local.get('inbox').then(async (r) => { const m = r.inbox || []; ${clear ? "await chrome.storage.local.set({ inbox: [] });" : ''} return m; })`;
    // read the extension's storage from one of its own pages over the DevTools pipe: the extension never talks to the daemon
    const { targetId } = await b.cdp.send('Target.createTarget', { url: `chrome-extension://${b.extensionId}/sidepanel.html`, background: true });
    try {
      const { sessionId } = await b.cdp.send('Target.attachToTarget', { targetId, flatten: true });
      for (let i = 0; ; i++) {
        const r = await b.cdp.send('Runtime.evaluate', { expression: `typeof chrome !== 'undefined' && !!chrome.storage && document.readyState === 'complete'`, returnByValue: true }, sessionId);
        if (r.result.value) break;
        if (i > 100) throw new Error('the extension page did not load');
        await sleep(50);
      }
      const r = await b.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
      const msgs = r.result.value ?? [];
      return msgs.length ? msgs : '(inbox empty)';
    } finally { await b.cdp.send('Target.closeTarget', { targetId }).catch(() => {}); }
  },
  async history(b, tab, args) {
    if (args.includes('--clear')) { b.history.length = 0; return 'cleared'; }
    return b.history;
  },

  // ── handoff
  async handoff(b, tab, args) {
    if (b.handoff) return `HANDOFF: already waiting for the user at ${tab.url}`;
    if (b.connected) throw new Error('the browser is already visible (connect); act there, or run `mis browse disconnect` first');
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

// Commands a browser skill may replay (skillify): the rest only observe, or are lifecycle/meta.
const NOT_IN_SKILLS = new Set(['history', 'url', 'tabs', 'console', 'network', 'dialog', 'perf', 'memory', 'inbox', 'watch', 'focus', 'connect', 'disconnect', 'handoff', 'resume', 'cdp']);

export async function runCommand(b, cmd, args, ctx) {
  if (cmd === 'chain') return chain(b, args[0], ctx);
  const h = HANDLERS[cmd];
  if (!h) throw new Error(`unknown browse command "${cmd}". Commands: ${Object.keys(HANDLERS).join(', ')}, chain, status, stop, restart`);
  if (cmd === 'cdp' && ctx.inChain) throw new Error('cdp is not allowed inside chain; run `mis browse cdp ...` on its own so the guard can ask');
  // M9-E: the guard asks for these every time, and it cannot see inside chain files, tab-each or browser skills
  if (BROWSE_ALWAYS_ASK.has(cmd) && ctx.inChain) throw new Error(`${cmd} is not allowed inside chain, tab-each or a browser skill; run \`mis browse ${cmd} ...\` on its own so the guard can ask`);
  const seen = b.blocked.length;
  const result = failIfBlocked(b, seen, cmd, await gated(b, h, cmd, args, ctx));
  record(b, cmd, args); // only commands that succeeded
  return result;
}

/** Fails `cmd` if a page holding a file attached without --remote made non-local requests (blocked) while it ran. */
export function failIfBlocked(b, seen, cmd, result) {
  const blocked = [...new Set(b.blocked.slice(seen))]; // a popup's request is seen by both of its sessions
  if (!blocked.length) return result;
  throw new Error(`${cmd} ran, but a page that holds a file attached without --remote made requests to non-local hosts, and the browser blocked them: ${blocked.join('; ')}. `
    + 'Such a file may only go to local hosts; non-local requests of every tab stay blocked while the page is open. '
    + 'To send a file to a site on purpose: `mis browse stop`, then `upload ... --remote` in a normal browser (the guard asks the user first)');
}

/** Where a navigation command is about to go (M9 fix1: checked against imported credentials before it runs). */
async function navTargets(b, tab, cmd, args, ctx) {
  if (cmd === 'goto' || cmd === 'newtab') return args[0] ? [toUrl(String(args[0]), ctx.cwd)] : [];
  if (cmd === 'diff') return args.slice(0, 2).map((u) => toUrl(String(u), ctx.cwd));
  if (cmd === 'reload') return [tab.url];
  if (cmd === 'back' || cmd === 'forward') {
    const { currentIndex, entries } = await b.send(tab, 'Page.getNavigationHistory');
    return [entries[currentIndex + (cmd === 'back' ? -1 : 1)]?.url].filter(Boolean);
  }
  return [];
}

async function gated(b, h, cmd, args, ctx) {
  const tab = b.current();
  // ADR-0003 (credentials always ask): with imported sessions, browsing a non-local site they log into needs --remote,
  // which the guard asks about. shortcut: a click that follows a link there is not checked beforehand (RISKS).
  if (b.credentialDomains?.size && !ctx.remote) {
    for (const u of await navTargets(b, tab, cmd, args, ctx)) {
      let host; try { host = new URL(u).hostname.toLowerCase(); } catch { continue; }
      if (isLocalOrigin(u) || ![...b.credentialDomains].some((d) => host === d || host.endsWith(`.${d}`))) continue;
      throw new Error(`${cmd} to ${new URL(u).origin} would browse a non-local site with imported credentials (logged-in cookies from cookie-import or state load); rerun with --remote (the guard asks the user first)`);
    }
  }
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

/** Command history for skillify: typed values become {{input}} parameters at once (never kept); credential commands are not recorded. */
function record(b, cmd, args) {
  if (BROWSE_ALWAYS_ASK.has(cmd) || NOT_IN_SKILLS.has(cmd)) return;
  let a = args.map(String);
  if (cmd === 'fill') a = [a[0], '{{input}}'];
  if (cmd === 'type') a = ['{{input}}'];
  b.history.push({ cmd, args: a, at: new Date().toISOString() });
  if (b.history.length > 200) b.history.shift();
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
