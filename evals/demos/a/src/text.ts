/** Uppercase the first character. */
export function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Cut to at most `max` characters, ending with "…" when cut. */
export function truncate(s: string, max: number): string {
  if (max < 1) throw new RangeError('max must be >= 1');
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
