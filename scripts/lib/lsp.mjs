// Minimal LSP client (M7-04, absorbs OMC's lsp_* bridge): Content-Length framed JSON-RPC over a language server's stdio,
// a per-extension server table, one lazily started server per (workspace root, server), and WorkspaceEdit application.
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { delimiter, dirname, extname, join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TIMEOUT_MS = Number(process.env.MIS_LSP_TIMEOUT_MS) || 15000;

/** Absolute path of an executable on PATH (pure JS: works with any PATH, spawns nothing), or null. */
export function which(cmd, path = process.env.PATH ?? '') {
  if (cmd.includes('/')) return existsSync(cmd) ? cmd : null;
  for (const d of path.split(delimiter).filter(Boolean)) {
    const p = join(d, cmd);
    try { accessSync(p, constants.X_OK); if (statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
}

// OMC's table (servers.ts), plus alternative Python servers. First command found on PATH wins.
const TS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
export const SERVERS = [
  { lang: 'typescript', commands: [['typescript-language-server', '--stdio']], extensions: TS, installHint: 'npm install -g typescript-language-server typescript' },
  { lang: 'python', commands: [['ty', 'server'], ['pyright-langserver', '--stdio'], ['basedpyright-langserver', '--stdio'], ['pylsp']], extensions: ['.py', '.pyw'], installHint: 'pip install pyright (or python-lsp-server, or ty)' },
  { lang: 'rust', commands: [['rust-analyzer']], extensions: ['.rs'], installHint: 'rustup component add rust-analyzer' },
  { lang: 'go', commands: [['gopls', 'serve']], extensions: ['.go'], installHint: 'go install golang.org/x/tools/gopls@latest' },
  { lang: 'c', commands: [['clangd']], extensions: ['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.m', '.mm'], installHint: 'install clangd from your package manager or LLVM (Xcode command line tools on macOS)' },
  { lang: 'swift', commands: [['sourcekit-lsp']], extensions: ['.swift'], installHint: 'install Swift from https://swift.org/download or via Xcode' },
  { lang: 'java', commands: [['jdtls']], extensions: ['.java'], installHint: 'install from https://github.com/eclipse/eclipse.jdt.ls' },
  { lang: 'kotlin', commands: [['kotlin-lsp', '--stdio']], extensions: ['.kt', '.kts'], installHint: 'brew install JetBrains/utils/kotlin-lsp' },
  { lang: 'json', commands: [['vscode-json-language-server', '--stdio']], extensions: ['.json', '.jsonc'], installHint: 'npm install -g vscode-langservers-extracted' },
  { lang: 'html', commands: [['vscode-html-language-server', '--stdio']], extensions: ['.html', '.htm'], installHint: 'npm install -g vscode-langservers-extracted' },
  { lang: 'css', commands: [['vscode-css-language-server', '--stdio']], extensions: ['.css', '.scss', '.less'], installHint: 'npm install -g vscode-langservers-extracted' },
  { lang: 'vue', commands: [['vue-language-server', '--stdio']], extensions: ['.vue'], installHint: 'npm install -g @vue/language-server' },
  { lang: 'yaml', commands: [['yaml-language-server', '--stdio']], extensions: ['.yaml', '.yml'], installHint: 'npm install -g yaml-language-server' },
  { lang: 'php', commands: [['intelephense', '--stdio']], extensions: ['.php', '.phtml'], installHint: 'npm install -g intelephense' },
  { lang: 'ruby', commands: [['solargraph', 'stdio']], extensions: ['.rb', '.rake', '.gemspec', '.erb'], installHint: 'gem install solargraph' },
  { lang: 'lua', commands: [['lua-language-server']], extensions: ['.lua'], installHint: 'install from https://github.com/LuaLS/lua-language-server' },
  { lang: 'elixir', commands: [['elixir-ls']], extensions: ['.ex', '.exs', '.heex', '.eex'], installHint: 'install from https://github.com/elixir-lsp/elixir-ls' },
  { lang: 'csharp', commands: [['omnisharp', '-lsp']], extensions: ['.cs'], installHint: 'dotnet tool install -g omnisharp' },
  { lang: 'dart', commands: [['dart', 'language-server', '--protocol=lsp']], extensions: ['.dart'], installHint: 'install the Dart or Flutter SDK' },
  { lang: 'verilog', commands: [['verible-verilog-ls', '--rules_config_search']], extensions: ['.v', '.vh', '.sv', '.svh'], installHint: 'download from https://github.com/chipsalliance/verible/releases' },
];
const LANGUAGE_ID = { '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascriptreact', '.py': 'python', '.rs': 'rust', '.go': 'go', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.m': 'objective-c', '.mm': 'objective-cpp', '.swift': 'swift', '.java': 'java', '.kt': 'kotlin', '.rb': 'ruby', '.cs': 'csharp', '.yml': 'yaml', '.htm': 'html', '.jsonc': 'jsonc' };

export const serverFor = (file) => SERVERS.find((s) => s.extensions.includes(extname(file).toLowerCase())) ?? null;
/** [absCommand, args] of the first installed command for a server entry, or null. */
export function installed(entry) {
  for (const [cmd, ...args] of entry.commands) { const p = which(cmd); if (p) return [p, args]; }
  return null;
}

const MARKERS = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'pom.xml', 'package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'compile_commands.json', '.git'];
export function findRoot(file) {
  for (let d = dirname(resolve(file)); parse(d).root !== d; d = dirname(d)) if (MARKERS.some((m) => existsSync(join(d, m)))) return d;
  return dirname(resolve(file));
}

export function frame(msg) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg }));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}
/** Returns a chunk consumer that calls onMessage per complete framed message (bytes, not chars, per Content-Length). */
export function parser(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const h = buf.indexOf('\r\n\r\n');
      if (h < 0) return;
      const len = buf.subarray(0, h).toString().match(/Content-Length:\s*(\d+)/i);
      if (!len) { buf = buf.subarray(h + 4); continue; }
      const end = h + 4 + Number(len[1]);
      if (buf.length < end) return;
      const body = buf.subarray(h + 4, end).toString();
      buf = buf.subarray(end);
      try { onMessage(JSON.parse(body)); } catch { /* skip malformed message */ }
    }
  };
}

const toPath = (uri) => fileURLToPath(uri);
const offsetAt = (text, { line, character }) => {
  let o = 0;
  for (let l = 0; l < line; l++) { const n = text.indexOf('\n', o); if (n < 0) return text.length; o = n + 1; }
  return Math.min(o + character, text.length); // JS string indices are UTF-16 units = LSP's default position encoding
};
function applyTextEdits(path, edits) {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const sorted = edits.map((e) => ({ s: offsetAt(text, e.range.start), e: offsetAt(text, e.range.end), t: e.newText })).sort((a, b) => b.s - a.s || b.e - a.e);
  let out = text;
  for (const x of sorted) out = out.slice(0, x.s) + x.t + out.slice(x.e);
  writeFileSync(path, out);
}
/** Write a WorkspaceEdit to disk; returns the touched file paths. */
export function applyWorkspaceEdit(edit) {
  const touched = new Set();
  for (const [uri, edits] of Object.entries(edit?.changes ?? {})) { applyTextEdits(toPath(uri), edits); touched.add(toPath(uri)); }
  for (const c of edit?.documentChanges ?? []) {
    if (c.kind === 'create') { const p = toPath(c.uri); mkdirSync(dirname(p), { recursive: true }); if (!existsSync(p) || c.options?.overwrite) writeFileSync(p, ''); touched.add(p); }
    else if (c.kind === 'rename') { const n = toPath(c.newUri); mkdirSync(dirname(n), { recursive: true }); renameSync(toPath(c.oldUri), n); touched.add(toPath(c.oldUri)).add(n); }
    else if (c.kind === 'delete') { rmSync(toPath(c.uri), { recursive: !!c.options?.recursive, force: !!c.options?.ignoreIfNotExists }); touched.add(toPath(c.uri)); }
    else { applyTextEdits(toPath(c.textDocument.uri), c.edits); touched.add(toPath(c.textDocument.uri)); }
  }
  return [...touched];
}

export class LspClient {
  constructor(root, command, args = []) {
    Object.assign(this, { root, command, args, alive: false, capabilities: {}, nextId: 0, pending: new Map(), docs: new Map(), diags: new Map(), waiters: new Map() });
  }

  async start() {
    this.proc = spawn(this.command, this.args, { cwd: this.root, stdio: ['pipe', 'pipe', 'pipe'], detached: true }); // own process group: kill() reaches helpers it starts (tsserver, proc-macro servers)
    this.alive = true;
    this.proc.stdout.on('data', parser((m) => this.onMessage(m)));
    this.proc.stderr.resume(); // drain; servers log a lot
    this.proc.stdin.on('error', () => {});
    const died = (why) => { this.alive = false; for (const p of this.pending.values()) p.reject(new Error(`language server ${why}`)); this.pending.clear(); for (const w of this.waiters.values()) w(); this.onExit?.(); };
    this.proc.on('exit', (code) => died(`exited (code ${code})`));
    this.proc.on('error', (e) => died(`failed to start: ${e.message}`));
    const rootUri = pathToFileURL(this.root).href;
    const init = await this.request('initialize', {
      processId: process.pid, rootUri, rootPath: this.root, workspaceFolders: [{ uri: rootUri, name: parse(this.root).base }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: false }, hover: { contentFormat: ['markdown', 'plaintext'] }, definition: { linkSupport: true }, references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true }, rename: { prepareSupport: true },
          codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports'] } }, resolveSupport: { properties: ['edit'] }, dataSupport: true },
          publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } }, diagnostic: {},
        },
        workspace: { symbol: {}, workspaceFolders: true, applyEdit: true, configuration: true, workspaceEdit: { documentChanges: true, resourceOperations: ['create', 'rename', 'delete'] } },
      },
      initializationOptions: {},
    }, Math.max(TIMEOUT_MS, 60000));
    this.capabilities = init?.capabilities ?? {};
    this.notify('initialized', {});
  }

  onMessage(m) {
    if (m.method && m.id !== undefined) return this.onServerRequest(m);
    if (m.method === 'textDocument/publishDiagnostics') {
      const path = toPath(m.params.uri);
      this.diags.set(path, m.params.diagnostics);
      this.waiters.get(path)?.();
      return;
    }
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result ?? null);
  }

  onServerRequest(m) {
    const reply = (result) => this.write({ id: m.id, result });
    switch (m.method) {
      case 'workspace/configuration': return reply((m.params?.items ?? []).map(() => null));
      case 'window/workDoneProgress/create': case 'client/registerCapability': case 'client/unregisterCapability': return reply(null);
      case 'workspace/workspaceFolders': return reply([{ uri: pathToFileURL(this.root).href, name: parse(this.root).base }]);
      case 'workspace/applyEdit':
        try { const files = applyWorkspaceEdit(m.params.edit); this.applied?.push(...files); this.resyncAll(files); return reply({ applied: true }); }
        catch (e) { return reply({ applied: false, failureReason: e.message }); }
      default: return this.write({ id: m.id, error: { code: -32601, message: `method not supported by client: ${m.method}` } });
    }
  }

  write(msg) { if (this.alive) this.proc.stdin.write(frame(msg)); }
  notify(method, params) { this.write({ method, params }); }
  request(method, params, timeoutMs = TIMEOUT_MS) {
    if (!this.alive) return Promise.reject(new Error('language server not running'));
    const id = ++this.nextId;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`LSP request '${method}' timed out after ${timeoutMs}ms`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); res(v); }, reject: (e) => { clearTimeout(t); rej(e); } });
      this.write({ id, method, params });
    });
  }

  /** Open the file, or send its current disk content if it changed since last sync (OMC never re-syncs). Returns the URI. */
  async sync(file) {
    const uri = pathToFileURL(file).href;
    if (!existsSync(file)) throw new Error(`file not found: ${file}`);
    const text = readFileSync(file, 'utf8');
    const doc = this.docs.get(file);
    if (doc?.text === text) return uri;
    this.diags.delete(file);
    if (!doc) this.notify('textDocument/didOpen', { textDocument: { uri, languageId: LANGUAGE_ID[extname(file).toLowerCase()] ?? extname(file).slice(1), version: 1, text } });
    else this.notify('textDocument/didChange', { textDocument: { uri, version: doc.version + 1 }, contentChanges: [{ text }] });
    this.docs.set(file, { text, version: (doc?.version ?? 0) + 1 });
    return uri;
  }
  resyncAll(files) { for (const f of files) if (this.docs.has(f) && existsSync(f)) this.sync(f); }

  /** Diagnostics for a synced file: pull model when the server offers it, else wait for publishDiagnostics. */
  async diagnostics(file, waitMs = 30000) {
    const uri = await this.sync(file);
    if (this.capabilities.diagnosticProvider) return (await this.request('textDocument/diagnostic', { textDocument: { uri } }))?.items ?? [];
    if (!this.diags.has(file)) {
      await new Promise((res) => { const t = setTimeout(res, waitMs); this.waiters.set(file, () => { clearTimeout(t); res(); }); });
      this.waiters.delete(file);
    }
    return this.diags.get(file) ?? [];
  }

  async stop() {
    if (!this.alive) return;
    try { await this.request('shutdown', null, 3000); this.notify('exit', null); } catch { /* kill below */ }
    await new Promise((res) => { if (!this.alive) return res(); const t = setTimeout(() => { this.proc.kill('SIGKILL'); res(); }, 2000); this.proc.once('exit', () => { clearTimeout(t); res(); }); });
  }
  kill() { try { process.kill(-this.proc.pid, 'SIGKILL'); } catch { /* already gone */ } }
}

// One client per (workspace root, server command), started on first use and kept for the MCP session.
const clients = new Map();
export async function clientFor(file) {
  const entry = serverFor(file);
  if (!entry) throw new Error(`no language server known for ${extname(file) || file}; see lsp_servers`);
  const found = installed(entry);
  if (!found) throw new Error(`BLOCKED: language server for ${extname(file)} not found (${entry.commands.map((c) => c[0]).join(' or ')}). Install with: ${entry.installHint}`);
  const root = findRoot(file), key = `${root}\0${found[0]}`;
  let c = clients.get(key);
  if (!c) {
    c = new LspClient(root, ...found);
    const starting = c.start();
    clients.set(key, c);
    c.onExit = () => { if (clients.get(key) === c) clients.delete(key); };
    c.ready = starting;
    try { await starting; } catch (e) { clients.delete(key); c.kill(); throw e; }
  }
  await c.ready;
  return c;
}
export function killAll() { for (const c of clients.values()) c.kill(); clients.clear(); }
