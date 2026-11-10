// Session-start recall in claude-mem's format (user decision 2026-11-10, item 3).
process.env.TZ = 'Asia/Seoul';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRecent } from '../../scripts/lib/recall.mjs';

const now = new Date('2026-11-10T00:17:00Z'); // 9:17am GMT+9
const memories = [
  { id: 4939, at: '2026-11-04T04:51:10Z', type: 'discovery', title: 'Pie syntax validated', subtitle: 's', narrative: 'n'.repeat(40), facts: ['f'], work: 4000 },
  { id: 4940, at: '2026-11-04T04:51:40Z', type: 'bugfix', title: 'Meta refresh blocked', work: 4000 },
  { id: 4941, at: '2026-11-06T23:18:00Z', type: 'feature', title: 'Release 0.4.0 merged', work: 2000 },
];
const summaries = [
  { id: 'S1', at: '2026-11-04T04:50:00Z', request: 'Harden visual docs' },
  { id: 'S2', at: '2026-11-06T23:22:00Z', request: 'Merge and push 0.4.0', investigated: 'push rejection', learned: 'branch protection likely', completed: 'local merge', next_steps: 'open a PR' },
];

test('renderRecent: claude-mem layout — header, legend, stats, days, repeated times, session rows, last summary, access line', () => {
  const out = renderRecent({ project: 'make-it-ship', now, memories, summaries });
  assert.equal(out, [
    '# [make-it-ship] make-it-ship 2026-11-10 9:17am GMT+9',
    '',
    'Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision',
    'Format: ID TIME TYPE TITLE',
    'Fetch details: mis memory get <IDs> | Search: mis memory search <words> or the memory_search tool',
    '',
    'Stats: 3 obs (26t read) | 10,000t work | 100% savings',
    '',
    '### Nov 4, 2026',
    'S1 Harden visual docs (Nov 4 at 1:50 PM)',
    '4939 1:51p 🔵 Pie syntax validated',
    '4940 " 🔴 Meta refresh blocked',
    '### Nov 7, 2026',
    '4941 8:18a 🟣 Release 0.4.0 merged',
    'S2 Merge and push 0.4.0 (Nov 7 at 8:22 AM)',
    '**Investigated**: push rejection',
    '',
    '**Learned**: branch protection likely',
    '',
    '**Completed**: local merge',
    '',
    '**Next Steps**: open a PR',
    '',
    '',
    'Access 10k tokens of past work via mis memory get <IDs> or mis memory search.',
  ].join('\n'));
});

test('renderRecent: limits, size budget (oldest rows go first, the summary block stays), raw fallback, empty', () => {
  assert.equal(renderRecent({ project: 'p', now, memories: [], summaries: [], raw: [] }), '');
  const many = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, at: new Date(Date.UTC(2026, 10, 9, 0, i)).toISOString(), type: 'change', title: `Change number ${i + 1}`, work: 10 }));
  const fifty = renderRecent({ project: 'p', now, memories: many, summaries });
  assert.match(fifty, /Stats: 50 obs/);
  assert.doesNotMatch(fifty, /^30 /m);
  const later = [...summaries, { id: 'S3', at: '2026-11-09T02:00:00Z', request: 'r', next_steps: 'open a PR' }];
  const small = renderRecent({ project: 'p', now, memories: many, summaries: later, maxChars: 1200 });
  assert.ok(small.length <= 1200, String(small.length));
  assert.match(small, /^80 /m, 'the newest row survives');
  assert.match(small, /\*\*Next Steps\*\*: open a PR/);
  const raw = renderRecent({ project: 'p', now, memories: [], summaries: [], raw: [
    { id: 'r1', at: '2026-11-09T01:00:00Z', type: 'read', title: 'Read a.md' },
    { id: 'r2', at: '2026-11-09T01:01:00Z', type: 'failure', title: 'Failed: npm test' },
    { id: 'r3', at: '2026-11-09T01:02:00Z', type: 'commit', title: 'fix: dates' },
  ] });
  assert.doesNotMatch(raw, /Read a\.md/, 'reads are noise at session start');
  assert.match(raw, /r2 10:01a 🔴 Failed: npm test\nr3 10:02a ✅ fix: dates/);
});
