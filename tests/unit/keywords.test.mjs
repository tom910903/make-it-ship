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
    loop: ['ralph: fix the login bug', '랄프로 끝까지 해줘'],
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
    wiki: ['wiki this finding', 'wiki add the auth notes'],
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
  for (const p of ['ralph: fix the importer', 'use ralph to finish the migration', '/ralph finish it', 'ralph mode: port the parser', '랄프로 끝까지 해줘', '랄프 모드로 해줘'])
    assert.deepEqual(names(p), ['loop'], p);
});

test('M6 D9: Japanese variants', () => {
  const cases = { loop: 'ラルフで直して', run: 'オートパイロットで作って', parallel: 'ウルトラワークで', 'second-opinion': 'シーシージー', 'plan-consensus': 'ラルプランして', interview: 'ディープインタビューしよう', tdd: 'テストファーストで', review: 'コードレビューして', 'security-review': 'セキュリティレビューして', think: 'ウルトラシンク', search: 'ディープサーチして', analyze: 'ディープアナライズして' };
  for (const [n, p] of Object.entries(cases)) assert.ok(names(p).includes(n), `${n} ← ${p}: ${names(p)}`);
});

test('M6 D4: style phrases only when the prompt is just the phrase', () => {
  assert.equal(styleSwitch('the router falls back to normal mode when wifi drops; fix it'), null);
  assert.equal(styleSwitch('Normal mode.'), 'off');
  assert.equal(styleSwitch('please stop ponytail'), 'off');
  assert.equal(styleSwitch('use ponytail ultra for the parser rewrite'), null);
});

test('M6 R3 (user decision): explicit forms start the loop, off-requests cancel, every other mention is only a hint for the model', () => {
  for (const p of ['ralph: fix the importer', 'ralph: fix the end-to-end tests', 'ralph: add a front end for the cli', '/ralph finish it', 'use ralph to fix the stop button',
    'use ralph to finish the migration', 'start ralph on the parser', 'ralph mode: port the parser', '랄프로 끝까지 해줘', '랄프 모드로 해줘', '랄프 켜줘',
    '랄프로 데이터 꺼내는 함수 고쳐줘', 'ラルフで直して', 'ラルフ 起動して直して'])
    assert.deepEqual(names(p), ['loop'], p);
  for (const p of ['turn off ralph', 'disable ralph', 'ralph stop', 'ralph off', 'ralph cancel', 'end ralph', 'no more ralph', 'stop the ralph loop',
    'ralph 그만', 'ralph 멈춰', '랄프 꺼줘', '랄프 꺼', 'ラルフ止めて', 'ラルフを止めて', 'cancelomc'])
    assert.deepEqual(names(p), ['cancel'], p);
  for (const p of ['ralph fix the login bug', 'Ralph fixed the bug already', 'ralph broke my repo', 'Ralph reviewed the PR yesterday', 'Ralph Smith reported a bug, fix it',
    'Thanks Ralph', 'I talked with Ralph', 'the ralph loop is stuck again', "don't use ralph anymore", 'please don\'t start ralph', '랄프로 하지 말고 그냥 고쳐줘',
    'ラルフで直さないで', '랄프 씨가 만든 모듈 고쳐줘', 'ralph stop the server before deploy'])
    assert.deepEqual(names(p), ['loop-hint'], p);
  assert.match(detectKeywords('Ralph fixed it')[0].context, /only if the user is asking/i);
  assert.ok(names('stop the loop in parser.js and add a test first').includes('tdd'), 'a coding sentence about a loop is not a cancel');
  assert.ok(!names('stop the loop in parser.js and add a test first').includes('cancel'));
});
