# M2 독립 검증 보고서

- 검증 일자: 2026-10-19
- 대상: `develop` HEAD `bd789b9`. 시작과 종료 시점 모두 `git status`가 clean이었다. 이 파일만 새로 만들었다.
- 검증자: 독립 검증자. 구현에 참여하지 않았다. `docs/PROGRESS.md`와 `M2-e2e.md`는 참고만 하고 모든 결과를 직접 다시 실행했다.
- 범위:
  - Spec §11 M2 행: resume, 재시도 상한, 시간 상한, debug, 보안 리뷰, simplify(의존성 경고·shortcut 목록), doctor, 범위 밖 편집 경고, HUD
  - §2 추적표의 M2 행: #7, #10, PRD 5.4, PRD 8.1, 데모 D
  - §14.3 `/make-it-ship:debug`

## 1. 요약 판정

**DEFECTS FOUND** (LOW 3건, HIGH·MEDIUM 0건)

종료 기준 두 가지는 모두 충족한다.
- **데모 D 통과**: 세션을 강제 종료한 뒤 재개해 VERIFIED가 나왔고, 이 판정은 실제 상태와 일치했다.
- **guard 우회 사례 테스트**: 126개가 통과했고, 직접 추가로 시험한 76개 형태도 전부 올바르게 판정됐다.

결함 3건은 모두 스킬·단계 지시문의 빈틈이다. `mis`의 판정 엔진과 guard 정책 코드에서는 결함을 찾지 못했다.

## 2. 실행한 명령과 결과 수치

| 명령 | 결과 |
|---|---|
| `npm test` | tests 253 / pass 253 / fail 0 / skipped 0 / todo 0 |
| `claude plugin validate .` | ✔ Validation passed |
| `node --test tests/unit/shell.test.mjs tests/unit/policy.test.mjs` | tests 126 / pass 126 / fail 0 |
| 직접 작성한 guard 탐침 (`probe.mjs` 55건, `probe2.mjs` 21건) | 76건 모두 기대값과 일치. M1 R-1~R-6 수정 주장도 확인 |
| 스텁 검색 `grep -rnE "TODO\|FIXME\|\.skip\|\.only\|not implemented\|todo\("` | 6건. 모두 task 상태 리터럴 `'TODO'`였다. 스텁이나 skip은 없음 |
| 헤드리스 실사용 | 10회: d1 3회(설정 확인 정지 1회 포함), d2 2회, d3, d5, d6 2회, d7. 아래 기록 참고 |

## 3. 종료 기준별 표

| 종료 기준 | 판정 | 증거 |
|---|---|---|
| 데모 D 통과 | **PASS** | 실행 d1의 흐름: 첫 `check` 이벤트(E1 FAIL)가 기록된 직후 claude 프로세스 트리를 SIGKILL → 새 프로세스에서 `/make-it-ship:resume` 실행 → `mis resume`(changed 0) → E2 PASS → rootcause 기록 → quality 리뷰 → **VERIFIED** → report. 직접 확인한 결과: `npm test`는 pass 3 / fail 0이고, diff는 `Math.floor→Math.round` 한 줄뿐이다. 수정을 되돌리면 `mis verdict`가 PARTIAL(unit stale, quality 리뷰 없음)로 바뀌고, HUD는 `unit~ · PARTIAL`을 표시한다. 원래대로 되돌리면 다시 VERIFIED가 된다 |
| guard 우회 사례 테스트 | **PASS** | 자동 테스트: `tests/unit/shell.test.mjs`의 조합 매트릭스(13 컨테이너 × 19 래퍼 × 7 명령), 변수·함수 경유 approve, 데이터 속 문구 미오탐, 상태 위조 deny, 퍼징 4000건, 스킬 지시 명령 미오탐. 그리고 `tests/unit/policy.test.mjs`. 직접 시험한 형태: `node --stack-size 999 mis.mjs approve`, `bash -e -o pipefail -c`, `bash <<EOF` 본문, `pnpm -C x add`, `yarn --cwd x add`, `xargs … approve`, main 브랜치에서 `git push -f`, `git -c … -C .. push origin main --force`가 모두 기대한 ask/deny로 판정됐다 |

## 4. M2 범위 항목별 판정

| 항목 | 판정 | 구현 | 자동 테스트 | 실사용 증거 |
|---|---|---|---|---|
| resume | PASS | `commands.mjs` `resume()` | `mis-resume.test.mjs`: 실제 SIGKILL로 check 도중 lock 회수, 변경 파일·STALE·진행 중 task 출력 | d1, d2b, d6, d6b에서 `resume` 이벤트가 기록됐고 재개 보고가 실제 상태와 맞았다. 다만 강제 종료가 mis 명령 사이에 떨어져서 lock 회수(`reclaimedLock`)는 실사용에서 일어나지 않았고, 이 부분은 통합 테스트로만 확인했다 |
| 재시도 상한 | PASS | `task retry` → `limitBlock` | `mis-retry.test.mjs`: 상한 도달 시 BLOCKED, `approve continue`로 1회 추가 | d4(**CLI로 직접 구동**, 모델 실행 아님): fail → rootcause 없이 retry는 거부 → 형식이 틀린 노트는 거부 → retry(attempts 2) → fail → retry에서 BLOCKED, verdict BLOCKED, `task done`도 거부. `approve continue` 후 attempts 3 |
| 시간 상한 | PASS | `pastDeadline` → `deadlineBlock` (check·task start·retry 시점에 검사) | `mis-retry.test.mjs` runtime limit | d6: 검증자가 state의 deadline을 과거로 바꾼 뒤 헤드리스 resume을 실행했다. 모델의 `mis check`가 BLOCKED로 거부됐고, 모델이 시도한 `mis approve continue`는 guard ask로 막혔다(permission_denials 1건). 운영자가 터미널에서 `approve continue`를 실행한 뒤 d6b가 VERIFIED로 마쳤다. 참고로 d3(1분 상한)는 57초 만에 끝나 상한이 발동하지 않았으므로 증거로 쓰지 않는다 |
| debug (PRD 5.4) | PASS | `task retry` rootcause 게이트, `note rootcause`의 REPRODUCTION/HYPOTHESIS/EVIDENCE 필수 | `mis-retry.test.mjs`: 노트 없이 retry 거부, 실패 이전의 노트는 무효, 형식 오류 거부 | d4(CLI): 거부 메시지 확인. 실사용 d1-resume, d3, d6에서 모델의 첫 rootcause 노트가 형식 오류로 거부됐고, 다시 작성해 기록됐다 |
| `/make-it-ship:debug` (§14.3) | PASS (결함 D-3 별도) | `skills/debug/SKILL.md` → `phases/debug.md` | `plugin-files.test.mjs:62`: 텍스트 매칭만 함 | d5(run 없음): 원인 `src/cart.js:13`을 실험으로 확인했고 코드는 바꾸지 않았다(git clean). d7(활성 run, T1 FAILED): `note rootcause` 이벤트가 기록됐고 코드 변경 없이 retry 여부를 사용자에게 물었다 |
| 보안 리뷰 (PRD 8.1) | PASS | `verdict.mjs` `requiredReviews`: riskFlags가 있으면 security 필수 | `verdict.test.mjs:39-40` table-driven | d4(CLI): security 리뷰가 없으면 PARTIAL, 기록하면 VERIFIED, 코드를 바꾸면 이전 security 리뷰는 무효(PARTIAL). d2/d2b(Standard, payment 플래그): spec·quality·security 리뷰 3건이 기록된 뒤 VERIFIED |
| simplify: 의존성 경고 (#7) | PASS | `deps.mjs`, `check` 경고, verdict PARTIAL | `mis-simplify.test.mjs`, `verdict.test.mjs:43-44` | d4: `package.json`에 left-pad를 추가하자 check 경고가 나오고 verdict PARTIAL. `mis note dep`을 기록하자 VERIFIED |
| simplify: shortcut 목록 | PASS | `debt.mjs`, 보고서 §10 | `mis-simplify.test.mjs`: trigger 없는 항목 표시, gitignore·docs 제외 | d2 실사용 보고서 §10에 모델이 추가한 `src/cart.js:13` 주석이 `(no-trigger)` 표시와 함께 나열됐다. d4 보고서에도 나열됐다 |
| doctor | PASS | `setup.mjs` `doctor` | `mis-init-doctor.test.mjs`: 중복 플러그인은 경고만 하고 설정 오류는 error | d4와 d2 실사용 모두 node/git/config ok, plugins warn(경고만, ok=true) |
| 범위 밖 편집 경고 | PASS (코드) / 실사용 미발생 | `policy.mjs` `classify` Write/Edit → plannedFiles glob | `policy.test.mjs:120-134`, `guard.test.mjs:55` | 실제 `scripts/guard.mjs`에 d2 상태를 넣어 확인했다. `README.md` Write → ask("outside the approved plan's files"), `src/cart.js` Edit → allow. 하지만 실사용 8개 transcript 모두 코드를 Bash(`sed -i`, python heredoc)로만 고쳐서, 이 경고가 발동할 기회가 없었다(R-1) |
| HUD | PASS (스크립트) / NEEDS_HUMAN (상태 줄 표시) | `scripts/statusline.mjs`, `mis init`의 `hud` 제안 | `statusline.test.mjs` | 실행 결과: `MIS ▸ VERIFYING · T1/1 · unit✓ · VERIFIED`, 블록 시 `MIS ▸ BLOCKED · T0/1 · unit· · BLOCKED`, 코드 변경 후 `unit~ · PARTIAL`. 실제 Claude Code 상태 줄에 표시되는지는 NH-3 |

## 5. 추적표(§2) M2 행별 판정

| 행 | 판정 | 자동 테스트 (실제로 주장을 시험하는가) | 실사용 |
|---|---|---|---|
| #7 불필요한 의존성 | PASS | `mis-simplify.test.mjs` 1번: 실제 git 저장소에서 manifest를 바꾸면 경고, 노트를 쓰면 해제. 동어반복 아님 | d4 |
| #10 중단 후 재확인 | PASS | `mis-resume.test.mjs`: 자식 프로세스를 SIGKILL해 lock 회수까지 실제로 재현 | d1(kill → resume → VERIFIED), d6 |
| PRD 5.4 원인 분석 | PASS | `mis-retry.test.mjs` 1번: 노트 없음, 형식 오류, 실패 이전 노트 각각 거부 | d4, d7 |
| PRD 8.1 보안 | PASS | `verdict.test.mjs:39-40` | d2b, d4 |
| 데모 D | PASS | 수동 E2E(Spec 규정) | d1 |

테스트가 없는 M2 §2 행은 없다.

## 6. 스텁·skip 검사

`grep -rnE "TODO|FIXME|\.skip|\.only|not implemented|todo\(" scripts skills agents hooks tests templates evals` 결과는 6건이다.
- `commands.mjs:130, 279, 441`
- `statusline.test.mjs:11`
- `verdict.test.mjs:28`
- `mis-plan.test.mjs:59`

모두 task 상태값 `'TODO'`이다. `.skip`, `.only`, 미구현 분기는 없다. `npm test` 출력에서도 skipped 0, todo 0이다.

## 7. 실사용 검증 기록

공통 환경:
- 명령: `claude -p … --plugin-dir <repo> --setting-sources project --strict-mcp-config --permission-mode bypassPermissions --output-format stream-json --verbose`
- 데모 생성: `node evals/setup-demo.mjs d <scratch>/dN`
- 같은 시간대에 다른 세션이 sibling 디렉터리 `make-it-ship-m2`에서 M3 작업을 하고 있었다. 이 검증은 그 디렉터리를 사용하지 않았다.

| 실행 | 요청 / 조작 | 결과 | 실제 상태 대조 |
|---|---|---|---|
| d1 첫 시도 | `/make-it-ship:run Fix the failing test…` (질문 없이 진행하라는 문구 없음) | 설정 확인을 기다리며 정지(설정 미작성). Spec §9 1단계와 일치(M1 L-1에서 수용) | `.git/make-it-ship` 없음 |
| d1 | 같은 요청 + "Proceed without asking…". 첫 `check` 이벤트가 나온 직후(30초) 프로세스 트리를 SIGKILL | 이벤트: start → plan → mode quick → task start → E1 FAIL. kill 시점에는 코드 변경이 없었다 | `mis status`: EXECUTING, T1 IN_PROGRESS, verdict FAILED |
| d1 resume | `/make-it-ship:resume The previous session was killed…` | resume(changed 0) → E2 PASS → rootcause(첫 시도는 형식 오류로 거부) → T1 done → quality 리뷰(0/1) → **VERIFIED** → report. guard ask/deny 0건 | `npm test` pass 3 / fail 0. 수정을 되돌리면 PARTIAL, 원복하면 VERIFIED |
| d2 (Standard) | "Use standard mode…" | interview, plan, critic(1차 blocking 1 → 계획 수정 → 2차 0/0). `approve plan`에서 guard ask로 정지. **permission_denials는 approve 1건뿐이었다** | AWAITING_APPROVAL, verdict PARTIAL |
| d2b | 운영자가 터미널에서 `mis approve plan` 실행 → resume | E1 FAIL(기준선) → rootcause → T1(테스트 4개) → T2(수정) → E2/E3 PASS → spec/quality/security 리뷰 → **VERIFIED**. denials 0 | `npm test` pass 7 / fail 0 |
| d3 | `maxRuntimeMinutes: 1` | 57초 안에 끝나 상한이 발동하지 않았다 → VERIFIED. 상한 증거로 쓰지 않음 | — |
| d4 | CLI 직접 구동 | 재시도 상한, 보안 리뷰, STALE, 의존성, shortcut, doctor (4절) | — |
| d5 | `/make-it-ship:debug The cart test suite fails…` (run 없음) | 원인과 실험을 보고했고 코드 변경은 없었다 | `git status` clean |
| d6 | 검증자가 run 생성 + deadline을 과거로 변경 → resume | check는 BLOCKED, `approve continue`는 guard ask(denied). 최종 메시지가 verdict를 "PARTIAL"로 잘못 인용(D-2) | `mis verdict` = BLOCKED |
| d6b | 운영자가 `approve continue` 실행 → resume | 실패 재현 없이 곧바로 `sed`로 수정 → E1 PASS → **VERIFIED**. FAIL 증거와 rootcause가 없다(D-1) | `npm test` pass 3 |
| d7 | 활성 run, T1 FAILED → `/make-it-ship:debug` | `note rootcause` 이벤트가 기록됐고 코드 변경은 없었다. `tail .git/make-it-ship/runs/…/logs/E1.log`는 guard가 deny(D-3) | T1 FAILED 그대로 |

대화형 확인 창(`approve plan`, `approve continue`)은 헤드리스에서 ask가 거부로 처리되는 것까지만 확인했다(ADR-014). 실제 창이 뜨는지는 NEEDS_HUMAN이다.

## 8. 결함 목록

| ID | 심각도 | 내용 | 재현 | 위치 |
|---|---|---|---|---|
| D-1 | LOW | resume 스킬이 "IN_PROGRESS인 버그 수정 task인데 FAIL 증거가 없다"는 경우를 reproduce-first로 돌려보내지 않는다. 그래서 d6b에서 모델이 phase 파일을 읽기 전에 `sed`로 수정했고, 기준선 FAIL 증거도 rootcause도 없이 VERIFIED가 됐다. 구현자도 M2-e2e d1에서 같은 패턴을 스킬 결함으로 보고 `implement.md`만 고쳤다(26be5e0). 재개 경로에는 그 수정이 반영되지 않았다. 판정 규칙(§6)상 VERIFIED는 맞지만, "원인 없이 수정 금지"라는 debug 단계의 목적을 재개 경로가 우회한다 | d6 절차: run 생성, task start, FAIL 증거 없음 → `/make-it-ship:resume` | `skills/resume/SKILL.md` 3단계 "a task left IN_PROGRESS: check its acceptance criteria … then continue it" |
| D-2 | LOW | 재개 중 limit BLOCKED로 멈출 때 `mis verdict`를 다시 실행하라는 지시가 없다. d6 최종 메시지는 블록되기 전에 받은 `mis status` 출력을 근거로 "verdict … is PARTIAL"이라고 했지만, 실제 `mis verdict`는 BLOCKED였다. "판정 문구는 mis 출력만 인용"(Spec §9)이라는 규칙을 오래된 출력으로 어긴 것이다. 완료를 주장하지는 않았다 | d6 | `skills/resume/SKILL.md` 3단계 BLOCKED 항목. `run/SKILL.md` 마지막 문단(`mis block` → `mis report`)이 limit 블록 경로에는 연결되지 않음 |
| D-3 | LOW | debug 단계 1번은 "the full log if needed"를 읽으라고 지시한다. 그런데 로그는 `.git/make-it-ship/runs/<id>/logs/E*.log`에만 있고, 이를 보여 주는 `mis` 하위명령이 없다. run 스킬은 그 경로를 직접 읽는 것을 금지하고, guard는 Bash 명령을 deny한다. d7 transcript에서 실제로 deny가 1건 발생했다. guard 판정 자체는 §7 표("Bash 명령에 `make-it-ship/runs` 포함 → deny")대로이므로 guard 결함이 아니라 지시문 결함이다. 모델은 테스트를 직접 실행하는 방식으로 우회했다 | d7: 활성 run에서 check FAIL 후 `/make-it-ship:debug` | `skills/run/phases/debug.md:7`, `skills/run/SKILL.md` Hard rules 1번 |

HIGH·MEDIUM 결함은 없다. guard에서는 판정 기준 (a), (b), (c)에 해당하는 결함이 없다.

## 9. 미검증 항목

- **NH-2**: 대화형 세션에서 `mis approve continue` 확인 창이 뜨는지, 그리고 승인·거절 각각의 결과. 헤드리스에서는 ask가 거부로 처리되는 것까지만 확인했다.
- **NH-3**: HUD. `statusLine`을 `~/.claude/settings.json`에 등록하고 재시작한 뒤 실제 상태 줄에 표시되는지. 스크립트 출력은 확인했다.
- **NH-1**(M1에서 이어짐): 대화형 `approve plan` 확인 창.
- 실사용 중 lock 회수: kill이 mis 명령 사이에 떨어져 `reclaimedLock`이 모두 null이었다. 통합 테스트로만 확인했다.
- 재시도 상한을 모델이 실제로 겪는 경로: CLI(d4)와 통합 테스트로만 확인했다.

## 10. 남은 위험

- **R-1 범위 밖 편집 경고의 실효성**: guard는 Write/Edit만 검사한다(Spec §7 행 정의와 일치). 실사용 transcript 8개(d1 run1, d1 resume, d2, d2b, d3, d5, d6, d6b)에서 모델은 Edit/Write를 한 번도 쓰지 않았다. 모든 코드 수정이 Bash `sed -i`나 python heredoc이었다. 실제 사용에서는 이 경고가 거의 발동하지 않을 수 있다. 확인 결과: Bash `sed -i … README.md`는 allow.
- **R-2 종료된 run에도 guard가 계속 적용됨**: `activeRun`은 CANCELLED가 아니면 참이다(`guard.mjs:18`). 그래서 REPORTED인 d2에서도 `README.md` Write는 ask(범위 밖)이고 `git push`도 ask였다. Spec §7의 "진행 중인 실행이 있을 때만"이라는 적용 범위 문구와 어긋나며, run이 끝난 뒤 이어지는 작업에서 불필요한 확인 창이 뜰 수 있다. §7 표 행의 기본 형태가 아니고 transcript에서도 발생하지 않아 결함으로 분류하지 않았다.
- **R-3 rootcause 순서**: PROGRESS RISKS에 이미 수용돼 있다. 이번 검증에서도 d1-resume과 d3에서 수정 뒤에 노트가 기록됐다(2회 추가 관찰).
- **R-4 범위 검사가 꺼지는 조건**: plan에 `plannedFiles`가 없으면 `tasks[].files`가 있어도 범위 검사를 하지 않는다(`guard.mjs:17`).
- **R-5 시간 상한 검사 시점**: 상한은 `check`, `task start`, `task retry`에서만 검사한다. 리뷰, verdict, report는 상한이 지나도 진행된다.
- **R-6 의존성 사유의 범위**: `note dep`이 하나라도 있으면 이후 다른 manifest 변경에도 경고와 PARTIAL이 모두 해제된다.
- **R-7 모델 판단의 정확도**: d5에서 모델이 제안한 회귀 테스트 예시 중 "1007@15% = 151.05 → just above half"는 설명이 틀렸다. 플러그인이 아니라 모델 판단의 영역이다.

## 2차 검증 (round 2)

**ROUND2: PASS**

- 검증 일자: 2026-10-19
- 대상: `develop` HEAD `d6ceac1`
  - 1차 이후 커밋은 `bd789b9`(PROGRESS)와 `d6ceac1`(M2-fix) 두 개다.
  - `d6ceac1`이 바꾼 파일: `skills/resume/SKILL.md`, `skills/run/phases/debug.md`, `scripts/guard.mjs`, `tests/integration/guard.test.mjs`, `docs/PROGRESS.md`
- 검증자: 새 독립 검증자. 1차 결과와 커밋 메시지를 믿지 않고 모두 다시 실행했다.
- 수정한 파일: 이 파일 끝에 이 절만 추가했다. 1차 본문은 바꾸지 않았다.
- 실험 위치: 저장소 밖 scratchpad(`…/scratchpad/r2/{k1,nf,bl,dbg,std}`). 다른 worktree와 브랜치는 사용하지 않았다.

### R2-1. 실행한 명령과 결과 수치

| 명령 | 결과 |
|---|---|
| `npm test` | tests 254 / pass 254 / fail 0 / skipped 0 / todo 0. 1차보다 1개 늘었는데, guard 통합 테스트 1건이 추가됐다 |
| `claude plugin validate .` | ✔ Validation passed |
| `node --test tests/unit/shell.test.mjs tests/unit/policy.test.mjs` | tests 126 / pass 126 / fail 0 |
| `node --test tests/integration/guard.test.mjs` | tests 8 / pass 8 / fail 0 |
| 스텁 검색 `grep -rnE "TODO\|FIXME\|\.skip\|\.only\|not implemented\|todo\("` | 6건, 1차와 같다. 모두 task 상태 리터럴 `'TODO'`이고 스텁이나 skip은 없다 |
| 헤드리스 실사용 | 7회: k1 실행·재개, nf, bl, dbg, std 1차·재개. 모두 `--output-format stream-json --verbose`로 실행했다 |

새 테스트 `guard: plan scope only applies while executing…`가 시험하는 내용:
- 실제 `mis`로 run을 진행하면서 같은 범위 밖 Write를 판정한다. EXECUTING에서는 ask, `report` 뒤에는 allow로 바뀐다.
- REPORTED에서 `git push`는 여전히 ask다.

판정이 실제로 바뀌는지를 시험하므로 동어반복이 아니다.

### R2-2. 1차 결함 재검증

| ID | 원래 재현 | 2차 결과 | 판정 |
|---|---|---|---|
| D-1 | run을 만들고 task를 start한 상태에서 FAIL 증거 없이 `/make-it-ship:resume` 실행 | **nf**: CLI로 같은 상태(T1 IN_PROGRESS, check 없음)를 만들고 헤드리스 resume을 실행했다. 이벤트 순서는 resume → E1 FAIL(03:39:54) → rootcause(03:40:08) → E2 PASS → done → quality → VERIFIED. 모델 출력 "No failing check recorded yet — reproduce first." `npm test` pass 3 / fail 0. **bl**에서도 모델이 수정보다 먼저 `mis check`를 실행했다(D-2 참고). 한 가지 실수가 있었다: nf에서 첫 `$M note rootcause`가 zsh에서 실패했는데 수정은 그대로 적용됐다. 모델이 스스로 알아차려 수정을 되돌리고(`git checkout`), 노트를 기록한 뒤 다시 수정했다. 최종 이벤트 순서는 올바르다(R2-5 참고) | **해결** |
| D-2 | 재개 중 시간 상한 BLOCKED에서 오래된 verdict를 인용 | **bl**: run을 만든 뒤 `deadlineAt`을 1시간 전으로 바꾸고 헤드리스 resume을 실행했다. 모델은 재현하려고 `mis check unit`을 실행했고 BLOCKED로 거부됐다. 이어서 **`mis verdict`를 다시 실행**하고 "`mis verdict` says **BLOCKED**"라고 인용했다. 실제 `mis verdict`도 BLOCKED. `approve continue`는 시도하지 않고 사용자에게 넘겼다. permission_denials 0, 코드 변경 0 | **해결** |
| D-3 | 활성 run에서 T1 FAILED 상태로 `/make-it-ship:debug` 실행. 모델이 `tail .git/make-it-ship/runs/…/E1.log`를 시도해 guard에 deny됨 | **dbg**: 같은 상태(E1 FAIL, T1 FAILED)에서 실행했다. 모델은 `npm test`로 직접 재현했고 상태 디렉터리 경로는 한 번도 시도하지 않았다. permission_denials 0. 이벤트는 rootcause → `task T1 retry`. 코드 변경은 없었다. `skills/run/phases/debug.md:7`이 "check tail 또는 프로젝트 러너로 재실행"으로 바뀌었고, `skills`·`agents` 어디에도 로그 파일을 직접 읽으라는 지시가 남아 있지 않다(grep 확인) | **해결** |

참고 (결함 아님):
- debug.md:7의 "the guard blocks that path"는 엄밀히 Bash 명령과 Write/Edit에만 맞는 말이다. guard matcher에 Read 도구가 없기 때문이다. 다만 직접 읽지 말라는 지시 자체는 `run/SKILL.md` Hard rule과 일치한다.
- dbg에서 모델은 `task T1 retry`를 스스로 실행해 마지막 시도 횟수를 쓴 뒤에 수정 여부를 물었다(1차 d7은 retry 전에 물었다). `skills/debug/SKILL.md` 2번과 `debug.md` 7번이 이 순서를 허용하므로 행동 관찰로만 기록한다.

### R2-3. 종료 기준 재확인

| 종료 기준 | 판정 | 증거 |
|---|---|---|
| 데모 D 통과 (kill 후 resume) | **PASS** | **k1**: `/make-it-ship:run …quick mode` 실행 중 `task start` 이벤트가 나오자마자 claude 프로세스와 그 자식을 SIGKILL했다(29초 시점). E1 FAIL 이벤트도 그 직후(1초 뒤) 기록됐다. 이미 실행 중이던 `mis check`가 끝까지 기록한 것이다. 이때 코드 변경은 없었다. 새 프로세스에서 `/make-it-ship:resume`을 실행한 흐름: resume(changed 0) → `node --test`로 재현 → rootcause → Edit(`Math.floor→Math.round`) → E2 PASS → done → quality 리뷰 → **VERIFIED** → report. denials 0. 직접 대조: `npm test` pass 3 / fail 0. 수정을 stash하면 `mis verdict`가 PARTIAL("unit is stale", "quality review missing")로 바뀌고, 되돌리면 VERIFIED. `reclaimedLock`은 이번에도 null이었다 |
| guard 우회 사례 테스트 | **PASS** | `shell.test.mjs`·`policy.test.mjs` 126/126. 1차 이후 `scripts/lib/shell.mjs`·`policy.mjs`는 바뀌지 않았다(`git show --stat d6ceac1`). 이번 커밋에서 guard 쪽 변경은 `scripts/guard.mjs`의 plannedFiles 적용 조건뿐이다 |

**Standard 실사용 (판정 기준 필수 항목)**:
- **std 1차**: `/make-it-ship:run … Use standard mode. Proceed without asking…`
  - 흐름: init → interview(Q1 MED, Q2 LOW, 기본값으로 해소) → plan → mode standard(payment 플래그) → plan-critic(major 1) → plan 수정 → plan-critic(0/0) → `approve plan`에서 guard ask로 정지.
  - **permission_denials는 1건뿐이었고, `… review add plan-critic … ; mis approve plan` 명령에 대한 것이었다.** 거부 사유는 "approval is recorded only when you confirm this command".
  - 상태는 AWAITING_APPROVAL. 최종 메시지는 `mis report`의 PARTIAL을 인용했고 실제 상태와 일치했다.
- **운영자 승인**: 검증자가 터미널에서 `mis approve plan`을 실행했다 → EXECUTING.
- **std 재개**: resume → task start → E1 FAIL → rootcause → E2 PASS → done → spec·quality·security 리뷰(모두 0/0) → **VERIFIED** → report. **denials 0.** 오류는 모델의 `$M` zsh 실패 1건뿐이었다.
- 직접 대조: `npm test` pass 3. 모델이 작성한 plan의 `plannedFiles`는 `["src/cart.js"]`이고, 수정도 이 파일뿐이다.
- 결론: 승인 외의 guard ask나 deny는 없었다. 판정 기준 (b)에 해당하는 오탐도 없다.

### R2-4. SPEC_CHANGES 해석 검토 (REPORTED 이후 guard 적용 범위)

기록된 해석(`docs/PROGRESS.md` SPEC_CHANGES):
- 취소되지 않은 현재 run이 있으면 원격 쓰기·설치는 계속 ask다.
- plannedFiles 범위 검사는 PLANNING~VERIFYING에서만 적용한다.

실제 판정을 `scripts/guard.mjs`에 직접 넣어 확인했다(`probe.mjs`):

| 상태 (run) | 범위 밖 Write `README.md` | `src/cart.js` Write | `.make-it-ship.json` | `git push` | `npm install` | main `push --force` | `approve` | 상태 경로 Bash |
|---|---|---|---|---|---|---|---|---|
| EXECUTING (dbg) | ask | allow | ask | ask | ask | deny | ask | deny |
| BLOCKED·limit (bl) | **allow** | allow | ask | ask | ask | deny | ask | deny |
| REPORTED (k1, std) | allow | allow | ask | ask | ask | deny | ask | deny |

- **정직성**: SPEC_CHANGES 문구("PLANNING~VERIFYING에서만")는 코드의 상태 목록과 정확히 일치한다. Spec 본문을 몰래 바꾸지 않았고, "(해석)"으로 표시했다. 다만 커밋 메시지와 코드 주석의 표현("only before the report", "after the report, edits are new work")은 실제 동작보다 좁다. limit BLOCKED도 "보고 전" 상태인데 범위 검사가 꺼지기 때문이다. 표현이 부정확한 것이지, 수정 주장이 거짓인 것은 아니다.
- **Spec 일관성**:
  - REPORTED 뒤에도 원격 쓰기·설치를 ask로 유지하는 것은 §7의 "진행 중인 실행이 있을 때만"이라는 문구보다 엄격하다.
  - 하지만 §5.3은 `SHIPPED` 상태를 두지 않고 "push/PR은 사용자 승인으로 수행"한다고 하고, §14의 ship 단계도 "push/PR/배포는 ask"를 요구한다. 그래서 REPORTED에서 ask를 유지해야 ship 단계의 승인 규칙이 성립한다. 문서화된 해석으로서 Spec과 정합한다.
  - 범위 검사를 REPORTED에서 끄는 것은 1차 R-2(종료된 run 뒤 불필요한 확인 창)를 해소한다.
- **BLOCKED에서 범위 검사가 꺼지는 문제**: `approveContinue`(`commands.mjs:215`)는 `s.state = s.blockedFrom`으로 BLOCKED 이전 상태(예: EXECUTING)로 되돌린다. 따라서 limit BLOCKED는 계획 실행 중의 일시 정지 상태다. 이 상태에서 범위 밖 Write를 해도 ask가 뜨지 않고, 그 편집을 안은 채 run이 이어질 수 있다. 결함으로 분류하지 않은 이유:
  - (a)가 아니다. limit BLOCKED가 §7의 "진행 중"에 해당하는지는 해석의 문제이고, 기록된 해석이 이 경우를 명시적으로 다룬다(상태 목록).
  - (b)가 아니다. resume 스킬은 limit BLOCKED에서 멈추라고 지시하고, bl과 1차 d6 transcript 모두 BLOCKED 중에 편집하지 않았다.
  - (c)가 아니다. 셸 매트릭스와 무관하다.
  
  그래서 남은 위험(R2-R1)으로 기록한다.

### R2-5. 남은 위험 (2차 추가분)

- **R2-R1 limit BLOCKED 중 범위 검사 해제**: R2-4 참고. 보완하려면 `executing` 조건에 `state === 'BLOCKED' && blockKind === 'limit'`을 포함하면 된다. 아니면 SPEC_CHANGES와 코드 주석에 BLOCKED를 명시해야 한다.
- **R2-R2 모델의 `M="node …"; $M` 습관**: zsh는 변수를 단어 단위로 나누지 않으므로 이 형태는 실패한다. 이번 실사용에서 k1, nf, bl, dbg, std에서 반복해서 관찰됐다.
  - nf에서는 이 때문에 rootcause 노트보다 수정이 먼저 적용됐다가, 모델이 스스로 되돌렸다. 이미 수용된 RISKS(rootcause 순서는 모델 판단)의 한 사례다.
  - 스킬은 `mis` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"`라고만 정의하므로 이 형태는 지시된 것이 아니다.
  - `mis`가 실패하면 retry 게이트가 거부하므로 거짓 완료로 이어지지는 않는다.
- **lock 회수 실사용 미발생**: k1에서도 `reclaimedLock`이 null이었다. 여전히 통합 테스트(`mis-resume.test.mjs`)로만 확인된다.
- 1차 R-1, R-3~R-7은 그대로 남아 있다. R-1과 R-3은 PROGRESS RISKS에 수용돼 있다. 1차 R-2는 범위 검사 부분이 해소됐고, 원격 쓰기 ask가 유지되는 부분은 위 해석으로 정리됐다.

### R2-6. 미검증 항목

NH-1, NH-2, NH-3(대화형 확인 창, HUD 상태 줄)은 1차와 같이 NEEDS_HUMAN이다. 헤드리스에서는 ask가 거부로 처리되는 것까지만 확인했다.

### R2-7. 결론

- 1차 결함 D-1, D-2, D-3은 원래 재현 절차로 다시 시험했고 모두 해결됐다.
- 새 결함은 없다. 판정 기준 (a), (b), (c)에 해당하는 guard 결함도 없다.
- 종료 기준 두 가지(데모 D kill/resume, guard 우회 사례 테스트)는 계속 충족된다.
- Standard 실사용에서 승인 외의 guard 개입은 없었다.
