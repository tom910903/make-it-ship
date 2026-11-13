// HUD data that the Claude Code status line input does not carry (statusline.mjs; absorbs the OMC HUD git, api-key-source,
// prompt-time, call-counts, skills and background elements, see THIRD_PARTY_NOTICES.md). Each one runs only when its item
// is on; any failure is a missing part, never an error.
import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { claudeDir, homeDir, readHome, writeHome } from './home.mjs';

const safe = (s) => String(s || 'default').replace(/[^\w.-]/g, '_');
// --no-optional-locks: a refresh must never hold index.lock while the user runs git
const git = (cwd, args) => execFileSync('git', ['--no-optional-locks', ...args], { cwd, encoding: 'utf8', timeout: 500, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'ignore'] });

const GIT_TTL = 5000, GIT_SLOW_TTL = 60000; // a repo where git status timed out is not asked again for a minute

/**
 * {staged, modified, untracked, ahead, behind}, or null outside a repository (or when git takes over 500 ms). Cached per
 * directory for 5 seconds (hud-git.json), so a status line that refreshes often runs git status at most that often.
 */
export function gitCounts(cwd, now = Date.now()) {
  const cache = readHome('hud-git.json', {}) ?? {}, hit = cache[cwd];
  if (hit && now - hit.at < (hit.slow ? GIT_SLOW_TTL : GIT_TTL)) return hit.n;
  let n = null, slow = false;
  try { n = parseStatus(git(cwd, ['status', '--porcelain=v2', '--branch'])); } catch (e) { slow = e.signal === 'SIGKILL' || e.code === 'ETIMEDOUT'; }
  for (const [k, v] of Object.entries(cache)) if (now - v.at > 10 * 60000) delete cache[k];
  try { writeHome('hud-git.json', { ...cache, [cwd]: { at: now, n, ...(slow && { slow }) } }); } catch { /* unwritable home: no cache */ }
  return n;
}

function parseStatus(out) {
  const n = { staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0 };
  for (const l of out.split('\n')) {
    const ab = l.match(/^# branch\.ab \+(\d+) -(\d+)/);
    if (ab) { n.ahead = Number(ab[1]); n.behind = Number(ab[2]); }
    else if (l.startsWith('? ')) n.untracked++;
    else if (/^[12u] /.test(l)) { if (l[2] !== '.') n.staged++; if (l[3] !== '.') n.modified++; }
  }
  return n;
}

/** Claude Code's parsed workspace.repo name, else the last path segment of the origin remote (no host, owner or credentials). */
export function repoName(repo, cwd) {
  if (repo?.name) return String(repo.name);
  let url; try { url = git(cwd, ['remote', 'get-url', 'origin']).trim(); } catch { return null; }
  return url.match(/([^/:]+?)(?:\.git)?\/?$/)?.[1] ?? null;
}

/** Where ANTHROPIC_API_KEY comes from, in Claude Code's order: project settings.local.json, user settings.json, the environment. */
export function apiKeySource(projectDir) {
  const has = (p) => { try { const e = JSON.parse(readFileSync(p, 'utf8'))?.env; return !!e && typeof e === 'object' && 'ANTHROPIC_API_KEY' in e; } catch { return false; } };
  if (projectDir && has(join(projectDir, '.claude', 'settings.local.json'))) return 'project';
  if (has(join(claudeDir(), 'settings.json'))) return 'global';
  return process.env.ANTHROPIC_API_KEY ? 'env' : null;
}

// Per-session files sit in sessions/, so pruneSessions (posttool.mjs) removes them with the rest after a week.
const promptFile = (sid) => join(homeDir(), 'sessions', `${safe(sid)}.prompt`);
/** UserPromptSubmit: one file per session holding the time, so it never races the session file's read-modify-write. */
export function notePrompt(sid, now = Date.now()) {
  mkdirSync(join(homeDir(), 'sessions'), { recursive: true });
  writeFileSync(promptFile(sid), String(now));
}
export function lastPrompt(sid) {
  try { const t = Number(readFileSync(promptFile(sid), 'utf8')); return t > 0 ? t : null; } catch { return null; }
}

const CHUNK = 4 << 20, BUDGET = 32 << 20; // bytes read at a time, and at most per refresh
const ORPHAN_MS = 6 * 60 * 60 * 1000; // as for agents: a task with no completion notice for 6 hours is gone (session killed)
const MARKS = ['"type":"assistant"', '<task-notification>', '<command-name>', 'Base directory for this skill', 'Async agent launched'];
const short = (s) => String(s).split(':').pop();
const fresh = (path) => ({ path, off: 0, tools: 0, agents: 0, skills: 0, skill: null, bg: {}, launches: {}, msg: null, think: null, slash: null });

/** A completion notice (a <task-notification> no longer running) ends that background task. */
function finished(t, c) {
  const done = t.includes('<task-notification>') && !t.includes('<status>running</status>') && t.match(/<tool-use-id>([^<]+)<\/tool-use-id>/);
  if (done) delete c.bg[done[1]];
}

/** One transcript line into the running counts; only lines with a marker are parsed (most of a transcript is tool output). */
function scan(text, c) {
  if (!MARKS.some((m) => text.includes(m))) return;
  let e; try { e = JSON.parse(text); } catch { return; }
  if (e?.isSidechain) return;
  const content = e.message?.content, at = Date.parse(e.timestamp) || Date.now();
  if (e.type === 'assistant') {
    c.slash = null;
    if ((e.message?.id ?? null) !== c.msg) { c.msg = e.message?.id ?? null; c.think = false; } // one message is several lines
    for (const b of Array.isArray(content) ? content : []) {
      if (b?.type === 'thinking' || b?.type === 'redacted_thinking') c.think = true;
      if (b?.type !== 'tool_use') continue;
      c.tools++;
      if (b.name === 'Agent' || b.name === 'Task') { c.agents++; c.launches[b.id] = at; }
      if (b.name === 'Skill') { c.skills++; if (b.input?.skill) c.skill = short(b.input.skill); }
      if (b.input?.run_in_background === true) c.bg[b.id] = at;
    }
    return;
  }
  if (e.type !== 'user') {
    // a notice that comes in during a turn is queued, not sent as a user message: queue-operation, queued_command attachment
    finished(typeof e.content === 'string' ? e.content : e.attachment?.type === 'queued_command' ? String(e.attachment.prompt ?? '') : '', c);
    return;
  }
  for (const b of typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []) {
    if (b?.type === 'tool_result' && b.tool_use_id in c.launches) {
      const t = typeof b.content === 'string' ? b.content : (Array.isArray(b.content) ? b.content.find((x) => x?.type === 'text')?.text : '') ?? '';
      if (t.startsWith('Async agent launched successfully')) c.bg[b.tool_use_id] = c.launches[b.tool_use_id];
      delete c.launches[b.tool_use_id];
    }
    if (b?.type !== 'text') continue;
    const t = String(b.text);
    finished(t, c);
    // a slash command is a skill only when the skill's text follows it; a built-in command (/effort) has none
    if (e.isMeta && c.slash && t.startsWith('Base directory for this skill:')) { c.skills++; c.skill = short(c.slash); c.slash = null; }
    else c.slash = t.match(/<command-name>\/([^<\s]+)<\/command-name>/)?.[1] ?? c.slash;
  }
}

/**
 * Counts from the session transcript: tool, agent and skill calls (Skill tool and slash-typed skills), the last skill,
 * background commands and agents without a completion notice, and whether the latest reply has a thinking block.
 * The byte offset is cached (sessions/<id>.hud.json), so a refresh parses only the lines added since the last one.
 */
export function transcriptStats(path, sid, now = Date.now(), { chunk = CHUNK, budget = BUDGET } = {}) {
  if (!path) return null;
  let size; try { size = statSync(path).size; } catch { return null; }
  const name = `sessions/${safe(sid)}.hud.json`;
  let c = readHome(name);
  if (c?.path !== path || !(c.off <= size)) c = fresh(path);
  if (size > c.off) {
    // Read in chunks and stop after BUDGET bytes: a resumed long session catches up over a few refreshes instead of
    // stalling one. A line is cut only at a newline byte, which never occurs inside a UTF-8 sequence.
    const start = c.off, fd = openSync(path, 'r');
    try {
      let pos = c.off, rest = Buffer.alloc(0);
      while (pos < size && c.off - start < budget) {
        const buf = Buffer.alloc(Math.min(chunk, size - pos));
        const n = readSync(fd, buf, 0, buf.length, pos);
        if (n <= 0) break;
        pos += n;
        const data = rest.length ? Buffer.concat([rest, buf.subarray(0, n)]) : buf.subarray(0, n);
        const end = data.lastIndexOf(10) + 1; // a line still being written is read next time
        if (end) { for (const l of data.toString('utf8', 0, end).split('\n')) scan(l, c); c.off += end; }
        rest = data.subarray(end);
      }
    } finally { closeSync(fd); }
    if (c.off > start) {
      for (const m of [c.bg, c.launches]) for (const [id, t] of Object.entries(m)) if (now - t > ORPHAN_MS) delete m[id];
      try { writeHome(name, c); } catch { /* unwritable home: counted again next time */ }
    }
  }
  return { tools: c.tools, agents: c.agents, skills: c.skills, skill: c.skill, bg: Object.values(c.bg).filter((t) => now - t <= ORPHAN_MS).length, think: c.think ?? undefined };
}

// mis hud previews render with the last real input; a status line refreshes often, so it is kept at most every 5 seconds.
const LAST = 'statusline-last.json';
export function rememberInput(input, now = Date.now()) {
  try { if (now - statSync(join(homeDir(), LAST)).mtimeMs < 5000) return; } catch { /* not written yet */ }
  writeHome(LAST, input);
}
export const lastInput = () => readHome(LAST);
