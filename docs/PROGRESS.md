STATUS: RUNNING
CURRENT: M1
VERIFY: PENDING

> 진행 상태의 유일한 기록. 재시작 시 이 파일 + `git log`부터 읽는다.
> 작업 방식: 작업마다 실패 테스트 → 최소 구현 → `npm test` 전체 통과 → 커밋 `M<n>-<id>: 요약`.

## M0 — 호스트 실증
VERIFY: PASSED (3c 사용자 확인 완료) — `docs/adr/0001-host-smoke.md`

### M1 착수 전 추가 실측 (2026-10-19)
- 스킬 **본문**의 `${CLAUDE_PLUGIN_ROOT}`도 절대경로로 치환됨 (probe 플러그인, `claude -p`).
- `claude --bare`는 로그인 불가("Not logged in") → 깨끗한 환경 smoke 불가.
  대안: `claude -p ... --setting-sources project --strict-mcp-config --plugin-dir <repo>` → 외부 플러그인 스킬 0개, MCP 0개, 대상 플러그인 스킬만 로드됨을 확인.
- Node v22.20.0은 `.ts`를 의존성 없이 실행(type stripping) → TS 데모를 의존성 0으로 구성 가능.

## M1 — 핵심 경험

종료 기준(Spec §11): 데모 A/B 수동 E2E 통과, unit/integration 통과.

| ID | 작업 | 상태 | 완료 조건 / 검증 | 추적 | 커밋 | 증거 |
|---|---|---|---|---|---|---|
| M1-01 | 뼈대: package.json, plugin.json(author), 테스트 러너 | DONE | `tests/unit/manifest.test.mjs`, `claude plugin validate .` | ADR-003 | 9513d63 | npm test 2/2, validate ✔ |
| M1-02 | `lib/config.mjs`: 스키마 검증(미지 키 오류), configHash | DONE | `tests/unit/config.test.mjs` | AC#5 | 422a4b2 | npm test 18/18 |
| M1-03 | `lib/tree-hash.mjs`: 임시 인덱스 write-tree, 보고서 경로 제외 | DONE | `tests/integration/tree-hash.test.mjs` (수정/신규/ignored/제외/실제 인덱스 불변) | AC#8 | 222ba6c | npm test 20/20 |
| M1-04 | `lib/state.mjs`: 상태 루트, 원자적 쓰기, events.jsonl, lock(O_EXCL·stale 회수), 전이표 | DONE | `tests/unit/state.test.mjs` | AC#4, AC#10(기반) | 26d1463 | npm test 26/26 |
| M1-05 | `lib/verdict.mjs`: §6 판정 우선순위 | DONE | `tests/unit/verdict.test.mjs` (table-driven) | AC#9, AC#6 | 9a33e10 | npm test 56/56 |
| M1-06 | `lib/policy.mjs` + `scripts/guard.mjs` + `hooks/hooks.json` | DONE | `tests/unit/policy.test.mjs`(허용/ask/deny/우회 문자열), `tests/integration/guard.test.mjs` | AC#11 | 6bd6f6c | npm test 128/128, validate ✔ |
| M1-07 | mis: start, plan set, mode set, interview add/resolve, approve plan | DONE | `tests/integration/mis-plan.test.mjs` (스키마 오류, 위험 하향 거부, HIGH 미해결·critic 미기록 승인 거부, 미승인 전이 거부) | AC#1,#2,#4, 문제#1, P0-03 | e82c326 | npm test 134/134 |
| M1-08 | mis: task start/done/fail, check(spawn·타임아웃·BLOCKED·마스킹) | DONE | `tests/integration/mis-check.test.mjs`, `tests/unit/mask.test.mjs` (STALE 포함) | AC#5, AC#8 | 1a8317f | npm test 142/142 |
| M1-09 | mis: review add(엄격 파서), verdict, status, report, block, cancel | DONE | `tests/integration/mis-report.test.mjs` (review 미기록→PARTIAL, status snapshot, 보고서 8항목) | AC#3,#6,#9 | 9923afb | npm test 147/147 |
| M1-10 | mis: init(설정 탐지), doctor(중복 플러그인 경고) | DONE | `tests/integration/mis-init-doctor.test.mjs` | AC#12 | 07f7a97 | npm test 150/150 |
| M1-11 | 에이전트 4종 + run/status 스킬 + phases 7종 + 직접 명령 3종 | DONE | `tests/unit/plugin-files.test.mjs`(frontmatter·tools 허용목록·참조 경로), `claude plugin validate .` | §14 discover·interview·plan·plan-critique·implement·verify·review | 85c6253 | npm test 168/168, validate ✔ |
| M1-12 | evals: 데모 A(TS)·B(Python) 생성 스크립트 | DONE | `tests/integration/evals.test.mjs` (생성 후 기본 테스트 실행 결과 확인) | 데모 A/B | 9c2a860 | npm test 171/171 |
| M1-13 | E2E: 깨끗한 환경 헤드리스로 데모 A(기능 추가)·B(버그 수정) Quick 경로 → REPORTED, Standard 경로 → 승인 대기에서 정지 | DONE | `docs/milestones/M1-e2e.md` 로그. 승인 이후 대화형 구간은 NEEDS_HUMAN 절차서 | 데모 A/B, AC#12 | b535061 | a1/b1 VERIFIED, a2 정지@승인, a2b VERIFIED; NH-1 대화형 확인 창 |
| M1-14 | 독립 검증 → `docs/milestones/M1-report.md`, `m1-verified` 태그 | TODO | 새 서브에이전트(컨텍스트 비상속) | §11 M1 | | |

### 원본 흡수 근거 (§14)
- phase별로 읽은 원본 파일 목록과 핵심 동작 요약: `docs/research/source-absorption-m1.md` (discover·interview·plan·plan-critique·implement·debug·verify·review·simplify). 각 phase 문서 첫 줄 `Absorbs:`에 원본 기능명을 명시하고 `tests/unit/plugin-files.test.mjs`가 이를 검사한다.

## M2 — 신뢰성

종료 기준(Spec §11): 데모 D 통과, guard 우회 사례 테스트.

| ID | 작업 | 상태 | 완료 조건 / 검증 | 추적 | 커밋 | 증거 |
|---|---|---|---|---|---|---|
| M2-01 | `mis resume`: lock 회수, STALE 재계산, 마지막 이벤트 이후 변경 파일 목록 + resume 스킬 | DONE | `tests/integration/mis-resume.test.mjs` (check 도중 SIGKILL → resume) | AC#10 | d4578b0 | npm test 201/201, validate ✔ |
| M2-02 | 재시도 상한 + rootcause 게이트: `task retry`, `note rootcause`, 상한 초과 BLOCKED | DONE | `tests/integration/mis-retry.test.mjs` | PRD 5.4, 8.3 | 7590ca0 | npm test 198/198 |
| M2-03 | 실행 시간 상한: deadline 초과 시 실행 명령 BLOCKED | DONE | `tests/integration/mis-retry.test.mjs` | PRD 8.3, §3-4 | 7590ca0 | npm test 198/198 |
| M2-04 | debug phase + `/make-it-ship:debug` | DONE | `plugin-files.test.mjs` 확장 | §14 debug | 8e1c752 | npm test 208/208, validate ✔ |
| M2-05 | security-reviewer 에이전트 + review phase 보안 리뷰 | DONE | `plugin-files.test.mjs`, verdict 표(이미 있음) | PRD 8.1 | 8e1c752 | npm test 208/208, validate ✔ |
| M2-06 | simplify: `mis check` 의존성 변경 경고·`note dep`, 보고서 shortcut 목록, simplify phase | DONE | `tests/integration/mis-simplify.test.mjs` | AC#7, §14 simplify | 8e1c752 | npm test 208/208, validate ✔ |
| M2-07 | guard: 계획 범위 밖 편집 ask + 우회 문자열 테스트 | DONE | `policy.test.mjs` 확장 | §7, AC#11 | 1739049 | npm test 211/211 (우회 변형 26건 포함) |
| M2-08 | HUD `scripts/statusline.mjs` + `mis init` statusLine 등록 제안 | DONE | `tests/unit/statusline.test.mjs` | §14 hud | 8c48f4e | npm test 214/214 |
| M2-09 | doctor (M1-10에서 구현됨) 재확인 | DONE | 기존 테스트 | AC#12 | 07f7a97 (M1-10), cc1f768 | mis-init-doctor.test.mjs 통과; 경고 문구 'enabled in settings' 정정 |
| M2-10 | 데모 D(실패 테스트 저장소) + 세션 강제 종료 후 재개 E2E | TODO | `docs/milestones/M2-e2e.md` | 데모 D | | |
| M2-11 | 독립 검증 → `M2-report.md`, `m2-verified` | TODO | VERIFIER_PROMPT | §11 M2 | | |
## M3
## M4
## M5

## NEEDS_HUMAN
- **NH-2 (M2)**: limit BLOCKED 후 `mis approve continue` 확인 창. 절차: `docs/milestones/M2-e2e.md`. 미확인
- **NH-3 (M2)**: HUD statusLine 실제 표시. 절차: `docs/milestones/M2-e2e.md`. 미확인
- **NH-1 (M1)**: 대화형 승인 확인 창 → 승인/거절 동작. 절차: `docs/milestones/M1-e2e.md` "NEEDS_HUMAN" 절. 상태: 미확인(통과로 기록하지 않음)

## BLOCKED

## PROPOSALS

## SPEC_CHANGES

## RISKS
- 사용자 환경에는 OMC·Superpowers·Ponytail 훅이 활성화돼 있음. E2E는 `--setting-sources project --strict-mcp-config`로 격리해 실행한다.
- (M1 검증 L-1) 헤드리스 첫 실행에서 모델이 설정 확인을 기다리며 멈추는 경우가 많다(비결정적). 확인 요청은 Spec에 부합하므로 수용한다. 무인 실행 시 요청에 "질문 없이 진행"을 명시.
- (M1 검증 L-2) `mis doctor`는 설정 파일의 `enabledPlugins`를 읽으므로, 이번 세션에 실제로 로드되지 않은 플러그인도 경고할 수 있다. 플러그인이 로드 목록을 얻을 방법이 없어 "enabled in settings" 문구로 수용.
- (M1 2차 검증) 모호성 영향도(HIGH/MED/LOW)는 모델이 분류한다. 모델이 HIGH를 MED로 낮추면 승인 게이트가 열린다. 기계로 막을 수 없는 모델 판단 영역이며, 보고서 8절에 해소된 가정을 모두 노출해 사용자가 볼 수 있게 했다.
- guard는 습관적 셸 형태(변수·함수·서브셸·접두어·제어문·`bash -c`)까지 다루지만, 의도적 난독화(eval, base64 등)는 Spec §7 위협 모델 밖이다.
- (M2 E2E d2) rootcause 노트 순서는 `task fail` → `retry` 경로에서만 강제된다. 같은 task 안에서 바로 고치면 노트가 수정 뒤에 올 수 있다(모델 판단 영역).
