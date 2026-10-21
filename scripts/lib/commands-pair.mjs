// M9-D D8: pair-agent (absorbs gstack pair-agent): share this workspace's built-in browser with another AI agent.
// The endpoint needs a token; without --local a tunnel (ngrok by default) makes it reachable from other machines.
// `start` always asks (policy.mjs EXTERNAL_MIS); company policy may forbid opening a public tunnel. `stop` closes both.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, flag, bool, readJson, duration } from './cli-util.mjs';
import { browseDir } from './browse/client.mjs';

const SERVER = fileURLToPath(new URL('./pair-server.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pairDir = (cwd) => { const d = join(browseDir(cwd), 'pair'); mkdirSync(d, { recursive: true }); return d; };
const portFree = (port) => new Promise((ok) => { const s = createServer().once('error', () => ok(false)).listen(port, '127.0.0.1', () => s.close(() => ok(true))); });

async function waitFor(fn, ms) { for (let t = 0; t < ms; t += 50) { const v = fn(); if (v) return v; await sleep(50); } return null; }

async function stopAll(d) {
  const s = readJson(join(d, 'state.json')) ?? {}, w = readJson(join(d, 'server.json')) ?? {};
  // the tunnel runs in its own process group (detached): signal the whole group so its children go too
  const kill = (sig) => { for (const pid of [s.tunnelPid && -s.tunnelPid, w.pid]) if (pid) try { process.kill(pid, sig); } catch { /* gone */ } };
  kill('SIGTERM');
  await waitFor(() => ![s.tunnelPid, w.pid].some((p) => p && alive(p)), 5000);
  kill('SIGKILL');
  writeFileSync(join(d, 'state.json'), '{}');
  return { port: w.port ?? null, portFree: w.port ? await portFree(w.port) : true, tunnelClosed: s.tunnelPid ? !alive(s.tunnelPid) : null };
}

async function pairAgent([sub, ...argv], cwd) {
  const args = [...argv], d = pairDir(cwd);
  if (sub === 'status') {
    const s = readJson(join(d, 'state.json')) ?? {}, w = readJson(join(d, 'server.json')) ?? {};
    return w.pid && alive(w.pid) ? { running: true, port: w.port, publicUrl: s.publicUrl ?? null, tunnel: !!s.tunnelPid && alive(s.tunnelPid), expiresAt: w.expiresAt } : { running: false };
  }
  if (sub === 'stop') return { stopped: true, ...(await stopAll(d)) };
  if (sub !== 'start') fail('usage: mis pair-agent start [--local] [--port N] [--ttl 24h] | status | stop');
  const local = bool(args, '--local'), port = Number(flag(args, '--port') ?? 0), ttl = duration(flag(args, '--ttl') ?? '24h', '--ttl');
  const cur = readJson(join(d, 'server.json'));
  if (cur?.pid && alive(cur.pid)) fail(`already paired on port ${cur.port}; mis pair-agent stop first`);
  const token = randomBytes(24).toString('base64url'), expiresAt = new Date(Date.now() + ttl).toISOString();
  const cfg = { port, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt, stateFile: join(d, 'server.json'), browseDir: browseDir(cwd), cwd };
  writeFileSync(join(d, 'server.json'), '{}');
  const child = spawn(process.execPath, [SERVER, JSON.stringify(cfg)], { detached: true, stdio: 'ignore' });
  child.unref();
  const w = await waitFor(() => { const s = readJson(join(d, 'server.json')); return s?.pid === child.pid ? s : null; }, 10000);
  if (!w) { await stopAll(d); fail('pair endpoint did not start'); }
  let publicUrl = null, tunnelPid = null;
  if (!local) {
    const cmd = (process.env.MIS_PAIR_TUNNEL_CMD ?? 'ngrok http {port} --log stdout --log-format json').replaceAll('{port}', String(w.port));
    const log = join(d, 'tunnel.log'), fd = openSync(log, 'w');
    const t = spawn('sh', ['-c', `exec ${cmd}`], { detached: true, stdio: ['ignore', fd, fd] });
    closeSync(fd); t.unref(); tunnelPid = t.pid;
    writeFileSync(join(d, 'state.json'), JSON.stringify({ tunnelPid }));
    publicUrl = await waitFor(() => /"url":"(https:\/\/[^"]+)"|(https:\/\/[\w.-]+\.ngrok[\w.-]*)/.exec(readFileSync(log, 'utf8'))?.slice(1).find(Boolean) ?? (alive(tunnelPid) ? null : 'DEAD'), 20000);
    if (!publicUrl || publicUrl === 'DEAD') {
      const tail = readFileSync(log, 'utf8').trim().split('\n').slice(-3).join('\n');
      await stopAll(d);
      fail(`BLOCKED: the tunnel did not come up (is ngrok installed and logged in? ngrok config add-authtoken <token>). Pair on this machine with --local instead.${tail ? `\n${tail}` : ''}`);
    }
  }
  writeFileSync(join(d, 'state.json'), JSON.stringify({ tunnelPid, publicUrl }));
  const url = publicUrl ?? `http://127.0.0.1:${w.port}`;
  return { url, port: w.port, token, expiresAt, local,
    instructions: `Give the other agent: base URL ${url}, header "Authorization: Bearer ${token}". POST ${url}/command with {"cmd":"goto","args":["https://..."]}, {"cmd":"snapshot","args":["-i"]}, {"cmd":"click","args":["@e3"]}; GET ${url}/health. Revoke with mis pair-agent stop.` };
}

export const pairCommands = { 'pair-agent': pairAgent };
