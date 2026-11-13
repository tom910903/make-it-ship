// Fixture web site for the built-in browser tests. Prints its port on stdout.
import { createServer } from 'node:http';
import { encodePng } from '../../scripts/lib/png.mjs';

const PNG = encodePng({ width: 2, height: 2, data: new Uint8Array(16).map((_, i) => (i % 4 === 0 || i % 4 === 3 ? 255 : 0)) });

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
  // served so the browser's favicon request is no 404 console error racing the console reads
  '/favicon.ico': ['image/x-icon', ''],
  // canary --discover: relative and cross-origin entries (only same-origin ones are kept)
  '/sitemap.xml': ['application/xml', '<?xml version="1.0"?><urlset><url><loc>/frame</loc></url><url><loc>https://other.example/x</loc></url></urlset>'],
  '/frame': ['text/html', '<p id="inner">Inside frame</p><button>Frame button</button>'],
  // a site that turns itself into a blob: document / opens an about:blank popup; both keep the site's origin
  '/blob.html': ['text/html', `<title>Blob maker</title><script>localStorage.secret = 'S3CR3T';
location = URL.createObjectURL(new Blob(['<p id="b">blob page</p>'], { type: 'text/html' }));</script>`],
  '/pop.html': ['text/html', `<title>Popup maker</title><script>localStorage.secret = 'S3CR3T';</script>
<button id="open" onclick="window.open('about:blank')">Open</button>`],
  '/upload.html': ['text/html', '<title>Upload</title><input type="file" id="f">'],
  '/clutter.html': ['text/html', `<title>Clutter</title><header id="bar" style="position:fixed;top:0;height:40px;width:100%;background:#ccc">Sticky bar</header>
<div class="cookie-banner" id="cb">We use cookies <button>OK</button></div><div class="ad-banner" id="ad">BUY NOW</div>
<div class="social-share" id="soc">Share</div><main><h1 id="h">Article</h1><p id="p" style="color: rgb(0, 128, 0)">Body text of the article that is long enough to count as a text block for the audit.</p></main>`],
  '/cursor.html': ['text/html', `<title>Cursor</title><style>.card { cursor: pointer; padding: 8px } #k { color: rgb(1, 2, 3) }</style>
<div class="card" id="card" onclick="this.dataset.hit = 'yes'"><span>Open card</span></div><div id="plain">Just text</div><button id="real">Real button</button>
<p id="k" style="margin-top: 7px">styled</p>`],
};
// pages that send an uploaded file somewhere; R = the remote site (shop.test), recorded by /up and listed by /hits
const UPLOADS = {
  '/remoteform.html': (R) => `<form method="post" action="${R}/up" enctype="multipart/form-data"><input type="file" id="f" name="f"><button id="send">Send</button></form>`,
  '/formaction.html': () => `<form method="post" action="/up" enctype="multipart/form-data"><input type="file" id="f" name="f">
<button id="send" formaction="http://shop.test:${server.address().port}/up">Send</button></form>`,
  '/localform.html': () => '<form method="post" action="/up" enctype="multipart/form-data"><input type="file" id="f" name="f"><button id="send">Send</button></form>',
  // page script sends the file: on change, on click, through a local URL that redirects out, and from a popup it hands the file to
  '/jsupload.html': (R) => `<title>JS upload</title><input type="file" id="f" onchange="fetch('${R}/up?onchange', { method: 'POST', body: this.files[0] }).catch(() => {})">
<script>const send = (u) => { const f = document.getElementById('f').files[0]; if (f) fetch(u, { method: 'POST', body: f }).catch(() => {}); };
function popup() { const f = document.getElementById('f').files[0]; if (!f) return; const w = window.open('/recv.html'); addEventListener('message', () => w.postMessage(f, '*')); }</script>
<button id="send" onclick="send('${R}/up?click')">Send</button><button id="redir" onclick="send('/redir-up')">Redirect</button><button id="popup" onclick="popup()">Popup</button>`,
  '/img.html': (R) => `<title>Remote image</title><img src="${R}/logo.png"><input type="file" id="f">`,
  '/recv.html': (R) => `<title>Receiver</title><script>addEventListener('message', (e) => fetch('${R}/up?popup', { method: 'POST', body: e.data })
  .then(() => { document.title = 'sent'; }, () => { document.title = 'blocked'; })); opener.postMessage('ready', '*');</script>`,
};
const hits = [];
const SLOW_MS = 800; // /slow answers late, so a previous page's late load events race with the new navigation

const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/xframe') { // a local page embedding a real site
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<title>X</title><iframe id="x" src="http://shop.test:${server.address().port}/next"></iframe>`); return;
  }
  const R = `http://shop.test:${server.address().port}`;
  if (UPLOADS[u.pathname]) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(UPLOADS[u.pathname](R)); return; }
  if (u.pathname === '/redir-up') { res.writeHead(307, { location: `${R}/up?redirect` }); res.end(); return; }
  if (u.pathname === '/logo.png') { hits.push({ host: req.headers.host, url: req.url, bytes: 0 }); res.writeHead(404); res.end(); return; }
  if (u.pathname === '/hits') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(hits)); return; }
  if (u.pathname === '/up') {
    let bytes = 0;
    req.on('data', (c) => { bytes += c.length; });
    req.on('end', () => { hits.push({ host: req.headers.host, url: req.url, bytes }); res.writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': '*' }); res.end('<title>Got it</title>'); });
    return;
  }
  if (u.pathname === '/nocontent') { res.writeHead(204); res.end(); return; }
  if (u.pathname === '/echo') { // what the browser sent: cookies, user agent and x-mis-* headers
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ cookie: req.headers.cookie ?? '', ua: req.headers['user-agent'], x: Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith('x-mis-'))) })); return;
  }
  if (u.pathname === '/pic.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); return; }
  if (u.pathname === '/private.bin') { // only with the session cookie
    if (!/sid=s3/.test(req.headers.cookie ?? '')) { res.writeHead(403); res.end('no'); return; }
    res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end('PRIVATE-BYTES'); return;
  }
  if (u.pathname === '/media.html') { // one same-origin image, one from another origin (no CORS headers), a video
    const other = `http://shop.test:${server.address().port}`;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<title>Media</title><img id="a" src="/pic.png" alt="local"><img id="b" src="${other}/pic.png" alt="remote"><video id="v" src="/clip.mp4" poster="/pic.png"></video><audio src="/a.mp3"></audio>`); return;
  }
  if (u.pathname === '/slow') { setTimeout(() => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Slow</title><p>slow page</p>'); }, SLOW_MS); return; }
  const page = PAGES[u.pathname] ?? (u.pathname === '/submitted' ? ['text/html', `<h1>Submitted</h1><p id="q">${u.search}</p>`] : null);
  if (!page) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'content-type': page[0] }); res.end(page[1]);
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
