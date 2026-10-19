/** Trim and collapse inner whitespace to single spaces. */
export function squish(s) {
  return s.trim().replace(/\s+/g, ' ');
}
