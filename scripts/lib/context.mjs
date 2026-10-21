import { readFileSync } from 'node:fs';

/** Context use (%) from the last assistant usage in a transcript. shortcut: assumes a 200k window; read the model's window if the host exposes it. */
export function contextPercent(path) {
  if (!path) return 0;
  try {
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 200; i--) {
      const u = JSON.parse(lines[i])?.message?.usage;
      if (u) return Math.round(((u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)) / 2000);
    }
  } catch { /* unreadable transcript */ }
  return 0;
}
