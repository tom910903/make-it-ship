// UserPromptSubmit keyword router (absorbs OMC magic keywords and Ponytail mode tracking; see THIRD_PARTY_NOTICES.md).
// Pure functions: detect → instructions; hooks.mjs injects them, `mis test-prompt` shows them.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkill } from './skills.mjs';

const K = (name, re, context) => ({ name, re, context });
// Priority order: earlier wins in conflict resolution.
const KEYWORDS = [
  K('cancel', /\b(cancelomc|stopomc)\b|\b(?:cancel|stop)[\s-]?mis\b(?![\w-])|(?<!\b(?:don'?t|do\s+not|never|not)\s+)\b(stop|cancel|kill|halt|disable|end|turn\s+off|no\s+more)\s+(the\s+)?ralph\b|^\s*\/?ralph(?:\s+mode)?\s*[:：]?\s*(stop|off|cancel)\s*[.!]?\s*$|^\s*랄프[^:：\n]*[:：]\s*(그만|멈춰|취소|꺼)\s*$|(ralph|랄프)\s?(멈춰|그만|취소|꺼줘|꺼(?:\s|$)|끄(?:기|자|고)|중지)|ラルフを?(止め|やめ)/i,
    'Cancel active Make It Ship modes: run `mis loop cancel`. If the user also wants to drop the current run, run `mis cancel`.'),
  K('loop', /\bralph\b|랄프|ラルフ/i,
    "Invoke /make-it-ship:loop with the user's task. It keeps working (plan → implement → verify) until `mis verdict` is VERIFIED or the iteration limit is reached; do not stop early."),
  K('loop-hint', null,
    'The prompt mentions "ralph". Only if the user is asking you to keep working until the result is verified, invoke /make-it-ship:loop. If it is a name, a complaint, or a request not to use or to stop it, ignore this note.'),
  K('run', /\b(autopilot|auto[\s-]pilot|full auto)\b|오토파일럿|オートパイロット|\b(build|create|make)\s+me\s+an?\s+(app|feature|project|tool|plugin|website|api|server|cli|script|system|service|dashboard|bot|extension)\b|\bi\s+want\s+an?\s+(app|feature|project|tool|plugin|website|api|server|cli|script|system|service|dashboard|bot|extension)\b|\bhandle\s+it\s+all\b|\bend\s+to\s+end\b|\be2e\s+this\b/i,
    "Invoke /make-it-ship:run with the user's request: plan, approval, test-first implementation, checks, reviews, and an honest report."),
  K('ultragoal', /\bultragoal\b/i,
    'Invoke /make-it-ship:run and put each goal in the plan as its own task with acceptance criteria; keep going with /make-it-ship:loop until every goal is VERIFIED.'),
  K('parallel', /\b(ultrawork|ulw)\b|울트라워크|ウルトラワーク/i,
    'Maximum parallel work: split the request into independent pieces and dispatch them to subagents in a single message (Agent tool). Inside a run use the parallel phase (`mis parallel`, task worktrees). Verify the combined result.'),
  K('second-opinion', /\b(ccg|claude-codex-gemini)\b|씨씨지|シーシージー/i,
    'Second opinion from other models: invoke /make-it-ship:ask (`mis second-opinion probe`, then `mis ccg "<question>"` for codex+gemini and synthesize). Calling an external model CLI sends code outside the company boundary, so it needs the user\'s approval (the guard asks; company policy may forbid it). Record it with `mis note second-opinion`; it never changes the verdict.'),
  K('plan-consensus', /\bralplan\b|랄플랜|ラルプラン/i,
    'Consensus planning: write the plan, then invoke /make-it-ship:plan-review; revise and repeat until the critic returns ACCEPT (at most 3 rounds), then show the plan to the user for approval.'),
  K('interview', /\b(deep[\s-]interview|ouroboros)\b|딥\s?인터뷰|ディープ\s?インタビュー/i,
    'Invoke /make-it-ship:interview: turn the request into goal, constraints and testable acceptance criteria, asking only high-impact questions one at a time.'),
  K('simplify', null,
    'Clean up AI slop in the named scope: invoke /make-it-ship:review focused on simplicity (dead code, duplication, needless abstraction or wrappers, unused dependencies), then remove the findings test-first with the suite green before and after. Behavior must not change.'),
  K('tdd', /\b(tdd|test\s+first|red\s+green)\b|테스트\s?퍼스트|テスト\s?ファースト/i,
    'TDD mode: for each behavior write a failing test, run it and see it fail for the right reason, write the minimal code, then run the full suite. No production code without a failing test first.'),
  K('review', /\b(code\s+review|review\s+(the\s+)?code)\b|코드\s?리뷰(?!어)|コード\s?レビュー(?!ア)/i,
    'Invoke /make-it-ship:review on the current changes (spec and quality reviewers, findings with severity and evidence).'),
  K('security-review', /\b(security\s+review|review\s+security)\b|보안\s?리뷰(?!어)|セキュリティー?\s?レビュー(?!ア)/i,
    'Invoke /make-it-ship:review including the security reviewer (agents/security-reviewer.md): trust boundaries, authn/authz, injection, secrets, unsafe deserialization; each finding with severity and evidence.'),
  K('think', /\b(ultrathink|think\s+hard|think\s+deeply)\b|울트라\s?씽크|ウルトラ\s?シンク/i,
    'Think deeply before answering: lay out the options, check each assumption against the code, and verify before concluding.'),
  K('search', /\bdeepsearch\b|딥\s?서치|ディープ\s?サーチ|\bsearch\s+(the\s+)?(codebase|code|files?|project)\b|\bfind\s+(in\s+)?(the\s+)?(codebase|all\s+files?)\b/i,
    'Search the codebase thoroughly before answering: dispatch the make-it-ship:explorer agent (several in parallel for separate areas) and answer with file:line references.'),
  K('wiki', /\bwiki\s+(this|add|lint|query)\b|위키에\s?(추가|저장)|ウィキに追加/i,
    'Project wiki: use the wiki_add / wiki_query / wiki_lint / wiki_read tools (Make It Ship MCP server) — "wiki this" means capture the current finding as a page.'),
  K('analyze', /\b(deep[\s-]?analy[sz]e)\b|딥\s?분석|ディープ\s?アナライズ/i,
    'Deep analysis: invoke /make-it-ship:debug — reproduce, trace, test one hypothesis at a time, and record the root cause before any fix.'),
];

const SLOP_EXPLICIT = /\b(ai[\s-]?slop|anti[\s-]?slop|de[\s-]?slop)\b/i;
const SLOP_ACTION = /\b(clean(?:\s*up)?|cleanup|refactor|simplify|dedupe|prune)\b/i;
const SLOP_SMELL = /\b(slop|duplicat\w*|dead\s+code|unused\s+code|over[\s-]?abstract\w*|wrapper\s+layers?|needless\s+abstractions?|tech\s+debt)\b/i;
// "ralph" starts a loop only in an unambiguous form (user decision after three rounds of heuristics); any other
// mention becomes a hint the model judges, since names, complaints and "don't use ralph" read the same to a regex.
// Only prefix forms start the loop (user decision after five rounds of regex heuristics); every other mention of
// ralph — "use ralph", "랄프로", names, questions, refusals — is a hint the model judges in context.
const LOOP_PREFIX = [/^\s*\/?ralph\s*:/i, /^\s*\/ralph\b/i, /^\s*ralph\s+mode\s*:/i, /^\s*랄프\s?(?:모드로?\s*(?:진행|해)?)?\s*[:：]/, /^\s*ラルフ\s?(?:モード)?\s*[:：]/];
const explicitLoop = (text) => LOOP_PREFIX.some((r) => r.test(text));
const mentionsRalph = (t) => /\bralph\b|랄프(?!로렌)|ラルフ(?!・?ローレン)/i.test(t);

const HELP_QUERY = /\b(what\s+is|what's|how\s+(do\s+i|to)\s+use|explain|describe|tell\s+me\s+about|why)\b|사용법|뭐야|뭐지|무엇|설명|왜/i;
const DIRECTIVE = /\b(fix|implement|build|add|refactor)\b|해줘|하자|해 줘|부탁|돌려/i;

/** Remove reference content so only the user's own words can trigger a mode. */
export function sanitize(text) {
  return String(text ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '')
    .replace(/<(\w[\w-]*)[\s>][\s\S]*?<\/\1>/g, '')
    .replace(/https?:\/\/[^\s)>\]]+/g, '')
    .replace(/^\s*>.*$/gm, '')
    .replace(/"[^"\n]*"|“[^”\n]*”|「[^」\n]*」/g, '')
    .replace(/^\s*\|(?:[^|\n]*\|){2,}\s*$/gm, '')
    .replace(/(?<=^|[\s"'(])\/?(?:[\w.\-가-힯]+\/)+[\w.\-가-힯]*/gm, '');
}

export function detectKeywords(prompt, { disabled = [] } = {}) {
  const text = sanitize(prompt);
  if (HELP_QUERY.test(text) && /[?？]/.test(text) && !DIRECTIVE.test(text) && !explicitLoop(text)) return [];
  let hits = KEYWORDS.filter((k) => k.name === 'simplify'
    ? SLOP_EXPLICIT.test(text) || (SLOP_ACTION.test(text) && SLOP_SMELL.test(text))
    : k.name === 'loop' ? explicitLoop(text)
    : k.name === 'loop-hint' ? mentionsRalph(text)
    : k.re.test(text));
  hits = hits.filter((k) => !disabled.includes(k.name));
  if (hits.some((k) => k.name === 'cancel')) hits = hits.filter((k) => k.name === 'cancel');
  if (hits.some((k) => k.name === 'loop')) hits = hits.filter((k) => k.name !== 'run' && k.name !== 'loop-hint');
  return hits.map(({ name, context }) => ({ name, context }));
}

/** Natural-language style changes; returns the new level or null. */
export function styleSwitch(prompt) {
  // Only a prompt that is just the phrase (like Ponytail): prose mentioning "normal mode" must not change the style.
  const t = String(prompt ?? '').trim().replace(/^please\s+|\s+please$|[.!]+$/gi, '').trim();
  const m = t.match(/^(?:ponytail|style)\s+(lite|full|ultra|off)$/i);
  if (m) return m[1].toLowerCase();
  if (/^(?:normal\s+mode|stop\s+(?:ponytail|style|mis\s+style)|스타일\s?(?:꺼|끄기|꺼줘|꺼\s?줘))$/i.test(t)) return 'off';
  return null;
}

/** Learned skills whose frontmatter `triggers` appear in the prompt (repo `.make-it-ship/skills`, then home `skills`). */
export function learnedSkills(prompt, repoDir, homeDir) {
  const text = String(prompt ?? '').toLowerCase();
  const found = [];
  for (const base of [repoDir && join(repoDir, '.make-it-ship', 'skills'), homeDir && join(homeDir, 'skills')]) {
    if (!base || !existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      const path = join(base, d, 'SKILL.md');
      try {
        const s = parseSkill(readFileSync(path, 'utf8'));
        if (s?.triggers?.some((t) => text.includes(t))) found.push({ name: s.name || d, description: s.description ?? '', path });
      } catch { /* unreadable skill is skipped */ }
    }
  }
  return found.slice(0, 3);
}

export function promptContext(matches, style, skills) {
  const parts = matches.map((m) => `[MAKE IT SHIP: ${m.name}] ${m.context}`);
  if (style) parts.push(`[MAKE IT SHIP: style] Style level is now ${style}${style === 'off' ? ' (style rules no longer apply)' : ''}.`);
  for (const s of skills) parts.push(`[MAKE IT SHIP: learned skill] ${s.name} — ${s.description}. If it applies, read ${s.path} and follow it.`);
  return parts.join('\n');
}
