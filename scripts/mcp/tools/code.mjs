// Code intelligence tools (absorbs OMC lsp_*, ast_grep_search/replace, python_repl). File writes happen only when
// apply === true (lsp_rename, ast_grep_replace) or always (lsp_code_action_resolve) — the guard's FILE_WRITERS rule.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVERS, applyWorkspaceEdit, clientFor, installed, killAll, serverFor, which } from '../../lib/lsp.mjs';
import { killRepls, repl } from '../../lib/repl.mjs';

// Language servers and interpreters live as long as this MCP server; stop them when the host goes away.
const cleanup = () => { killAll(); killRepls(); };
process.once('exit', cleanup);
process.stdin.once('end', cleanup);
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(sig, () => { cleanup(); process.exit(0); });

const KINDS = ['', 'File', 'Module', 'Namespace', 'Package', 'Class', 'Method', 'Property', 'Field', 'Constructor', 'Enum', 'Interface', 'Function', 'Variable', 'Constant', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Key', 'Null', 'EnumMember', 'Struct', 'Event', 'Operator', 'TypeParameter'];
const SEVERITY = ['', 'error', 'warning', 'info', 'hint'];

const pos = { line: { type: 'integer', minimum: 1, description: 'Line number (1-based)' }, character: { type: 'integer', minimum: 0, description: 'Character in the line (0-based)' } };
const fileProp = { file: { type: 'string', description: 'Path to the source file (relative to the project directory or absolute)' } };
const atPos = { type: 'object', properties: { ...fileProp, ...pos }, required: ['file', 'line', 'character'] };
const rangeProps = {
  ...fileProp,
  startLine: { type: 'integer', minimum: 1, description: 'Start line (1-based)' }, startCharacter: { type: 'integer', minimum: 0, description: 'Start character (0-based)' },
  endLine: { type: 'integer', minimum: 1, description: 'End line (1-based)' }, endCharacter: { type: 'integer', minimum: 0, description: 'End character (0-based)' },
};

// Canonical paths, so URIs we send match the paths servers publish diagnostics for (symlinked project dirs).
const real = (p) => { try { return realpathSync(p); } catch { return p; } };
/** Run fn(client, absFile, uri) against the language server for a.file (started lazily, reused). */
async function withLsp(a, cwd, fn) {
  if (!a.file) throw new Error('file is required');
  const file = real(resolve(cwd, a.file));
  const c = await clientFor(file);
  return fn(c, file, await c.sync(file));
}
const at = (uri, a) => ({ textDocument: { uri }, position: { line: a.line - 1, character: a.character } });
const loc = (l) => { const r = l.targetSelectionRange ?? l.range ?? l.targetRange; return { file: fileURLToPath(l.uri ?? l.targetUri), line: r.start.line + 1, character: r.start.character }; };
const symbol = (s) => s.location
  ? { name: s.name, kind: KINDS[s.kind], line: s.location.range.start.line + 1, ...(s.containerName ? { container: s.containerName } : {}) }
  : { name: s.name, kind: KINDS[s.kind], line: s.selectionRange.start.line + 1, ...(s.children?.length ? { children: s.children.map(symbol) } : {}) };
const diag = (d) => ({ line: d.range.start.line + 1, character: d.range.start.character, severity: SEVERITY[d.severity ?? 1], message: d.message, source: d.source, code: d.code });
function editSummary(edit) {
  const n = new Map();
  for (const [uri, es] of Object.entries(edit?.changes ?? {})) n.set(fileURLToPath(uri), es.length);
  for (const c of edit?.documentChanges ?? []) if (c.textDocument) { const f = fileURLToPath(c.textDocument.uri); n.set(f, (n.get(f) ?? 0) + c.edits.length); }
  return [...n].map(([file, edits]) => ({ file, edits }));
}
async function codeActions(c, file, uri, a) {
  const range = { start: { line: a.startLine - 1, character: a.startCharacter }, end: { line: a.endLine - 1, character: a.endCharacter } };
  const diagnostics = (c.diags.get(file) ?? []).filter((d) => d.range.start.line <= range.end.line && d.range.end.line >= range.start.line);
  return (await c.request('textDocument/codeAction', { textDocument: { uri }, range, context: { diagnostics } })) ?? [];
}

// tsc --noEmit for a directory with tsconfig.json (OMC's preferred strategy); null when tsc is not installed.
function tscDiagnostics(dir) {
  const tsc = [join(dir, 'node_modules', '.bin', 'tsc')].find(existsSync) ?? which('tsc');
  if (!tsc) return null;
  let out = '';
  try { execFileSync(tsc, ['--noEmit', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 << 20 }); }
  catch (e) { out = `${e.stdout ?? ''}${e.stderr ?? ''}`; if (!out) throw e; }
  const diagnostics = [...out.matchAll(/^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm)].map((m) => ({ file: m[1], line: +m[2], character: +m[3] - 1, severity: m[4], code: m[5], message: m[6] }));
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length, warningCount = diagnostics.length - errorCount;
  if (!diagnostics.length && out.trim()) throw new Error(`tsc failed: ${out.trim().slice(0, 2000)}`); // e.g. a bad tsconfig: never report a pass
  return { strategy: 'tsc', success: errorCount === 0, errorCount, warningCount, diagnostics, summary: `tsc: ${errorCount} errors, ${warningCount} warnings` };
}
function walk(dir, exts, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!['node_modules', 'dist', 'build', '.git'].includes(e.name)) walk(join(dir, e.name), exts, out); }
    else if (e.isFile() && exts.includes(extname(e.name))) out.push(join(dir, e.name));
  }
  return out;
}
async function lspDirectory(dir) {
  const diagnostics = [], skipped = [], hints = new Set();
  let filesChecked = 0;
  for (const file of walk(dir, ['.ts', '.tsx', '.js', '.jsx'])) {
    try {
      const c = await clientFor(file);
      for (const d of await c.diagnostics(file, 2000)) diagnostics.push({ file, ...diag(d) });
      filesChecked++;
    } catch (e) {
      skipped.push({ file, reason: e.message });
      if (/^BLOCKED/.test(e.message)) hints.add(serverFor(file).installHint);
    }
  }
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length, warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
  return {
    strategy: 'lsp', success: errorCount === 0 && skipped.length === 0 && filesChecked > 0, errorCount, warningCount, filesChecked, diagnostics, skipped, installHints: [...hints],
    summary: `LSP: ${errorCount} errors, ${warningCount} warnings in ${filesChecked} file(s)${skipped.length ? `; ${skipped.length} file(s) NOT checked` : ''}${filesChecked ? '' : '; nothing was checked'}`,
  };
}

// ast-grep CLI. `sg` is only trusted when it reports itself as ast-grep (on Linux `sg` is often shadow-utils).
function astGrep() {
  const bin = which('ast-grep') ?? (which('sg') && /ast-grep/.test(spawnSync('sg', ['--version'], { encoding: 'utf8' }).stdout ?? '') ? which('sg') : null);
  if (!bin) throw new Error('BLOCKED: ast-grep not found on PATH. Install with: brew install ast-grep, npm install -g @ast-grep/cli, or cargo install ast-grep --locked');
  return bin;
}
function sgRun(cwd, a, extra) {
  if (!a.pattern || !a.language) throw new Error('pattern and language are required');
  const args = ['run', '--pattern', a.pattern, ...(a.rewrite != null ? ['--rewrite', a.rewrite] : []), '--lang', a.language, ...extra, ...[].concat(a.paths ?? '.')];
  const r = spawnSync(astGrep(), args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000 });
  if (r.error) throw r.error;
  if (extra.includes('--update-all')) { if (r.status !== 0) throw new Error(`ast-grep failed: ${r.stderr.trim()}`); return r.stdout; }
  try { return JSON.parse(r.stdout || '[]'); } catch { throw new Error(`ast-grep failed: ${(r.stderr || r.stdout).trim()}`); }
}
const match = (m) => ({ file: m.file, line: m.range.start.line + 1, column: m.range.start.column + 1, text: m.text, lines: m.lines, vars: Object.fromEntries(Object.entries(m.metaVariables?.single ?? {}).map(([k, v]) => [k, v.text])) });
const sgProps = {
  pattern: { type: 'string', description: 'AST pattern with meta-variables: $NAME matches one node, $$$ARGS matches many (e.g. "console.log($MSG)")' },
  language: { type: 'string', description: 'ast-grep language: javascript, typescript, tsx, python, go, rust, java, kotlin, swift, c, cpp, csharp, ruby, html, css, json, yaml, ...' },
  paths: { type: 'array', items: { type: 'string' }, description: 'Files or directories to search (default: the project directory)' },
};

export const tools = [
  {
    name: 'lsp_hover',
    description: 'Type information, documentation and signature at a position (language server). line is 1-based, character 0-based.',
    inputSchema: atPos,
    handler: (a, { cwd }) => withLsp(a, cwd, async (c, f, uri) => {
      const h = await c.request('textDocument/hover', at(uri, a));
      return h ? [].concat(h.contents).map((x) => typeof x === 'string' ? x : x.value).join('\n\n') : 'No hover information at this position';
    }),
  },
  {
    name: 'lsp_goto_definition',
    description: 'Where the symbol at a position is defined: [{file, line (1-based), character (0-based)}].',
    inputSchema: atPos,
    handler: (a, { cwd }) => withLsp(a, cwd, async (c, f, uri) => [].concat((await c.request('textDocument/definition', at(uri, a))) ?? []).map(loc)),
  },
  {
    name: 'lsp_find_references',
    description: 'All references to the symbol at a position across the workspace: [{file, line, character}].',
    inputSchema: { ...atPos, properties: { ...atPos.properties, includeDeclaration: { type: 'boolean', description: 'Include the declaration (default true)' } } },
    handler: (a, { cwd }) => withLsp(a, cwd, async (c, f, uri) => ((await c.request('textDocument/references', { ...at(uri, a), context: { includeDeclaration: a.includeDeclaration !== false } })) ?? []).map(loc)),
  },
  {
    name: 'lsp_document_symbols',
    description: 'Outline of a file: functions, classes, variables with kind and 1-based line, nested.',
    inputSchema: { type: 'object', properties: fileProp, required: ['file'] },
    handler: (a, { cwd }) => withLsp(a, cwd, async (c, f, uri) => ((await c.request('textDocument/documentSymbol', { textDocument: { uri } })) ?? []).map(symbol)),
  },
  {
    name: 'lsp_workspace_symbols',
    description: 'Search symbols by name across the workspace. file is any file of the workspace (selects the language server).',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Symbol name or fragment' }, ...fileProp }, required: ['query', 'file'] },
    handler: (a, { cwd }) => withLsp(a, cwd, async (c) => ((await c.request('workspace/symbol', { query: a.query })) ?? []).map((s) => ({ name: s.name, kind: KINDS[s.kind], file: fileURLToPath(s.location.uri), line: (s.location.range?.start.line ?? 0) + 1 }))),
  },
  {
    name: 'lsp_diagnostics',
    description: 'Errors, warnings and hints the language server reports for a file (current disk content).',
    inputSchema: { type: 'object', properties: { ...fileProp, severity: { type: 'string', enum: ['error', 'warning', 'info', 'hint'], description: 'Only this severity' } }, required: ['file'] },
    handler: (a, { cwd }) => withLsp(a, cwd, async (c, f) => (await c.diagnostics(f)).map(diag).filter((d) => !a.severity || d.severity === a.severity)),
  },
  {
    name: 'lsp_diagnostics_directory',
    description: 'Project-wide diagnostics for a directory: tsc --noEmit when it has tsconfig.json and tsc is installed, otherwise the language server file by file (.ts/.tsx/.js/.jsx). success is false if any file could not be checked.',
    inputSchema: { type: 'object', properties: { directory: { type: 'string', description: 'Project directory (default: the project directory)' }, strategy: { type: 'string', enum: ['auto', 'tsc', 'lsp'], description: 'auto (default), tsc or lsp' } } },
    handler: async (a, { cwd }) => {
      const dir = real(resolve(cwd, a.directory ?? '.')), strategy = a.strategy ?? 'auto';
      const hasTsconfig = existsSync(join(dir, 'tsconfig.json'));
      if (strategy === 'lsp' || !hasTsconfig) return lspDirectory(dir);
      const tsc = tscDiagnostics(dir);
      if (tsc) return tsc;
      const r = await lspDirectory(dir);
      return { ...r, summary: `tsc not found (npm install -D typescript), fell back to the language server. ${r.summary}` };
    },
  },
  {
    name: 'lsp_servers',
    description: 'Known language servers, whether each is installed, its file extensions and how to install it.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => SERVERS.map((s) => { const f = installed(s); return { lang: s.lang, installed: !!f, command: f ? f[0] : s.commands.map((c) => c[0]).join(' | '), extensions: s.extensions, ...(f ? {} : { installHint: s.installHint }) }; }),
  },
  {
    name: 'lsp_prepare_rename',
    description: 'Whether the symbol at a position can be renamed, and its range (1-based lines, 0-based characters).',
    inputSchema: atPos,
    handler: (a, { cwd }) => withLsp(a, cwd, async (c, f, uri) => {
      const r = await c.request('textDocument/prepareRename', at(uri, a)).catch(() => null);
      if (!r) return 'Cannot rename symbol at this position';
      if (r.defaultBehavior) return { defaultBehavior: true };
      const g = r.range ?? r;
      return { line: g.start.line + 1, character: g.start.character, endLine: g.end.line + 1, endCharacter: g.end.character, ...(r.placeholder ? { placeholder: r.placeholder } : {}) };
    }),
  },
  {
    name: 'lsp_rename',
    description: 'Rename the symbol at a position across the workspace. Returns the edits; writes them to disk only with apply: true.',
    inputSchema: { ...atPos, properties: { ...atPos.properties, newName: { type: 'string', minLength: 1 }, apply: { type: 'boolean', description: 'true writes the edits to disk (default false: preview)' } }, required: [...atPos.required, 'newName'] },
    handler: (a, { cwd }) => withLsp(a, cwd, async (c, f, uri) => {
      const edit = await c.request('textDocument/rename', { ...at(uri, a), newName: a.newName });
      if (!edit) throw new Error('the language server returned no edits for this rename');
      if (a.apply !== true) return { applied: false, files: editSummary(edit), edit, hint: 'pass apply: true to write these edits' };
      c.resyncAll(applyWorkspaceEdit(edit));
      return { applied: true, files: editSummary(edit) };
    }),
  },
  {
    name: 'lsp_code_actions',
    description: 'Quick fixes and refactorings available for a range (1-based lines, 0-based characters). Use the index with lsp_code_action_resolve.',
    inputSchema: { type: 'object', properties: rangeProps, required: Object.keys(rangeProps) },
    handler: (a, { cwd }) => withLsp(a, cwd, async (c, f, uri) => (await codeActions(c, f, uri, a)).map((x, i) => ({ index: i + 1, title: x.title, kind: x.kind, preferred: x.isPreferred || undefined }))),
  },
  {
    name: 'lsp_code_action_resolve',
    description: 'Apply the code action with the given 1-based index from lsp_code_actions (same range): writes its edits to disk and runs its command. Returns the files changed.',
    inputSchema: { type: 'object', properties: { ...rangeProps, actionIndex: { type: 'integer', minimum: 1 } }, required: [...Object.keys(rangeProps), 'actionIndex'] },
    handler: (a, { cwd }) => withLsp(a, cwd, async (c, f, uri) => {
      const actions = await codeActions(c, f, uri, a);
      let x = actions[a.actionIndex - 1];
      if (!x) throw new Error(actions.length ? `invalid actionIndex; available: 1-${actions.length}` : 'no code actions available for this range');
      if (typeof x.command !== 'string' && !x.edit && c.capabilities.codeActionProvider?.resolveProvider) x = await c.request('codeAction/resolve', x);
      const cmd = typeof x.command === 'string' ? x : x.command;
      const files = x.edit ? applyWorkspaceEdit(x.edit) : [];
      c.resyncAll(files);
      if (cmd) { // the server answers with workspace/applyEdit requests, which the client applies
        c.applied = files;
        try { await c.request('workspace/executeCommand', { command: cmd.command, arguments: cmd.arguments }); } finally { c.applied = undefined; }
      }
      if (!x.edit && !cmd) throw new Error(`code action "${x.title}" has no edit or command`);
      return { title: x.title, kind: x.kind, files: [...new Set(files)], command: cmd?.command };
    }),
  },
  {
    name: 'ast_grep_search',
    description: 'Structural code search with ast-grep (AST patterns, more precise than text search). Returns matches with 1-based line/column and captured meta-variables.',
    inputSchema: { type: 'object', properties: { ...sgProps, maxResults: { type: 'integer', minimum: 1, description: 'Default 20' } }, required: ['pattern', 'language'] },
    handler: (a, { cwd }) => {
      const all = sgRun(cwd, a, ['--json=compact']);
      return { total: all.length, matches: all.slice(0, a.maxResults ?? 20).map(match) };
    },
  },
  {
    name: 'ast_grep_replace',
    description: 'Structural rewrite with ast-grep: pattern → rewrite (reuse meta-variables). Previews by default; writes files only with apply: true.',
    inputSchema: { type: 'object', properties: { ...sgProps, rewrite: { type: 'string', description: 'Replacement, e.g. "logger.info($MSG)"' }, apply: { type: 'boolean', description: 'true writes the changes (default false: dry run)' } }, required: ['pattern', 'rewrite', 'language'] },
    handler: (a, { cwd }) => {
      if (a.rewrite == null) throw new Error('rewrite is required');
      const changes = sgRun(cwd, a, ['--json=compact']).map((m) => ({ file: m.file, line: m.range.start.line + 1, text: m.text, replacement: m.replacement }));
      if (a.apply !== true) return { applied: false, changes, hint: changes.length ? 'pass apply: true to write these changes' : 'no matches' };
      if (changes.length) sgRun(cwd, a, ['--update-all']);
      return { applied: changes.length > 0, changes };
    },
  },
  {
    name: 'python_repl',
    description: 'Persistent Python interpreter per researchSessionID: variables survive between calls. Actions: execute (run code; stdout/stderr captured), interrupt, reset (clear variables), get_state (variable names). Uses .venv/bin/python when the project has one.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['execute', 'interrupt', 'reset', 'get_state'] },
        researchSessionID: { type: 'string', description: 'Session name (default "default")' },
        code: { type: 'string', description: 'Python code (execute)' },
        executionTimeout: { type: 'integer', minimum: 1, description: 'Milliseconds before the run is interrupted (default 300000); state is kept' },
        projectDir: { type: 'string', description: 'Working directory (default: the project directory)' },
      },
      required: ['action'],
    },
    handler: (a, { cwd }) => repl({ action: a.action, code: a.code, id: a.researchSessionID ?? 'default', timeoutMs: a.executionTimeout ?? 300000, dir: resolve(cwd, a.projectDir ?? '.') }),
  },
];
