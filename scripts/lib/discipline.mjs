// SessionStart discipline (absorbs Superpowers using-superpowers and its always-on rules; see THIRD_PARTY_NOTICES.md).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** "- /make-it-ship:<name>: <first sentence>" for every skill, read from the plugin's own SKILL.md files. */
export function skillIndex(pluginRoot) {
  const lines = [];
  for (const name of readdirSync(join(pluginRoot, 'skills')).sort()) {
    try {
      const fm = readFileSync(join(pluginRoot, 'skills', name, 'SKILL.md'), 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
      const desc = fm.match(/^description:\s*(.+)$/m)?.[1].replace(/^["'>|-]\s*/, '') ?? '';
      lines.push(`- /make-it-ship:${name} — ${desc.split(/(?<=\.)\s/)[0]}`);
    } catch { /* a skill without SKILL.md is skipped */ }
  }
  return lines.join('\n');
}

/** @param opts.proactive suggest the next skill (config `proactive`, default on; absorbs gstack proactive suggestions and its question format) */
export function disciplineText(pluginRoot, { proactive = true } = {}) {
  return `<MAKE_IT_SHIP>
Make It Ship is installed. Its skills are invoked with the Skill tool; when one applies to the request, invoke it BEFORE answering, even for a question that looks simple:
${skillIndex(pluginRoot)}

Always, in every task (not only inside a run):
- Unclear request: ask before building, one question at a time, only what changes the result.
- Code change: write a failing test first, watch it fail, then the minimal code, then the whole suite.
- Bug: find the root cause (reproduce, one hypothesis at a time) before changing code; never retry the same fix blindly.
- Done / passing / fixed: run the verification command and read its output first; report failures with the output.
- Review feedback: check each point against the code before applying it; push back with evidence when it is wrong.
- Independent work: hand separate tasks to subagents in parallel; keep authoring and reviewing in separate passes.
- Asking the user: restate the decision in one line, give your recommendation and why, then 2-4 concrete options (AskUserQuestion when available).${proactive ? `
- Next step: when a piece of work ends, suggest in one line the one skill that fits next (after a fix /make-it-ship:review, before merging /make-it-ship:ship, a failing test /make-it-ship:debug); do not run it unasked.` : ''}
</MAKE_IT_SHIP>`;
}
