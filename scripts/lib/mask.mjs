// Mask secrets before logs are stored (mis check).
const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIAL)/i;
const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
];
const KV = /((?:password|passwd|secret|token|api[_-]?key|authorization)["']?\s*[=:]\s*(?:Bearer\s+)?)["']?[^\s"',;]+/gi;
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/g;
// scheme://user:password@host (M9 r2 N5): the password goes, the user and host stay
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)[^\s/@]+@/gi;

export function maskSecrets(text, env = process.env) {
  let out = text;
  for (const [k, v] of Object.entries(env)) {
    if (v && v.length >= 8 && SECRET_NAME.test(k)) out = out.split(v).join('***');
  }
  for (const re of PATTERNS) out = out.replace(re, '***');
  return out.replace(URL_USERINFO, '$1***@').replace(BEARER, '$1***').replace(KV, '$1***');
}
