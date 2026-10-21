// Plan documents (absorbs Superpowers writing-plans / executing-plans, OMC plan, gstack spec): a Markdown plan that a
// person can read and `mis start --plan` can execute. One parser for `mis plan check` and `mis start --plan`.
//
// ## Goal            one paragraph                       (required)
// ## Constraints / ## Non-goals / ## Risk flags          bullet lists (optional)
// ## Tasks           ### T1: title, then bullets = acceptance criteria;
//                    optional `Files: a, b` and `Depends on: T1` lines   (required, each task needs a bullet)
// ## Acceptance criteria   bullets                       (required)
// ## Verification    bullets with the commands to run    (required)

const SECTIONS = {
  goal: /^(goal|목표)$/i, constraints: /^(constraints|제약)$/i, nonGoals: /^(non-?goals|out of scope|범위 밖)$/i,
  tasks: /^(tasks|작업)$/i, acceptance: /^(acceptance( criteria)?|수용 기준)$/i, verification: /^(verification( commands)?|how to verify|검증)$/i,
  riskFlags: /^(risk flags|위험 신호)$/i,
};
export const REQUIRED_SECTIONS = ['goal', 'tasks', 'acceptance', 'verification'];

const bullets = (lines) => lines.map((l) => l.match(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/)?.[1]).filter(Boolean);
const list = (s) => s.split(',').map((x) => x.trim().replace(/^`|`$/g, '')).filter(Boolean);

export function parsePlanDoc(md) {
  const body = {};
  let cur = null;
  for (const line of String(md).replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { cur = Object.keys(SECTIONS).find((k) => SECTIONS[k].test(h[1])) ?? null; if (cur) body[cur] ??= []; continue; }
    if (cur) body[cur].push(line);
  }
  const tasks = [];
  let t = null;
  for (const line of body.tasks ?? []) {
    const h = line.match(/^###\s+([A-Za-z][\w-]*)\s*[:.)-]\s*(.+?)\s*$/);
    if (h) { t = { id: h[1], title: h[2], acceptance: [] }; tasks.push(t); continue; }
    if (!t) continue;
    const f = line.match(/^\s*files?\s*:\s*(.+)$/i);
    const d = line.match(/^\s*depends on\s*:\s*(.+)$/i);
    if (f) t.files = list(f[1]);
    else if (d) t.dependsOn = list(d[1]);
    else t.acceptance.push(...bullets([line]));
  }
  const missing = REQUIRED_SECTIONS.filter((k) => !(k === 'goal' ? (body.goal ?? []).join(' ').trim() : k === 'tasks' ? tasks.length : bullets(body[k] ?? []).length));
  for (const x of tasks) if (!x.acceptance.length) missing.push(`acceptance criteria of task ${x.id}`);
  const plan = {
    goal: (body.goal ?? []).map((l) => l.trim()).filter(Boolean).join(' '),
    ...(bullets(body.constraints ?? []).length ? { constraints: bullets(body.constraints) } : {}),
    ...(bullets(body.nonGoals ?? []).length ? { nonGoals: bullets(body.nonGoals) } : {}),
    acceptance: bullets(body.acceptance ?? []),
    tasks,
    howToRun: bullets(body.verification ?? []).map((c) => c.replace(/^`(.+)`$/, '$1')),
    ...(bullets(body.riskFlags ?? []).length ? { riskFlags: bullets(body.riskFlags).map((x) => x.toLowerCase()) } : {}),
  };
  return { plan, missing };
}
