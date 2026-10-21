import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, write, ROOT } from '../helpers.mjs';
import { mcpSession } from '../helpers-mcp.mjs';
import { readFileSync } from 'node:fs';

test('MCP server: initialize, tools/list with schemas, unknown tool and method errors', async () => {
  const s = await mcpSession(makeRepo());
  try {
    const tools = await s.list();
    assert.ok(tools.length >= 3);
    for (const t of tools) { assert.match(t.name, /^[a-z_]+$/); assert.equal(t.inputSchema.type, 'object'); assert.ok(t.description.length > 10); }
    const bad = await s.call('no_such_tool');
    assert.equal(bad.isError, true);
    assert.equal((await s.rpc('no/such/method')).error.code, -32601);
  } finally { s.close(); }
});

test('skills tools: plugin, local and global learned skills', async () => {
  const dir = makeRepo(), home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  write(dir, { '.make-it-ship/skills/csv/SKILL.md': '---\nname: csv-export\ndescription: CSV export steps\n---\nbody-local' });
  write(home, { 'skills/dep/SKILL.md': '---\nname: deploy\ndescription: deploy steps\n---\nbody-global' });
  const s = await mcpSession(dir, { MIS_STATE_HOME: home });
  try {
    const all = (await s.call('list_skills')).json;
    assert.ok(all.some((x) => x.name === 'run' && x.scope === 'plugin'));
    assert.ok(all.some((x) => x.name === 'csv-export' && x.scope === 'local'));
    assert.ok(all.some((x) => x.name === 'deploy' && x.scope === 'global'));
    // M9 r2 D5: an untrusted repository's skill bodies are not returned; name and description come framed as repository content
    const untrusted = (await s.call('load_skills_local', { names: ['csv-export'] })).json[0];
    assert.equal(untrusted.body, undefined);
    assert.equal(untrusted.trusted, false);
    assert.match(untrusted.note, /repository content[\s\S]*untrusted[\s\S]*mis skill trust/);
    assert.equal(all.find((x) => x.name === 'csv-export').trusted, false);
    write(home, { 'trusted-repos.json': { repos: [dir] } }); // what `mis skill trust` records
    assert.match((await s.call('load_skills_local', { names: ['csv-export'] })).json[0].body, /body-local/);
    assert.equal((await s.call('list_skills')).json.find((x) => x.name === 'csv-export').trusted, true);
    assert.match((await s.call('load_skills_global')).json[0].body, /body-global/);
  } finally { s.close(); }
});

test('.mcp.json registers the server with the plugin root', () => {
  const m = JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8'));
  assert.deepEqual(m.mcpServers.mis.args, ['${CLAUDE_PLUGIN_ROOT}/scripts/mcp/server.mjs']);
});
