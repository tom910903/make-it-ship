// M9-D D2: research loops — sciomc sessions, autoresearch evaluator contract and limits, self-improve approval gate, writer-memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, mis, git } from '../helpers.mjs';
import { extractFindings, checkEvaluator, checkResult } from '../../scripts/lib/commands-research.mjs';
import { classify } from '../../scripts/lib/policy.mjs';

const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r.json; };

const STAGE = `[FINDING:F1] Startup is slow
cold start is 2.1s (n=5)
[CONFIDENCE:HIGH] five runs agree
[/FINDING]
[EVIDENCE:F1]
- Command: hyperfine 'node app'
- Content: 2.1 s ± 0.1
[/EVIDENCE]
[FINDING:F2] Maybe the cache
no data yet
[/FINDING]`;

test('research findings: tags are extracted and weak findings (no evidence or confidence) are flagged', () => {
  const [f1, f2] = extractFindings(STAGE);
  assert.equal(f1.id, 'F1'); assert.equal(f1.confidence, 'HIGH'); assert.equal(f1.evidence.length, 1); assert.deepEqual(f1.problems, []);
  assert.deepEqual(f2.problems, ['no [EVIDENCE] block', 'no [CONFIDENCE] level']);
});

test('mis research: session with N stages for parallel scientists, add records findings, report separates verified from weak, limits stop it', () => {
  const dir = makeRepo();
  const s = ok(mis(dir, ['research', 'start', 'why', 'is', 'startup', 'slow', '--stages', '2', '--max-iterations', '2']));
  assert.equal(s.stages.length, 2);
  assert.match(s.next, /2 scientist subagents in ONE message/);
  const a = ok(mis(dir, ['research', 'add', s.id, '1', '-'], { input: STAGE }));
  assert.equal(a.findings, 2); assert.deepEqual(a.weak.map((w) => w.id), ['F2']); assert.deepEqual(a.remaining, [2]);
  const rep = ok(mis(dir, ['research', 'report', s.id]));
  const md = readFileSync(rep.report, 'utf8');
  assert.match(md, /### F1: Startup is slow/); assert.match(md, /Unverified[\s\S]*F2: Maybe the cache/); assert.match(md, /- stage 2/);
  ok(mis(dir, ['research', 'add', s.id, '2', '-'], { input: 'nothing tagged' }));
  const third = mis(dir, ['research', 'add', s.id, '1', '-'], { input: STAGE });
  assert.equal(third.code, 1); assert.match(third.err, /STOPPED: 2 iterations used/);
  assert.equal(ok(mis(dir, ['research', 'status', s.id])).status, 'stopped');
  const late = ok(mis(dir, ['research', 'start', 'x', '--max-runtime', '1ms']));
  assert.match(mis(dir, ['research', 'add', late.id, '1', '-'], { input: STAGE }).err, /max runtime reached/);
});

test('autoresearch evaluator contract: command, timeoutSec and json output are required; results need a boolean pass', () => {
  assert.deepEqual(checkEvaluator({ command: 'x', timeoutSec: 5, output: 'json' }), []);
  assert.equal(checkEvaluator({ command: '', timeoutSec: 0, output: 'text' }).length, 3);
  assert.equal(checkResult({ pass: true, score: 3 }), null);
  assert.match(checkResult({ pass: 'yes' }), /boolean/);
  assert.match(checkResult({ pass: true, score: 'hi' }), /number/);
  assert.match(checkResult(undefined), /not a JSON object/);
});

test('mis autoresearch: iterations write evaluation JSON and a markdown decision log; failing iterations do not stop; contract errors are recorded', () => {
  const dir = makeRepo({ 'score.txt': '1' });
  ok(mis(dir, ['autoresearch', 'init', 'speed', '--mission', 'make it faster', '--eval', `node -e "const s=+require('fs').readFileSync('score.txt','utf8');console.log(JSON.stringify({pass:s>=3,score:s}))"`]));
  assert.match(mis(dir, ['autoresearch', 'init', 'bad', '--mission', 'm', '--eval', 'x', '--eval-timeout', '0']).err, /evaluator contract/);
  ok(mis(dir, ['autoresearch', 'start', 'speed', '--max-iterations', '3']));
  const e1 = ok(mis(dir, ['autoresearch', 'eval', 'speed', '--decision', 'baseline']));
  assert.equal(e1.status, 'fail'); assert.equal(e1.stopped, false);
  writeFileSync(join(dir, 'score.txt'), '5');
  const e2 = ok(mis(dir, ['autoresearch', 'eval', 'speed', '--decision', 'cache the parse']));
  assert.equal(e2.status, 'pass'); assert.equal(e2.best.iteration, 2);
  writeFileSync(join(dir, '.make-it-ship/autoresearch/speed/evaluator.json'), JSON.stringify({ command: 'echo not-json', timeoutSec: 5, output: 'json' }));
  const e3 = ok(mis(dir, ['autoresearch', 'eval', 'speed', '--decision', 'try']));
  assert.equal(e3.status, 'contract-error'); assert.equal(e3.stopped, true); assert.equal(e3.reason, 'max iterations reached');
  const st = ok(mis(dir, ['autoresearch', 'status', 'speed']));
  const log = readFileSync(st.log, 'utf8');
  for (const re of [/Iteration 1 — fail/, /decision: cache the parse/, /Iteration 3 — contract-error/, /evaluator problem/, /Stopped[\s\S]*max iterations/]) assert.match(log, re);
  assert.deepEqual(readdirSync(join(st.log, '..', 'evaluations')), ['iteration-0001.json', 'iteration-0002.json', 'iteration-0003.json']);
  assert.match(mis(dir, ['autoresearch', 'eval', 'speed']).err, /no running autoresearch run/);
});

test('mis autoresearch stops at max runtime: an evaluator that outlives the deadline is killed and the run stops', () => {
  const dir = makeRepo();
  ok(mis(dir, ['autoresearch', 'init', 'slow', '--mission', 'm', '--eval', 'sleep 30; echo \'{"pass":true}\'', '--eval-timeout', '120']));
  ok(mis(dir, ['autoresearch', 'start', 'slow', '--max-runtime', '2s']));
  const e = ok(mis(dir, ['autoresearch', 'eval', 'slow', '--decision', 'one']));
  assert.equal(e.status, 'stopped-at-deadline'); assert.equal(e.stopped, true); assert.equal(e.reason, 'max runtime reached');
  assert.ok(e.ms < 25000, `killed at the deadline, not after the 30s evaluator (${e.ms} ms)`);
  assert.equal(ok(mis(dir, ['autoresearch', 'status', 'slow'])).run.status, 'stopped');
});

function patch(dir, file, from, to) {
  writeFileSync(join(dir, file), to);
  const p = git(dir, 'diff', '--', file) + '\n';
  writeFileSync(join(dir, file), from);
  return p;
}

test('self-improve proposes only; nothing changes until mis approve proposal, which the guard always asks about', () => {
  const dir = makeRepo({ 'skills/x/SKILL.md': 'old rule\n', 'src/app.js': 'code\n' });
  writeFileSync(join(dir, 'p.diff'), patch(dir, 'skills/x/SKILL.md', 'old rule\n', 'new rule\n'));
  const p = ok(mis(dir, ['self-improve', 'propose', 'tighten rule', '--patch', 'p.diff', '--why', 'retro found misses']));
  assert.equal(p.status, 'proposed');
  assert.equal(readFileSync(join(dir, 'skills/x/SKILL.md'), 'utf8'), 'old rule\n', 'proposing does not apply');
  for (const activeRun of [false, true]) {
    assert.equal(classify({ tool_name: 'Bash', tool_input: { command: `node /p/scripts/mis.mjs approve proposal ${p.id}` }, cwd: dir }, { repoRoot: dir, activeRun, currentBranch: 'main' }).decision, 'ask');
  }
  writeFileSync(join(dir, 'code.diff'), patch(dir, 'src/app.js', 'code\n', 'hacked\n'));
  assert.match(mis(dir, ['self-improve', 'propose', 'x', '--patch', 'code.diff']).err, /only process and skill files/);
  const a = ok(mis(dir, ['approve', 'proposal', p.id]));
  assert.equal(a.status, 'applied');
  assert.equal(readFileSync(join(dir, 'skills/x/SKILL.md'), 'utf8'), 'new rule\n');
  assert.match(mis(dir, ['approve', 'proposal', p.id]).err, /proposal is applied/);
});

test('self-improve tournament scores each candidate in a throwaway worktree and proposes the winner (still unapplied)', () => {
  const dir = makeRepo({ '.make-it-ship/score': '1\n' });
  writeFileSync(join(dir, 'a.diff'), patch(dir, '.make-it-ship/score', '1\n', '4\n'));
  writeFileSync(join(dir, 'b.diff'), patch(dir, '.make-it-ship/score', '1\n', '9\n'));
  const r = ok(mis(dir, ['self-improve', 'tournament', '--bench', `node -e "console.log(JSON.stringify({score:+require('fs').readFileSync('.make-it-ship/score','utf8')}))"`, 'a.diff', 'b.diff']));
  assert.match(r.winner, /b\.diff$/);
  assert.deepEqual(r.results.map((x) => x.score), [4, 9]);
  assert.equal(r.proposal.status, 'proposed');
  assert.equal(readFileSync(join(dir, '.make-it-ship/score'), 'utf8'), '1\n');
  assert.equal(git(dir, 'worktree', 'list').split('\n').length, 1, 'candidate worktrees removed');
  assert.deepEqual(ok(mis(dir, ['self-improve', 'list'])).proposals.map((x) => x.status), ['proposed']);
});

test('writer-memory: create, read, update, delete characters, relationships, scenes; query and export; backups before changes', () => {
  const dir = makeRepo();
  ok(mis(dir, ['writer-memory', 'init', 'Spring', '--genre', 'romance']));
  ok(mis(dir, ['writer-memory', 'char', 'add', 'Saerang', '--tone', 'dry', '--keywords', '["just","fine"]']));
  ok(mis(dir, ['writer-memory', 'char', 'add', 'Haerang']));
  assert.deepEqual(ok(mis(dir, ['writer-memory', 'char', 'Saerang'])).Saerang.keywords, ['just', 'fine']);
  ok(mis(dir, ['writer-memory', 'char', 'update', 'Haerang', 'tone', 'warm']));
  const rel = ok(mis(dir, ['writer-memory', 'rel', 'add', 'Saerang', 'Haerang', 'romantic']));
  ok(mis(dir, ['writer-memory', 'rel', 'update', 'Haerang', 'Saerang', 'meet', 'on', 'the', 'roof']));
  assert.equal(ok(mis(dir, ['writer-memory', 'rel', 'show', 'Saerang', 'Haerang'])).evolution[0].change, 'meet on the roof');
  const sc = ok(mis(dir, ['writer-memory', 'scene', 'add', 'Rooftop', '--location', 'roof']));
  ok(mis(dir, ['writer-memory', 'world', 'set', 'setting', 'Seoul']));
  ok(mis(dir, ['writer-memory', 'theme', 'add', 'patience']));
  const q = ok(mis(dir, ['writer-memory', 'query', 'roof']));
  assert.deepEqual(q.scenes, [sc.id]); assert.deepEqual(q.relationships, [rel.id]);
  ok(mis(dir, ['writer-memory', 'scene', 'remove', sc.id]));
  ok(mis(dir, ['writer-memory', 'char', 'remove', 'Haerang']));
  const st = ok(mis(dir, ['writer-memory', 'status']));
  assert.equal(st.characters, 1); assert.equal(st.scenes, 0); assert.equal(st.themes, 1);
  assert.match(readFileSync(ok(mis(dir, ['writer-memory', 'export'])).export, 'utf8'), /### Saerang/);
  assert.ok(readdirSync(join(dir, '.make-it-ship/writer-memory/backups')).length >= 5);
  assert.ok(existsSync(join(dir, '.make-it-ship/writer-memory/memory.json')));
});
