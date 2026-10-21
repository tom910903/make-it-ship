// mermaid flowchart → .excalidraw + .svg (absorbs gstack diagram). Supports the flowchart subset architects use:
// `flowchart TD|LR` / `graph TD|LR`, nodes `A[text]` `A(text)` `A{text}` `A((text))`, edges `-->` `---` `-.->` `==>` with `|label|`.
// shortcut: no subgraphs, classes or other diagram types; render those with a mermaid tool when needed.

const NODE = /([A-Za-z_][\w-]*)\s*(?:\[\[?([^\]]*)\]?\]|\(\(?([^)]*)\)?\)|\{([^}]*)\})?/y;
const EDGE = /\s*(-->|---|-\.->|==>|--)\s*(?:\|([^|]*)\|\s*)?/y;

export function parseMermaid(src) {
  const lines = String(src).split('\n').map((l) => l.replace(/%%.*$/, '').trim()).filter(Boolean);
  const head = lines.shift() ?? '';
  const m = head.match(/^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/i);
  if (!m) throw new Error('diagram must start with "flowchart TD|LR" (or "graph TD|LR")');
  const nodes = new Map(), edges = [];
  const node = (id, label) => { if (!nodes.has(id) || label) nodes.set(id, { id, label: (label ?? nodes.get(id)?.label ?? id).trim() || id }); };
  for (const line of lines) {
    let pos = 0, prev = null, label = null;
    for (;;) {
      NODE.lastIndex = pos;
      const n = NODE.exec(line);
      if (!n) throw new Error(`cannot parse: ${line}`);
      const id = n[1];
      node(id, n[2] ?? n[3] ?? n[4]);
      if (prev) edges.push({ from: prev, to: id, label });
      pos = NODE.lastIndex;
      EDGE.lastIndex = pos;
      const e = EDGE.exec(line);
      if (!e) break;
      prev = id; label = e[2]?.trim() || null; pos = EDGE.lastIndex;
    }
    if (line.slice(pos).trim().replace(/;$/, '')) throw new Error(`cannot parse: ${line}`);
  }
  return { direction: m[1].toUpperCase(), nodes: [...nodes.values()], edges };
}

/** Longest-path layering from roots; each layer is a row (TD) or column (LR). */
export function layout(g) {
  const level = new Map(g.nodes.map((n) => [n.id, 0]));
  for (let i = 0; i < g.nodes.length; i++) for (const e of g.edges) if (e.from !== e.to) level.set(e.to, Math.max(level.get(e.to), Math.min(level.get(e.from) + 1, g.nodes.length)));
  const rows = {};
  for (const n of g.nodes) (rows[level.get(n.id)] ??= []).push(n.id);
  const W = 180, H = 60, GX = 60, GY = 70, horizontal = g.direction === 'LR' || g.direction === 'RL';
  const pos = {};
  for (const [lv, ids] of Object.entries(rows)) ids.forEach((id, i) => {
    pos[id] = horizontal ? { x: 20 + Number(lv) * (W + GX), y: 20 + i * (H + GY) } : { x: 20 + i * (W + GX), y: 20 + Number(lv) * (H + GY) };
  });
  return { pos, W, H };
}

const base = (id, type, x, y, w, h, extra = {}) => ({ id, type, x, y, width: w, height: h, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent',
  fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], roundness: null, seed: 1, version: 1,
  versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, ...extra });

export function toExcalidraw(g) {
  const { pos, W, H } = layout(g);
  const elements = [];
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

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function toSvg(g) {
  const { pos, W, H } = layout(g);
  const maxX = Math.max(...Object.values(pos).map((p) => p.x)) + W + 20, maxY = Math.max(...Object.values(pos).map((p) => p.y)) + H + 20;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${maxX}" height="${maxY}" viewBox="0 0 ${maxX} ${maxY}" font-family="system-ui, sans-serif">`,
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#1e1e1e"/></marker></defs>',
    '<rect width="100%" height="100%" fill="#ffffff"/>'];
  for (const e of g.edges) {
    const a = pos[e.from], b = pos[e.to];
    const [x1, y1, x2, y2] = [a.x + W / 2, a.y + H / 2, b.x + W / 2, b.y + H / 2];
    // end at the box border: shorten by the half-size along the dominant axis
    const ex = Math.abs(x2 - x1) > Math.abs(y2 - y1) ? x2 - Math.sign(x2 - x1) * W / 2 : x2, ey = Math.abs(x2 - x1) > Math.abs(y2 - y1) ? y2 : y2 - Math.sign(y2 - y1) * H / 2;
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="#1e1e1e" stroke-width="2" marker-end="url(#arrow)"/>`);
    if (e.label) parts.push(`<text x="${(x1 + ex) / 2 + 6}" y="${(y1 + ey) / 2}" font-size="13" fill="#444">${esc(e.label)}</text>`);
  }
  for (const n of g.nodes) {
    const { x, y } = pos[n.id];
    parts.push(`<rect x="${x}" y="${y}" width="${W}" height="${H}" rx="8" fill="#f4f6fb" stroke="#1e1e1e" stroke-width="2"/>`,
      `<text x="${x + W / 2}" y="${y + H / 2 + 5}" text-anchor="middle" font-size="15">${esc(n.label)}</text>`);
  }
  parts.push('</svg>');
  return parts.join('\n');
}
