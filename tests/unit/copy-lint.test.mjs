import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintText } from '../../scripts/lib/copy-lint.mjs';

const kinds = (t, o) => lintText(t, o).map((f) => `${f.line}:${f.kind}:${f.match.toLowerCase()}`);

test('stock phrases, slop words and chatbot residue are found with their line', () => {
  assert.deepEqual(kinds('Plan trips\nUnlock the power of your data\nA seamless experience\nLorem ipsum dolor'),
    ['2:stock:unlock the power', '2:slop:unlock', '3:slop:seamless', '4:residue:lorem ipsum']);
});

test('literal uses stay: seamless knit, bespoke tailoring, a powerful 2,000 W motor, leverage up to 1:30, unlock the door', () => {
  assert.deepEqual(kinds('Seamless knit socks\nBespoke tailoring\nA powerful 2,000 W motor\nLeverage up to 1:30\nUnlock the door with your phone'), []);
});

test('plain product copy passes; words inside longer words are not hits', () => {
  assert.deepEqual(kinds('Book a table for tonight\nRealmente bueno\nUnlockable trophies'), []);
});

test('HTML: only visible text counts (tags, attributes, scripts and styles are skipped), line numbers are kept', () => {
  const html = '<div class="seamless">\n<script>const unlock = 1</script>\n<style>.robust{}</style>\n<h1>Look no further</h1>';
  assert.deepEqual(kinds(html, { html: true }), ['4:stock:look no further']);
});
