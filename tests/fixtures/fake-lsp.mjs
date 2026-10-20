#!/usr/bin/env node
// Tiny fake language server for tests: Content-Length framed JSON-RPC over stdio, enough of LSP to drive every lsp_* tool.
// Diagnostics: one error per line containing "ERR". Rename edits every occurrence of the word under the cursor.
import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

if (process.env.FAKE_LSP_PID_FILE) { // like tsserver under typescript-language-server: a helper process that must die with us
  const helper = spawn('sleep', ['60'], { stdio: 'ignore' });
  appendFileSync(process.env.FAKE_LSP_PID_FILE, `${process.pid}\nhelper ${helper.pid}\n`);
}
const docs = new Map(); // uri -> text
const pending = new Map();
let nextId = 1000, configResult = 'none';

const send = (m) => { const b = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...m })); process.stdout.write(`Content-Length: ${b.length}\r\n\r\n`); process.stdout.write(b); };
const ask = (method, params) => new Promise((res) => { const id = nextId++; pending.set(id, res); send({ id, method, params }); });
const range = (l1, c1, l2, c2) => ({ start: { line: l1, character: c1 }, end: { line: l2, character: c2 } });
const wordAt = (uri, { line, character }) => {
  const text = docs.get(uri).split('\n')[line] ?? '';
  let s = character, e = character;
  while (s > 0 && /\w/.test(text[s - 1])) s--;
  while (e < text.length && /\w/.test(text[e])) e++;
  return { word: text.slice(s, e), range: range(line, s, line, e) };
};
const publish = (uri) => send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: docs.get(uri).split('\n').flatMap((l, i) => l.includes('ERR') ? [{ range: range(i, l.indexOf('ERR'), i, l.indexOf('ERR') + 3), severity: 1, source: 'fake', code: 'E1', message: 'bad 한글' }] : []) } });

async function onRequest(m) {
  const p = m.params ?? {};
  const uri = p.textDocument?.uri;
  switch (m.method) {
    case 'initialize':
      return { capabilities: { hoverProvider: true, definitionProvider: true, referencesProvider: true, documentSymbolProvider: true, workspaceSymbolProvider: true, renameProvider: { prepareProvider: true }, codeActionProvider: { resolveProvider: true }, executeCommandProvider: { commands: ['fake.footer'] } }, serverInfo: { name: 'fake', root: p.rootUri } };
    case 'shutdown': return null;
    case 'textDocument/hover': return { contents: { kind: 'markdown', value: `hover 한글 ${p.position.line}:${p.position.character} cfg=${configResult}` } };
    case 'textDocument/definition': return [{ uri, range: range(0, 9, 0, 12) }];
    case 'textDocument/references': return [{ uri, range: range(0, 9, 0, 12) }, { uri, range: range(2, 4, 2, 7) }];
    case 'textDocument/documentSymbol': return [{ name: 'foo', kind: 12, range: range(0, 0, 1, 1), selectionRange: range(0, 9, 0, 12), children: [{ name: 'x', kind: 13, range: range(1, 2, 1, 9), selectionRange: range(1, 6, 1, 7) }] }];
    case 'workspace/symbol': return [{ name: `${p.query}Fn`, kind: 12, location: { uri: [...docs.keys()][0], range: range(3, 0, 3, 5) } }];
    case 'textDocument/prepareRename': { const w = wordAt(uri, p.position); return w.word ? { range: w.range, placeholder: w.word } : null; }
    case 'textDocument/rename': {
      const { word } = wordAt(uri, p.position);
      const edits = docs.get(uri).split('\n').flatMap((l, i) => [...l.matchAll(new RegExp(`\\b${word}\\b`, 'g'))].map((x) => ({ range: range(i, x.index, i, x.index + word.length), newText: p.newName })));
      return { changes: { [uri]: edits } };
    }
    case 'textDocument/codeAction':
      return [{ title: 'Add header', kind: 'quickfix', isPreferred: true, data: { uri } }, { title: 'Add footer', command: 'fake.footer', arguments: [uri] }];
    case 'codeAction/resolve':
      return { ...p, edit: { documentChanges: [{ textDocument: { uri: p.data.uri, version: null }, edits: [{ range: range(0, 0, 0, 0), newText: '// header\n' }] }] } };
    case 'workspace/executeCommand': {
      const u = p.arguments[0], n = docs.get(u).split('\n').length;
      await ask('workspace/applyEdit', { edit: { changes: { [u]: [{ range: range(n, 0, n, 0), newText: '// footer\n' }] } } });
      return null;
    }
    default: throw Object.assign(new Error(`unhandled ${m.method}`), { code: -32601 });
  }
}

function onNotification(m) {
  const p = m.params;
  if (m.method === 'initialized') ask('workspace/configuration', { items: [{ section: 'fake' }] }).then((r) => { configResult = JSON.stringify(r); });
  if (m.method === 'textDocument/didOpen') { docs.set(p.textDocument.uri, p.textDocument.text); publish(p.textDocument.uri); }
  if (m.method === 'textDocument/didChange') { docs.set(p.textDocument.uri, p.contentChanges.at(-1).text); publish(p.textDocument.uri); }
  if (m.method === 'textDocument/didClose') docs.delete(p.textDocument.uri);
  if (m.method === 'exit') process.exit(0);
}

let buf = Buffer.alloc(0);
process.stdin.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const h = buf.indexOf('\r\n\r\n');
    if (h < 0) return;
    const len = Number(buf.subarray(0, h).toString().match(/Content-Length: (\d+)/i)[1]);
    if (buf.length < h + 4 + len) return;
    const m = JSON.parse(buf.subarray(h + 4, h + 4 + len).toString());
    buf = buf.subarray(h + 4 + len);
    if (m.method && m.id !== undefined) onRequest(m).then((result) => send({ id: m.id, result }), (e) => send({ id: m.id, error: { code: e.code ?? -32603, message: e.message } }));
    else if (m.method) onNotification(m);
    else { pending.get(m.id)?.(m.result); pending.delete(m.id); }
  }
});
process.stdin.on('end', () => process.exit(0));
