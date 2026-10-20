// Small pure helpers of the built-in browser (mis browse).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

/**
 * Local = a file: or loopback origin (or URL). Decides when storage/JS/upload need --remote. Opaque or unknown origins
 * (about:blank and data: documents report "://", sandboxed ones "null") and blob:/about: URLs are not local: fail closed.
 */
export function isLocalOrigin(o) {
  let url;
  try { url = new URL(o); } catch { return false; }
  if (url.protocol === 'file:') return true;
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return false;
  const h = url.hostname.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** gstack-style target parsing: schemes kept, file://./rel and existing paths → file URL, bare hosts get a scheme. */
export function toUrl(target, cwd) {
  if (/^file:\/\/(\.|~)/.test(target)) {
    const rest = target.slice(7);
    return pathToFileURL(rest.startsWith('~') ? resolve(homedir(), rest.slice(2)) : resolve(cwd, rest)).href;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[\w.-]+:\d+/.test(target)) return target;
  const p = resolve(cwd, target);
  if (existsSync(p)) return pathToFileURL(p).href;
  return (/^(localhost|127\.|\[::1\])/.test(target) ? 'http://' : 'https://') + target;
}

/** Changed lines between two texts (LCS), as "- old" / "+ new". */
export function lineDiff(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  // shortcut: O(n*m) table; very long pages fall back to a set difference. Use Myers if exact long diffs matter.
  if (x.length * y.length > 4e6) {
    const sx = new Set(x), sy = new Set(y);
    return [...x.filter((l) => !sy.has(l)).map((l) => `- ${l}`), ...y.filter((l) => !sx.has(l)).map((l) => `+ ${l}`)];
  }
  const n = x.length, m = y.length, t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { i++; j++; }
    else if (i < n && (j === m || t[i + 1][j] >= t[i][j + 1])) out.push(`- ${x[i++]}`);
    else out.push(`+ ${y[j++]}`);
  }
  return out;
}

const PER_INCH = { in: 1, pt: 72, cm: 2.54, mm: 25.4, px: 96 };
export function toInches(dim) {
  const m = /^(\d+(?:\.\d+)?)(in|pt|cm|mm|px)$/.exec(String(dim).trim());
  if (!m) throw new Error(`bad dimension "${dim}" (use e.g. 1in, 72pt, 2.54cm, 25mm, 96px)`);
  return Number(m[1]) / PER_INCH[m[2]];
}

/**
 * M9-E: browse commands that touch credentials, the user's own Chrome, saved browser state or fetch remote content with
 * the browser's cookies. The guard asks for them every time (run or not); the daemon refuses them inside chain, tab-each
 * and browser skills, and the CLI refuses them in scripts run by `mis check` (MIS_CLI), where the guard cannot see them.
 */
export const BROWSE_ALWAYS_ASK = new Map([
  ['cookies', 'reads every cookie in the browser (session tokens)'],
  ['cookie', 'sets a cookie the browser sends to the site'],
  ['cookie-import', 'loads cookies (logged-in sessions) from a file into the browser'],
  ['cookie-import-browser', "reads and decrypts your real browser's cookie store (macOS Keychain) and loads the sessions into the built-in browser"],
  ['header', 'adds a request header (often an auth token) to every request the browser sends'],
  ['useragent', 'changes the user agent every site sees'],
  ['connect', 'opens a visible Chrome on a persistent profile whose logins stay on disk'],
  ['state', 'saves or restores cookies and open pages (logged-in sessions) to/from disk'],
  ['download', "fetches a URL with the browser's cookies and writes it to disk"],
  ['scrape', "fetches every image/video on the page with the browser's cookies and writes them to disk"],
  ['archive', 'saves the whole page (MHTML, with its resources) to disk'],
]);

/** The always-ask commands a browse argv runs: the subcommand, tab-each's command and inline chain steps. */
export function alwaysAskIn(browseArgs) {
  const words = browseArgs.filter((w) => !w.startsWith('-'));
  const [sub, next] = words, hits = [];
  if (BROWSE_ALWAYS_ASK.has(sub)) hits.push(sub);
  if (sub === 'tab-each' && BROWSE_ALWAYS_ASK.has(next)) hits.push(next);
  if (sub === 'chain') {
    // a chain file or stdin is invisible here; the daemon refuses these commands inside chain anyway
    try { for (const s of JSON.parse(next ?? '')) if (Array.isArray(s) && BROWSE_ALWAYS_ASK.has(s[0])) hits.push(s[0]); } catch { /* not inline JSON */ }
  }
  return hits;
}
