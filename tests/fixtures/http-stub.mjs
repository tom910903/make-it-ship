// Local stand-in for external endpoints (health checks, telemetry sync, dashboards, the OpenAI image API).
// Prints its port; appends every request as a JSON line to the log file given as argv[2]. Never reaches the network.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const log = process.argv[2];
// 1x1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let n = 0;
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (log) appendFileSync(log, JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, body }) + '\n');
    const json = (code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url === '/ok') return json(200, { ok: true });
    if (req.url === '/bad') return json(500, { ok: false });
    if (req.url === '/events' && req.method === 'POST') return json(200, { inserted: JSON.parse(body).length });
    if (req.url.startsWith('/dashboard/')) return json(200, { kind: req.url.split('/').pop(), rows: [{ skill: 'qa', runs: 3 }] });
    if (req.url === '/v1/responses' && req.method === 'POST') return json(200, { id: `resp_${++n}`, output: [{ type: 'image_generation_call', result: PNG }] });
    json(404, { error: 'not found' });
  });
}).listen(0, '127.0.0.1', function () { console.log(this.address().port); });
