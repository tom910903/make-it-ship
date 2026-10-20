// Fixture secrets assembled at runtime so no test file contains one literally (pre-push scans, push protection).
export const FAKE = { gh: 'gh' + 'p_' + 'A1b2'.repeat(9), aws: 'AK' + 'IA' + 'Q'.repeat(16) };
