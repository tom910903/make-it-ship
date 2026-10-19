# Make It Ship 결과 보고서 — 20261019-1228-1617

> **판정: VERIFIED** — 배포 준비 완료 (정의된 검증 범위 안에서)
> 판정은 `mis verdict`가 규칙(Spec §6)으로 계산했다. 모델이 정한 값이 아니다.
> 코드 상태(tree): `882e99fc677a32b72278ef37be786247d803dd0c` · 모드: full — User explicitly requested full mode; new project built from scratch with several modules (core, store, CLI, smoke QA). · 생성: 2026-10-19T03:39:37.412Z

## 1. 목표와 달성 여부
목표: Build the dependency-free Node CLI `tally` from REQUIREMENTS.md (add/today/week/reset over a JSON file at $TALLY_FILE) with unit tests for counting and date logic and a real-CLI smoke script qa/cli-smoke.mjs.

달성 여부: 수용 조건과 필수 검증이 현재 코드 기준으로 충족됨

제약: No runtime or dev dependencies; Node >= 22 built-ins only; ESM (package.json type=module).; Output formats exactly as REQUIREMENTS.md:6-9.; ADR-001 (Option B): pure src/core.js, src/store.js (load+validate, temp-file+rename save), src/cli.js main({argv, env, now, stdout, stderr}) returning exit code, 2-line bin/tally.js.; Local date read once from injected `now` via getFullYear/getMonth/getDate; all day arithmetic in UTC on YYYY-MM-DD keys (DST-safe); never toISOString for keys.; Habit containers are own-property safe (Object.create(null) / Object.hasOwn) so __proto__, constructor, toString are ordinary habits.; Check order: argument count (usage, exit 2) -> habit name (stderr, exit 2) -> load file (invalid: stderr, exit 1, file untouched).; Tests and smoke always use a temp TALLY_FILE; never touch ~/.tally.json.; .make-it-ship.json is not edited.

## 2. 작업 상태 (모델 판단)
- [DONE] T1 Pure core: habit validation, local date keys, counting — 수용 기준: isValidHabit accepts /^[A-Za-z0-9_-]{1,32}$/ and rejects '', 33 chars, 'a b', 'ä', 'a.b'.; localDateKey(new Date(2026,9,19,23,30)) === '2026-10-19' under TZ=America/New_York (UTC date already 10-20).; lastNDays(key, 7) returns 7 consecutive distinct keys oldest first ending on key, including across 2026-03-08 spring-forward and 2026-11-01 fall-back, and across a month/year boundary (2026-01-03 -> starts 2025-12-28).; add(data, habit, key) increments and returns the new count; today(data, key) returns [habit, count] pairs sorted by code-unit order with zero entries omitted; week(data, habit, key) returns 7 [key, count] pairs with 0 for missing days; reset(data, habit) removes the habit and reports whether anything changed.; Habits named __proto__, constructor and toString count independently and do not alter Object.prototype.; test/placeholder.test.js removed; npm test passes.
- [DONE] T2 Store: load/validate and atomic save — 수용 기준: resolveFile(env) returns env.TALLY_FILE when non-empty, else path.join(os.homedir(), '.tally.json').; load(missing file) returns empty data; load of invalid JSON, a non-object top level (array/string/null), a non-object habit entry, a bad date key, or a count that is not a positive integer throws a StoreError naming the file.; Loaded data uses own-property-safe containers (a stored '__proto__' habit round-trips).; save writes `<file>.<pid>.tmp` in the same directory then renames over the file; resulting file parses back to the same data; no .tmp left behind.; Unit tests in test/store.test.js use a fresh temp directory and pass under npm test.
- [DONE] T3 CLI main and bin entry — 수용 기준: main({argv, env, now, stdout, stderr}) returns 0/1/2 and writes only through the injected streams.; add prints '<habit>: <count today>'; today prints '<habit> <count>' lines sorted or 'nothing yet'; week prints 7 'YYYY-MM-DD <count>' lines oldest first; reset prints 'reset <habit>' (also for an unknown habit, without creating the file).; Unknown command, no command, missing argument, or extra argument -> usage text on stderr, empty stdout, exit 2, data file not read or written.; Invalid habit -> stderr message containing the name, exit 2, file not touched; corrupt file -> stderr message, exit 1, file bytes unchanged.; bin/tally.js has a '#!/usr/bin/env node' shebang, is executable, and sets process.exitCode from main.; test/cli.test.js covers each command and error path in-process with a fixed `now` and temp TALLY_FILE; npm test passes.
- [DONE] T4 Real-CLI smoke script qa/cli-smoke.mjs — 수용 기준: Spawns `node bin/tally.js` with a fresh temp TALLY_FILE (mkdtemp) and checks stdout, stderr and exit code for: today (empty -> 'nothing yet'), add x2 for two habits, today sorted, week (7 lines, last line is today with the right count, earlier lines 0), reset, reset of unknown habit, today after reset, add __proto__.; Error cases: no command, unknown command, add without habit, extra argument, invalid habit name (exit 2 + stderr, empty stdout); corrupt JSON file -> exit 1 and file bytes unchanged.; Prints each case PASS/FAIL, removes its temp dir, exits 1 if any case fails and 0 otherwise; `mis check qa-cli` passes.

## 3. 변경한 기능과 주요 파일
- A `bin/tally.js`
- A `qa/cli-smoke.mjs`
- A `src/cli.js`
- A `src/core.js`
- A `src/store.js`
- A `test/cli.test.js`
- A `test/core.test.js`
- D `test/placeholder.test.js`
- A `test/store.test.js`

## 4. 수행한 검증과 실제 결과 (기계 검증)
| ID | check | 명령(argv) | exit | 기록 당시 | 현재 코드 기준 | 종료 시각 |
|---|---|---|---|---|---|---|
| E1 | unit | `npm test` | 0 | PASS | STALE | 2026-10-19T03:34:34.730Z |
| E2 | unit | `npm test` | 0 | PASS | STALE | 2026-10-19T03:35:06.895Z |
| E3 | unit | `npm test` | 0 | PASS | STALE | 2026-10-19T03:35:41.732Z |
| E4 | qa-cli | `node qa/cli-smoke.mjs` | 0 | PASS | STALE | 2026-10-19T03:36:10.966Z |
| E5 | unit | `npm test` | 0 | PASS | STALE | 2026-10-19T03:36:12.044Z |
| E6 | unit | `npm test` | 0 | PASS | PASS | 2026-10-19T03:38:30.960Z |
| E7 | qa-cli | `node qa/cli-smoke.mjs` | 0 | PASS | PASS | 2026-10-19T03:38:32.504Z |

## 5. 리뷰 (모델 판단)
- plan-critic: blocking 0, major 0 — 현재 코드 기준 (`reviews/1-plan-critic.md`)
- product: blocking 0, major 0 — 이전 코드 기준(무효) (`reviews/2-product.md`)
- quality: blocking 0, major 0 — 현재 코드 기준 (`reviews/3-quality.md`)
- spec: blocking 0, major 0 — 현재 코드 기준 (`reviews/4-spec.md`)

## 6. 검증하지 못한 영역과 이유
없음

## 7. 코드 변경 이후 무효가 된 검증
- E1 `unit` (PASS) — 이후 코드 또는 설정이 바뀌어 무효
- E2 `unit` (PASS) — 이후 코드 또는 설정이 바뀌어 무효
- E3 `unit` (PASS) — 이후 코드 또는 설정이 바뀌어 무효
- E4 `qa-cli` (PASS) — 이후 코드 또는 설정이 바뀌어 무효
- E5 `unit` (PASS) — 이후 코드 또는 설정이 바뀌어 무효

## 8. 사용자 결정·배포 전 주의사항
- 가정: Q1 (MED) What happens when $TALLY_FILE exists but is not valid JSON (or not the expected shape)? → Default: stderr error naming the file, exit 1, file left untouched. (다르면 알려 달라)
- 가정: Q2 (MED) Are extra arguments (e.g. tally add a b, tally today x) errors? → Default: wrong argument count is a usage error (stderr, exit 2). (다르면 알려 달라)
- 가정: Q3 (LOW) Does reset on a habit with no records succeed? → Default: prints reset <habit>, exit 0. (다르면 알려 달라)
- 가정: Q4 (LOW) Is qa-cli a required check for this run? → Default: qa-cli is listed as required in the plan acceptance and run via mis check; config unchanged. (다르면 알려 달라)
- 가정: Q5 (LOW) JSON file schema? → Default: {habit: {YYYY-MM-DD: count}}. (다르면 알려 달라)
- 가정: Q6 (MED) Disk read/write errors other than a missing file (EACCES, EISDIR, missing parent dir)? → Default: stderr message with path and reason, exit 1, no stack trace. (다르면 알려 달라)
- 가정: Q7 (LOW) Validate habit names stored in the data file on load? → Default: yes, rejected as invalid file shape (exit 1). (다르면 알려 달라)
- 가정: Q8 (LOW) Should --help exit 0? → Default: unchanged, usage error exit 2. (다르면 알려 달라)
- 원격 push·PR·배포는 사용자 승인 후에만 수행한다.

## 9. 실행·확인 방법
- `npm test`
- `node qa/cli-smoke.mjs`
- `TALLY_FILE=/tmp/t.json node bin/tally.js add run && TALLY_FILE=/tmp/t.json node bin/tally.js week run`
- `npm test` (필수 check 재실행)
- `node qa/cli-smoke.mjs` (필수 check 재실행)

## 10. 의도적 지름길 (shortcut)
코드의 `shortcut: <한계>, <업그레이드 시점>` 주석 목록이다. 트리거가 없는 항목은 방치될 위험이 있다.

- `src/store.js:49` — no locking, concurrent writers can lose an update; add a lock file if tally is ever run in parallel.

1 markers, 0 with no trigger.

## 정직성 표기
- **기계 검증**: 4절의 check 결과. `mis check`가 명령을 직접 실행하고 exit code를 기록했다.
- **모델 판단**: 2절 작업 완료 여부, 5절 리뷰, 수용 기준 충족 여부. 모델이 작성했으며 기계로 확인되지 않았다.
- **미지원**: 토큰 예산 — 플러그인은 토큰 사용량을 얻을 수 없다. 실행 시간·재시도 상한만 강제한다.
