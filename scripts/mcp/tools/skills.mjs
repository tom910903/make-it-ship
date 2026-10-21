// Skill listing/loading (absorbs OMC list_omc_skills / load_omc_skills_local / load_omc_skills_global).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeDir } from '../../lib/home.mjs';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function scan(base, scope) {
  if (!existsSync(base)) return [];
  return readdirSync(base).flatMap((d) => {
    const path = join(base, d, 'SKILL.md');
    if (!existsSync(path)) return [];
    const fm = readFileSync(path, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    return [{ name: fm.match(/^name:\s*(.+)$/m)?.[1].trim() ?? d, scope, description: fm.match(/^description:\s*(.+)$/m)?.[1].trim() ?? '', path }];
  });
}

const sources = (cwd) => ({
  plugin: scan(join(PLUGIN, 'skills'), 'plugin'),
  local: scan(join(cwd, '.make-it-ship', 'skills'), 'local'),
  global: scan(join(homeDir(), 'skills'), 'global'),
});

const load = (list, names) => list.filter((s) => !names?.length || names.includes(s.name)).map((s) => ({ ...s, body: readFileSync(s.path, 'utf8') }));

export const tools = [
  {
    name: 'list_skills',
    description: 'List Make It Ship skills: plugin skills, project-local learned skills (.make-it-ship/skills) and global learned skills (~/.make-it-ship/skills).',
    inputSchema: { type: 'object', properties: {} },
    handler: (_a, { cwd }) => Object.values(sources(cwd)).flat().map(({ body, ...s }) => s),
  },
  {
    name: 'load_skills_local',
    description: 'Load the full text of project-local learned skills (optionally only the named ones).',
    inputSchema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } } },
    handler: (a, { cwd }) => load(sources(cwd).local, a.names),
  },
  {
    name: 'load_skills_global',
    description: 'Load the full text of global learned skills (optionally only the named ones).',
    inputSchema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } } },
    handler: (a, { cwd }) => load(sources(cwd).global, a.names),
  },
];
