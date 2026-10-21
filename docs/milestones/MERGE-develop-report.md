# develop 병합 검증 보고서 (8353e07)

- 대상: 병합 커밋 `8353e07`. 부모는 ^1 `0c54461`(M1~M5 라인)과 ^2 `17f800a`(develop, M6·M7)이고, merge-base는 `62df4ea`다.
- 검증자: 독립 verifier. 이 병합 작업에는 참여하지 않았다. 일시: 2026-10-21.
- 리포지토리 변경: 이 파일만 새로 만들었다. 커밋·push·태그는 하지 않았다.

## 요약 판정: PASS (병합 결함 0건. 문서에 LOW 잔재가 있다)

- 양쪽 부모의 테스트가 모두 남아 있다. 사라진 테스트는 없다.
- guard는 두 가지 동작을 모두 지킨다.
  - D-1: run이 EXECUTING일 때 `.git/`과 중첩 저장소의 편집은 ask다. task worktree 소유 판정도 그대로다.
  - develop 쪽: freeze, symlink, 저장소별 범위, trace가 모두 동작한다.
- 이 두 동작은 `node scripts/guard.mjs`에 hook JSON을 직접 넣어 재현했다.
- `npm test`는 430/430이다. 실패·skip·todo는 0이고, 두 번 실행해 같은 결과를 얻었다.
- plugin validate는 2종 모두 통과했다.

## 실행한 명령과 수치

| 확인 | 명령 | 결과 |
|---|---|---|
| 병합 테스트 | `npm test` (2회) | tests 430, pass 430, fail 0, cancelled 0, skipped 0, todo 0 (두 번 모두) |
| 부모·base 테스트 | 각 커밋을 `git archive`로 scratchpad에 풀어 `npm test` | base 319, ^1 321, ^2 428 (모두 fail 0). 계산: 428 + 321 − 319 = **430** = 병합 |
| test() 제목 비교 | 모든 `tests/**/*.mjs`의 `test(` 제목을 ^1·^2·병합에서 비교 | ^2에만 있던 제목 중 병합에서 빠진 것 0개. ^1에만 있던 제목 중 빠진 것 1개: `statusline.test.mjs` "prints the run line…". develop이 M6-06/D11에서 "idle line without a run, run line plus extras with one"으로 이름을 바꾼 것이고, base와 ^1의 원문도 같다. 손실이 아니다 |
| 정적 test() 수 | 같은 방식 | base 151, ^1 153, ^2 260, 병합 262 (= 153 + 260 − 151) |
| 충돌 파일 재계산 | `git merge-tree --write-tree --name-only 0c54461 17f800a` | 7개: README, HANDOFF, guard.mjs, guard.test, mis-bench.test, mis-resume.test, plugin-files.test. PROGRESS.md는 자동 병합 |
| plugin validate | `claude plugin validate .claude-plugin/plugin.json` / `claude plugin validate .` | 둘 다 ✔ Validation passed |
| hardware | `git grep -n -i hardware` | 위험 플래그로 쓰인 곳은 0개. 남은 것은 의도된 것뿐이다: BLOCKED 사유(SKILL.md:89, mis-report.test), iOS `hardwareProperties`, 회귀 단언 `mis-plan.test.mjs:52`, Spec 원문, 문서 기록 |
| stub/skip | `git grep -nE "\.skip\|\.only\|todo\(\|not implemented" -- scripts skills agents hooks tests` | 0건 (exit 1) |
| MCP 서버 | `tools/list`로 `scripts/mcp/server.mjs` 직접 호출 | 도구 54개. README에 나온 도구군이 모두 있다. `.mcp.json` 서버 키는 `mis`이고, policy의 `OWN_MCP = 'mcp__plugin_make-it-ship_mis__'`와 일치한다 |

## guard 재현 (scratchpad 임시 저장소, `MIS_STATE_HOME` 임시 디렉터리)

### (a) D-1

준비:
- `mis start` → `plan set`(plannedFiles `src/**`, T1=`src/a.js`, T2=`src/b.js`) → `mode set quick` → `approve plan`
- 상태는 EXECUTING이 됐다.

| 대상 (cwd = 메인 저장소) | 결과 |
|---|---|
| `.git/hooks/pre-commit` (Edit) | ask |
| `.git/config` (Write) | ask |
| `vendor/lib/x.js` (중첩 `git init` 저장소) | ask |
| `src/a.js` | allow |
| `README.md` | ask |

이어서 `mis worktree add T1`로 task worktree를 만들었다.

| cwd | 대상 | 결과 |
|---|---|---|
| main | `<wt>/src/a.js` (T1 소유) | allow |
| main | `<wt>/src/b.js` (T2 소유) | ask |
| wt | `<main>/README.md` | ask |
| main | `<wt>/.git` | ask |

### (b) develop의 freeze와 trace

별도 저장소 r2에서 run 없이 `mis freeze src`를 실행했다.

| 대상 | 결과 |
|---|---|
| `src/a.js` | allow |
| `README.md` | deny |
| `src/escape/p.js` (밖을 가리키는 symlink) | deny |
| `.git/config` | deny |

저장소별 범위:
- cwd가 다른 저장소 r1이면 r1 파일은 allow다. 그 저장소에는 freeze가 걸리지 않았기 때문이다.
- cwd가 r2(frozen)이면 r1 파일 쓰기는 deny다.

`mis unfreeze` 뒤에는 `README.md`가 allow로 돌아왔다.

trace: 판정마다 `trace.jsonl`에 한 줄씩 쌓였다(16줄). decision과 reason이 기록된다.

## 파일별 충돌 해결 판정

| 파일 | ^1 대비 | ^2 대비 | 판정 |
|---|---|---|---|
| `scripts/guard.mjs` | develop의 `inRepo`, freeze(세션 cwd 기준 root 비교), trace 추가 | D-1의 `gitDir`/`own` 선택 추가. `ctx`는 D-1 규칙으로 고르고, freeze는 별도의 `sessionCtx`로 판정한다 | **정상**. 두 동작을 모두 재현했다 |
| `tests/integration/guard.test.mjs` | develop 테스트 4개 추가 | D-1 테스트 1개 추가 | **정상**. base 10, ^1 11, ^2 14, 병합 15 |
| `tests/integration/mis-bench.test.mjs` | develop의 `benchStatus` 고정 수치 테스트 추가 | ^1의 `setBaseline` 고정 E2E 유지 | **정상**. 테스트 3개. develop의 "noise-sensitive" 주석만 ^1 주석으로 바뀌었다 |
| `tests/integration/mis-resume.test.mjs` | 차이 없음(^1과 동일) | develop의 60초 폴링 대신 marker 또는 child exit를 기다리는 방식 | **정상**. 이벤트 기반으로 더 결정적이다 |
| `tests/unit/plugin-files.test.mjs` | M6 배선 테스트 추가 | marketplace 테스트 추가 | **정상**. 15 → 17 |
| `README.md` | ^1에서 지워진 줄은 CLI 목록 한 줄뿐이다. develop의 freeze, unfreeze, style, loop, test-prompt가 더해진 줄로 바뀌었다. 그 밖에 develop의 Always on과 Tools 절이 추가됐다 | ^1의 Install(마켓플레이스), hardware 제거, validate 2종, Releasing이 들어왔다 | **정상**. `Object.keys(commands)` 31개와 README CLI 목록 첫 단어 31개를 `comm -3`으로 비교했고 차이는 0이다 |
| `docs/HANDOFF.md` | ^1에서 지워진 줄을 하나씩 확인했다(`git diff ^1 -- docs/HANDOFF.md`). 마켓플레이스·업데이트 AUTO, version 올리기(3장 6번·4장), master 전환(3장 6번), 간헐 실패 테스트(2장·5장), D-1·hardware, NH 상태는 모두 다시 적혀 있다. 빠진 것은 세부 기록 두 가지다: bench 수정 전후 1/15→0/15 수치, "저장소 밖 symlink·`.make-it-ship.json` 편집은 9aaf3b1 이후 ask" 참고 문장 | ^2에서 지워진 줄도 확인했다. M8 R3-1~R3-4, M9 N1~N8·D1~D7, `c11e94e`, worktree 경로(절대 경로 `~/Dev/Git/tools/…`로 바뀜)는 모두 다시 적혀 있다 | **정상**. 아래 L-1, L-6 참고 |
| `docs/PROGRESS.md` (자동) | 헤더가 develop 값(IN_PROGRESS/M6)으로 바뀜 | NEEDS_HUMAN 한 줄(NH-5)만 ^1 값 | **정상**. SPEC_CHANGES, FIXES(D-1 포함), RISKS(M7 N8·N9 포함), NEEDS_HUMAN 모두 양쪽 내용이 있고 중복 헤더는 없다. 아래 L-2 참고 |

자동 병합 쪽의 의미 충돌 확인:
- `plan.mjs` RISK_FLAGS: hardware가 없고, 다시 들어온 곳도 없다.
- `mis-concurrency`의 `MIS_LOCK_WAIT_MS`: 병합된 `state.mjs:94`의 `withLock`이 이 값을 그대로 읽는다.
- `policy.mjs`는 develop 버전이고, ^1은 이 파일을 바꾸지 않았다.
- `mis-plan.test`의 `['hardware']` 거부 단언이 남아 있다.

## 결함 목록

병합으로 생긴 결함은 없다. 아래 6건은 문서 정확도 문제이고 모두 LOW다. **모두 판정을 막지 않는다.**

| ID | 심각도 | 위치 | 내용 | 재현 |
|---|---|---|---|---|
| L-1 | LOW | `docs/HANDOFF.md` 3장 1번 | "충돌은 8개 파일에서 났고 … README, PROGRESS, HANDOFF"라고 적혀 있다. 실제 충돌은 7개이고 PROGRESS는 자동 병합이었다 | `git merge-tree --write-tree --name-only 0c54461 17f800a` |
| L-2 | LOW (develop에서 넘어옴) | `docs/PROGRESS.md` 1~3행, M7-05 행 | 헤더는 `CURRENT: M6 / VERIFY: PENDING`인데 M6과 M7 절은 PASSED이고 태그도 있다. M7 절 머리는 PASSED(6차)인데 M7-05 행은 "IN_PROGRESS — 1차 검증 DEFECTS"로 남아 있다 | `head -3 docs/PROGRESS.md`, `sed -n 131,139p` |
| L-3 | LOW (develop에서 넘어옴) | `docs/HANDOFF.md:21` | `node scripts/gap-matrix.mjs --write`를 안내하지만, 이 라인과 develop에는 그 스크립트가 없다. `m9-wip`에만 있다 | `git ls-tree -r --name-only HEAD \| grep gap-matrix.mjs` → 없음 |
| L-4 | LOW (develop에서 넘어옴, `git show 8353e07^2:scripts/mcp/server.mjs`:17에서 확인) | `scripts/mcp/server.mjs:17` | serverInfo version이 `0.2.0`인데 `plugin.json`과 `package.json`은 `0.1.0`이다. 표시값이라 동작에는 영향이 없다 | initialize 응답 |
| L-5 | LOW (base `62df4ea`부터 있었음. base, ^1, ^2 README 모두 같다) | README `mis` CLI 목록 | `note dep\|rootcause\|design` 목록에 `second-opinion`이 빠져 있다. 코드에는 있다(commands.mjs:473) | — |
| L-6 | LOW (병합에서 생김) | `docs/HANDOFF.md` | ^1 HANDOFF에 있던 세부 기록 두 가지가 빠졌다: bench 결정화의 수정 전후 측정치(1/15→0/15), "저장소 밖 symlink·`.make-it-ship.json` 편집은 `9aaf3b1` 이후 ask" 참고 문장. 둘 다 커밋 기록(`27f86f3`, `9aaf3b1`)과 `POST-FINAL-report.md`에 남아 있어 사라진 정보는 아니다 | `git diff 8353e07^1 8353e07 -- docs/HANDOFF.md` |

## 남은 위험

- HANDOFF 0장 경고대로, M8/M9 WIP(develop 기반)를 이 라인에 들여오면 `guard.mjs`, `policy.mjs`, `shell.mjs`에서 충돌이 다시 날 수 있다.
  - D-1 테스트 "files under .git/ or in a nested repo"와 freeze 테스트 4개(D10, R2-7, R3-4 포함)를 함께 다시 돌려야 한다.
- 확인하지 않은 것:
  - 병합본의 마켓플레이스 설치와 MCP 서버 기동(실제 `claude plugin install`)
  - 대화형 확인 창(NH)
  - Linux에서의 lock 동작
- 테스트는 macOS에서 load 약 8~25일 때 실행했다. 고부하 결정성은 다시 측정하지 않았다.
- 원격 상태: `origin/feature/make-it-ship-m1-m5`는 아직 `0c54461`이다(병합 전). push는 사용자 결정이다.
