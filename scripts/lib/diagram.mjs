// mermaid → .svg (+ .excalidraw for flowcharts) (absorbs gstack diagram). renderDiagram(src) dispatches on the header line and draws a
// documented subset of each kind; anything else throws `cannot parse: <line>` so the picture never differs from GitHub's render:
// - flowchart|graph TD|LR: nodes `A[t]` `A(t)` `A{t}` `A((t))`, edges `-->` `---` `-.->` `==>` with `|label|`, one level of `subgraph id [title]` … `end`
// - sequenceDiagram: participant/actor [as alias], `->>` `-->>` `->` `-->` `-x` `--x` with `: text`, Note left of|right of|over A[,B], loop/alt/else/opt/end, autonumber
// - classDiagram: `class X { members }`, `X : member`, `<|--` `*--` `o--` `-->` `..>` `..|>` `--` `..` with "cardinality" and `: label`
// - erDiagram: `ENTITY { type name [PK|FK|UK] ["comment"] }`, `A ||--o{ B : label` (symbol cardinalities)
// - stateDiagram-v2: `[*] --> A`, `A --> B : label`, `state "desc" as A`, `A : desc`
// shortcut: no nested subgraphs, composite states, notes outside sequence diagrams, pie/xychart (mis chart) or other kinds; render those with a mermaid tool when needed.

const NODE = /([A-Za-z_][\w-]*)\s*(?:\[\[?([^\]]*)\]?\]|\(\(?([^)]*)\)?\)|\{([^}]*)\})?/y;
const EDGE = /\s*(-->|---|-\.->|==>|--)\s*(?:\|([^|]*)\|\s*)?/y;
// shortcut: classDef/class/style/linkStyle are accepted and ignored (shapes and edges match GitHub, colors do not); honour them when someone needs the colors.
const STYLING = /^(classDef|class|style|linkStyle)\s/;
const cannot = (line) => new Error(`cannot parse: ${line}`);
const clean = (src) => String(src).split('\n').map((l) => l.replace(/%%.*$/, '').trim()).filter(Boolean);

export function parseMermaid(src) {
  const lines = clean(src);
  const head = lines.shift() ?? '';
  const m = head.match(/^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/i);
  if (!m) throw new Error('diagram must start with "flowchart TD|LR" (or "graph TD|LR")');
  const nodes = new Map(), edges = [], groups = [], seen = new Map();
  let group = null;
  const node = (id, label, line) => {
    const n = nodes.get(id) ?? nodes.set(id, { id, label: id }).get(id);
    if (label) n.label = label.trim() || id;
    if (!seen.has(id)) seen.set(id, line);
    if (group && n.group !== group.id) {
      if (n.group) throw cannot(line); // a node in two subgraphs: GitHub moves it, we would not
      n.group = group.id; group.nodes.push(id);
    }
  };
  for (const line of lines) {
    const sg = line.match(/^subgraph\s+([A-Za-z_][\w-]*)\s*(?:\[\s*"?([^\]"]*)"?\s*\])?$/);
    if (sg) {
      if (group) throw cannot(line); // nested subgraphs are not drawn
      groups.push(group = { id: sg[1], title: sg[2]?.trim() || sg[1], nodes: [], line });
      continue;
    }
    if (line === 'end') { if (!group?.nodes.length) throw cannot(line); group = null; continue; }
    if (STYLING.test(line)) continue;
    let pos = 0, prev = null, label = null;
    for (;;) {
      NODE.lastIndex = pos;
      const n = NODE.exec(line);
      if (!n) throw cannot(line);
      const id = n[1];
      node(id, n[2] ?? n[3] ?? n[4], line);
      if (prev) edges.push({ from: prev, to: id, label });
      pos = NODE.lastIndex;
      EDGE.lastIndex = pos;
      const e = EDGE.exec(line);
      if (!e) break;
      prev = id; label = e[2]?.trim() || null; pos = EDGE.lastIndex;
    }
    if (line.slice(pos).trim().replace(/;$/, '')) throw cannot(line);
  }
  if (group) throw cannot(group.line);
  for (const s of groups) if (seen.has(s.id)) throw cannot(seen.get(s.id)); // edges to a subgraph id would draw a stray box
  return { direction: m[1].toUpperCase(), nodes: [...nodes.values()], edges, groups: groups.map(({ id, title, nodes: ids }) => ({ id, title, nodes: ids })) };
}

function parseSequence(lines) {
  const parts = new Map(), edges = [], rows = [], open = [];
  let auto = false;
  const who = (id) => (parts.has(id) || parts.set(id, { id, label: id, actor: false }), id);
  const touch = (...ids) => { for (const b of open) for (const id of ids) b.cols.add(id); };
  for (const line of lines) {
    let m;
    if (line === 'autonumber') auto = true;
    else if ((m = line.match(/^(participant|actor)\s+([A-Za-z_]\w*)(?:\s+as\s+(.+))?$/))) Object.assign(parts.get(who(m[2])), { label: m[3]?.trim() ?? m[2], actor: m[1] === 'actor' });
    else if ((m = line.match(/^([A-Za-z_]\w*)\s*(-->>|->>|--x|-x|-->|->)\s*([A-Za-z_]\w*)\s*:(.*)$/))) {
      const msg = { from: who(m[1]), to: who(m[3]), arrow: m[2], text: m[4].trim() };
      edges.push(msg); rows.push({ type: 'msg', msg, n: edges.length }); touch(msg.from, msg.to);
    } else if ((m = line.match(/^note\s+(left of|right of|over)\s+([A-Za-z_]\w*)(?:\s*,\s*([A-Za-z_]\w*))?\s*:(.*)$/i))) {
      if (m[3] && m[1].toLowerCase() !== 'over') throw cannot(line);
      const ids = [who(m[2]), ...(m[3] ? [who(m[3])] : [])];
      rows.push({ type: 'note', side: m[1].toLowerCase(), ids, text: m[4].trim() }); touch(...ids);
    } else if ((m = line.match(/^(loop|alt|opt)\b\s*(.*)$/))) { const b = { type: 'open', kind: m[1], text: m[2].trim(), cols: new Set(), elses: [] }; open.push(b); rows.push(b); }
    else if ((m = line.match(/^else\b\s*(.*)$/))) { const b = open.at(-1); if (b?.kind !== 'alt') throw cannot(line); const r = { type: 'else', text: m[1].trim() }; b.elses.push(r); rows.push(r); }
    else if (line === 'end') { const b = open.pop(); if (!b) throw cannot(line); rows.push({ type: 'close', block: b }); }
    else throw cannot(line);
  }
  if (open.length) throw cannot(`${open.at(-1).kind} ${open.at(-1).text} (no end)`);
  return { nodes: [...parts.values()], edges, rows, auto };
}

function parseClass(lines) {
  const nodes = new Map(), edges = [];
  const cls = (id) => nodes.get(id) ?? nodes.set(id, { id, title: id, sections: [[], []] }).get(id);
  const member = (id, text) => cls(id).sections[text.includes('(') ? 1 : 0].push(text); // mermaid: `()` marks a method
  const MARK = { '<|--': ['tri', null], '*--': ['diamond', null], 'o--': ['odiamond', null], '-->': [null, 'open'], '--': [null, null], '..>': [null, 'open'], '..|>': [null, 'tri'], '..': [null, null] };
  let body = null;
  for (const line of lines) {
    let m;
    if (body) { if (line === '}') body = null; else if (line.startsWith('<<')) throw cannot(line); else member(body, line); continue; }
    if ((m = line.match(/^([A-Za-z_]\w*)\s*(?:"([^"]*)"\s*)?(<\|--|\*--|o--|-->|--|\.\.\|>|\.\.>|\.\.)\s*(?:"([^"]*)"\s*)?([A-Za-z_]\w*)\s*(?::\s*(.+))?$/))) {
      const [start, end] = MARK[m[3]];
      edges.push({ from: cls(m[1]).id, to: cls(m[5]).id, rel: m[3], label: m[6]?.trim() || null, fromLabel: m[2] ?? null, toLabel: m[4] ?? null, dashed: m[3].startsWith('..'), start, end });
    } else if ((m = line.match(/^class\s+([A-Za-z_]\w*)\s*(\{)?$/))) { cls(m[1]); if (m[2]) body = m[1]; }
    else if ((m = line.match(/^([A-Za-z_]\w*)\s*:\s*(.+)$/))) member(m[1], m[2].trim());
    else throw cannot(line);
  }
  if (body) throw cannot(`class ${body} { (no closing })`);
  return { direction: 'TD', nodes: [...nodes.values()], edges };
}

// shortcut: only the symbol cardinalities (`|o` `||` `}o` `}|` …), drawn as text (0..1, 1, 0..*, 1..*) instead of crow's feet; add glyphs if readers ask.
const CARD = { '|o': '0..1', 'o|': '0..1', '||': '1', '}o': '0..*', 'o{': '0..*', '}|': '1..*', '|{': '1..*' };
function parseEr(lines) {
  const nodes = new Map(), edges = [];
  const ent = (id) => nodes.get(id) ?? nodes.set(id, { id, title: id, sections: [] }).get(id);
  let body = null;
  for (const line of lines) {
    let m;
    if (body) {
      if (line === '}') body = null;
      else if (/^[A-Za-z][\w()[\]-]*\??\s+\*?[A-Za-z_][\w-]*(\s+(PK|FK|UK)(\s*,\s*(PK|FK|UK))*)?(\s+"[^"]*")?$/.test(line)) (body.sections[0] ??= []).push(line);
      else throw cannot(line);
      continue;
    }
    if ((m = line.match(/^([A-Za-z_][\w-]*)\s*(\|o|\|\||\}o|\}\|)(--|\.\.)(o\||\|\||o\{|\|\{)\s*([A-Za-z_][\w-]*)\s*:\s*(?:"([^"]*)"|([\w-]+))$/)))
      edges.push({ from: ent(m[1]).id, to: ent(m[5]).id, fromLabel: CARD[m[2]], toLabel: CARD[m[4]], label: m[6] ?? m[7], dashed: m[3] === '..', start: null, end: null });
    else if ((m = line.match(/^([A-Za-z_][\w-]*)\s*(\{)?$/))) { const e = ent(m[1]); if (m[2]) body = e; }
    else throw cannot(line);
  }
  if (body) throw cannot(`${body.id} { (no closing })`);
  return { direction: 'TD', nodes: [...nodes.values()], edges };
}

function parseState(lines) {
  const nodes = new Map(), edges = [];
  const st = (id, side) => {
    const key = id === '[*]' ? `[*]${side}` : id; // GitHub draws the start and the end [*] as two different nodes
    return (nodes.get(key) ?? nodes.set(key, id === '[*]' ? { id: key, label: '', shape: side } : { id, label: id }).get(key)).id;
  };
  for (const line of lines) {
    let m;
    if ((m = line.match(/^(\w+|\[\*\])\s*-->\s*(\w+|\[\*\])\s*(?::\s*(.+))?$/))) edges.push({ from: st(m[1], 'start'), to: st(m[2], 'end'), label: m[3]?.trim() || null });
    else if ((m = line.match(/^state\s+"([^"]*)"\s+as\s+(\w+)$/))) nodes.get(st(m[2])).label = m[1];
    else if ((m = line.match(/^(\w+)\s*:\s*(.+)$/))) nodes.get(st(m[1])).label = m[2].trim();
    else throw cannot(line);
  }
  return { direction: 'TD', nodes: [...nodes.values()], edges };
}

const PARSE = { sequenceDiagram: ['sequence', parseSequence], classDiagram: ['class', parseClass], erDiagram: ['er', parseEr], 'stateDiagram-v2': ['state', parseState] };

/** One entry for every kind: { kind, svg, excalidraw (flowchart only, else null), nodes, edges, … }. */
export function renderDiagram(src) {
  const lines = clean(src), head = lines[0] ?? '';
  if (/^(flowchart|graph)\b/i.test(head)) { const g = parseMermaid(src); return { kind: 'flowchart', ...g, svg: toSvg(g), excalidraw: toExcalidraw(g) }; }
  if (!PARSE[head]) throw new Error(`unsupported diagram type: ${head} (supported: flowchart, sequenceDiagram, classDiagram, erDiagram, stateDiagram-v2)`);
  const [kind, parse] = PARSE[head], g = parse(lines.slice(1));
  // shortcut: .excalidraw only for flowcharts; add per-kind elements when someone edits the other kinds in Excalidraw.
  return { kind, ...g, svg: kind === 'sequence' ? sequenceSvg(g) : toSvg(g), excalidraw: null };
}

/** Longest-path layering from roots; each layer is a row (TD) or column (LR). Each subgraph gets its own band of slots so its frame encloses only its nodes. */
export function layout(g, W = 180, H = 60) {
  const level = new Map(g.nodes.map((n) => [n.id, 0]));
  for (let i = 0; i < g.nodes.length; i++) for (const e of g.edges) if (e.from !== e.to) level.set(e.to, Math.max(level.get(e.to), Math.min(level.get(e.from) + 1, g.nodes.length)));
  const GX = 60, GY = 70, horizontal = g.direction === 'LR' || g.direction === 'RL', top = g.groups?.length ? 40 : 0; // room for frame titles
  const slot = {}, used = {}, width = {}, offset = {};
  for (const n of g.nodes) { const b = n.group ?? '', k = `${b}|${level.get(n.id)}`; slot[n.id] = used[k] = (used[k] ?? -1) + 1; width[b] = Math.max(width[b] ?? 0, slot[n.id] + 1); }
  let acc = 0;
  for (const b of Object.keys(width)) { offset[b] = acc; acc += width[b]; }
  const pos = {};
  for (const n of g.nodes) {
    const lv = level.get(n.id), i = offset[n.group ?? ''] + slot[n.id];
    pos[n.id] = horizontal ? { x: 20 + lv * (W + GX), y: 20 + top + i * (H + GY) } : { x: 20 + i * (W + GX), y: 20 + top + lv * (H + GY) };
  }
  const frames = (g.groups ?? []).map((s) => {
    const ps = s.nodes.map((id) => pos[id]), x = Math.min(...ps.map((p) => p.x)) - 15, y = Math.min(...ps.map((p) => p.y)) - 30;
    return { id: s.id, title: s.title, x, y, w: Math.max(...ps.map((p) => p.x)) + W + 15 - x, h: Math.max(...ps.map((p) => p.y)) + H + 12 - y };
  });
  return { pos, W, H, frames };
}

const base = (id, type, x, y, w, h, extra = {}) => ({ id, type, x, y, width: w, height: h, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent',
  fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], roundness: null, seed: 1, version: 1,
  versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, ...extra });

export function toExcalidraw(g) {
  const { pos, W, H, frames } = layout(g);
  const elements = frames.map((f) => base(`frame-${f.id}`, 'frame', f.x, f.y, f.w, f.h, { name: f.title }));
  for (const n of g.nodes) {
    const { x, y } = pos[n.id];
    elements.push(base(`box-${n.id}`, 'rectangle', x, y, W, H, { boundElements: [{ type: 'text', id: `text-${n.id}` }] }));
    elements.push(base(`text-${n.id}`, 'text', x + 10, y + H / 2 - 12, W - 20, 24, { text: n.label, originalText: n.label, fontSize: 18, fontFamily: 1,
      textAlign: 'center', verticalAlign: 'middle', containerId: `box-${n.id}`, lineHeight: 1.25 }));
  }
  g.edges.forEach((e, i) => {
    const a = pos[e.from], b = pos[e.to];
    const sx = a.x + W / 2, sy = a.y + H / 2, dx = b.x + W / 2 - sx, dy = b.y + H / 2 - sy;
    elements.push(base(`edge-${i}`, 'arrow', sx, sy, Math.abs(dx), Math.abs(dy), { points: [[0, 0], [dx, dy]], startBinding: { elementId: `box-${e.from}`, focus: 0, gap: 4 },
      endBinding: { elementId: `box-${e.to}`, focus: 0, gap: 4 }, startArrowhead: null, endArrowhead: 'arrow', ...(e.label ? { label: { text: e.label } } : {}) }));
  });
  return { type: 'excalidraw', version: 2, source: 'make-it-ship', elements, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {} };
}

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Colors only through classes so the dark-mode media query reaches every mark.
const STYLE = `.bg{fill:#fff}.node{fill:#f4f6fb;stroke:#1e1e1e;stroke-width:2}.edge{stroke:#1e1e1e;stroke-width:2;fill:none}.dashed{stroke-dasharray:6 4}
.life{stroke:#999;stroke-width:1;stroke-dasharray:4 4}.solid{fill:#1e1e1e}.hollow{fill:#fff;stroke:#1e1e1e;stroke-width:1.5}.frame{fill:#8882;stroke:#888;stroke-width:1.5}
.note{fill:#fff5c4;stroke:#aa9;stroke-width:1}text{fill:#1e1e1e;font-size:15px}.label{fill:#444;font-size:13px}.title{font-weight:600}
@media (prefers-color-scheme: dark){.bg{fill:#1e1e1e}.node{fill:#2a2f3a;stroke:#ddd}.edge{stroke:#ddd}.solid{fill:#ddd}.hollow{fill:#1e1e1e;stroke:#ddd}
.note{fill:#4a4630;stroke:#887}text{fill:#eee}.label{fill:#bbb}}`;
const mk = (id, d, cls) => `<marker id="${id}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="${d}" class="${cls}"/></marker>`;
const DEFS = `<defs>${mk('arrow', 'M0,0 L10,5 L0,10 z', 'solid')}${mk('open', 'M0,0 L10,5 L0,10', 'edge')}${mk('tri', 'M0,0 L10,5 L0,10 z', 'hollow')}${
  mk('diamond', 'M0,5 L5,1 L10,5 L5,9 z', 'solid')}${mk('odiamond', 'M0,5 L5,1 L10,5 L5,9 z', 'hollow')}${mk('cross', 'M0,0 L10,10 M0,10 L10,0', 'edge')}</defs>`;
const svgDoc = (w, h, body) => [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="system-ui, sans-serif">`,
  `<style>${STYLE}</style>`, DEFS, '<rect width="100%" height="100%" class="bg"/>', ...body, '</svg>'].join('\n');
const marks = (e) => `${e.start ? ` marker-start="url(#${e.start})"` : ''}${(e.end === undefined ? 'arrow' : e.end) ? ` marker-end="url(#${e.end ?? 'arrow'})"` : ''}`;
const text = (x, y, s, cls = '', anchor = 'middle') => `<text x="${x}" y="${y}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}${cls ? ` class="${cls}"` : ''}>${esc(s)}</text>`;

/** Box-and-edge kinds (flowchart, class, ER, state) share the layered layout; `sections` are member compartments under a title. */
export function toSvg(g) {
  const rowsOf = (n) => [n.label ?? n.title ?? '', ...(n.sections ?? []).flat()];
  const W = Math.max(180, ...g.nodes.flatMap(rowsOf).map((s) => s.length * 8 + 30));
  const H = Math.max(60, ...g.nodes.filter((n) => n.sections?.length).map((n) => 34 + n.sections.flat().length * 18 + n.sections.length * 6));
  const { pos, frames } = layout(g, W, H), byId = new Map(g.nodes.map((n) => [n.id, n]));
  const maxX = Math.max(...Object.values(pos).map((p) => p.x)) + W + 20, maxY = Math.max(...Object.values(pos).map((p) => p.y)) + H + 20;
  const half = (id) => (byId.get(id).shape ? [12, 12] : [W / 2, H / 2]);
  const parts = frames.flatMap((f) => [`<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="6" class="frame"/>`, text(f.x + 8, f.y + 18, f.title, 'label title', 'start')]);
  for (const e of g.edges) {
    const a = pos[e.from], b = pos[e.to], [x1, y1, x2, y2] = [a.x + W / 2, a.y + H / 2, b.x + W / 2, b.y + H / 2], cls = `edge${e.dashed ? ' dashed' : ''}`;
    if (e.from === e.to) { // self loop on the right side
      const r = a.x + W;
      parts.push(`<path d="M${r},${y1 - 10} C${r + 45},${y1 - 35} ${r + 45},${y1 + 35} ${r},${y1 + 10}" class="${cls}"${marks(e)}/>`);
      if (e.label) parts.push(text(r + 40, y1 + 4, e.label, 'label', 'start'));
      continue;
    }
    // end at the box border: shorten by the half-size along the dominant axis
    const hz = Math.abs(x2 - x1) > Math.abs(y2 - y1), cut = (x, y, ox, oy, [hw, hh]) => (hz ? [x + Math.sign(ox - x) * hw, y] : [x, y + Math.sign(oy - y) * hh]);
    const [sx, sy] = cut(x1, y1, x2, y2, half(e.from)), [ex, ey] = cut(x2, y2, x1, y1, half(e.to));
    parts.push(`<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" class="${cls}"${marks(e)}/>`);
    if (e.label) parts.push(text((sx + ex) / 2 + 6, (sy + ey) / 2, e.label, 'label', 'start'));
    if (e.fromLabel) parts.push(text(sx + (ex - sx) * 0.15 + 8, sy + (ey - sy) * 0.15 + 4, e.fromLabel, 'label', 'start'));
    if (e.toLabel) parts.push(text(sx + (ex - sx) * 0.85 + 8, sy + (ey - sy) * 0.85 + 4, e.toLabel, 'label', 'start'));
  }
  for (const n of g.nodes) {
    const { x, y } = pos[n.id], cx = x + W / 2, cy = y + H / 2;
    if (n.shape === 'start') { parts.push(`<circle cx="${cx}" cy="${cy}" r="10" class="solid"/>`); continue; }
    if (n.shape === 'end') { parts.push(`<circle cx="${cx}" cy="${cy}" r="12" class="node"/>`, `<circle cx="${cx}" cy="${cy}" r="6" class="solid"/>`); continue; }
    parts.push(`<rect x="${x}" y="${y}" width="${W}" height="${H}" rx="8" class="node"/>`);
    if (!n.sections?.length) { parts.push(text(cx, cy + 5, n.label ?? n.title)); continue; }
    parts.push(text(cx, y + 21, n.title, 'title'));
    let ty = y + 30;
    for (const sec of n.sections) {
      parts.push(`<line x1="${x}" y1="${ty}" x2="${x + W}" y2="${ty}" class="edge"/>`);
      sec.forEach((row, i) => parts.push(text(x + 10, ty + 17 + i * 18, row, 'label', 'start')));
      ty += sec.length * 18 + 6;
    }
  }
  return svgDoc(maxX, maxY, parts);
}

// shortcut: sequence frames span the participants they touch; no activation bars and no participant boxes repeated at the bottom (GitHub repeats them).
function sequenceSvg(g) {
  const cols = new Map(g.nodes.map((p, i) => [p.id, i]));
  const C = Math.max(160, ...g.nodes.map((p) => p.label.length * 8 + 30), ...g.edges.map((m) => m.text.length * 7 + 50));
  const cx = (id) => 20 + cols.get(id) * C + C / 2, back = [], front = [];
  let depth = 0, y = 110;
  for (const r of g.rows) if (r.type === 'open') r.depth = depth++; else if (r.type === 'close') depth--; // nesting insets frames
  for (const r of g.rows) {
    if (r.type === 'msg') {
      const { from, to, arrow, text: t } = r.msg, cls = `edge${arrow.startsWith('--') ? ' dashed' : ''}`;
      const m = { end: arrow.endsWith('>>') ? 'arrow' : arrow.endsWith('x') ? 'cross' : null }, label = g.auto ? `${r.n}. ${t}` : t;
      if (from === to) {
        front.push(`<path d="M${cx(from)},${y - 6} h40 v18 h-40" class="${cls}"${marks(m)}/>`, text(cx(from) + 46, y + 6, label, 'label', 'start'));
        y += 18;
      } else front.push(text((cx(from) + cx(to)) / 2, y - 6, label, 'label'), `<line x1="${cx(from)}" y1="${y}" x2="${cx(to)}" y2="${y}" class="${cls}"${marks(m)}/>`);
      r.y = y; y += 40;
    } else if (r.type === 'note') {
      const xs = r.ids.map(cx), w = C * 0.42;
      const [l, rr] = r.side === 'left of' ? [xs[0] - C * 0.9, xs[0] - 10] : r.side === 'right of' ? [xs[0] + 10, xs[0] + C * 0.9] : [Math.min(...xs) - w, Math.max(...xs) + w];
      front.push(`<rect x="${l}" y="${y - 18}" width="${rr - l}" height="28" class="note"/>`, text((l + rr) / 2, y + 1, r.text, 'label'));
      y += 40;
    } else if (r.type === 'open' || r.type === 'else') { r.y = y - 12; y += 34; }
    else {
      const b = r.block, ids = [...b.cols], xs = ids.length ? ids.map(cx) : [cx(g.nodes[0]?.id ?? '')], depth = 6 * (b.depth ?? 0);
      const x = Math.min(...xs) - C / 2 + 6 + depth, w = Math.max(...xs) - Math.min(...xs) + C - 12 - 2 * depth, top = b.y;
      back.push(`<rect x="${x}" y="${top}" width="${w}" height="${y - 12 - top}" class="frame"/>`, text(x + 6, top + 16, `${b.kind}${b.text ? ` [${b.text}]` : ''}`, 'label title', 'start'));
      for (const e of b.elses) back.push(`<line x1="${x}" y1="${e.y}" x2="${x + w}" y2="${e.y}" class="edge dashed"/>`, text(x + 6, e.y + 16, `[${e.text}]`, 'label', 'start'));
      y += 10;
    }
  }
  return svgDoc(20 + g.nodes.length * C + 20, y + 10, [
    ...g.nodes.flatMap((p) => {
      const x = cx(p.id);
      const head = p.actor
        ? [`<circle cx="${x}" cy="28" r="8" class="node"/>`, `<path d="M${x},36 v14 M${x - 12},42 h24 M${x},50 l-10,12 M${x},50 l10,12" class="edge"/>`, text(x, 80, p.label, 'title')]
        : [`<rect x="${x - C / 2 + 10}" y="20" width="${C - 20}" height="44" rx="6" class="node"/>`, text(x, 47, p.label, 'title')];
      return [`<line x1="${x}" y1="${p.actor ? 86 : 64}" x2="${x}" y2="${y}" class="life"/>`, ...head];
    }), ...back, ...front]);
}
