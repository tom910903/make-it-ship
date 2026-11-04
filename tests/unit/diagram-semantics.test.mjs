// Mermaid semantics the diagram renderer must match (checked against the mermaid-js flowchart/state/class docs): what GitHub draws, or `cannot parse`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMermaid, renderDiagram, layout } from '../../scripts/lib/diagram.mjs';

const edges = (g) => g.edges.map((e) => [e.from, e.to, e.label]);

test('flowchart: text on links (-- text -->, -. text .->, == text ==>), no spaces around arrows, quoted labels', () => {
  const g = parseMermaid('flowchart TD\n  A -- yes --> B\n  A-->C\n  C---D\n  D-. maybe .->E\n  E == sure ==> F\n  F-- open ---G\n  G-->|"quoted"|H["Quoted [x]"]\n  H --> my-node["/api/users"]');
  assert.equal(g.nodes.at(-1).label, '/api/users', 'a quoted label may start with a slash');
  assert.deepEqual(g.nodes.map((n) => n.id), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'my-node']);
  assert.deepEqual(edges(g), [['A', 'B', 'yes'], ['A', 'C', null], ['C', 'D', null], ['D', 'E', 'maybe'], ['E', 'F', 'sure'], ['F', 'G', 'open'], ['G', 'H', 'quoted'], ['H', 'my-node', null]]);
  assert.deepEqual(g.edges.map((e) => [e.end, e.dashed, e.thick]).slice(2, 6), [[null, undefined, undefined], [undefined, true, undefined], [undefined, undefined, true], [null, undefined, undefined]]);
  assert.equal(g.nodes.find((n) => n.id === 'H').label, 'Quoted [x]');
});

test('flowchart: shapes keep clean labels and draw their outline; <br> breaks lines; #entity; codes decode', () => {
  const g = renderDiagram('flowchart LR\n  A([Stadium]) --> B[(DB)]\n  B --> C[[sub]]\n  C --> D{decision}\n  D --> E((circle))\n  E --> F(round)\n  F --> G{{hex}}\n  G --> H["say #quot;hi#quot; #35;1<br>next<br/>last"]');
  assert.deepEqual(g.nodes.map((n) => [n.id, n.label, n.shape]), [['A', 'Stadium', 'stadium'], ['B', 'DB', 'cylinder'], ['C', 'sub', 'subroutine'], ['D', 'decision', 'diamond'],
    ['E', 'circle', 'circle'], ['F', 'round', 'round'], ['G', 'hex', 'hexagon'], ['H', 'say "hi" #1\nnext\nlast', 'rect']]);
  for (const [, t] of g.svg.matchAll(/<(?:text|tspan)[^>]*>([^<]+)</g)) assert.doesNotMatch(t, /[()[\]{}]/, 'no bracket garbage in any text');
  assert.match(g.svg, /<polygon[^>]*class="node"/, 'diamond / hexagon');
  assert.match(g.svg, /<ellipse[^>]*class="node"/, 'circle');
  assert.match(g.svg, /<tspan[^>]*>say &quot;hi&quot; #1<\/tspan><tspan[^>]*>next<\/tspan><tspan[^>]*>last<\/tspan>/);
  for (const bad of ['A>flag]', 'A[/lean/]', 'A(((x)))', 'A --> B & C', 'A ---> B', 'A -- B', 'A["`md`"]'])
    assert.throws(() => renderDiagram(`flowchart TD\n${bad}`), /cannot parse/, bad);
});

test('flowchart: RL and BT mirror LR and TD', () => {
  const pos = (dir) => layout(parseMermaid(`flowchart ${dir}\n  A --> B`)).pos;
  const [lr, rl, td, bt] = ['LR', 'RL', 'TD', 'BT'].map(pos);
  assert.ok(lr.A.x < lr.B.x && rl.A.x > rl.B.x, 'RL: the edge runs right to left');
  assert.ok(td.A.y < td.B.y && bt.A.y > bt.B.y, 'BT: the edge runs bottom to top');
  assert.equal(rl.A.y, rl.B.y);
});

test('layered layout is cycle safe: a cycle takes one layer per state, opposite edges and their labels do not overlap', () => {
  const g = renderDiagram('stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy : start\n  Busy --> Idle : done\n  Busy --> [*]');
  const { pos, H } = layout(g);
  assert.equal(pos.Busy.y - pos.Idle.y, H + 70, 'Busy one layer below Idle, no gap from the back edge');
  assert.ok(pos['[*]end'].y - pos.Busy.y === H + 70);
  // the horizontal extent of a label from its anchor (7px a character, as the renderer measures)
  const span = (t) => {
    const [, x, a] = g.svg.match(new RegExp(`<text x="([\\d.]+)" y="[\\d.]+"(?: text-anchor="(\\w+)")?[^>]*>${t}<`)), w = t.length * 7;
    return a === 'end' ? [Number(x) - w, Number(x)] : a === 'middle' ? [Number(x) - w / 2, Number(x) + w / 2] : [Number(x), Number(x) + w];
  };
  const [s, d] = [span('start'), span('done')];
  assert.ok(s[1] <= d[0] || d[1] <= s[0], `labels apart: start ${s}, done ${d}`);
  const xs = (from, to) => g.svg.match(new RegExp(`<line x1="([\\d.]+)" y1="${pos[from].y + H}" x2="([\\d.]+)" y2="${pos[to].y}"|<line x1="([\\d.]+)" y1="${pos[from].y}" x2="([\\d.]+)" y2="${pos[to].y + H}"`)).filter(Boolean)[1];
  assert.notEqual(xs('Idle', 'Busy'), xs('Busy', 'Idle'), 'opposite edges are not drawn on top of each other');
  const flow = layout(parseMermaid('flowchart TD\n  A --> B\n  B --> C\n  C --> A'));
  assert.deepEqual(['A', 'B', 'C'].map((k) => flow.pos[k].y), [20, 20 + 130, 20 + 260]);
});

test('stateDiagram: repeated descriptions are all shown', () => {
  const g = renderDiagram('stateDiagram-v2\n  A : first\n  A : second\n  B : only\n  A --> B');
  const a = g.nodes.find((n) => n.id === 'A');
  assert.deepEqual([a.title, a.sections], ['A', [['first', 'second']]]);
  assert.equal(g.nodes.find((n) => n.id === 'B').label, 'only');
  for (const t of ['>first<', '>second<']) assert.ok(g.svg.includes(t), t);
});

test('classDiagram: generics List~int~ show as List<int>; cardinalities sit between the boxes, not under them', () => {
  const g = renderDiagram('classDiagram\n  class Bag {\n    +List~int~ items\n    +get(Map~K,V~ m) V\n  }\n  Bag "1" --> "many" Item');
  assert.deepEqual(g.nodes[0].sections, [['+List<int> items'], ['+get(Map<K,V> m) V']]);
  assert.ok(g.svg.includes('+List&lt;int&gt; items'));
  const { pos, H } = layout(g, 0, Number(g.svg.match(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="([\d.]+)" rx/)[1]));
  const y = (t) => Number(g.svg.match(new RegExp(`<text x="[\\d.]+" y="([\\d.]+)"[^>]*>${t}<`))[1]);
  for (const t of ['1', 'many']) assert.ok(y(t) - 11 > pos.Bag.y + H && y(t) < pos.Item.y, `${t} at ${y(t)} between ${pos.Bag.y + H} and ${pos.Item.y}`);
});

test('every generated SVG has its own ids: two diagrams on one page never share a marker', () => {
  const a = renderDiagram('flowchart LR\n  A --> B').svg, b = renderDiagram('flowchart LR\n  A --> B').svg;
  const ids = (s) => [...s.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids(a).length > 0);
  assert.equal(new Set([...ids(a), ...ids(b)]).size, ids(a).length + ids(b).length);
  for (const s of [a, b]) for (const [, ref] of s.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids(s).includes(ref), ref);
});

test('sequence: a self-message label stays inside the SVG', () => {
  const s = renderDiagram('sequenceDiagram\n  A->>B: hi\n  B->>B: Verify credentials against the directory').svg;
  const width = Number(s.match(/width="([\d.]+)"/)[1]);
  const [, x, t] = s.match(/<text x="([\d.]+)" y="[\d.]+" class="label">(Verify[^<]*)</);
  assert.ok(Number(x) + t.length * 7 <= width, `label ends at ${Number(x) + t.length * 7}, svg is ${width} wide`);
});

test('sequenceDiagram: <br> in messages and notes is a line break, as on GitHub', () => {
  const { svg } = renderDiagram('sequenceDiagram\nA->>B: l1<br/>l2\nNote over A: n1<br>n2');
  assert.doesNotMatch(svg, /&lt;br/);
  assert.match(svg, /<tspan[^>]*>l1<\/tspan><tspan[^>]*>l2<\/tspan>/);
  assert.match(svg, /<tspan[^>]*>n1<\/tspan><tspan[^>]*>n2<\/tspan>/);
});
