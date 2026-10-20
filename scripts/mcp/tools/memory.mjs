// Memory tools (absorbs OMC notepad_* / project_memory_* / state_* / shared_memory_*). Storage: scripts/lib/memory.mjs.
import * as M from '../../lib/memory.mjs';

const WD = { workingDirectory: { type: 'string', description: 'Working directory (defaults to the project dir)' } };
const SID = { session_id: { type: 'string', description: 'Accepted for OMC compatibility; mode state is per repo, not per session' } };
const str = (description) => ({ type: 'string', description });
const tool = (name, description, properties, required, run) => ({
  name, description, inputSchema: { type: 'object', properties: { ...properties, ...WD }, required },
  handler: (a, { cwd }) => run(a, a.workingDirectory || cwd),
});

const notepad = [
  tool('notepad_read', 'Read the notepad: all sections, or one of priority, working, manual.',
    { section: { type: 'string', enum: ['all', 'priority', 'working', 'manual'] } }, [],
    (a, cwd) => { const n = M.notepadRead(cwd); return n ? M.formatNotepad(n, a.section ?? 'all') : 'Notepad does not exist yet. Use notepad_write_* to create it.'; }),
  tool('notepad_write_priority', 'Replace the Priority Context (keep under 500 chars; injected at every session start).',
    { content: str('Content (recommend under 500 chars, max 2000)') }, ['content'],
    (a, cwd) => { const r = M.setPriority(cwd, a.content); return `Wrote Priority Context (${r.chars} chars).${r.warning ? `\nWarning: ${r.warning}` : ''}`; }),
  tool('notepad_write_working', 'Add a timestamped Working Memory entry (entries older than 7 days are pruned).',
    { content: str('Entry content (max 4000)') }, ['content'], (a, cwd) => M.addEntry(cwd, 'working', a.content)),
  tool('notepad_write_manual', 'Add a timestamped entry to the MANUAL section (never pruned).',
    { content: str('Entry content (max 4000)') }, ['content'], (a, cwd) => M.addEntry(cwd, 'manual', a.content)),
  tool('notepad_prune', 'Remove Working Memory entries older than N days (default 7).',
    { daysOld: { type: 'integer', minimum: 1, maximum: 365 } }, [],
    (a, cwd) => { const d = a.daysOld ?? M.WORKING_DAYS; if (!Number.isInteger(d) || d < 1 || d > 365) throw new Error('daysOld must be 1..365'); return M.pruneNotepad(cwd, d); }),
  tool('notepad_stats', 'Notepad statistics: size, priority size, working entry count, oldest entry.', {}, [], (_a, cwd) => {
    const n = M.notepadRead(cwd);
    if (!n) return { exists: false };
    return { exists: true, totalSize: Buffer.byteLength(JSON.stringify(n)), prioritySize: Buffer.byteLength(n.priority?.text ?? ''),
      workingMemoryEntries: n.working.length, manualEntries: n.manual.length, oldestEntry: n.working.map((e) => e.at).sort()[0] ?? null };
  }),
];

const SECTIONS = { techStack: 'techStack', build: 'build', conventions: 'conventions', structure: 'structure', notes: 'customNotes', directives: 'userDirectives' };
const project = [
  tool('project_memory_read', 'Read project memory (tech stack, build/test commands, conventions, notes, user directives). Detects the basics on first read.',
    { section: { type: 'string', enum: ['all', ...Object.keys(SECTIONS)] } }, [],
    (a, cwd) => { const m = M.projectEnsure(cwd); return !a.section || a.section === 'all' ? m : m[SECTIONS[a.section]] ?? null; }),
  tool('project_memory_write', 'Write project memory: replace it, or deep-merge into it with merge: true.',
    { memory: { type: 'object', description: 'Memory object' }, merge: { type: 'boolean' } }, ['memory'], (a, cwd) => {
      if (!a.memory || typeof a.memory !== 'object' || Array.isArray(a.memory)) throw new Error('memory must be an object');
      const base = a.merge ? M.projectRead(cwd) : null;
      const m = base ? M.mergeMemory(base, a.memory) : { ...a.memory };
      m.version ??= '1.0.0'; m.lastScanned ??= Date.now(); m.projectRoot ??= cwd;
      M.projectSave(cwd, m);
      return `${a.merge ? 'Merged' : 'Wrote'} project memory.`;
    }),
  tool('project_memory_add_note', 'Add a categorized note to project memory (keeps the last 20).',
    { category: str('e.g. build, test, deploy, env, architecture'), content: str('Note (max 1000)') }, ['category', 'content'],
    (a, cwd) => { M.addNote(cwd, a.category, a.content); return `Added note [${a.category}].`; }),
  tool('project_memory_add_directive', 'Add a user directive that persists across sessions and survives compaction (deduplicated, max 20).',
    { directive: str('The directive, e.g. "Always use strict mode"'), context: str('Optional context'), priority: { type: 'string', enum: ['high', 'normal'] } }, ['directive'],
    (a, cwd) => M.addDirective(cwd, a).added ? `Added directive (${a.priority ?? 'normal'}).` : 'Directive already present.'),
];

const STATE_FIELDS = { active: { type: 'boolean' }, iteration: { type: 'number' }, max_iterations: { type: 'number' }, current_phase: { type: 'string' },
  task_description: { type: 'string' }, plan_path: { type: 'string' }, started_at: { type: 'string' }, completed_at: { type: 'string' }, error: { type: 'string' } };
const MODE = { mode: str(`Mode name (e.g. ralplan, ultrawork). Built-ins ${M.BUILTIN_MODES.join(', ')} are Make It Ship's live state and read-only.`) };
const state = [
  tool('state_read', 'Read the state of a mode (custom modes, or the live run/loop/style/freeze).', { ...MODE, ...SID }, ['mode'],
    (a, cwd) => M.modeRead(cwd, M.BUILTIN_MODES.includes(a.mode) ? a.mode : M.checkName('mode', a.mode)) ?? `No state found for mode: ${a.mode}`),
  tool('state_write', 'Write (replace) the state of a custom mode. Explicit fields win over the free-form `state` object. Refuses the run/loop/style/freeze built-ins.',
    { ...MODE, ...STATE_FIELDS, state: { type: 'object', description: 'Additional custom fields' }, ...SID }, ['mode'], (a, cwd) => {
      const explicit = Object.fromEntries(Object.keys(STATE_FIELDS).filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
      const s = M.modeWrite(cwd, a.mode, { ...(a.state ?? {}), ...explicit });
      return `Wrote state for ${a.mode} (${Object.keys(s).length - 1} fields).`;
    }),
  tool('state_clear', 'Delete the state of a custom mode. Refuses the run/loop/style/freeze built-ins (use mis cancel / mis loop cancel).', { ...MODE, ...SID }, ['mode'],
    (a, cwd) => ({ mode: a.mode, cleared: M.modeClear(cwd, a.mode) })),
  tool('state_list_active', 'List active modes: the current run, loop, freeze, style level and custom modes with active: true.',
    { all: { type: 'boolean' }, ...SID }, [], (_a, cwd) => M.modeList(cwd).filter((m) => m.active)),
  tool('state_get_status', 'Status of one mode, or of every built-in and custom mode.', { mode: MODE.mode, ...SID }, [], (a, cwd) => {
    if (!a.mode) return M.modeList(cwd);
    const builtin = M.BUILTIN_MODES.includes(a.mode);
    const s = M.modeRead(cwd, builtin ? a.mode : M.checkName('mode', a.mode));
    return { mode: a.mode, builtin, exists: !!s, active: s?.active === true, state: s };
  }),
];

const NS = { namespace: str('Namespace (team, pipeline run, session group)') }, KEY = { key: str('Key (letters, digits, . _ -)') };
const shared = [
  tool('shared_memory_write', 'Write a key/value into a namespace for cross-agent handoffs, with optional TTL in seconds (max 7 days).',
    { ...NS, ...KEY, value: { description: 'Any JSON value' }, ttl: { type: 'integer', minimum: 1, maximum: 604800 } }, ['namespace', 'key', 'value'],
    (a, cwd) => { const { value, ...e } = M.sharedWrite(cwd, a.namespace, a.key, a.value, a.ttl); return e; }),
  tool('shared_memory_read', 'Read a key from a namespace (expired entries read as not found).', { ...NS, ...KEY }, ['namespace', 'key'],
    (a, cwd) => M.sharedRead(cwd, a.namespace, a.key) ?? `Key "${a.key}" not found in namespace "${a.namespace}" (or expired).`),
  tool('shared_memory_list', 'List the keys of a namespace, or all namespaces when none is given.', { namespace: NS.namespace }, [],
    (a, cwd) => a.namespace ? M.sharedList(cwd, a.namespace) : M.sharedNamespaces(cwd)),
  tool('shared_memory_delete', 'Delete a key from a namespace.', { ...NS, ...KEY }, ['namespace', 'key'],
    (a, cwd) => ({ deleted: M.sharedDelete(cwd, a.namespace, a.key) })),
  tool('shared_memory_cleanup', 'Remove expired entries from one namespace or all.', { namespace: NS.namespace }, [],
    (a, cwd) => M.sharedCleanup(cwd, a.namespace)),
];

export const tools = [...notepad, ...project, ...state, ...shared];
