# Make It Ship — 최종 보고서 (FINAL)

- 작성: 2026-10-19 · 브랜치 `develop` · 기준 문서: `docs/Make_It_Ship_Spec_v1.1.md`(구현 기준), `docs/adr/0001-host-smoke.md`, `docs/adr/0002-parallel-state.md`, `docs/Make_It_Ship_Product_Plan_v1.0.md`
- 최종 검증: **FINAL: PASS** — `docs/milestones/FINAL-verification.md` (3라운드). 1차는 기능 전체를 확인했다: 새 clone, 데모 B 빠른 수정, 데모 D 강제 종료→재개, VERIFIED 위조 시도, guard 습관 형태, §2 전 행. 2·3차는 NEEDS_HUMAN 절차 보완(NH-5 project scope, 항목별 PASS 조건)과, 고부하에서 비결정적이던 동시성 테스트를 결정적으로 바꾼 것을 확인했다. 최종 커밋 기준 `npm test` 319/319, `claude plugin validate .` 통과.

## 1. 결과

| 마일스톤 | 범위(Spec §11) | 독립 검증 | 태그 |
|---|---|---|---|
| M0 | 호스트 실증 | ADR-0001 (사전 완료) | — |
| M1 | 핵심 경험: mis 핵심 명령, guard, run/status, discover·interview·plan·plan-critique·implement·verify·review | 4차 PASS — `docs/milestones/M1-report.md` | `m1-verified` |
| M2 | 신뢰성: resume, 재시도·시간 상한, debug, 보안 리뷰, simplify, doctor, 범위 밖 편집, HUD | 2차 PASS — `M2-report.md` | `m2-verified` |
| M3 | 선택형 협업: worktree 병렬, 파일 소유권, product-review·design·design-explore, 상태 저장 재검토(ADR-0002) | 2차 PASS — `M3-report.md` | `m3-verified` |
| M4 | 제품화: qa 프로파일(CLI·API·Web·iOS 시뮬레이터), ship, 문서 단계, 데모 C, 파일럿 8종 | 3차 PASS — `M4-report.md` | `m4-verified` |
| M5 | 확장: retro, learn, second opinion, iOS 실기기 브리지, ~~BSP 프로파일~~(사후 제거), 벤치마크, 토큰 예산(표시), Codex 어댑터 | 3차 PASS — `M5-report.md` | `m5-verified` |

모든 마일스톤은 같은 순서로 진행했다.
1. 작업마다 실패 테스트를 먼저 쓰고, 최소 구현 뒤 `npm test` 전체 통과를 확인하고 커밋했다.
2. 마일스톤이 끝나면 구현 맥락을 모르는 새 에이전트가 회의적으로 검증했다.
3. 결함이 나오면 고친 뒤 다시 검증했다. 라운드별 기록은 각 보고서에 남아 있다.

검증 라운드에서 실제로 잡아 고친 주요 결함은 다음과 같다.
- **승인 우회** (M1)
  - 변수나 함수를 거쳐 `approve`를 호출하면 확인 창 없이 승인이 기록됐다.
  - heredoc 본문(계획·리뷰 텍스트)을 명령으로 오인해 정상 흐름이 막혔다.
  - 그 밖의 습관적 셸 형태도 놓쳤다.
  - 문자열을 하나씩 막는 방식으로는 반복해서 결함이 나왔다. 그래서 4차에서 셸 토크나이저 기반으로 재작성했고, 조합 행렬 테스트를 만들었다.
- **설정 변경** (M4, 파일럿 4)
  - run 도중 `.make-it-ship.json`을 바꾸면 guard를 거치지 않고 검증 규칙이 바뀌었다.
  - `mis approve config` 기록이 없으면 판정을 PARTIAL로 고정하도록 수정했다.
- **Quick 모드 UI 변경** (M4)
  - 실사용 QA 없이 VERIFIED가 나오면서, 보고서에 "검증하지 못한 영역 없음"이 표시됐다.
  - 이제 감지된 표면을 "실사용 QA 미실행"으로 명시한다.
- **기타**: 보고 후 ship 순서 모순, SwiftPM iOS 탐지 오류, 브리지 잔존 코드 탐지 누락(M5) 등.

## 2. 추적표 상태 (Spec §2)

| PRD AC / 항목 | 구현 | 자동 테스트 | 실사용 증거 | 상태 |
|---|---|---|---|---|
| #1 목표·제약·완료조건 | `mis plan set` 스키마, interview | `mis-plan.test.mjs` | 데모 A/B/C, 파일럿 | PASS |
| #2 Quick/Standard/Full·변경 | `mis mode set`, 위험 플래그 하향 거부·자동 상향 | `mis-plan.test.mjs` | 파일럿 3(auth→standard) | PASS |
| #3 계획·작업 한곳 | `plan.json`, `mis status` | `render.test.mjs` 스냅샷 | 모든 E2E | PASS |
| #4 승인 범위 내 변경 | `mis approve plan`(guard ask), 미승인 전이 거부, plannedFiles 범위 ask | `mis-plan`, `guard`, `policy` | Standard 실행 전부 승인 단계에서 정지 | PASS (확인 창 자체는 NEEDS_HUMAN NH-1) |
| #5 실제 실행, 불가 시 표시 | `mis check`(spawn, 타임아웃, BLOCKED) | `mis-check.test.mjs` | 파일럿 6(BLOCKED·PARTIAL) | PASS |
| #6 요구 적합성·품질 점검 | spec/quality 리뷰어, 엄격한 헤더 파서 | `render`, `mis-report` | stream-json으로 리뷰어 호출 확인 | PASS |
| #7 불필요한 의존성 | 매니페스트 변경 감지, check 경고, `mis note dep` | `mis-simplify`, `mis-check` | — | PASS |
| #8 코드 변경 시 재판정 | tree hash·config hash → STALE | `tree-hash`, `mis-check` | 모든 검증자가 "깨뜨리면 PARTIAL, 되돌리면 VERIFIED"를 재현 | PASS |
| #9 4상태 보고 | `mis verdict`(§6 우선순위) | `verdict.test.mjs` 표 | 모든 E2E | PASS |
| #10 중단 후 재확인 | `mis resume`, running 표식, lock 회수 | `mis-resume`, `state` | 데모 D 강제 종료→재개(M2 2회), 파일럿 8 | PASS |
| #11 원격·위험 작업 무승인 금지 | guard(셸 토크나이저), fail-closed | `policy`, `shell`(조합 행렬·fuzz), `guard` | 실사용 실행에서 승인 외 거부 0건 | PASS (대화형 확인 창은 NH-1·NH-2·NH-4) |
| #12 외부 플러그인 없이 동작 | 외부 참조 0, `doctor` 경고 | `mis-init-doctor` | `--setting-sources project --strict-mcp-config`로 모든 E2E 수행 | PASS (실제 설치 경로는 NH-5) |
| 문제#1 요구 이해 | interview, 미해결 HIGH → 승인 거부 | `mis-plan` | — | PASS (영향도 분류는 모델 판단, 위험 참조) |
| P0-03 계획 품질 | critic 리뷰 없이 승인 불가(plan hash 바인딩) | `mis-plan` | 데모 C·파일럿 5(critic 재검토) | PASS |
| 5.4 원인 분석 | `mis note rootcause` 없으면 `task retry` 거부, 재시도 상한 | `mis-retry` | 파일럿 2·7·8, 데모 D | PASS |
| 8.1 보안 | 위험 플래그 → security 리뷰 없으면 PARTIAL | `verdict`, `plugin-files` | 파일럿 3 security 리뷰 | PASS |
| 데모 A/B | `evals/demos/a`, `b` | `evals.test.mjs` | `M1-e2e.md` | PASS |
| 데모 D | `evals/demos/d` | `evals.test.mjs` | `M2-e2e.md`, M2 검증 | PASS |
| 데모 C | `evals/demos/c` | `evals.test.mjs` | 새 clone 설치로 Full 경로 VERIFIED(M4-e2e, M4 검증 3회) | PASS |

## 3. 사람이 확인할 항목 (NEEDS_HUMAN — 통과로 기록하지 않음)

단계별 절차, PASS 조건, 결과 기록란: `docs/milestones/NEEDS_HUMAN.md`.

후속(2026-10-20): NH-1~NH-4는 Claude가 tmux 안의 대화형 `claude`로 자동 확인했다. 확인 창이 실제로 떴고, 거절하면 상태가 유지되며, 승인하면 진행됐다. 상세는 `docs/milestones/NH-auto-check.md`다. 사람 확인이 아니므로 PASS로 기록하지 않는다. 미발생 경로는 두 가지다: NH-2 재시도 상한, NH-4 승인 후 병합 충돌.

| ID | 항목 | 절차 문서 |
|---|---|---|
| NH-1 | 대화형 세션의 `approve plan` 확인 창. 승인·거절 시 동작 | `docs/milestones/NEEDS_HUMAN.md` |
| NH-2 | 상한 BLOCKED 후 `mis approve continue` 확인 창 | `M2-e2e.md` |
| NH-3 | HUD statusLine 실제 표시(비용 포함) | `M2-e2e.md`, `M5-e2e.md` |
| NH-4 | 병렬 실행 중 소유 범위 밖 편집 확인 창. 승인 시 충돌 처리 | `M3-e2e.md` |
| NH-5 | 실제 플러그인 설치 경로(마켓플레이스 / `claude plugin install`) | README |
| NH-6 | iOS 실기기 디버그 브리지 설치·조회·제거 | `M5-e2e.md`, `templates/ios-debug-bridge/README.md` |
| NH-7 | second opinion 실제 호출(외부 모델 서비스, 사내 정책 확인 필요) | `M5-e2e.md` |
| NH-8 | Codex 어댑터 실사용 | `M5-e2e.md` |
| NH-9 | 해당 없음 — 2026-10-20 사용자 결정으로 BSP QA 프로파일(M5-05) 제거 | — |

모든 헤드리스 검증에서 승인 단계는 운영자가 터미널에서 대리 실행했다. 이것은 확인 창 동작을 증명하지 않는다.

## 4. 남은 위험

모델 판단에 기대는 부분이라 기계로 막을 수 없다.
- **모호성 영향도 분류**: HIGH/MED/LOW를 모델이 정한다. 모델이 HIGH를 MED로 낮추면 승인 게이트가 열린다. 그래서 해소된 가정을 모두 보고서 8절에 노출한다.
- **원인 노트 순서**: rootcause를 수정 전에 남기도록 강제하는 것은 `task fail → retry` 경로뿐이다. 같은 task 안에서 바로 고치면 노트가 수정 뒤에 기록될 수 있다.
- **리뷰 원문 전사**: 리뷰어 출력을 메인 세션이 그대로 옮겨 기록한다. 적대적 모델을 막는 것은 Spec §7 위협 모델 밖이다.
- **헤드리스 첫 실행**: 설정 확인을 기다리며 멈추는 경우가 있다. Spec §9-1에 맞는 안전한 동작이다.

guard의 범위(Spec §7 위협 모델은 부주의·습관만 다룬다)
- 의도적 난독화(eval/base64 등)는 막지 않는다.
- 범위 밖 편집 경고는 Write/Edit에만 걸린다. Bash로 하는 편집(`sed -i`, 스크립트)은 경고 대상이 아니다.
- §7 표 밖의 원격 명령(`gh api -X POST`, `curl -X POST`, `npm ci` 등)은 개입하지 않는다.
- 활성 run이 없으면 guard는 상태 위조만 막는다. 이때는 외부 모델 CLI 호출도 묻지 않으므로, 스킬이 사용자에게 먼저 묻는다.

호스트·플랫폼 제약
- **토큰 예산**: 강제할 수 없다. 플러그인은 사용량을 읽을 수 없다. HUD 표시만 한다.
- **헤드리스 승인**: `claude -p`에서는 `ask`가 실행되지 않는다. 무인 루프는 승인 단계에서 정지한다(ADR-014).
- **doctor 경고**: 설정 파일의 `enabledPlugins`를 읽으므로, 실제로는 로드되지 않은 플러그인도 경고할 수 있다.
- **stale lock 회수**: 실사용에서는 일어나지 않아 통합 테스트로만 확인했다.

기능별 한계
- **보고 후 변경**: REPORTED run은 최종이다. 보고 후에 변경하려면 follow-up run(계획·검사·리뷰 다시)이 필요하다.
- **체인지로그 분류**: 키워드 기반이다. 증상만 적은 버그 수정은 Added로 분류될 수 있다. 초안이므로 반영 전에 고친다.
- **SwiftPM STALE**: `.build`가 `.gitignore`에 없으면 check가 통과 직후 STALE이 된다(안전한 쪽 오류).
- **bridge-scan**: Markdown 파일을 제외한다. DocC 안에 들어 있는 코드는 놓친다.

검증 환경
- 모든 실사용 검증은 macOS arm64, Claude Code 2.1.292, Node 22.20, 외부 플러그인을 끈 설정(`--setting-sources project --strict-mcp-config`)에서 했다. Linux는 확인하지 않았다.
- 상세는 `docs/PROGRESS.md` RISKS, 각 `M<n>-report.md`의 "남은 위험".

## 5. 설치·사용법

요구 사항: Claude Code(플러그인 지원), Node.js 22+, git. macOS에서 검증했다. 런타임 의존성이 없고 빌드 단계도 없다.

설치
```sh
git clone <this repo> ~/make-it-ship
claude --plugin-dir ~/make-it-ship                 # 세션 단위 (검증된 경로)
```
마켓플레이스로 설치하는 방법: `docs/milestones/NEEDS_HUMAN.md` NH-5(project scope). 이 경로는 사람이 아직 확인하지 않았다.

사용
```
/make-it-ship:run Implement docs/feature-request.md     # 계획 → 승인 → 구현 → 검증 → 리뷰 → 보고
/make-it-ship:run Fix the bug described in ISSUE.md
/make-it-ship:status                                   # 단계·작업·check·리뷰·판정
/make-it-ship:resume                                   # 중단 후 재개
```

단계별 명령: `/make-it-ship:interview`, `plan-review`, `review`, `debug`, `qa`, `ship`, `retro`

주요 개념
- `.make-it-ship.json`: check 명령을 정의한다(`mis init`이 제안). 바꾸면 기존 증거가 STALE이 되고, 사용자 승인이 필요하다.
- 판정: `mis verdict`만 VERIFIED / PARTIAL / BLOCKED / FAILED를 정한다. VERIFIED가 아니면 "배포 준비 완료"로 표기하지 않는다.
- 보고서: `docs/make-it-ship/<run>/report.md`. ship 준비물은 `ship.md`.
- 상태: `.git/make-it-ship/`. 커밋되지 않고, 직접 편집하면 guard가 거부한다.

CLI 전체 목록과 설정 예시는 `README.md`를 본다. Codex에서 쓰려면 `adapters/codex/AGENTS.md`를 본다(guard 미적용).
