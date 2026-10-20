// Visual companion server (spawned detached by `mis companion start`): serves HTML mockups from one directory on
// 127.0.0.1 with a page index, live reload (SSE) and click-to-choose. Access needs the per-start key (query or cookie).
// argv: <dir> <port> <key> <infoFile> <choicesFile>
import { createServer } from 'node:http';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

const [dir, port, key, infoFile, choicesFile] = process.argv.slice(2);
const IDLE_MS = 4 * 60 * 60 * 1000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.json': 'application/json' };
const CLIENT = `<style>[data-choice]{cursor:pointer}[data-choice].mis-selected{outline:3px solid #2563eb;outline-offset:2px}</style>
<script>(()=>{const es=new EventSource('/__events');es.onmessage=(e)=>{if(e.data==='reload')location.reload()};
document.addEventListener('click',(e)=>{const el=e.target.closest('[data-choice]');if(!el)return;
document.querySelectorAll('.mis-selected').forEach((x)=>x.classList.remove('mis-selected'));el.classList.add('mis-selected');
fetch('/__choice',{method:'POST',body:JSON.stringify({page:location.pathname.slice(1),choice:el.dataset.choice,text:el.textContent.trim().slice(0,200)})})})})();</script>`;
const FRAME = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:24px 16px}a{color:#2563eb}</style></head><body>${body}</body></html>`;

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const inject = (html) => (/<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${CLIENT}</body>`) : html + CLIENT);

function pages(d = dir) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.')) return [];
    const p = join(d, e.name);
    if (e.isDirectory()) return pages(p);
    return e.name.endsWith('.html') ? [{ rel: relative(dir, p), mtime: statSync(p).mtimeMs }] : [];
  });
}

const clients = new Set();
let debounce = null;
watch(dir, { recursive: true }, () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => { for (const c of clients) c.write('data: reload\n\n'); }, 100);
});

let last = Date.now();
setInterval(() => { if (Date.now() - last > IDLE_MS) process.exit(0); }, 60_000).unref();

const server = createServer((req, res) => {
  last = Date.now();
  const u = new URL(req.url, 'http://localhost');
  const cookie = `mis_key_${server.address().port}`; // cookies are not port-scoped: one name per companion
  const cookieKey = new RegExp(`(?:^|;\\s*)${cookie}=([0-9a-f]+)`).exec(req.headers.cookie ?? '')?.[1];
  if (u.searchParams.get('key') !== key && cookieKey !== key) { res.writeHead(403).end('forbidden: open the full URL printed by `mis companion start`'); return; }
  res.setHeader('set-cookie', `${cookie}=${key}; HttpOnly; SameSite=Strict; Path=/`);
  if (u.pathname === '/__events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (u.pathname === '/__choice' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 10_000) req.destroy(); });
    req.on('end', () => {
      try {
        const c = JSON.parse(body);
        appendFileSync(choicesFile, JSON.stringify({ page: String(c.page ?? ''), choice: String(c.choice ?? ''), text: String(c.text ?? '').slice(0, 200), at: new Date().toISOString() }) + '\n');
        res.writeHead(204).end();
      } catch { res.writeHead(400).end(); }
    });
    return;
  }
  if (u.pathname === '/') {
    const list = pages().sort((a, b) => b.mtime - a.mtime)
      .map((p) => `<li><a href="/${p.rel.split(sep).map(encodeURIComponent).join('/')}">${esc(p.rel)}</a> <small>${new Date(p.mtime).toLocaleString()}</small></li>`).join('');
    res.writeHead(200, { 'content-type': TYPES['.html'] }).end(inject(FRAME('Mockups', `<h1>Mockups</h1><p>Newest first. Pages reload when their files change.</p><ul>${list || '<li>No HTML files yet.</li>'}</ul>`)));
    return;
  }
  let abs;
  try { abs = resolve(dir, decodeURIComponent(u.pathname).slice(1)); } catch { abs = null; }
  if (!abs || !abs.startsWith(dir + sep) || !existsSync(abs) || !statSync(abs).isFile()) { res.writeHead(404).end('not found'); return; }
  const type = TYPES[extname(abs).toLowerCase()] ?? 'application/octet-stream';
  if (extname(abs).toLowerCase() !== '.html') { res.writeHead(200, { 'content-type': type }).end(readFileSync(abs)); return; }
  const html = readFileSync(abs, 'utf8');
  // Fragments (no <html>) get a minimal page frame, as in the Superpowers companion.
  res.writeHead(200, { 'content-type': type }).end(inject(/^\s*(<!doctype|<html)/i.test(html) ? html : FRAME(esc(relative(dir, abs)), html)));
});

server.listen(Number(port), '127.0.0.1', () => {
  const p = server.address().port;
  writeFileSync(infoFile, JSON.stringify({ pid: process.pid, port: p, dir, url: `http://127.0.0.1:${p}/?key=${key}` }));
});
