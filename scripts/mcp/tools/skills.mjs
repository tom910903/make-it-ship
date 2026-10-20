// Skill listing/loading (absorbs OMC list_omc_skills / load_omc_skills_local / load_omc_skills_global).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homeDir } from '../../lib/home.mjs';
import { PLUGIN_SKILLS, scanSkills as scan } from '../../lib/skills.mjs';

const sources = (cwd) => ({
  plugin: scan(PLUGIN_SKILLS, 'plugin'),
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
