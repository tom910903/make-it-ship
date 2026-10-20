// Browser state of the daemon: tabs (one flattened CDP session each), event capture, navigation, element lookup.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, CDP } from './chrome.mjs';
import { isLocalUrl } from './util.mjs';

const CAP = 2000; // per-tab buffer size for console/network/dialog entries
const push = (arr, x) => { arr.push(x); if (arr.length > CAP) arr.splice(0, arr.length - CAP); };
const fmtArg = (a) => a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : a.unserializableValue ?? a.description ?? a.type;
const errText = (d) => (d.exception?.description ?? d.text ?? 'error').split('\n')[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Browser {
  constructor({ exe, extraArgs = [], headlessOnly = false }) {
    Object.assign(this, { exe, extraArgs, headlessOnly });
    this.tabs = new Map(); this.bySession = new Map(); this.seq = 0; this.active = null;
    this.viewport = { width: 1280, height: 720, scale: 1 };
    this.headless = true; this.handoff = null; this.profile = null; this.proc = null; this.cdp = null;
  }

  async start(headless = true) {
    this.profile ??= mkdtempSync(join(tmpdir(), 'mis-browse-profile-'));
    const { proc, wsUrl } = await launchChrome({ exe: this.exe, userDataDir: this.profile, headless: headless || this.headlessOnly, extraArgs: this.extraArgs });
    this.proc = proc; this.headless = headless;
    proc.on('exit', () => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.lastTabs = [...this.tabs.values()].map((t) => t.url); // a user closing the visible window mid-handoff: resume reopens these
      this.onExit?.();
    });
    this.cdp = await CDP.connect(wsUrl);
    this.cdp.on((m, p, s) => this.event(m, p, s));
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    const pages = targetInfos.filter((t) => t.type === 'page');
    for (const t of pages) await this.attach(t.targetId);
    if (!pages.length) await this.newTab();
    this.active = [...this.tabs.keys()][0];
  }

  /** Clean browser exit (flushes cookies to the profile), then a hard kill if it hangs. */
  async shutdown() {
    const proc = this.proc;
    this.proc = null;
    if (this.cdp && !this.cdp.closed) await this.cdp.send('Browser.close', {}, undefined, 5000).catch(() => {});
    this.cdp?.close();
    if (proc && proc.exitCode === null) {
      await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(5000)]);
      if (proc.exitCode === null) proc.kill('SIGKILL');
    }
    this.tabs.clear(); this.bySession.clear(); this.active = null;
  }

  async close() {
    await this.shutdown();
    if (this.profile) rmSync(this.profile, { recursive: true, force: true });
  }

  send(tab, method, params = {}, timeoutMs) { return this.cdp.send(method, params, tab.sessionId, timeoutMs); }

  async attach(targetId) {
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const tab = { id: ++this.seq, targetId, sessionId, url: 'about:blank', title: '', mainFrameId: null, frameId: null, frameUrl: null,
      refs: new Map(), nodeRef: new Map(), refSeq: 0, lastSnapshot: null, contexts: new Map(),
      console: [], network: [], requests: new Map(), dialogs: [], dialogPolicy: { accept: true, text: '' },
      inflight: 0, lastNet: 0, navTs: 0, loading: false, waiters: new Set() };
    this.tabs.set(tab.id, tab); this.bySession.set(sessionId, tab);
    const s = (m, p) => this.send(tab, m, p);
    await Promise.all(['Page', 'Runtime', 'Network', 'DOM', 'Log'].map((d) => s(`${d}.enable`)));
    await s('Accessibility.enable').catch(() => {});
    await this.applyViewport(tab);
    const { frameTree } = await s('Page.getFrameTree');
    tab.mainFrameId = frameTree.frame.id; tab.url = frameTree.frame.url;
    return tab;
  }

  async newTab(url) {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
    const tab = await this.attach(targetId);
    this.active = tab.id;
    if (url) await this.navigate(tab, url);
    return tab;
  }

  current() {
    const tab = this.tabs.get(this.active) ?? [...this.tabs.values()].at(-1);
    if (!tab) throw new Error('no open tab (run `mis browse newtab`)');
    this.active = tab.id;
    return tab;
  }

  applyViewport(tab) {
    if (!this.headless) return; // a visible window (handoff) keeps the user's own window size
    const { width, height, scale } = this.viewport;
    return this.send(tab, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  }

  event(method, p, sessionId) {
    if (method === 'Target.targetCreated' && p.targetInfo.type === 'page' && p.targetInfo.openerId && !this.handoff) {
      if (![...this.tabs.values()].some((t) => t.targetId === p.targetInfo.targetId)) this.attach(p.targetInfo.targetId).catch(() => {});
      return;
    }
    if (method === 'Target.targetDestroyed' || method === 'Target.detachedFromTarget') {
      const gone = [...this.tabs.values()].find((t) => (p.targetId && t.targetId === p.targetId) || (p.sessionId && t.sessionId === p.sessionId));
      if (gone) { this.tabs.delete(gone.id); this.bySession.delete(gone.sessionId); if (this.active === gone.id) this.active = [...this.tabs.keys()].at(-1) ?? null; }
      return;
    }
    const tab = this.bySession.get(sessionId);
    if (!tab) return;
    const main = (frameId) => frameId === tab.mainFrameId;
    switch (method) {
      case 'Runtime.executionContextCreated': if (p.context.auxData?.isDefault) tab.contexts.set(p.context.auxData.frameId, p.context.id); break;
      case 'Runtime.executionContextDestroyed':
        for (const [f, id] of tab.contexts) if (id === p.executionContextId) tab.contexts.delete(f);
        break;
      case 'Runtime.executionContextsCleared': tab.contexts.clear(); break;
      case 'Runtime.consoleAPICalled': {
        const f = p.stackTrace?.callFrames?.[0];
        push(tab.console, { type: p.type === 'warning' ? 'warn' : p.type, text: p.args.map(fmtArg).join(' '), url: f?.url, line: f ? f.lineNumber + 1 : undefined });
        break;
      }
      case 'Runtime.exceptionThrown': push(tab.console, { type: 'error', text: errText(p.exceptionDetails), url: p.exceptionDetails.url, line: p.exceptionDetails.lineNumber + 1 }); break;
      case 'Log.entryAdded': push(tab.console, { type: p.entry.level === 'warning' ? 'warn' : p.entry.level, text: p.entry.text, url: p.entry.url }); break;
      case 'Network.requestWillBeSent': {
        const prev = tab.requests.get(p.requestId);
        if (prev && p.redirectResponse) { prev.status = p.redirectResponse.status; prev.done = true; tab.inflight--; }
        const r = { id: p.requestId, method: p.request.method, url: p.request.url, type: p.type, start: p.timestamp, status: null, size: 0, ms: null };
        tab.requests.set(p.requestId, r); push(tab.network, r);
        tab.inflight++; tab.lastNet = Date.now();
        if (p.type === 'Document' && main(p.frameId)) tab.navTs = p.timestamp;
        break;
      }
      case 'Network.responseReceived': { const r = tab.requests.get(p.requestId); if (r) { r.status = p.response.status; r.mime = p.response.mimeType; } break; }
      case 'Network.loadingFinished':
      case 'Network.loadingFailed': {
        const r = tab.requests.get(p.requestId);
        if (r && !r.done) {
          r.done = true; r.ms = Math.round((p.timestamp - r.start) * 1000);
          if (method === 'Network.loadingFinished') r.size = p.encodedDataLength; else r.failed = p.errorText;
          tab.inflight = Math.max(0, tab.inflight - 1); tab.lastNet = Date.now();
        }
        tab.requests.delete(p.requestId);
        break;
      }
      case 'Page.javascriptDialogOpening':
        push(tab.dialogs, { type: p.type, message: p.message, accepted: this.headless ? tab.dialogPolicy.accept : null });
        // a visible browser (handoff) leaves dialogs to the user; headless would block forever otherwise
        if (this.headless) this.send(tab, 'Page.handleJavaScriptDialog', { accept: tab.dialogPolicy.accept, promptText: tab.dialogPolicy.text }).catch(() => {});
        break;
      case 'Page.frameNavigated':
        if (!p.frame.parentId) {
          tab.mainFrameId = p.frame.id; tab.url = p.frame.url;
          tab.refs.clear(); tab.nodeRef.clear(); tab.refSeq = 0; tab.frameId = null; tab.frameUrl = null;
        }
        break;
      case 'Page.navigatedWithinDocument': if (main(p.frameId)) { tab.url = p.url; this.wake(tab); } break;
      case 'Page.frameStartedLoading': if (main(p.frameId)) tab.loading = true; break;
      case 'Page.frameStoppedLoading': if (main(p.frameId)) { tab.loading = false; this.wake(tab); } break;
      case 'Page.loadEventFired': tab.loading = false; this.wake(tab); break;
    }
  }

  wake(tab) { for (const w of tab.waiters) w(); tab.waiters.clear(); }

  waitLoad(tab, ms = 30000) {
    let w, timer;
    const promise = new Promise((resolve, reject) => {
      w = () => { clearTimeout(timer); resolve(); };
      timer = setTimeout(() => { tab.waiters.delete(w); reject(new Error(`page did not finish loading within ${ms / 1000}s`)); }, ms);
      tab.waiters.add(w);
    });
    return { promise, cancel: () => { clearTimeout(timer); tab.waiters.delete(w); } };
  }

  async navigate(tab, url) {
    const wait = this.waitLoad(tab);
    wait.promise.catch(() => {});
    const r = await this.send(tab, 'Page.navigate', { url });
    if (r.errorText) { wait.cancel(); throw new Error(`cannot open ${url}: ${r.errorText}`); }
    if (!r.loaderId) { wait.cancel(); return null; } // same-document navigation
    await wait.promise;
    return [...tab.network].reverse().find((q) => q.type === 'Document' && q.start >= tab.navTs)?.status ?? null;
  }

  /** After an input event: if it started a page load, wait for it (bounded). */
  async settle(tab) {
    await sleep(80);
    if (!tab.loading) return;
    const w = this.waitLoad(tab, 15000);
    await w.promise.catch(() => {});
  }

  async evaluate(tab, expression, { byValue = true } = {}) {
    const contextId = tab.frameId ? tab.contexts.get(tab.frameId) : undefined;
    if (tab.frameId && !contextId) throw new Error('the selected frame is gone; run `mis browse frame main`');
    const r = await this.send(tab, 'Runtime.evaluate', { expression, returnByValue: byValue, awaitPromise: true, userGesture: true, ...(contextId ? { contextId } : {}) });
    if (r.exceptionDetails) throw new Error(errText(r.exceptionDetails));
    return byValue ? r.result.value : r.result;
  }

  async callOn(tab, objectId, fn, ...args) {
    const r = await this.send(tab, 'Runtime.callFunctionOn', { objectId, functionDeclaration: String(fn), arguments: args.map((value) => ({ value })), returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(errText(r.exceptionDetails));
    return r.result.value;
  }

  /** objectId of a CSS selector (auto-waits briefly) or an @e ref from snapshot (stale refs fail fast). */
  async element(tab, target, waitMs = 3000) {
    if (/^@e\d+$/.test(target)) {
      const backendNodeId = tab.refs.get(target);
      if (!backendNodeId) throw new Error(`unknown ref ${target}: run \`mis browse snapshot\` first (refs reset on navigation)`);
      const stale = new Error(`stale ref ${target}: the element is no longer in the page; run \`mis browse snapshot\` again`);
      const obj = await this.send(tab, 'DOM.resolveNode', { backendNodeId }).catch(() => { throw stale; });
      if (!(await this.callOn(tab, obj.object.objectId, function () { return this.isConnected; }))) throw stale;
      return obj.object.objectId;
    }
    const deadline = Date.now() + waitMs;
    for (;;) {
      const r = await this.evaluate(tab, `document.querySelector(${JSON.stringify(target)})`, { byValue: false });
      if (r.objectId) return r.objectId;
      if (Date.now() > deadline) throw new Error(`no element matches ${target}`);
      await sleep(100);
    }
  }

  /** Center of the element's box in viewport coordinates, after scrolling it into view. */
  async center(tab, objectId, target) {
    await this.callOn(tab, objectId, function () { this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); });
    const { quads } = await this.send(tab, 'DOM.getContentQuads', { objectId }).catch(() => ({ quads: [] }));
    if (!quads?.length) throw new Error(`${target} is not visible (it has no layout box)`);
    const q = quads[0];
    return { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 };
  }

  mouse(tab, type, { x, y }, extra = {}) {
    return this.send(tab, 'Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  }

  /** Local main page and (if selected) local frame: storage and page JS run without --remote. */
  isLocal(tab) { return isLocalUrl(tab.url) && (!tab.frameId || isLocalUrl(tab.frameUrl)); }

  async tabUrls() {
    if (!this.cdp || this.cdp.closed) return this.lastTabs ?? [];
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    const pages = targetInfos.filter((t) => t.type === 'page' && !/^(chrome|devtools|chrome-search):/.test(t.url));
    const active = this.tabs.get(this.active)?.targetId;
    pages.sort((a, b) => (b.targetId === active) - (a.targetId === active));
    return pages.map((t) => t.url);
  }

  /** Restart on the same profile (cookies and storage carry over) and reopen the given pages; the first becomes active. */
  async relaunch(headless, urls) {
    await this.shutdown();
    await this.start(headless);
    const [first, ...rest] = urls.length ? urls : ['about:blank'];
    const firstTab = this.current();
    if (first !== 'about:blank') await this.navigate(firstTab, first).catch(() => {});
    for (const u of rest) await this.newTab(u).catch(() => {});
    this.active = firstTab.id;
  }
}
