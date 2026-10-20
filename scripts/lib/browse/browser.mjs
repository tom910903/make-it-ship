// Browser state of the daemon: tabs (one flattened CDP session each), event capture, navigation, element lookup.
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome } from './chrome.mjs';
import { isLocalOrigin } from './util.mjs';

const CAP = 2000; // per-tab buffer size for console/network/dialog entries
const push = (arr, x) => { arr.push(x); if (arr.length > CAP) arr.splice(0, arr.length - CAP); };
const fmtArg = (a) => a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : a.unserializableValue ?? a.description ?? a.type;
const errText = (d) => (d.exception?.description ?? d.text ?? 'error').split('\n')[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pageKey = (url) => `url:${String(url).split('#')[0]}`;

export class Browser {
  constructor({ exe, extraArgs = [], headlessOnly = false }) {
    Object.assign(this, { exe, extraArgs, headlessOnly });
    this.tabs = new Map(); this.bySession = new Map(); this.seq = 0; this.active = null;
    this.viewport = { width: 1280, height: 720, scale: 1 };
    this.headless = true; this.handoff = null; this.profile = null; this.proc = null; this.cdp = null;
    this.blocked = []; // requests refused because a page holds a file attached without --remote (M8 R2-1)
  }

  async start(headless = true) {
    this.profile ??= mkdtempSync(join(tmpdir(), 'mis-browse-profile-'));
    const { proc, cdp } = await launchChrome({ exe: this.exe, userDataDir: this.profile, headless: headless || this.headlessOnly, extraArgs: this.extraArgs });
    this.proc = proc; this.headless = headless; this.autoAttached = false;
    proc.on('exit', () => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.lastTabs = [...this.tabs.values()].map((t) => t.url); // a user closing the visible window mid-handoff: resume reopens these
      this.onExit?.();
    });
    this.cdp = cdp;
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
    if (!this.profile) return;
    // browser helper processes can still write into the profile for a moment after the browser exits
    for (let i = 0; i < 10; i++) {
      rmSync(this.profile, { recursive: true, force: true, maxRetries: 3 });
      await sleep(200);
      if (!existsSync(this.profile)) return;
    }
  }

  send(tab, method, params = {}, timeoutMs) { return this.cdp.send(method, params, tab.sessionId, timeoutMs); }

  async attach(targetId) {
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const tab = { id: ++this.seq, targetId, sessionId, url: 'about:blank', title: '', mainFrameId: null, frameId: null, frameUrl: null,
      refs: new Map(), nodeRef: new Map(), refSeq: 0, lastSnapshot: null, contexts: new Map(),
      console: [], network: [], requests: new Map(), dialogs: [], dialogPolicy: { accept: true, text: '' },
      inflight: 0, lastNet: 0, navTs: 0, loading: false, waiters: new Set(),
      // main-frame navigation tracking: which document is committed, which has loaded, and event counters
      loaderId: null, loadedLoader: null, navSeq: 0, sameDocSeq: 0, startSeq: 0, stoppedAtStart: 0, pinned: null,
      holds: new Set(), intercepting: false };
    this.tabs.set(tab.id, tab); this.bySession.set(sessionId, tab);
    const s = (m, p) => this.send(tab, m, p);
    await Promise.all(['Page', 'Runtime', 'Network', 'DOM', 'Log'].map((d) => s(`${d}.enable`)));
    if (this.holding) await this.intercept(tab); // e.g. a popup of a page that holds a local-only file
    await s('Accessibility.enable').catch(() => {});
    await this.applyViewport(tab);
    const { frameTree } = await s('Page.getFrameTree');
    tab.mainFrameId = frameTree.frame.id; tab.url = frameTree.frame.url; tab.loaderId = frameTree.frame.loaderId;
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
    if (method === 'Target.attachedToTarget' && !sessionId) return this.popupAttached(p);
    if (method === 'Fetch.requestPaused') return this.screen(sessionId, p);
    const tab = this.bySession.get(sessionId);
    if (!tab) return;
    const main = (frameId) => frameId === tab.mainFrameId;
    switch (method) {
      // origin comes from the browser (not from page JS, which can overwrite self.origin)
      case 'Runtime.executionContextCreated':
        if (p.context.auxData?.isDefault) tab.contexts.set(p.context.auxData.frameId, { id: p.context.id, uniqueId: p.context.uniqueId, origin: p.context.origin });
        break;
      case 'Runtime.executionContextDestroyed':
        for (const [f, c] of tab.contexts) if (c.id === p.executionContextId) tab.contexts.delete(f);
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
          tab.mainFrameId = p.frame.id; tab.url = p.frame.url; tab.loaderId = p.frame.loaderId; tab.navSeq++;
          tab.refs.clear(); tab.nodeRef.clear(); tab.refSeq = 0; tab.frameId = null; tab.frameUrl = null;
          this.wake(tab);
        }
        break;
      case 'Page.navigatedWithinDocument': if (main(p.frameId)) { if (tab.holds.has(tab.loaderId)) tab.holds.add(pageKey(p.url)); tab.url = p.url; tab.sameDocSeq++; this.wake(tab); } break;
      case 'Page.frameStartedLoading': if (main(p.frameId)) { tab.loading = true; tab.startSeq++; this.wake(tab); } break;
      case 'Page.frameStoppedLoading':
        if (main(p.frameId)) { tab.loading = false; tab.loadedLoader = tab.loaderId; tab.stoppedAtStart = tab.startSeq; this.wake(tab); }
        break;
      case 'Page.loadEventFired': tab.loading = false; tab.loadedLoader = tab.loaderId; this.wake(tab); break;
    }
  }

  /**
   * M8 R2-1: a file attached by `upload` without --remote may only go to local destinations. The page holding it is
   * remembered by its document (loaderId) and its URLs: back/forward restores a form's chosen files into a new document
   * at the same URL, so that URL stays held for the tab's lifetime (over-blocking a later fresh visit is the safe side).
   * While any tab shows a held page, every tab's requests to non-local hosts fail (form posts, fetch/XHR, beacons,
   * redirects, popups, workers), until the holding tab is closed. Interception is armed before the file is attached, so an onchange upload cannot slip out.
   * shortcut: WebSocket handshakes are not visible to the Fetch domain and are not blocked; see PROGRESS RISKS.
   */
  async holdLocalOnly(tab) {
    tab.holds.add(tab.loaderId).add(pageKey(tab.url));
    for (const t of this.tabs.values()) await this.intercept(t);
    if (this.autoAttached) return;
    // pages opened later (popups the holder hands the file to) start paused until their requests are intercepted too
    await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'page' }] });
    this.autoAttached = true;
  }

  async popupAttached({ sessionId, waitingForDebugger }) {
    const s = (m, p = {}) => this.cdp.send(m, p, sessionId);
    // not waiting: a session this daemon opened itself (attachToTarget also reports here) or an existing tab: leave it alone
    if (!waitingForDebugger) return;
    await s('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }).catch(() => {});
    await s('Runtime.runIfWaitingForDebugger').catch(() => {});
  }

  get holding() { return [...this.tabs.values()].some((t) => t.holds.has(t.loaderId) || t.holds.has(pageKey(t.url))); }

  async intercept(tab) {
    if (tab.intercepting) return;
    await this.send(tab, 'Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    tab.intercepting = true; // stays on: deciding per request keeps a restored page covered from its first request
  }

  screen(sessionId, p) {
    let block = true; // fail closed if deciding throws
    try {
      const tab = this.bySession.get(sessionId);
      // the agent's own goto/back/forward/reload leaves the page (and the file) behind: its main-frame document request
      // (and that request's redirects) may go anywhere
      const leaving = tab?.leaving && p.resourceType === 'Document' && p.frameId === tab.mainFrameId;
      block = this.holding && !leaving && !isLocalOrigin(p.request.url);
    } catch { /* block */ }
    if (block) {
      const what = `${p.request.method} ${p.request.url}`;
      // requests that carry data fail the command that caused them; passive loads (GET/HEAD) are blocked and only logged
      if (!['GET', 'HEAD'].includes(p.request.method)) this.blocked.push(what);
      const tab = this.bySession.get(sessionId);
      if (tab) push(tab.console, { type: 'error', text: `mis browse blocked ${what}: a file attached without --remote may not leave this machine` });
    }
    this.cdp.send(block ? 'Fetch.failRequest' : 'Fetch.continueRequest', block ? { requestId: p.requestId, errorReason: 'BlockedByClient' } : { requestId: p.requestId }, sessionId)
      .catch(() => {}); // the request may be gone already (tab closed, navigation cancelled it)
  }

  wake(tab) { for (const w of [...tab.waiters]) w(); }

  /** Resolves when `done()` holds, re-checked on every navigation event of the tab. */
  waitFor(tab, done, ms = 30000, what = 'page did not finish loading') {
    return new Promise((resolve, reject) => {
      if (done()) return resolve();
      const w = () => { if (done()) { clearTimeout(timer); tab.waiters.delete(w); resolve(); } };
      const timer = setTimeout(() => { tab.waiters.delete(w); reject(new Error(`${what} within ${ms / 1000}s`)); }, ms);
      tab.waiters.add(w);
    });
  }

  /**
   * Navigate and wait for *this* navigation: its own document (loaderId of Page.navigate) has loaded, or loading that
   * started after the request stopped without a new document (204, download). Late events of the previous page match neither.
   */
  async navigate(tab, url) {
    const start = tab.startSeq;
    tab.leaving = true;
    try {
      const r = await this.send(tab, 'Page.navigate', { url });
      if (r.errorText) throw new Error(`cannot open ${url}: ${r.errorText}`);
      if (!r.loaderId) return null; // same-document navigation
      await this.waitFor(tab, () => tab.loadedLoader === r.loaderId || tab.stoppedAtStart > start);
    } finally { tab.leaving = false; }
    return [...tab.network].reverse().find((q) => q.type === 'Document' && q.start >= tab.navTs)?.status ?? null;
  }

  /** Run a navigation command without a loaderId (history, reload) and wait until a new document committed and stopped loading, or a same-document move. */
  async waitNav(tab, run, ms = 15000) {
    const nav = tab.navSeq, same = tab.sameDocSeq;
    tab.leaving = true;
    try {
      await run();
      await this.waitFor(tab, () => tab.sameDocSeq > same || (tab.navSeq > nav && !tab.loading), ms, 'the page did not finish navigating');
    } finally { tab.leaving = false; }
  }

  /** After an input event: if it started a page load, wait for it (bounded). */
  async settle(tab) {
    await sleep(80);
    await this.waitFor(tab, () => !tab.loading, 15000).catch(() => {});
  }

  async evaluate(tab, expression, { byValue = true } = {}) {
    // pinned: the document whose origin was checked (gated commands); if it navigated away since, this fails instead of running elsewhere
    const contextId = tab.frameId ? tab.contexts.get(tab.frameId)?.id : undefined;
    if (!tab.pinned && tab.frameId && !contextId) throw new Error('the selected frame is gone; run `mis browse frame main`');
    const where = tab.pinned ? { uniqueContextId: tab.pinned } : contextId ? { contextId } : {};
    const r = await this.send(tab, 'Runtime.evaluate', { expression, returnByValue: byValue, awaitPromise: true, userGesture: true, ...where });
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

  /**
   * The page JS context a command will run in (selected frame, else main frame) and its security origin as the browser
   * reports it. blob: and about:blank documents carry their creator's origin; opaque ones report "://" (not local).
   */
  async pageContext(tab) {
    const frame = tab.frameId ?? tab.mainFrameId;
    try { await this.waitFor(tab, () => tab.contexts.has(tab.frameId ?? tab.mainFrameId), 5000); } catch { /* reported below */ }
    const c = tab.contexts.get(tab.frameId ?? tab.mainFrameId);
    if (!c?.uniqueId) throw new Error(`no script context for the ${frame === tab.mainFrameId ? 'page' : 'selected frame'} yet; try again`);
    return { ...c, local: isLocalOrigin(c.origin) };
  }

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
