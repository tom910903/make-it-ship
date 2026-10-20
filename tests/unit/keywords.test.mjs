import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectKeywords, styleSwitch, learnedSkills } from '../../scripts/lib/keywords.mjs';
import { makeRepo, mis, write } from '../helpers.mjs';

const names = (p, opts) => detectKeywords(p, opts).map((m) => m.name);

test('every keyword triggers in English and Korean', () => {
  const cases = {
    cancel: ['cancelomc please', 'stopomc'],
    loop: ['ralph: fix the login bug', '랄프: 끝까지 해줘'],
    run: ['autopilot: add csv export', 'build me an app for notes', 'I want a cli that counts words', 'handle it all', '오토파일럿으로 해줘'],
    ultragoal: ['ultragoal ship these three things'],
    parallel: ['ulw refactor the parsers', 'ultrawork this', '울트라워크로 해줘'],
    'second-opinion': ['ccg on this design', '씨씨지 돌려줘'],
    'plan-consensus': ['ralplan the migration', '랄플랜 해줘'],
    interview: ['deep interview me about the feature', '딥인터뷰 하자'],
    simplify: ['deslop the parser', 'clean up the dead code and duplication'],
    tdd: ['tdd this change', 'test first please', '테스트 퍼스트로'],
    review: ['code review the diff', '코드 리뷰 해줘'],
    'security-review': ['security review the auth module', '보안 리뷰 부탁'],
    think: ['ultrathink about the cache', 'think hard here', '울트라씽크'],
    search: ['deepsearch for the retry logic', 'search the codebase for retries', '딥 서치 해줘'],
    analyze: ['deep-analyze this crash', '딥 분석 해줘'],
  };
  for (const [name, prompts] of Object.entries(cases)) {
    for (const p of prompts) assert.ok(names(p).includes(name), `${name} ← "${p}" got ${names(p)}`);
  }
});

test('reference content does not trigger: code, quotes, URLs, paths, questions about a keyword', () => {
  for (const p of [
    'see `ralph` in the docs', '```\nralph\n```', 'https://example.com/ralph/ulw', 'open docs/ralph/notes.md',
    '> code review the diff', 'what is ralph?', 'how do I use ultrawork?', '랄프 사용법이 뭐야?', 'the ralph mode keeps looping, why?',
  ]) assert.deepEqual(names(p), [], p);
});

test('conflicts: cancel wins alone; loop absorbs run; disabled keywords are dropped', () => {
  assert.deepEqual(names('cancelomc and ralph'), ['cancel']);
  assert.deepEqual(names('ralph: autopilot the importer'), ['loop']);
  assert.deepEqual(names('ralph: tdd this', { disabled: ['tdd'] }), ['loop']);
  const m = detectKeywords('code review the diff')[0];
  assert.match(m.context, /make-it-ship:review/);
});

test('style switch phrases (incl. migrating ponytail wording)', () => {
  assert.equal(styleSwitch('normal mode please'), 'off');
  assert.equal(styleSwitch('stop ponytail'), 'off');
  assert.equal(styleSwitch('ponytail ultra'), 'ultra');
  assert.equal(styleSwitch('스타일 꺼줘'), 'off');
  assert.equal(styleSwitch('a normal request'), null);
});

test('learned skills: frontmatter triggers in repo and home dirs, at most 3', () => {
  const dir = makeRepo(), home = mkdtempSync(join(tmpdir(), 'mis-home-'));
  write(dir, { '.make-it-ship/skills/csv/SKILL.md': '---\nname: csv-export\ndescription: How we export CSV\ntriggers: [csv, export]\n---\nbody' });
  write(home, { 'skills/deploy/SKILL.md': '---\nname: deploy\ndescription: Deploy steps\ntriggers: ["배포"]\n---\nbody' });
  const hit = learnedSkills('add CSV download and 배포 it', dir, home);
  assert.deepEqual(hit.map((s) => s.name).sort(), ['csv-export', 'deploy']);
  assert.match(hit.find((s) => s.name === 'deploy').path, /skills\/deploy\/SKILL\.md$/);
  assert.deepEqual(learnedSkills('nothing relevant', dir, home), []);
});

test('mis test-prompt shows matches, style switch, and the injected context without changing state', () => {
  const dir = makeRepo(), env = { MIS_STATE_HOME: mkdtempSync(join(tmpdir(), 'mis-home-')) };
  const r = mis(dir, ['test-prompt', 'ralph: fix it'], { env }).json;
  assert.deepEqual(r.matches, ['loop']);
  assert.match(r.context, /make-it-ship:loop/);
  assert.equal(mis(dir, ['test-prompt', 'normal mode'], { env }).json.style, 'off');
  assert.equal(mis(dir, ['style'], { env }).json.level, 'full', 'test-prompt is a dry run');
});

test('M6 D2/D7: names, quotes, complaints and casual words do not start modes', () => {
  for (const p of [
    'Ralph from QA reported a bug in login, fix it', 'Our new intern Ralph wrote this module', 'Rename the ralph variable to worker',
    'He said "ralph" was the codename', '랄프가 어제 회의에서 말한 버그 고쳐줘', 'ralph keeps looping, make it stop', '랄프가 계속 반복돼, 멈춰줘',
    'the UW campus map is broken',
  ]) assert.ok(!names(p).includes('loop') && !names(p).includes('parallel'), `${p}: ${names(p)}`);
  assert.deepEqual(names('stop the ralph loop'), ['cancel']);
  for (const p of ['ralph: fix the importer', '/ralph finish it', 'ralph mode: port the parser', '랄프: 끝까지 해줘', '랄프 모드로 진행: 해줘'])
    assert.deepEqual(names(p), ['loop'], p);
});

test('M6 D9: Japanese variants', () => {
  const cases = { loop: 'ラルフ: 直して', run: 'オートパイロットで作って', parallel: 'ウルトラワークで', 'second-opinion': 'シーシージー', 'plan-consensus': 'ラルプランして', interview: 'ディープインタビューしよう', tdd: 'テストファーストで', review: 'コードレビューして', 'security-review': 'セキュリティレビューして', think: 'ウルトラシンク', search: 'ディープサーチして', analyze: 'ディープアナライズして' };
  for (const [n, p] of Object.entries(cases)) assert.ok(names(p).includes(n), `${n} ← ${p}: ${names(p)}`);
});

test('M6 D4: style phrases only when the prompt is just the phrase', () => {
  assert.equal(styleSwitch('the router falls back to normal mode when wifi drops; fix it'), null);
  assert.equal(styleSwitch('Normal mode.'), 'off');
  assert.equal(styleSwitch('please stop ponytail'), 'off');
  assert.equal(styleSwitch('use ponytail ultra for the parser rewrite'), null);
});

test('M6 R5 (user decision): only prefix forms start the loop; every other mention is a model-judged hint; off-requests cancel', () => {
  for (const p of ['ralph: fix the importer', 'ralph: fix the end-to-end tests', 'ralph: why does login fail on Safari? make the e2e suite pass',
    "ralph: don't break the public API while fixing the parser", '/ralph finish it', 'ralph mode: port the parser', '랄프: 끝까지 해줘',
    '랄프 모드로 진행: 로그인이 왜 깨져? 테스트 통과할 때까지', 'ラルフ: 直して'])
    assert.deepEqual(names(p), ['loop'], p);
  for (const p of ['turn off ralph', 'disable ralph', 'ralph stop', 'ralph off', 'ralph cancel', 'end ralph', 'no more ralph', 'stop the ralph loop',
    'ralph: stop', 'ralph: off', 'ralph mode: off', '/ralph off', '/ralph cancel', '랄프 모드로 진행: 그만', 'ralph 그만', '랄프 꺼줘', 'ラルフを止めて', 'cancelomc'])
    assert.deepEqual(names(p), ['cancel'], p);
  for (const p of ['use ralph to finish the migration', 'start ralph on the parser', '랄프로 끝까지 해줘', 'ラルフで直して', 'how do I use ralph?', 'why did you start ralph?',
    'we stopped using ralph last week, just fix it normally', 'Use ralph? No thanks.', '랄프로는 안 될 것 같아', '랄프로선 무리야', 'ラルフでさえ無理', 'Use Ralph’s patch',
    'Ralph Lauren page is broken, fix it', 'Ralph fixed the bug already', 'Thanks Ralph', 'the ralph loop is stuck again', "don't use ralph anymore", 'ralph.config.js is wrong, fix it'])
    assert.ok(!names(p).includes('loop') && !names(p).includes('cancel'), `${p}: ${names(p)}`);
  assert.deepEqual(names('use ralph to finish the migration'), ['loop-hint']);
  assert.match(detectKeywords('Ralph fixed it')[0].context, /only if the user is asking/i);
  for (const p of ["ralph: don't stop ralph until tests pass", 'do not cancel ralph', 'never disable ralph'])
    assert.ok(!names(p).includes('cancel'), `${p}: ${names(p)}`);
  for (const p of ['stop mis-labelling the axes', 'stop the loop in parser.js and add a test first'])
    assert.ok(!names(p).includes('cancel'), p);
});

test('M6 R6 (same principle as the loop): cancel only when the whole prompt is a short off-request; everything else with ralph is a hint', () => {
  for (const p of ['turn off ralph', 'disable ralph', 'ralph stop', 'ralph off', 'ralph cancel', 'end ralph', 'stop the ralph loop', 'ralph: stop', 'ralph: stop please',
    'ralph: cancel the loop', 'ralph: turn off', '/ralph off', '/ralph cancel', 'ralph mode: off', '랄프 꺼줘', '랄프: 꺼줘', '랄프: 그만해', '랄프: 중지', 'ralph 그만',
    '랄프 모드로 진행: 그만', 'ラルフを止めて', 'ラルフ: やめて', 'ラルフ：停止', 'cancelomc', 'Ralph, stop.'])
    assert.deepEqual(names(p), ['cancel'], p);
  for (const p of ["don’t stop ralph", "please don't ever stop ralph", "I didn't stop ralph, it stopped by itself", '랄프 그만두지 마', '랄프 취소하지 마세요', 'ラルフを止めないで',
    'add a button to stop ralph', '랄프 취소 버튼 만들어줘', 'ラルフを止めるボタンを追加して', 'disable Ralph’s account', 'In the end Ralph fixed it himself', 'cancel mis.json load when offline',
    'https://ci.example.com/job/42 ralph: why is this red?', '`npm test` ralph: flaky', '/ralph-lauren.png is broken, replace it'])
    assert.ok(!names(p).includes('cancel') && !names(p).includes('loop'), `${p}: ${names(p)}`);
  for (const p of ["ralph: don’t stop ralph until tests pass", "ralph: please don't ever stop ralph", '랄프: 끝날 때까지 랄프 그만두지 마', 'ラルフ: ラルフを止めないで、テストが通るまで'])
    assert.deepEqual(names(p), ['loop'], p);
  assert.match(detectKeywords('add a button to stop ralph')[0].context, /mis loop cancel/);
});

test('M6 R7: a prompt made only of ralph words, off words and filler cancels (any language, with or without prefix); anything else does not', () => {
  for (const p of ['ralph: please stop', 'ralph: stop, please', 'ralph: stop now', 'ralph: stop it', 'ralph: quit', 'ralph: stop?', '랄프: 그만해줘', '랄프: 멈춰줘', '랄프: 꺼 주세요',
    '랄프: 중지해', '랄프: 종료', '랄프 모드: 꺼', 'ラルフ: 止めてください', 'ラルフ: キャンセル', 'ラルフモード: 停止', 'Please, stop ralph', 'turn ralph off', 'stop ralph now', 'exit ralph',
    '랄프를 꺼줘', '랄프 모드 꺼줘', '랄프 종료', 'ラルフを止めてください', 'ralph：stop'])
    assert.deepEqual(names(p), ['cancel'], p);
  for (const p of ["ralph: don't stop", 'ralph: stop the server from crashing on boot', 'ralph: end-to-end tests are red, fix them', 'ralph: 서버 종료 버그 고쳐줘'])
    assert.deepEqual(names(p), ['loop'], p);
  for (const p of ['add a button to stop ralph', '랄프 취소 버튼 만들어줘', 'ラルフを止めるボタンを追加して', 'In the end Ralph fixed it himself', "don't stop ralph", 'stop ralph from deleting files'])
    assert.ok(!names(p).includes('cancel'), `${p}: ${names(p)}`);
  assert.deepEqual(names('ralph：fix it'), ['loop'], 'full-width colon prefix');
});

test('M6 R8: token rule — any polite ending, punctuation, mixed languages, inner commas; one prefix shape shared by loop and cancel', () => {
  for (const p of ['ラルフ: 停止してください', 'ラルフ: キャンセルしてください', '랄프: 중지하세요', '랄프: 멈춰요', '랄프: 꺼줘요', '랄프 꺼주세요', 'ラルフを止めて下さい',
    'ralph: stop…', 'ralph: stop;', '랄프: 꺼줘~', 'stop ralph…', '랄프, 꺼줘', 'ラルフ、止めて', 'ralph — stop', '랄프 stop', 'stop 랄프', 'ラルフ stop', 'ralph 꺼줘', '랄프 그만 꺼',
    '랄프 모드로 해: 꺼줘'])
    assert.deepEqual(names(p), ['cancel'], p);
  for (const p of ['랄프: 데이터 꺼내는 함수 고쳐줘', '랄프 그만두지 마', '랄프: 멈추지 말고 계속해', 'ralph ralph ralph ralph ralph ralph 꺼줘'])
    assert.ok(!names(p).includes('cancel'), `${p}: ${names(p)}`);
  assert.deepEqual(names('랄프 모드로 해: 로그인 고쳐줘'), ['loop']);
});
