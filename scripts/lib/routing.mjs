// Project CLAUDE.md "## Skill routing" section (M9-F10, replaces the gstack preamble writer; see THIRD_PARTY_NOTICES.md).
// `mis setup routing` shows the change; only `--write` (a guard ask) writes it.

export const ROUTING = `## Skill routing

When a request matches, invoke the Make It Ship skill with the Skill tool before answering:
- build, implement or change code with verification → /make-it-ship:run
- a bug, failing test or unexpected behavior → /make-it-ship:debug
- review a diff, branch or PR → /make-it-ship:review
- review a plan before building → /make-it-ship:plan-review
- QA a web app or CLI → /make-it-ship:qa
- ship: PR and release checks → /make-it-ship:ship
- keep going until verified → /make-it-ship:loop
- where a run stands / continue it → /make-it-ship:status, /make-it-ship:resume
- weekly retrospective → /make-it-ship:retro
`;

/** The existing section: from its heading to the next heading of the same or higher level (or the end). */
function findSection(text) {
  const m = text.match(/^## Skill routing[ \t]*$/m);
  if (!m) return null;
  const start = m.index;
  const rest = text.slice(start + m[0].length);
  const next = rest.search(/^#{1,2} /m);
  return { start, end: next < 0 ? text.length : start + m[0].length + next };
}

/** {next, old, changed}: the CLAUDE.md text with the MIS routing section replacing an existing one, or appended. */
export function routingChange(text) {
  const t = text ?? '';
  const s = findSection(t);
  const old = s ? t.slice(s.start, s.end) : '';
  const block = s && s.end < t.length ? `${ROUTING}\n` : ROUTING;
  const next = s ? t.slice(0, s.start) + block + t.slice(s.end) : `${t}${t && !t.endsWith('\n') ? '\n' : ''}${t ? '\n' : ''}${ROUTING}`;
  return { next, old, changed: next !== t };
}

/** Line diff of the section only (old lines '-', new lines '+'). */
export function sectionDiff(old) {
  return [...(old ? old.trimEnd().split('\n').map((l) => `- ${l}`) : []), ...ROUTING.trimEnd().split('\n').map((l) => `+ ${l}`)].join('\n');
}
