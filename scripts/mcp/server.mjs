#!/usr/bin/env node
// Make It Ship MCP server (M7): stdio JSON-RPC (newline-delimited) exposing the tool modules listed in registry.mjs.
// Registered by the plugin's .mcp.json as server "mis" → tools appear as mcp__plugin_make-it-ship_mis__<name>.
import { createInterface } from 'node:readline';
import { loadTools } from './registry.mjs';

const tools = await loadTools();
const byName = new Map(tools.map((t) => [t.name, t]));
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const ctx = () => ({ cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd() });

export const toText = (v) => typeof v === 'string' ? v : JSON.stringify(v, null, 2);

async function handle(m) {
  switch (m.method) {
    case 'initialize':
      return { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'make-it-ship', version: '0.2.0' } };
    case 'ping': return {};
    case 'tools/list':
      return { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    case 'tools/call': {
      const t = byName.get(m.params?.name);
      if (!t) return { content: [{ type: 'text', text: `unknown tool: ${m.params?.name}` }], isError: true };
      try {
        return { content: [{ type: 'text', text: toText(await t.handler(m.params.arguments ?? {}, ctx())) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `${t.name}: ${e.message}` }], isError: true };
      }
    }
    default: return undefined;
  }
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
  if (m.id === undefined) return; // notification
  const result = await handle(m);
  send(result === undefined
    ? { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } }
    : { jsonrpc: '2.0', id: m.id, result });
});
