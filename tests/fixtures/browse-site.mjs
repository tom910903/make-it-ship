// Fixture web site for the built-in browser tests. Prints its port on stdout.
import { createServer } from 'node:http';

const HOME_PAGE = `<!doctype html><html><head><title>Fixture Home</title>
<meta property="og:title" content="OG Home"><link rel="stylesheet" href="/style.css"><script src="/app.js"></script>
<script type="application/ld+json">{"@type":"Thing","name":"fx"}</script></head><body>
<h1>Welcome</h1><nav><a href="/next">Next page</a></nav>
<form action="/submitted" method="get"><label>Email <input name="email" id="email"></label>
<label>Password <input type="password" name="pw" value="secret"></label>
<select name="size" id="size"><option value="s">Small</option><option value="l">Large</option></select>
<label><input type="checkbox" id="agree" name="agree"> Agree</label><button type="submit">Send</button></form>
<button id="add" onclick="document.getElementById('list').insertAdjacentHTML('beforeend','<li>item</li>')">Add item</button><ul id="list"></ul>
<button id="swap" onclick="document.getElementById('target').replaceWith(Object.assign(document.createElement('button'),{id:'target',textContent:'Target'}))">Swap</button>
<button id="target">Target</button>
<button id="confirm" onclick="window.lastConfirm = confirm('Sure?')">Confirm</button>
<div id="hover" onmouseover="this.dataset.hovered='yes'">Hover me</div>
<input type="file" id="file"><div id="box" style="width:120px;height:80px;background:rgb(255,0,0)"></div>
<iframe id="frm" src="/frame" width="300" height="100"></iframe>
<div style="height:2000px"></div><p id="bottom">Bottom</p></body></html>`;
export const PAGES = {
  '/': ['text/html', HOME_PAGE],
  '/app.js': ['text/javascript', "console.log('app loaded'); console.error('boom from app');"],
  '/style.css': ['text/css', '#hover:hover { color: red }'],
  '/next': ['text/html', '<title>Next</title><h1>Next page</h1><a href="/">Home</a>'],
  '/frame': ['text/html', '<p id="inner">Inside frame</p><button>Frame button</button>'],
};

const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const page = PAGES[u.pathname] ?? (u.pathname === '/submitted' ? ['text/html', `<h1>Submitted</h1><p id="q">${u.search}</p>`] : null);
  if (!page) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'content-type': page[0] }); res.end(page[1]);
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
