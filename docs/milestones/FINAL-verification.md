# Make It Ship — 최종 독립 검증 (FINAL)

FINAL: (작성 중)

- 검증 대상: `develop` HEAD `be21dd8` (m5-verified와 동일, 이후 커밋 0)
- 검증자: 독립 서브에이전트(구현 컨텍스트 비상속). 외부 모델 호출·push·commit·tag·패키지 설치·MCP 쓰기 없음.
- 일자: 2026-10-19

## 1. 기본 명령과 수치 (원본 저장소)

| 명령 | 결과 |
|---|---|
| `npm test` | tests 319 / pass 319 / fail 0 / skipped 0 / todo 0 (15.7s) |
| `claude plugin validate .` | ✔ Validation passed |
| `git tag` | m1-verified, m2-verified, m3-verified, m4-verified, m5-verified (5개 모두 존재) |
| `git log m5-verified..HEAD` | 비어 있음 (HEAD = m5-verified = be21dd8) |
| 스텁 grep | 8건, 모두 task 상태 문자열 `'TODO'`(commands.mjs 152/309/512/550, 테스트 픽스처 4건). 실제 스텁·skip·only·미구현 0건 |

## 2. 마일스톤 보고서 최종 라운드

| MS | 최종 라운드 | 태그 커밋 | 태그 이후 커밋 수 | 현재 전체 테스트 |
|---|---|---|---|---|
| M1 | ROUND4: PASS (M1-report.md:505) | a9862cb | 65 | 319/319 통과 |
| M2 | ROUND2: PASS (M2-report.md:130) | a54d31a | 51 | 319/319 통과 |
| M3 | ROUND2: PASS (M3-report.md:156) | 60d1940 | 38 | 319/319 통과 |
| M4 | ROUND3: PASS (M4-report.md:301) | bb945b3 | 22 | 319/319 통과 |
| M5 | ROUND3: PASS (M5-report.md:286) | be21dd8 | 0 | 319/319 통과 |

태그 이후 커밋은 후속 마일스톤 작업이며, 현재 HEAD에서 전체 스위트(M1~M5 테스트 포함)가 모두 통과하므로 이전 마일스톤 자동 검증이 깨진 흔적은 없다. 실사용 회귀 여부는 §4 dogfood에서 별도 확인.

## 5. 제품 약속 재검사 (임시 저장소, 검증자 직접 실행)

### 5.1 "검증 안 된 작업을 완료라 부르지 않는다" — VERIFIED 위조 시도

임시 git 저장소(`node --test` 기반 Quick run, task done, quality 리뷰 기록)에서 `mis` CLI로 직접 시도했다. 스크립트: scratchpad `probe.sh`.

| # | 시도 | 결과 | 판단 |
|---|---|---|---|
| P1 | check를 한 번도 실행하지 않고 verdict | PARTIAL `required check unit is not run` | 정상 |
| P2 | check PASS → VERIFIED 확인 → `lib.mjs` 한 줄 수정 | VERIFIED → PARTIAL `stale (code or config changed)` + 리뷰도 현재 코드 기준 아님 | 정상 (AC#8) |
| P3 | `mis check unit --status PASS` (결과값 주입 플래그) | 플래그는 무시되고 실제 `node --test` 실행 결과(exit 0)만 기록 | 정상 (§7 잔여위험 2행) |
| P4 | 설정 `required.quick: []` (필수 check 0개로 VERIFIED 노림) | `mis start` 거부: `required.quick must list at least one check` | 정상 |
| P5 | 설정 `checks: {}` | `mis start` 거부: `checks must define at least one check` | 정상 |
| P6 | PASS 후 설정의 argv를 `["true"]`로 바꾸고 재-check | 변경 직후 STALE, `true`로 재실행해도 PARTIAL `.make-it-ship.json changed during the run without approval (ask the user: mis approve config)`, 보고서도 PARTIAL로 생성 | 정상 (§7 잔여위험 1행) |
| P7 | 테스트를 실제로 깨고 check | FAILED | 정상 |
| P8 | PASS(E1) → 코드 깨고 FAIL(E2) → 원복(트리 해시가 E1과 동일) | PARTIAL `stale` — 오래된 PASS 증거를 재사용하지 않고 최신 증거 기준으로 판정 | 정상 (보수적) |

### 5.2 "위험 작업은 사용자 승인 필요" — guard 습관 형태 (활성 run이 있는 저장소, main 브랜치)

`scripts/guard.mjs`에 PreToolUse JSON을 직접 넣었다. 스크립트: scratchpad `gprobe.mjs`.

| 분류 | 형태 | 결정 |
|---|---|---|
| 승인 | `node "<root>/scripts/mis.mjs" approve plan` / `cd <repo> && … approve plan` / `… approve plan 2>&1 \| tail -20` / `bash -c "… approve plan"` / `CI=1 … approve continue` / `(cd <repo>; … approve config)` / `… review add … ; … approve plan` | 7/7 **ask** |
| push·PR | `git push` / `git push -u origin feature/fix` / `git add -A && git commit -m fix && git push origin HEAD` / `git -C <repo> push` / `gh pr create --fill --base main` / `gh pr merge 12 --squash` / `git push origin feature 2>&1 \| tail -5` / `gh release create v1.0` | 8/8 **ask** |
| 기본 브랜치 강제 push | `git push --force origin main` / `git push --force-with-lease origin HEAD:main` | 2/2 **deny** |
| 상태 위조 | Write `.git/make-it-ship/runs/r/state.json` / `echo … >> .git/make-it-ship/runs/r/evidence.jsonl` / `rm -rf .git/make-it-ship/runs` | 3/3 **deny** |
| 설치·설정·MCP | `npm install lodash` / `python3 -m pip install requests` / Edit `.make-it-ship.json` / `mcp__…__createJiraIssue` | 4/4 **ask** |
| 정상 흐름(오탐 확인) | `npm test` / `mis check unit` / `mis verdict` / `git status && git diff` / Edit `lib.mjs` | 5/5 개입 없음 |

VERIFIER_PROMPT 판정 기준 (a)(b)(c)에 해당하는 오판정 0건. 헤드리스에서 `ask`는 실행되지 않음(ADR-0001 3b), 대화형 확인 창은 3c에서 사람이 확인했지만 본 플러그인의 실제 승인 창은 NH-1로 남아 있다.

## 3. Spec §2 추적표 행별 판정

자동 테스트는 모두 현재 HEAD에서 319/319 통과. 실사용 증거는 본 검증의 직접 실행(§4·§5) 또는 표시한 마일스톤 보고서.

| PRD AC | 판정 | 자동 테스트 | 실사용 증거 |
|---|---|---|---|
| #1 목표·제약·완료조건 | PASS | `tests/integration/mis-plan.test.mjs` "plan set: schema errors…" | 데모 B/D 이벤트 `plan`(planHash 기록), 보고서 1절 |
| #2 모드 분류·변경 | PASS | `mis-plan.test.mjs` "mode set: reason required, risk flags forbid quick…" | 데모 B/D `mode quick` + 사유 기록 |
| #3 계획·작업 한곳 확인 | PASS | `tests/unit/render.test.mjs`(status 렌더), `mis-report.test.mjs` | 임시 저장소 `mis status` 출력(단계·모드·작업 1/1) |
| #4 승인 범위 내 변경 | PASS (헤드리스) / NEEDS_HUMAN (확인 창, NH-1) | `mis-plan.test.mjs` "unapproved execution is refused…" | §5.2 승인 7형태 모두 ask; 실제 확인 창은 NH-1 |
| #5 실제 실행·불가 표시 | PASS | `mis-check.test.mjs` "check PASS / FAIL…", "cannot run … → BLOCKED" | 데모 B E1 FAIL(exit 1)→E3 PASS, 직접 재실행 8 tests OK; §5.1 P3 결과 주입 무시 |
| #6 요구 적합성·품질 점검 | PASS | `mis-report.test.mjs` "no review → PARTIAL", `verdict.test.mjs` | 데모 B quality 리뷰 1차 MAJOR 1 → 수정 → 재리뷰 0/0 후 VERIFIED |
| #7 불필요 의존성 검토 | PASS | `mis-simplify.test.mjs`, `mis-check.test.mjs` "dependency manifest change needs a reason" | 데모 B/D `changedManifests: []` (M2-report 2차에서 경고 실재 확인) |
| #8 변경 시 재판정 | PASS | `mis-check.test.mjs` "STALE: file edit, new file, and config change…" | 데모 B 코드 깨기 → PARTIAL/STALE, 원복 → VERIFIED; §5.1 P2·P6·P8 |
| #9 4상태 보고 | PASS | `tests/unit/verdict.test.mjs` table-driven | VERIFIED(데모 B/D), PARTIAL(P1), FAILED(P7); BLOCKED는 테스트 + M4 데모 C(qa-cli BLOCKED) |
| #10 중단 후 재확인 | PASS | `mis-resume.test.mjs` "resume after a session is killed mid-check" | 데모 D: E1 FAIL 직후 SIGKILL → 새 프로세스 resume → VERIFIED (§4.2) |
| #11 원격·위험 작업 무승인 금지 | PASS (헤드리스) / NEEDS_HUMAN (확인 창, NH-1·NH-2·NH-4) | `policy.test.mjs`, `shell.test.mjs`, `guard.test.mjs` | §5.2 31형태 오판정 0; 데모 3회 transcript에 guard 오탐 0 |
| #12 외부 플러그인 없이 동작 | PASS | `mis-init-doctor.test.mjs` "doctor … duplicate-plugin warning" | 새 clone + `--setting-sources project --strict-mcp-config`로 데모 B/D 완료 |
| 문제#1 요구사항 이해(interview) | PASS | `mis-plan.test.mjs` "approve plan: gated by HIGH ambiguity…" | 데모 B `interview-add Q1 (MED)` → resolve, 보고서 가정 노출 |
| P0-03 계획 Critic | PASS | `mis-plan.test.mjs` "approve plan: … plan critic bound to current plan" | Quick 경로라 본 검증 데모에서는 해당 없음; M1-report 4차 a2b에서 critic 후 승인 확인 |
| 5.4 원인 분석(debug) | PASS | `mis-retry.test.mjs` "retry needs a root-cause note written after the failure" | 데모 B/D 모두 FAIL 후 `note rootcause` 기록. 단 순서 강제는 retry 경로에서만(RISKS 기록) |
| 8.1 보안 리뷰 | PASS | `verdict.test.mjs` "risk flag without security review → PARTIAL" | 본 검증 데모는 riskFlags 없음; M2-report에서 실증 |
| 데모 A/B | PASS (B 재현) | `evals.test.mjs` "demo b: the reported bug actually reproduces" | §4.1 새 환경 데모 B VERIFIED, 직접 테스트 일치. 데모 A는 M1-e2e/M1-report 4차 기록에 의존(재실행 안 함) |
| 데모 D | PASS | `evals.test.mjs` "demo d: … fails at baseline" | §4.2 |
| 데모 C | PASS (보고서 의존) | `evals.test.mjs` "demo c: …" | M4-e2e/M4-report 3차 기록. 본 검증에서 재실행 안 함 |

FAIL 행: 없음. NEEDS_HUMAN 부분: #4, #11의 대화형 확인 창.

## 4. 새 환경 dogfood (검증자 직접 실행)

환경: `git clone -b develop <repo> <scratchpad>/clone` (HEAD be21dd8). clone에서 `npm test` 319/319, `claude plugin validate .` ✔. Claude Code 2.1.292, Node v22.20.0.
공통 옵션: `--plugin-dir <clone> --setting-sources project --strict-mcp-config --permission-mode bypassPermissions --max-turns 100 --output-format stream-json --verbose`.

### 4.1 (a) 데모 B — 빠른 버그 수정

- 요청: `/make-it-ship:run Fix the bug described in ISSUE.md. Proceed without asking me questions.`
- 이벤트: `start → interview-add Q1(MED) → resolve → plan → mode quick → task T1 start → check E1 FAIL(exit 1) → note rootcause → check E2 PASS → task done → review quality (blocking 0, major 1) → check E3 PASS → review quality (0/0) → verdict VERIFIED → report`
- 변경: `inventory.py`(+9/-1), `tests/test_inventory.py`(+13, 회귀 테스트 4개). `total_value` 변경 없음.
- 검증자 직접 확인:
  - `python3 -m unittest discover -s tests` → 8 tests OK
  - `parse_price`: `"1,234.50"→1234.5`, `"12.50"→12.5`, `"$3"→3.0`, `"12,50"→12.5`, `"1,234,567.00"→1234567.0` (ISSUE.md 요구와 일치)
  - `mis verdict` → VERIFIED, unit PASS
- 깨기/복원: `subn("", …)`을 `subn(",", …)`로 바꿈 → 테스트 errors=2 → `mis verdict` **PARTIAL** (`unit is stale`, `quality review missing for current code`). 원복 → **VERIFIED**. 판정이 실제 코드 상태를 따라감.
  - 참고: REPORTED 이후 `mis check unit`은 `run is REPORTED`로 거부된다. 따라서 보고 후 코드가 깨지면 FAILED가 아니라 PARTIAL(STALE)로 남는다. VERIFIED를 주장하지 않으므로 안전한 쪽.
- 보고서: `docs/make-it-ship/<run>/report.md`에 E1~E3 argv·exit·현재 상태, 무효 증거(E1, E2) 목록, 기계 검증/모델 판단 구분 표기.
- guard: transcript에서 ask/deny 0건.

### 4.2 (b) 데모 D — 강제 종료 후 재개

- 1차 요청: `/make-it-ship:run Make the test suite green as described in TASK.md. Proceed without asking me questions.`
- 강제 종료: `events.jsonl`에 첫 `"type":"check"`가 생기자마자(시작 후 약 32초) claude 프로세스 트리를 SIGKILL. 시점 이벤트: `task T1 start → check-start E1 → check E1 FAIL(exit 1)`. 코드 변경 전, 남은 프로세스 없음.
- 2차(새 프로세스): `/make-it-ship:resume The previous session was killed. Resume the run and finish it. Proceed without asking me questions.`
- 이벤트: `resume (reclaimedLock null, interrupted 0, changed 0) → note rootcause → check E2 PASS → task done → review quality 0/0 → verdict VERIFIED → report`
- 재개 보고: "task T1 반쯤 진행, 실패 재현 기록됨(expected 892, got 893), 코드 변경 없음" — 처음부터 다시 묻지 않고 마지막 지점에서 이어감.
- 검증자 직접 확인: 변경은 `src/cart.js` 1줄(`Math.floor`→`Math.round`)뿐, 테스트 파일 변경 없음(TASK.md "테스트가 아닌 코드 수정" 준수). `npm test` pass 3 / fail 0. `mis verdict` VERIFIED.
- guard: 1차·2차 transcript 모두 ask/deny 0건.

### 4.3 관찰

- 두 실행 모두 `task done`(13:37) 이후 quality 리뷰 기록(13:56)까지 실제 시간이 약 19분이었다. `result.duration_ms`는 각각 130s+22s, 85s로 짧았다. 백그라운드 리뷰 서브에이전트를 기다리는 시간으로 보이며, 두 실행이 같은 초에 끝난 점으로 보아 호스트·API 지연 쪽일 가능성이 높다. 판정 정확성에는 영향 없음. 데모 B는 `-p` 출력에 중간 결과("re-review is running")가 먼저 나오고 같은 프로세스가 이어서 최종 결과를 냈다.
- 두 데모 모두 모델이 `.make-it-ship.json`을 `mis start` 전에 작성했다. 활성 run이 없을 때라 guard 대상이 아니다(§7 적용 범위대로). "질문 없이 진행" 요청에 따른 것이며 README의 "You confirm it before it is written"는 대화형 기준이다.

## 6. NEEDS_HUMAN 점검 (NH-1..NH-9)

| NH | 내용 | 절차 위치 | 절차 구체성 | 통과로 기록된 곳 |
|---|---|---|---|---|
| NH-1 | 대화형 승인 확인 창 | `docs/milestones/M1-e2e.md` "NEEDS_HUMAN" 절(1~5단계) | 구체적 | 없음. PROGRESS "미확인(통과로 기록하지 않음)", M1-report:597 "NH-1을 통과한 것은 아니다" |
| NH-2 | limit BLOCKED 후 `approve continue` 창 | `M2-e2e.md:23` | 구체적(maxAttempts 1 설정 절차) | 없음 ("미확인") |
| NH-3 | HUD 상태 줄·비용 표시 | `M2-e2e.md:25`, `M5-e2e.md` NH-3 | 구체적 | 없음. M2-report는 "PASS (스크립트) / NEEDS_HUMAN (상태 줄 표시)"로 구분 |
| NH-4 | 병렬 중 소유 밖 편집 창 → 충돌 처리 | `M3-e2e.md:26` | 구체적 | 없음 |
| NH-5 | 실제 플러그인 설치 경로 | PROGRESS "절차: README 설치 절" | **불충분** — 아래 D-1 | 없음 |
| NH-6 | iOS 실기기 브리지 | `M5-e2e.md:15-17` | 구체적 | 없음 |
| NH-7 | second opinion 실제 호출 | `M5-e2e.md:18` | 확인 항목 3개 명시 | 없음 (사내 정책상 미호출) |
| NH-8 | Codex 어댑터 실사용 | `M5-e2e.md:19` | 짧지만 실행 가능(데모 A, AGENTS.md 흐름, VERIFIED까지) | 없음 |
| NH-9 | BSP 실제 빌드·타깃 | `M5-e2e.md:20` | **불충분** — 필요 조건만 있고 단계·확인 항목 없음 (D-2) | 없음 |

`grep -rnE "NH-[0-9].{0,60}(PASS|통과|확인 완료|✅)" docs README.md` → 통과 주장 0건(부정문 1건 제외). 9개 모두 미확인으로 정직하게 남아 있다.

