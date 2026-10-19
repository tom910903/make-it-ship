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
| M1-08 | mis: task start/done/fail, check(spawn·타임아웃·BLOCKED·마스킹) | TODO | `tests/integration/mis-check.test.mjs`, `tests/unit/mask.test.mjs` (STALE 포함) | AC#5, AC#8 | | |
| M1-09 | mis: review add(엄격 파서), verdict, status, report, block, cancel | TODO | `tests/integration/mis-report.test.mjs` (review 미기록→PARTIAL, status snapshot, 보고서 8항목) | AC#3,#6,#9 | | |
| M1-10 | mis: init(설정 탐지), doctor(중복 플러그인 경고) | TODO | `tests/integration/mis-init-doctor.test.mjs` | AC#12 | | |
| M1-11 | 에이전트 4종 + run/status 스킬 + phases 7종 + 직접 명령 3종 | TODO | `tests/unit/plugin-files.test.mjs`(frontmatter·tools 허용목록·참조 경로), `claude plugin validate .` | §14 discover·interview·plan·plan-critique·implement·verify·review | | |
| M1-12 | evals: 데모 A(TS)·B(Python) 생성 스크립트 | TODO | `tests/integration/evals.test.mjs` (생성 후 기본 테스트 실행 결과 확인) | 데모 A/B | | |
| M1-13 | E2E: 깨끗한 환경 헤드리스로 데모 A(기능 추가)·B(버그 수정) Quick 경로 → REPORTED, Standard 경로 → 승인 대기에서 정지 | TODO | `docs/milestones/M1-e2e.md` 로그. 승인 이후 대화형 구간은 NEEDS_HUMAN 절차서 | 데모 A/B, AC#12 | | |
| M1-14 | 독립 검증 → `docs/milestones/M1-report.md`, `m1-verified` 태그 | TODO | 새 서브에이전트(컨텍스트 비상속) | §11 M1 | | |

### 원본 흡수 근거 (§14)
- (M1-11 작성 시 phase별로 읽은 원본 SKILL.md 경로를 기록)

## M2
## M3
## M4
## M5

## NEEDS_HUMAN

## BLOCKED

## PROPOSALS

## SPEC_CHANGES

## RISKS
- 사용자 환경에는 OMC·Superpowers·Ponytail 훅이 활성화돼 있음. E2E는 `--setting-sources project --strict-mcp-config`로 격리해 실행한다.
