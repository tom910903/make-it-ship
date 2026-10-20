import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { frame, parser, applyWorkspaceEdit, serverFor, findRoot, which, LspClient } from '../../scripts/lib/lsp.mjs';
import { ROOT } from '../helpers.mjs';

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'mis-lsp-')));
const uri = (p) => pathToFileURL(p).href;
const r = (l1, c1, l2, c2) => ({ start: { line: l1, character: c1 }, end: { line: l2, character: c2 } });

test('framing: Content-Length counts bytes; messages split across chunks and multibyte text survive', () => {
  const got = [];
  const feed = parser((m) => got.push(m));
  const a = frame({ id: 1, result: '한글 ✓' }), b = frame({ method: 'x', params: { s: '😀' } });
  assert.equal(Number(a.toString().match(/Content-Length: (\d+)/)[1]), Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '한글 ✓' })));
  const all = Buffer.concat([a, b]);
  for (let i = 0; i < all.length; i += 7) feed(all.subarray(i, i + 7)); // split inside headers and multibyte chars
  assert.deepEqual(got.map((m) => m.result ?? m.params.s), ['한글 ✓', '😀']);
});

test('applyWorkspaceEdit: changes and documentChanges, reverse order, UTF-16 columns, CRLF, create/rename/delete', () => {
  const d = tmp();
  const a = join(d, 'a.ts'), b = join(d, 'b.ts');
  writeFileSync(a, 'let foo = 1;\r\nfoo + foo;\r\n');
  writeFileSync(b, 'const s = "😀"; foo\n');
  const files = applyWorkspaceEdit({
    changes: { [uri(a)]: [{ range: r(0, 4, 0, 7), newText: 'bar' }, { range: r(1, 0, 1, 3), newText: 'bar' }, { range: r(1, 6, 1, 9), newText: 'bar' }] },
    documentChanges: [
      { textDocument: { uri: uri(b), version: 1 }, edits: [{ range: r(0, 16, 0, 19), newText: 'baz' }] },
      { kind: 'create', uri: uri(join(d, 'new.ts')) },
      { kind: 'rename', oldUri: uri(b), newUri: uri(join(d, 'c.ts')) },
    ],
  });
  assert.equal(readFileSync(a, 'utf8'), 'let bar = 1;\r\nbar + bar;\r\n');
  assert.equal(readFileSync(join(d, 'c.ts'), 'utf8'), 'const s = "😀"; baz\n'); // 😀 is two UTF-16 units
  assert.ok(existsSync(join(d, 'new.ts')) && !existsSync(b));
  assert.deepEqual(files.sort(), [a, b, join(d, 'c.ts'), join(d, 'new.ts')].sort());
  applyWorkspaceEdit({ documentChanges: [{ kind: 'delete', uri: uri(join(d, 'new.ts')) }] });
  assert.ok(!existsSync(join(d, 'new.ts')));
});

test('server table and workspace root detection', () => {
  assert.equal(serverFor('/x/a.tsx').lang, 'typescript');
  assert.equal(serverFor('/x/a.py').lang, 'python');
  assert.equal(serverFor('/x/a.go').installHint.includes('gopls'), true);
  assert.equal(serverFor('/x/a.unknownext'), null);
  const d = tmp();
  mkdirSync(join(d, 'pkg', 'src'), { recursive: true });
  writeFileSync(join(d, 'pkg', 'package.json'), '{}');
  assert.equal(findRoot(join(d, 'pkg', 'src', 'a.ts')), join(d, 'pkg'));
  const bin = tmp();
  writeFileSync(join(bin, 'tool'), '#!/bin/sh\n'); chmodSync(join(bin, 'tool'), 0o755);
  writeFileSync(join(bin, 'noexec'), '');
  assert.equal(which('tool', bin), join(bin, 'tool'));
  assert.equal(which('noexec', bin), null);
});

test('LspClient against the fake server: requests, server-to-client requests, push diagnostics, re-sync after edits', async () => {
  const d = tmp(), f = join(d, 'a.ts');
  writeFileSync(f, 'function foo() {\n  let x = ERR;\n}\n');
  const c = new LspClient(d, process.execPath, [join(ROOT, 'tests', 'fixtures', 'fake-lsp.mjs')]);
  await c.start();
  try {
    await c.sync(f);
    const diags = await c.diagnostics(f, 2000);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].message, 'bad 한글');
    const hover = await c.request('textDocument/hover', { textDocument: { uri: uri(f) }, position: { line: 1, character: 2 } });
    assert.match(hover.contents.value, /hover 한글 1:2 cfg=\[null\]/); // workspace/configuration answered with one null per item
    writeFileSync(f, 'function foo() {}\n');
    await c.sync(f); // didChange with the new disk content
    assert.deepEqual(await c.diagnostics(f, 2000), []);
    await assert.rejects(c.request('no/such', {}), /unhandled no\/such/);
  } finally { await c.stop(); }
  assert.equal(c.alive, false);
});
