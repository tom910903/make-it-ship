# Make It Ship 결과 보고서 — 20261019-1237-2bff

> **판정: VERIFIED** — 배포 준비 완료 (정의된 검증 범위 안에서)
> 판정은 `mis verdict`가 규칙(Spec §6)으로 계산했다. 모델이 정한 값이 아니다.
> 코드 상태(tree): `4805aed13fdc0d1fa52a8ffedb9129fd9a24891e` · 모드: standard — Coordinated change across all three pipeline modules (parse/summarize/render) plus changed output format; small code but cross-module contract change. No auth/payment-processing/pii/migration risk: this is report formatting of amounts. · 생성: 2026-10-19T03:42:54.480Z

## 1. 목표와 달성 여부
목표: Switch the parse -> summarize -> render pipeline to integer cents so money totals have no float error and print with exactly two decimals.

달성 여부: 수용 조건과 필수 검증이 현재 코드 기준으로 충족됨

제약: Render ordering stays sorted by name (Object.keys(...).sort()); Output line format stays 'name: total' joined by newlines; No new dependencies; Module exports and signatures (parse(text), summarize(rows), render(totals)) unchanged; Cents conversion is done on the digit string (whole and fraction digits), never via Number(s)*100; The header is always the first physical line; only trailing whitespace of the text is trimmed; line numbers are 1-based physical lines; Only the amount field is trimmed (whitespace and \r); names are kept verbatim except a trailing \r is never part of a name since it sits after the amount; The three modules form one contract change: per-task cycles run only that task's own test file; the full npm test (including test/pipeline.test.js) is required to pass after T3; Error tests assert on the message (assert.throws(fn, /line N/)); Rollback: revert the single change commit

## 2. 작업 상태 (모델 판단)
- [DONE] T1 parse converts amounts to integer cents from the digit string and rejects invalid amounts with line numbers — 수용 기준: parse('name,amount\na,12.34')[0].amount === 1234; '12' -> 1200, '12.3' -> 1230, '-0.05' -> -5, '0.07' -> 7, '1.15' -> 115, '0.29' -> 29, '4.35' -> 435, '-1.15' -> -115 (Number.isInteger true for all); parse('name,amount\na,1\nb,1.234') throws with message matching /line 3/; each of 'a,abc', 'a,', 'a' (no comma), 'a,.5', 'a,1e2' as line 2 throws with message matching /line 2/; parse('name,amount\na,1\n\nb,2') throws with message matching /line 3/ (mid blank line rejected); trailing newline is ignored: parse('name,amount\na,1\n') returns exactly 1 row; CRLF and padded amount accepted: parse('name,amount\r\na, 1.50 \r\n')[0] deep-equals {name:'a',amount:150}; names not trimmed: parse('name,amount\n a,1')[0].name === ' a'
- [DONE] T2 summarize sums integer cents (logic already integer-safe; update doc comment to say cents, add tests) — 수용 기준: summarize([{name:'a',amount:10},{name:'a',amount:20},{name:'b',amount:5}]) deep-equals {a:30,b:5}; all totals are integers (Number.isInteger); src/summarize.js doc comment states totals are integer cents
- [DONE] T3 render prints cents as amounts with exactly two decimals, ordering unchanged; update pipeline test — 수용 기준: render({b:500,a:1234}) === 'a: 12.34\nb: 5.00'; render({a:7}) === 'a: 0.07'; render({a:-5}) === 'a: -0.05'; render({a:-1234}) === 'a: -12.34'; render({a:-0}) === 'a: 0.00'; pipeline test expects 'a: 1.00\nb: 5.00' and a 0.1+0.2 case expects 'a: 0.30'; full npm test passes

## 3. 변경한 기능과 주요 파일
- A `.make-it-ship.json`
- M `src/parse.js`
- M `src/render.js`
- M `src/summarize.js`
- A `test/parse.test.js`
- M `test/pipeline.test.js`
- A `test/render.test.js`
- A `test/summarize.test.js`

## 4. 수행한 검증과 실제 결과 (기계 검증)
| ID | check | 명령(argv) | exit | 기록 당시 | 현재 코드 기준 | 종료 시각 |
|---|---|---|---|---|---|---|
| E1 | unit | `npm test` | 0 | PASS | PASS | 2026-10-19T03:41:40.381Z |

## 5. 리뷰 (모델 판단)
- plan-critic: blocking 0, major 2 — 현재 코드 기준 (`reviews/1-plan-critic.md`)
- plan-critic: blocking 0, major 1 — 현재 코드 기준 (`reviews/2-plan-critic.md`)
- plan-critic: blocking 0, major 0 — 현재 코드 기준 (`reviews/3-plan-critic.md`)
- spec: blocking 0, major 0 — 현재 코드 기준 (`reviews/4-spec.md`)
- quality: blocking 0, major 0 — 현재 코드 기준 (`reviews/5-quality.md`)

## 6. 검증하지 못한 영역과 이유
없음

## 7. 코드 변경 이후 무효가 된 검증
없음

## 8. 사용자 결정·배포 전 주의사항
- 가정: Q1 (MED) Which line number does the >2-decimals error name? → Default: 1-based physical line number of the input text (header is line 1, first data row is line 2) (다르면 알려 달라)
- 가정: Q2 (MED) How are integers, 1-decimal values, negatives and non-numeric amounts handled? → Default: accept optional leading '-', digits, optional '.' with 1-2 digits (12 -> 1200, 12.3 -> 1230, -0.05 -> -5); any other amount (non-numeric, empty, >2 decimals) throws an Error naming the line number; render prints negatives as -0.05 (다르면 알려 달라)
- 가정: Q3 (LOW) Existing test expects render output a: 1 / b: 5; does it change? → Yes: expectation becomes 'a: 1.00\nb: 5.00' as the request mandates two decimals; ordering unchanged (다르면 알려 달라)
- 원격 push·PR·배포는 사용자 승인 후에만 수행한다.

## 9. 실행·확인 방법
- `npm test`
- `node --input-type=module -e "import {parse} from './src/parse.js'; import {summarize} from './src/summarize.js'; import {render} from './src/render.js'; console.log(render(summarize(parse('name,amount\na,0.1\na,0.2\nb,12.34'))))"`
- `npm test` (필수 check 재실행)

## 10. 의도적 지름길 (shortcut)
코드의 `shortcut: <한계>, <업그레이드 시점>` 주석 목록이다. 트리거가 없는 항목은 방치될 위험이 있다.

No shortcut debt.

## 정직성 표기
- **기계 검증**: 4절의 check 결과. `mis check`가 명령을 직접 실행하고 exit code를 기록했다.
- **모델 판단**: 2절 작업 완료 여부, 5절 리뷰, 수용 기준 충족 여부. 모델이 작성했으며 기계로 확인되지 않았다.
- **미지원**: 토큰 예산 — 플러그인은 토큰 사용량을 얻을 수 없다. 실행 시간·재시도 상한만 강제한다.
