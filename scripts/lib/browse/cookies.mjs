// cookie-import-browser (absorbs gstack cookie-import-browser / setup-browser-cookies): read and decrypt the cookie store
// of a Chromium browser installed for this user. Runs in the CLI (the Keychain prompt belongs to the user's terminal),
// only after the guard asked (policy.mjs). The store is copied to a private temp dir, read, and the copy deleted.
// Decryption (Chromium os_crypt): macOS v10 = AES-128-CBC, key PBKDF2-SHA1(Keychain "<Browser> Safe Storage" password,
// "saltysalt", 1003 rounds, 16 bytes), IV 16 spaces; Linux v10 = same with password "peanuts" and 1 round, v11 = the
// password from the Secret Service (secret-tool). Since cookie DB version 24 the plaintext starts with SHA-256(host_key).
import { execFileSync } from 'node:child_process';
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSERS = {
  chrome: { name: 'Chrome', mac: 'Google/Chrome', linux: 'google-chrome', keychain: 'Chrome Safe Storage', app: 'chrome' },
  chromium: { name: 'Chromium', mac: 'Chromium', linux: 'chromium', keychain: 'Chromium Safe Storage', app: 'chromium' },
  edge: { name: 'Edge', mac: 'Microsoft Edge', linux: 'microsoft-edge', keychain: 'Microsoft Edge Safe Storage', app: 'microsoft-edge' },
  brave: { name: 'Brave', mac: 'BraveSoftware/Brave-Browser', linux: 'BraveSoftware/Brave-Browser', keychain: 'Brave Safe Storage', app: 'brave' },
  arc: { name: 'Arc', mac: 'Arc/User Data', keychain: 'Arc Safe Storage' },
};
const SAME_SITE = { 0: 'None', 1: 'Lax', 2: 'Strict' };
const EPOCH_DELTA_S = 11644473600; // Chromium time: microseconds since 1601-01-01

const dataDir = (b) => (process.platform === 'darwin' ? b.mac && join(homedir(), 'Library', 'Application Support', b.mac)
  : process.platform === 'linux' ? b.linux && join(homedir(), '.config', b.linux) : null);

/** The user's own browser data dirs on this machine (connect refuses to run inside them). */
export const browserDataDirs = () => Object.values(BROWSERS).map(dataDir).filter(Boolean);

/** The cookie DB of a profile: <profile>/Network/Cookies (Chrome 96+) or <profile>/Cookies. */
export function cookieDbPath({ browser = 'chrome', profile = 'Default', profileDir } = {}) {
  const b = BROWSERS[browser];
  if (!b) throw new Error(`unknown browser "${browser}" (${Object.keys(BROWSERS).join(', ')})`);
  let dir = profileDir;
  if (!dir) {
    const base = dataDir(b);
    if (!base) throw new Error(`BLOCKED: importing ${b.name} cookies is supported on macOS and Linux only (Windows Chrome 127+ binds the key to Chrome itself)`);
    dir = join(base, profile);
  }
  const db = [join(dir, 'Network', 'Cookies'), join(dir, 'Cookies')].find(existsSync);
  if (!db) throw new Error(`no cookie store in ${dir} (is ${b.name} installed, and is "${profile}" a profile? see --profile / --profile-dir)`);
  return { db, browser: b };
}

async function openCopy(db, fn) {
  let sqlite;
  try { sqlite = await import('node:sqlite'); } catch { throw new Error('BLOCKED: reading a browser cookie store needs Node 22.5+ (node:sqlite)'); }
  const tmp = mkdtempSync(join(tmpdir(), 'mis-cookies-')); // 0700: the copy holds encrypted session cookies
  try {
    const copy = join(tmp, 'Cookies');
    copyFileSync(db, copy);
    for (const ext of ['-wal', '-shm']) if (existsSync(db + ext)) copyFileSync(db + ext, copy + ext); // a running browser keeps recent writes in the WAL
    const conn = new sqlite.DatabaseSync(copy, { readOnly: true });
    try { return fn(conn); } finally { conn.close(); }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const matches = (host, domains) => domains.some((d) => { const h = host.replace(/^\./, ''); return h === d || h.endsWith(`.${d}`); });

/** Domains with cookie counts; nothing is decrypted. */
export async function listCookieDomains(opts) {
  const { db } = cookieDbPath(opts);
  return openCopy(db, (c) => c.prepare('SELECT host_key AS domain, COUNT(*) AS count FROM cookies GROUP BY host_key ORDER BY count DESC').all()
    .map((r) => ({ domain: r.domain, count: Number(r.count) })));
}

function password(browser) {
  if (process.platform === 'darwin') {
    try { // bare name through PATH; macOS shows its own Keychain prompt to the user
      return execFileSync('security', ['find-generic-password', '-w', '-s', browser.keychain], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (e) { throw new Error(`cannot read "${browser.keychain}" from the Keychain (${String(e.stderr || e.message).trim().split('\n')[0]}); allow access in the macOS dialog and retry`); }
  }
  return null;
}

function linuxV11(browser) {
  try { return execFileSync('secret-tool', ['lookup', 'application', browser.app], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

/** Decrypted cookies of the given domains (and their subdomains) as CDP cookie params. */
export async function readBrowserCookies(opts) {
  const domains = (opts.domains ?? []).map((d) => d.toLowerCase().replace(/^\./, ''));
  if (!domains.length) throw new Error('name the sites to import with --domain <host> (repeatable); without it the command only lists domains');
  const { db, browser } = cookieDbPath(opts);
  return openCopy(db, (c) => {
    const version = Number(c.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value ?? 0);
    const q = c.prepare('SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, has_expires, samesite FROM cookies');
    q.setReadBigInts(true); // Chromium timestamps (µs since 1601) do not fit a double
    const rows = q.all().filter((r) => matches(r.host_key, domains));
    const keys = {};
    const key = (prefix) => {
      if (keys[prefix] !== undefined) return keys[prefix];
      const pw = process.platform === 'darwin' ? password(browser) : prefix === 'v11' ? linuxV11(browser) : 'peanuts';
      return (keys[prefix] = pw === null ? null : pbkdf2Sync(pw, 'saltysalt', process.platform === 'darwin' ? 1003 : 1, 16, 'sha1'));
    };
    const out = [], skipped = [];
    const now = Date.now() / 1000;
    for (const r of rows) {
      let value = r.value;
      const enc = Buffer.from(r.encrypted_value ?? []);
      if (enc.length) {
        const prefix = enc.subarray(0, 3).toString('latin1');
        const k = /^v1[01]$/.test(prefix) ? key(prefix) : null;
        if (!k) { skipped.push(`${r.host_key} ${r.name} (${prefix} not supported)`); continue; }
        try {
          const d = createDecipheriv('aes-128-cbc', k, Buffer.alloc(16, 0x20));
          let plain = Buffer.concat([d.update(enc.subarray(3)), d.final()]);
          if (version >= 24) {
            if (!plain.subarray(0, 32).equals(createHash('sha256').update(r.host_key).digest())) throw new Error('domain hash mismatch');
            plain = plain.subarray(32);
          }
          value = plain.toString('utf8');
        } catch (e) { skipped.push(`${r.host_key} ${r.name} (${e.message.includes('hash') ? e.message : 'cannot decrypt'})`); continue; }
      }
      const expires = Number(r.has_expires) ? Number(BigInt(r.expires_utc) / 1000000n) - EPOCH_DELTA_S : 0;
      if (expires && expires < now) continue;
      out.push({ name: r.name, value, domain: r.host_key, path: r.path || '/', secure: !!Number(r.is_secure), httpOnly: !!Number(r.is_httponly),
        ...(SAME_SITE[Number(r.samesite)] ? { sameSite: SAME_SITE[Number(r.samesite)] } : {}), ...(expires ? { expires } : {}) });
    }
    return { cookies: out, skipped, source: `${browser.name} (${db.replace(homedir(), '~')})` };
  });
}
