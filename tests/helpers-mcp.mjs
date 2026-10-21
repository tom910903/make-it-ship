// Drive the MCP server over stdio like the host does.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

export async function mcpSession(cwd, env = {}) {
  const e = { ...process.env }; delete e.CLAUDE_CODE_SESSION_ID; Object.assign(e, env, { CLAUDE_PROJECT_DIR: cwd }); delete e.NODE_TEST_CONTEXT;
  const p = spawn(process.execPath, [join(ROOT, 'scripts', 'mcp', 'server.mjs')], { cwd, env: e, stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  createInterface({ input: p.stdout }).on('line', (l) => { const m = JSON.parse(l); pending.get(m.id)?.(m); pending.delete(m.id); });
  let id = 0;
  const rpc = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  return {
    rpc,
    list: async () => (await rpc('tools/list')).result.tools,
    /** Call a tool; returns { text, json, isError }. */
    call: async (name, args = {}) => {
      const r = (await rpc('tools/call', { name, arguments: args })).result;
      const text = r.content[0].text;
      let json; try { json = JSON.parse(text); } catch { /* text result */ }
      return { text, json, isError: !!r.isError };
    },
    close: () => p.kill(),
  };
}
