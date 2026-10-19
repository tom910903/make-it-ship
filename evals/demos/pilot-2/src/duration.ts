/** Parse "1h30m", "45m", "2h", "90s" into seconds. */
export function parseDuration(s: string): number {
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || s === '') throw new Error(`bad duration: ${s}`);
  const [, h, min, sec] = m;
  return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(sec ?? 0) * 60;
}
