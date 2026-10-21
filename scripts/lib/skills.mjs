// Learned skills (absorbs OMC skill/skillify/learner and Superpowers writing-skills + render-graphs.js; own implementation,
// see THIRD_PARTY_NOTICES.md). A learned skill is <base>/<name>/SKILL.md with name/description/triggers frontmatter;
// base is the project (.make-it-ship/skills) or the user (~/.make-it-ship/skills). The plugin's skills/ are read-only.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeDir } from './home.mjs';

export const PLUGIN_SKILLS = fileURLToPath(new URL('../../skills', import.meta.url));
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const skillBase = (scope, root) => (scope === 'user' ? join(homeDir(), 'skills') : join(root, '.make-it-ship', 'skills'));

/** Frontmatter fields; triggers only in the one-line form `triggers: [a, "b c"]` (the form the prompt router reads). */
export function parseSkill(text) {
  const m = String(text).match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const fm = m[1], field = (k) => fm.match(new RegExp(`^${k}:[ \\t]*(.*)$`, 'm'))?.[1].trim();
  const raw = field('triggers');
  const inline = raw?.match(/^\[(.*)\]$/)?.[1];
  const triggers = inline === undefined ? null : inline.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean);
  return { name: field('name'), description: field('description')?.replace(/^["']|["']$/g, ''), triggersRaw: raw, triggers, body: m[2] };
}

export function scanSkills(base, scope) {
  if (!existsSync(base)) return [];
  return readdirSync(base).sort().flatMap((d) => {
    const path = join(base, d, 'SKILL.md');
    if (!existsSync(path)) return [];
    const s = parseSkill(readFileSync(path, 'utf8')) ?? {};
    return [{ name: s.name || d, scope, description: s.description ?? '', triggers: s.triggers ?? [], path }];
  });
}

/** Lint a learned skill. Errors block add/edit (and exit 1 in `mis skill lint`); warnings are advice. */
export function lintSkill(text, dirName) {
  const errors = [], warnings = [];
  const s = parseSkill(text);
  if (!s) return { errors: ['frontmatter missing (the file must start with ---, name/description/triggers, ---)'], warnings };
  if (!s.name || !NAME_RE.test(s.name)) errors.push('name must be kebab-case (a-z, 0-9, -; at most 64 chars)');
  else if (dirName && s.name !== dirName) errors.push(`name "${s.name}" does not match its directory "${dirName}"`);
  if (!s.description) errors.push('description missing');
  else if (s.description.length > 1024) errors.push('description longer than 1024 characters');
  else if (!/^use when\b/i.test(s.description)) warnings.push('description should start with "Use when" (the situation that triggers it, not a summary of the steps)');
  if (s.triggersRaw === undefined) errors.push('triggers missing: without `triggers: [..]` the prompt router never offers the skill');
  else if (s.triggers === null) errors.push('triggers must be one line in the form `triggers: [phrase one, phrase two]`');
  else if (!s.triggers.length) errors.push('triggers is empty');
  else for (const t of s.triggers) if (t.length < 3) errors.push(`trigger "${t}" is too short (matches almost any prompt)`);
  if (!s.body.trim()) errors.push('body is empty');
  else if (/\b(TODO|TBD|FIXME)\b|\[(fill|placeholder)[^\]]*\]/i.test(s.body)) errors.push('body has a placeholder (TODO/TBD/FIXME/[fill ...]); write the real content');
  if (s.body.split('\n').length > 500) warnings.push('body is over 500 lines; move reference material into a supporting file');
  return { errors, warnings };
}

/** Default subagent for `mis skill test`: Claude in print mode, customizations (skills, plugins, hooks, CLAUDE.md) off, read-only tools. */
export const skillTestArgv = () => ['claude', '-p', '--safe-mode', '--tools', 'Read,Grep,Glob'];

/** ```dot blocks of a SKILL.md with their digraph names (absorbs Superpowers render-graphs.js). */
export function dotBlocks(md) {
  return [...String(md).matchAll(/```dot\n([\s\S]*?)```/g)].map((m, i) => {
    const src = m[1].trim();
    return { name: src.match(/^\s*(?:strict\s+)?(?:di)?graph\s+(\w+)/)?.[1] ?? `graph_${i + 1}`, src };
  });
}
