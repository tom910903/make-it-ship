import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeRepo, write, ROOT } from '../helpers.mjs';
import { mcpSession } from '../helpers-mcp.mjs';

const CODE_TOOLS = ['lsp_hover', 'lsp_goto_definition', 'lsp_find_references', 'lsp_document_symbols', 'lsp_workspace_symbols', 'lsp_diagnostics',
  'lsp_diagnostics_directory', 'lsp_servers', 'lsp_prepare_rename', 'lsp_rename', 'lsp_code_actions', 'lsp_code_action_resolve',
  'ast_grep_search', 'ast_grep_replace', 'python_repl'];
const has = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'mis-bin-')));
/** A temp bin dir with executable shims: { name: 'shell body' } */
function shims(map) {
  const bin = tmp();
  for (const [name, body] of Object.entries(map)) { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); }
  return bin;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return fn(); };

test('code tools are registered', async () => {
  const s = await mcpSession(makeRepo());
  try {
    const names = (await s.list()).map((t) => t.name);
    for (const n of CODE_TOOLS) assert.ok(names.includes(n), n);
  } finally { s.close(); }
});

test('lsp_* against a fake language server: positions, edits gated by apply, code actions, shutdown with the session', async () => {
  const dir = makeRepo({ 'src/a.ts': 'function foo() {\n  let x = ERR;\n  foo(x);\n}\n', 'package.json': '{}' });
  const pidFile = join(tmp(), 'pids');
  const bin = shims({ 'typescript-language-server': `exec "${process.execPath}" "${join(ROOT, 'tests', 'fixtures', 'fake-lsp.mjs')}" "$@"` });
  const s = await mcpSession(dir, { PATH: `${bin}:${process.env.PATH}`, FAKE_LSP_PID_FILE: pidFile });
  const f = join(dir, 'src', 'a.ts');
  try {
    // line is 1-based, character 0-based (OMC convention); file is relative to the project dir
    assert.match((await s.call('lsp_hover', { file: 'src/a.ts', line: 2, character: 3 })).text, /hover 한글 1:3/);
    assert.deepEqual((await s.call('lsp_goto_definition', { file: 'src/a.ts', line: 3, character: 2 })).json, [{ file: f, line: 1, character: 9 }]);
    assert.equal((await s.call('lsp_find_references', { file: 'src/a.ts', line: 1, character: 10 })).json.length, 2);
    const sym = (await s.call('lsp_document_symbols', { file: 'src/a.ts' })).json;
    assert.deepEqual(sym, [{ name: 'foo', kind: 'Function', line: 1, children: [{ name: 'x', kind: 'Variable', line: 2 }] }]);
    assert.deepEqual((await s.call('lsp_workspace_symbols', { query: 'foo', file: 'src/a.ts' })).json, [{ name: 'fooFn', kind: 'Function', file: f, line: 4 }]);
    const diag = (await s.call('lsp_diagnostics', { file: 'src/a.ts' })).json;
    assert.deepEqual(diag, [{ line: 2, character: 10, severity: 'error', message: 'bad 한글', source: 'fake', code: 'E1' }]);
    assert.deepEqual((await s.call('lsp_diagnostics', { file: 'src/a.ts', severity: 'warning' })).json, []);
    assert.deepEqual((await s.call('lsp_prepare_rename', { file: 'src/a.ts', line: 1, character: 10 })).json, { line: 1, character: 9, endLine: 1, endCharacter: 12, placeholder: 'foo' });

    const before = readFileSync(f, 'utf8');
    const dry = (await s.call('lsp_rename', { file: 'src/a.ts', line: 1, character: 10, newName: 'bar' })).json;
    assert.equal(dry.applied, false);
    assert.deepEqual(dry.files, [{ file: f, edits: 2 }]);
    assert.ok(dry.edit.changes);
    assert.equal(readFileSync(f, 'utf8'), before, 'no write without apply:true');
    assert.equal((await s.call('lsp_rename', { file: 'src/a.ts', line: 1, character: 10, newName: 'bar', apply: 'true' })).json.applied, false, 'only boolean true writes');
    const done = (await s.call('lsp_rename', { file: 'src/a.ts', line: 1, character: 10, newName: 'bar', apply: true })).json;
    assert.equal(done.applied, true);
    assert.equal(readFileSync(f, 'utf8'), before.replaceAll('foo', 'bar'));
    // the server saw the new text (re-synced), so a second rename works on "bar"
    assert.equal((await s.call('lsp_rename', { file: 'src/a.ts', line: 1, character: 10, newName: 'baz' })).json.files[0].edits, 2);

    const range = { file: 'src/a.ts', startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 5 };
    assert.deepEqual((await s.call('lsp_code_actions', range)).json, [{ index: 1, title: 'Add header', kind: 'quickfix', preferred: true }, { index: 2, title: 'Add footer' }]);
    const r1 = (await s.call('lsp_code_action_resolve', { ...range, actionIndex: 1 })).json; // edit comes from codeAction/resolve
    assert.deepEqual(r1.files, [f]);
    assert.match(readFileSync(f, 'utf8'), /^\/\/ header\n/);
    await s.call('lsp_code_action_resolve', { ...range, actionIndex: 2 }); // command → server sends workspace/applyEdit
    assert.match(readFileSync(f, 'utf8'), /\/\/ footer\n$/);
    assert.equal((await s.call('lsp_code_action_resolve', { ...range, actionIndex: 9 })).isError, true);

    const servers = (await s.call('lsp_servers')).json;
    assert.equal(servers.find((x) => x.lang === 'typescript').installed, true);
    const dd = (await s.call('lsp_diagnostics_directory', { directory: '.', strategy: 'lsp' })).json;
    assert.equal(dd.strategy, 'lsp');
    assert.deepEqual([dd.success, dd.errorCount, dd.filesChecked], [false, 1, 1]); // the ERR line is still in src/a.ts
  } finally { s.close(); }
  const lines = readFileSync(pidFile, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2, 'one server reused across calls');
  const [server, helper] = [Number(lines[0]), Number(lines[1].split(' ')[1])];
  assert.equal(await until(() => !alive(server) && !alive(helper)), true, 'language server and its helper processes stop when the MCP session ends');
});

test('missing binaries: BLOCKED with install hints, and directory diagnostics never pass when nothing could check', async () => {
  const dir = makeRepo({ 'a.go': 'package main\n', 'tsconfig.json': '{}', 'b.ts': 'let x = 1;\n' });
  const s = await mcpSession(dir, { PATH: tmp() }); // empty PATH: no language servers, no ast-grep, no python3, no tsc
  try {
    const h = await s.call('lsp_hover', { file: 'a.go', line: 1, character: 0 });
    assert.equal(h.isError, true);
    assert.match(h.text, /BLOCKED: language server for \.go not found.*gopls/s);
    assert.match((await s.call('lsp_hover', { file: 'x.unknownext', line: 1, character: 0 })).text, /no language server known for \.unknownext/);
    const ag = await s.call('ast_grep_search', { pattern: 'foo($A)', language: 'typescript' });
    assert.equal(ag.isError, true);
    assert.match(ag.text, /BLOCKED: ast-grep not found.*(brew|npm|cargo) install/s);
    const py = await s.call('python_repl', { action: 'execute', code: 'print(1)' });
    assert.equal(py.isError, true);
    assert.match(py.text, /BLOCKED: python3 not found/);
    const dd = (await s.call('lsp_diagnostics_directory', { directory: '.' })).json;
    assert.equal(dd.success, false);
    assert.match(dd.summary, /tsc not found/);
    assert.ok(dd.installHints.some((x) => /typescript-language-server/.test(x)));
  } finally { s.close(); }
});

test('ast_grep_*: JSON results, dry run by default, --update-all only with apply:true (fake ast-grep)', async () => {
  const dir = makeRepo({ 'src/a.ts': 'foo(1);\nfoo(2);\n' });
  const log = join(tmp(), 'args');
  const json = JSON.stringify([{ file: 'src/a.ts', text: 'foo(1)', replacement: 'bar(1)', range: { start: { line: 0, column: 0 }, end: { line: 0, column: 6 } }, lines: 'foo(1);', metaVariables: { single: { A: { text: '1' } } } }]);
  const bin = shims({ 'ast-grep': `echo "$@" >> "${log}"\ncase "$*" in *--update-all*) echo applied;; *) printf '%s' '${json}';; esac` });
  const s = await mcpSession(dir, { PATH: `${bin}:${process.env.PATH}` });
  try {
    const found = (await s.call('ast_grep_search', { pattern: 'foo($A)', language: 'typescript', paths: ['src'] })).json;
    assert.deepEqual(found.matches, [{ file: 'src/a.ts', line: 1, column: 1, text: 'foo(1)', lines: 'foo(1);', vars: { A: '1' } }]);
    const dry = (await s.call('ast_grep_replace', { pattern: 'foo($A)', rewrite: 'bar($A)', language: 'typescript', paths: ['src'] })).json;
    assert.equal(dry.applied, false);
    assert.equal(dry.changes[0].replacement, 'bar(1)');
    await s.call('ast_grep_replace', { pattern: 'foo($A)', rewrite: 'bar($A)', language: 'typescript', paths: ['src'], apply: true });
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(calls.length, 4); // search, dry replace, apply = preview then --update-all
    assert.ok(calls.slice(0, 3).every((c) => !c.includes('--update-all') && c.includes('--json')));
    assert.match(calls[3], /--pattern foo\(\$A\) --rewrite bar\(\$A\) --lang typescript --update-all src/);
  } finally { s.close(); }
});

test('ast_grep_search with the real binary when installed, else BLOCKED', async () => {
  const dir = makeRepo({ 'a.ts': 'foo(1);\nconsole.log(2);\n' });
  const s = await mcpSession(dir);
  try {
    const r = await s.call('ast_grep_search', { pattern: 'console.log($X)', language: 'typescript' });
    const real = has('ast-grep') || (has('sg') && /ast-grep/.test(spawnSync('sg', ['--version'], { encoding: 'utf8' }).stdout ?? '')); // same rule as the tool
    if (real) assert.deepEqual(r.json.matches.map((m) => [m.line, m.vars.X]), [[2, '2']]);
    else assert.match(r.text, /BLOCKED: ast-grep not found/);
  } finally { s.close(); }
});

test('python_repl: persistent state, captured output, timeout keeps the session, reset, get_state (real python3 when installed, else BLOCKED)', async () => {
  const s = await mcpSession(makeRepo());
  try {
    const first = await s.call('python_repl', { action: 'execute', researchSessionID: 's1', code: 'import os, sys\nx = 41\nprint("out")\nprint("err", file=sys.stderr)\nos.write(1, b"raw\\n")' });
    if (!has('python3')) { assert.match(first.text, /BLOCKED: python3 not found/); return; }
    assert.equal(first.isError, false, first.text);
    assert.equal(first.json.stdout, 'out\n');
    assert.equal(first.json.stderr, 'err\n');
    assert.equal((await s.call('python_repl', { action: 'execute', researchSessionID: 's1', code: 'print(x + 1)' })).json.stdout, '42\n');
    assert.match((await s.call('python_repl', { action: 'execute', researchSessionID: 's2', code: 'print(x)' })).json.error, /NameError/, 'sessions are separate');
    const t = (await s.call('python_repl', { action: 'execute', researchSessionID: 's1', code: 'while True: pass', executionTimeout: 500 })).json;
    assert.match(t.error, /timed out after 500ms/);
    assert.equal((await s.call('python_repl', { action: 'execute', researchSessionID: 's1', code: 'print(x)' })).json.stdout, '41\n', 'state survives a timeout');
    assert.deepEqual((await s.call('python_repl', { action: 'get_state', researchSessionID: 's1' })).json.variables, ['os', 'sys', 'x']);
    await s.call('python_repl', { action: 'reset', researchSessionID: 's1' });
    assert.match((await s.call('python_repl', { action: 'execute', researchSessionID: 's1', code: 'x' })).json.error, /NameError/);
    const big = (await s.call('python_repl', { action: 'execute', researchSessionID: 's1', code: 'print("x" * 2000000)' })).json.stdout;
    assert.ok(big.length < 1100000 && big.endsWith('[OUTPUT TRUNCATED - exceeded 1MB limit]'), 'output is capped at 1MB');
    assert.equal((await s.call('python_repl', { action: 'execute', researchSessionID: 's1', code: 'raise ValueError("boom")' })).json.error.includes('ValueError: boom'), true);
  } finally { s.close(); }
});

test('clangd: real document symbols, definition and diagnostics when installed, else BLOCKED', async () => {
  // The undeclared name sits in its own statement: in C mode clang drops a whole expression with an undeclared operand
  // from the AST (Apple clang 21 does), so `add` inside that expression would resolve to nothing.
  const dir = makeRepo({ 'm.c': 'int add(int a, int b) { return a + b; }\nint main(void) { int x = add(1, 2); return x + missing; }\n' });
  const s = await mcpSession(dir);
  try {
    const sym = await s.call('lsp_document_symbols', { file: 'm.c' });
    if (!has('clangd')) { assert.match(sym.text, /BLOCKED: language server for \.c not found/); return; }
    assert.deepEqual(sym.json.map((x) => x.name), ['add', 'main']);
    assert.deepEqual((await s.call('lsp_goto_definition', { file: 'm.c', line: 2, character: 25 })).json.map((l) => l.line), [1]);
    const d = (await s.call('lsp_diagnostics', { file: 'm.c' })).json;
    assert.ok(d.some((x) => x.severity === 'error' && /missing/.test(x.message)), JSON.stringify(d));
  } finally { s.close(); }
});
