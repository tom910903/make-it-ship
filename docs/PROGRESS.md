STATUS: RUNNING
CURRENT: M2
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
VERIFY: PASSED (4차, `docs/milestones/M1-report.md` ROUND4: PASS) — 태그 `m1-verified`. 1~3차 결함 수정 이력은 보고서 참조. NEEDS_HUMAN: NH-1.

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
| M1-14 | 독립 검증 → `docs/milestones/M1-report.md`, `m1-verified` 태그 | DONE | 새 서브에이전트(컨텍스트 비상속) | §11 M1 | (this) | M1-report.md 1~4차, ROUND4: PASS |

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
| M2-07b | guard 매트릭스 밖 형태(M1 4차 R-1~R-6) 처리 + 조합 테스트 확장 | DONE | `shell.test.mjs` | §7, M2 종료 기준 | fddc253 | npm test 253/253 (조합 행렬 확장) |
| M2-10 | 데모 D(실패 테스트 저장소) + 세션 강제 종료 후 재개 E2E | DONE | `docs/milestones/M2-e2e.md` | 데모 D | d4cb653 | d1/d2 강제 종료→resume→VERIFIED; NH-2, NH-3 |
| M2-11 | 독립 검증 → `M2-report.md`, `m2-verified` | TODO | VERIFIER_PROMPT | §11 M2 | | |
## M3 — 선택형 협업

종료 기준(Spec §11): 충돌 재현 테스트.

| ID | 작업 | 상태 | 완료 조건 / 검증 | 추적 | 커밋 | 증거 |
|---|---|---|---|---|---|---|
| M3-01 | ADR-0002: 병렬 도입 시 상태 저장 재검토(SQLite vs JSON+lock 대기) | DONE | `docs/adr/0002-parallel-state.md` | ADR-004 | cc8f5f7 | ADR-0002 |
| M3-02 | lock 대기(경합 시 재시도) + 동시 mis 호출 무손실 | DONE | `tests/integration/mis-concurrency.test.mjs` | ADR-004 | cc8f5f7 | npm test 231/231 (동시 8 writer 무손실) |
| M3-03 | `mis parallel plan`: files 소유권 겹침·dependsOn으로 병렬 wave 계산 | DONE | `tests/unit/parallel.test.mjs` | §14 parallel | aba7d4b | parallel.test.mjs |
| M3-04 | `mis worktree add| DONE | TODO | `tests/integration/mis-worktree.test.mjs` (충돌 재현) | aba7d4b | npm test 238/238, 충돌 재현 mis-worktree.test.mjs | |
| M3-05 | implementer 에이전트(도구 허용목록) + parallel phase | DONE | `plugin-files.test.mjs` | §14 parallel | 875b944 | npm test 244/244, validate ✔ |
| M3-06 | product-reviewer 에이전트 + product-review phase, Full 승인 게이트 | DONE | `mis-plan.test.mjs` 확장 | §14.1 product-review | 875b944 | npm test 244/244, validate ✔ |
| M3-07 | architect 에이전트 + design phase(ADR 초안) | DONE | `plugin-files.test.mjs` | §14 design | 875b944 | npm test 244/244, validate ✔ |
| M3-08 | design-explore phase + `mis note design`, Full+UI 승인 게이트 | DONE | `mis-plan.test.mjs` 확장 | §14 design-explore | 875b944 | npm test 244/244, validate ✔ |
| M3-09 | E2E: 병렬 2작업 + 충돌 시나리오 헤드리스 | DONE | `docs/milestones/M3-e2e.md` | §11 M3 | 00f54b2 | p1 VERIFIED, implementer×2 병렬, guard 0건; 충돌은 통합 테스트; NH-4 |
| M3-10 | 독립 검증 → `M3-report.md`, `m3-verified` | TODO | VERIFIER_PROMPT | §11 M3 | | |
## M4 — 제품화

종료 기준(Spec §11): 새 환경 설치 → 소형 프로젝트 완료.

| ID | 작업 | 상태 | 완료 조건 / 검증 | 추적 | 커밋 | 증거 |
|---|---|---|---|---|---|---|
| M4-01 | QA 프로파일 탐지 `mis qa detect`(CLI·API·Web·iOS 시뮬레이터) + Standard/Full에서 `qa-*` check 필수화 | DONE | `tests/integration/mis-qa.test.mjs`, verdict 표 | §14 qa, §14.1 | 8d5d875 | npm test 274/274 |
| M4-02 | qa phase + qa-tester 에이전트 + `/make-it-ship:qa` | DONE | `plugin-files.test.mjs` | §14.3 | 0fcfe04 | npm test 280/280, validate ✔ |
| M4-03 | `mis ship`: PR 초안·체인지로그 초안·릴리스 체크리스트, VERIFIED 아니면 NOT READY | DONE | `tests/integration/mis-ship.test.mjs` | §14 ship | 3ef7d96 | npm test 276/276 |
| M4-04 | ship·docs phase + `/make-it-ship:ship` | DONE | `plugin-files.test.mjs` | §14.3 | 0fcfe04 | npm test 280/280, validate ✔ |
| M4-05 | 데모 C(md 요구사항 → 소형 앱) 픽스처 + Full 경로 E2E | TODO | `docs/milestones/M4-e2e.md` | 데모 C | | |
| M4-06 | 파일럿 과제 8종 픽스처(PRD 13.3) + 헤드리스 실행 기록 | TODO | `docs/milestones/M4-pilots.md` | §11 M4 | | |
| M4-07 | 새 환경 설치 검증: 새 clone + 외부 플러그인 없는 설정으로 데모 C 완료, 설치 문서 | TODO | `docs/milestones/M4-e2e.md` | §11 M4 종료 기준 | | |
| M4-08 | 독립 검증 → `M4-report.md`, `m4-verified` | TODO | VERIFIER_PROMPT | §11 M4 | | |
## M5 — 확장

종료 기준(Spec §11): "별도 AC". 아래 AC를 M5 종료 기준으로 정의한다(Spec 범위 항목을 그대로 따르며 결정 변경 없음).

| ID | 작업 | 상태 | AC (완료 조건 / 검증) | 추적 | 커밋 | 증거 |
|---|---|---|---|---|---|---|
| M5-01 | retro: `mis retro`가 runs/*/events.jsonl을 집계(판정 분포, 실패→통과 주기, 재시도, 차단 사유, 리뷰 blocking, 소요 시간) → `docs/make-it-ship/retro-<date>.md`; retro phase + `/make-it-ship:retro` | DONE | `tests/integration/mis-retro.test.mjs`(합성 run 2개 집계 값 검증) | §14 retro, §14.3 | 3f13c8a | npm test, mis-retro.test.mjs |
| M5-02 | learn: `mis learn add| DONE | TODO | `tests/integration/mis-learn.test.mjs` | 3f13c8a | mis-learn.test.mjs | |
| M5-03 | second opinion: `mis second-opinion detect`(codex/gemini CLI 탐지), 결과는 판정에 영향 없는 노트로 기록; 실제 외부 모델 호출은 사용자 승인 대상 | DONE | `tests/integration/mis-second.test.mjs`(PATH 가짜 바이너리) | §14 second opinion | be03d58 | mis-second.test.mjs; 실제 외부 모델 호출은 NEEDS_HUMAN |
| M5-04 | iOS 실기기 브리지: `templates/ios-debug-bridge/`(SPM, 모든 소스 `#if DEBUG`, 루프백 전용) + `mis ios bridge-scan`; ship은 브리지 코드가 남으면 NOT READY; 실기기 check는 기기 없으면 BLOCKED | TODO | `tests/integration/mis-ios.test.mjs`(템플릿 불변식·스캔·ship 연동), 시뮬레이터 SDK 타입체크는 E2E 기록 | §14 ios(M5) | | |
| M5-05 | BSP QA 프로파일: Yocto/Buildroot/커널 트리 탐지 → 빌드 check 제안 + 타깃 검증은 BLOCKED("빌드 통과 ≠ 하드웨어 동작") | DONE | `tests/integration/mis-qa.test.mjs` 확장(합성 트리) | §11 M5, PRD 10.2 | 659c27e | mis-qa.test.mjs BSP 2건 |
| M5-06 | 성능 벤치마크: `mis bench <check> --runs N` 중앙값 기록, 같은 run의 이전 측정 대비 +20% 경고·+50% 회귀 표시, 보고서 반영 | TODO | `tests/integration/mis-bench.test.mjs` | §11 M5 | | |
| M5-07 | 토큰 예산(호스트 지원 시): HUD가 statusLine 입력의 비용 값을 표시, 강제는 미지원으로 보고서·doctor에 명시 | TODO | `statusline.test.mjs` 확장 | §3-4, §11 M5 | | |
| M5-08 | Codex 어댑터: `adapters/codex/AGENTS.md` — mis CLI 기반 동일 흐름, guard 훅 부재(강제력 차이) 명시 | TODO | `plugin-files.test.mjs`(참조 명령 존재) | §11 M5, PRD 10.1 | | |
| M5-09 | E2E/NEEDS_HUMAN 기록: 시뮬레이터 SDK 타입체크, 실기기·외부 모델 호출은 NEEDS_HUMAN | TODO | `docs/milestones/M5-e2e.md` | §11 M5 | | |
| M5-10 | 독립 검증 → `M5-report.md`, `m5-verified` | TODO | VERIFIER_PROMPT | §11 M5 | | |
| F-01 | 최종 검증 + `docs/milestones/FINAL-report.md` | TODO | 결과, 추적표 상태, 사람 확인 항목, 남은 위험, 설치·사용법 | 골 | | |

## NEEDS_HUMAN
- **NH-4 (M3)**: 병렬 중 소유 밖 편집 확인 창 → 승인 시 충돌 처리. 절차: `docs/milestones/M3-e2e.md`. 미확인
- **NH-2 (M2)**: limit BLOCKED 후 `mis approve continue` 확인 창. 절차: `docs/milestones/M2-e2e.md`. 미확인
- **NH-3 (M2)**: HUD statusLine 실제 표시. 절차: `docs/milestones/M2-e2e.md`. 미확인
- **NH-1 (M1)**: 대화형 승인 확인 창 → 승인/거절 동작. 절차: `docs/milestones/M1-e2e.md` "NEEDS_HUMAN" 절. 상태: 미확인(통과로 기록하지 않음)

## BLOCKED

## PROPOSALS

## SPEC_CHANGES
- (해석) §14 second opinion: 다른 모델 CLI(codex, gemini, `omc ask`) 호출은 저장소 내용을 외부 서비스로 보내므로 PRD 8.1(외부 전송 기본 차단)과 조직 데이터 정책에 따라 guard가 ask로 분류한다. §7 표에 같은 성격의 행(외부 쓰기 ask)이 있어 그 연장으로 본다.
- (해석, Spec 본문은 수정하지 않음) §4는 `agents/`가 모두 읽기 전용이라고 적었다. 그러나 M3 병렬 실행(§11 M3, §14 parallel)에는 쓰기 가능한 작업자가 필요하다. 그래서 `agents/implementer.md`를 추가했다. 도구는 허용목록(Read, Write, Edit, Grep, Glob, Bash)으로 지정해 Agent와 MCP를 차단했다(ADR-013 방식). 쓰기는 자기 worktree의 task 파일로 제한되며, guard가 범위 밖 편집에 ask를 건다.

## RISKS
- 사용자 환경에는 OMC·Superpowers·Ponytail 훅이 활성화돼 있음. E2E는 `--setting-sources project --strict-mcp-config`로 격리해 실행한다.
- (M1 검증 L-1) 헤드리스 첫 실행에서 모델이 설정 확인을 기다리며 멈추는 경우가 많다(비결정적). 확인 요청은 Spec에 부합하므로 수용한다. 무인 실행 시 요청에 "질문 없이 진행"을 명시.
- (M1 검증 L-2) `mis doctor`는 설정 파일의 `enabledPlugins`를 읽으므로, 이번 세션에 실제로 로드되지 않은 플러그인도 경고할 수 있다. 플러그인이 로드 목록을 얻을 방법이 없어 "enabled in settings" 문구로 수용.
- (M1 2차 검증) 모호성 영향도(HIGH/MED/LOW)는 모델이 분류한다. 모델이 HIGH를 MED로 낮추면 승인 게이트가 열린다. 기계로 막을 수 없는 모델 판단 영역이며, 보고서 8절에 해소된 가정을 모두 노출해 사용자가 볼 수 있게 했다.
- guard는 습관적 셸 형태(변수·함수·서브셸·접두어·제어문·`bash -c`)까지 다루지만, 의도적 난독화(eval, base64 등)는 Spec §7 위협 모델 밖이다.
- (M2 E2E d2) rootcause 노트 순서는 `task fail` → `retry` 경로에서만 강제된다. 같은 task 안에서 바로 고치면 노트가 수정 뒤에 올 수 있다(모델 판단 영역).
- (M1 4차 R-1~R-6) guard의 매트릭스 밖 형태: `node --flag mis.mjs approve`, 셸 주석 `#`, `bash -o pipefail -c`, main에서 `git push --force origin HEAD`, `npm --prefix x install`, `bash <<EOF` 본문. M2 guard 우회 사례 작업(M2-07b)에서 처리.
