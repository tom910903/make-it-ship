// Tool modules of the MCP server. Each exports `tools`: [{ name, description, inputSchema, handler(args, {cwd}) }].
// One line per module so parallel work adds modules without conflicts.
const MODULES = [
  './tools/skills.mjs',
  './tools/code.mjs',
];

export async function loadTools() {
  const all = [];
  for (const m of MODULES) all.push(...(await import(m)).tools);
  const seen = new Set();
  for (const t of all) { if (seen.has(t.name)) throw new Error(`duplicate tool ${t.name}`); seen.add(t.name); }
  return all;
}
