# Make It Ship — 기술 Spec v1.1 (MVP 확정안)

| 항목 | 값 |
|---|---|
| 문서 버전 | 1.1 — 구현 기준 |
| 작성일 | 2026-10-19 |
| 상위 문서 | `Make_It_Ship_Product_Plan_v1.0.md` (제품 기획서, 이하 **PRD**) |
| 대체 문서 | `Make_It_Ship_Development_Spec_v1.0.md` (이하 **Spec v1.0**). 충돌 시 본 문서 우선 |
| 저장소 | `git@github.com:tom910903/make-it-ship.git` |
| 대상 | Claude Code 플러그인 / macOS arm64 / Node.js 22 LTS 이상 |

> PRD는 무엇·왜를, 본 문서는 어떻게를 정한다. 본 문서의 모든 MVP 요구는 §2 추적표의 한 행에 연결된다. 행을 채울 수 없는 약속은 MVP에 넣지 않는다.

---

## 1. 확정된 결정 (ADR 요약)

| ADR | 결정 | 근거 | Spec v1.0 대비 |
|---|---|---|---|
| ADR-001 | 독립 플러그인. 외부 4개 플러그인 불필요 | PRD AC#12 | 동일 |
| ADR-002 | **MCP 서버 없음.** 스킬 + 훅 + `scripts/mis.mjs` CLI | 증거 위조 방지에는 "모델이 아닌 스크립트가 실행·기록"이면 충분. MCP는 구조화 호출 외 이득 없음 | 변경 |
| ADR-003 | **순수 Node ESM(`.mjs`) + JSDoc, 런타임 의존성 0, 빌드 없음** | 플러그인은 저장소 그대로 설치됨(`npm install` 단계 없음) → 번들/네이티브 모듈 문제 제거 | TypeScript → 변경 |
| ADR-004 | **상태는 JSON + JSONL 파일.** SQLite 미사용 | 단일 에이전트 MVP에는 동시 쓰기 없음. 원자적 rename으로 충분 | 변경. M3 병렬 도입 시 재검토 |
| ADR-005 | 필수 진입은 `run` 하나. 단계별 직접 호출 명령(§14.3)은 선택 | PRD 17.2 "세부 스킬을 배우지 않고" + 단계별 단독 사용 요구 | 8개 → 1 + 선택 |
| ADR-006 | MVP는 단일 실행 에이전트(메인 세션) + 읽기 전용 리뷰 서브에이전트들. 병렬 분업은 M3 | PRD 6.1 "첫 시연은 단일 에이전트로" | 동일 |
| ADR-010 | OMC·Superpowers·gstack·Ponytail의 **개발 관련 기능을 전부 흡수**한다. 동일 구현이 아니라 단일 책임 단계로 재구성하며 §14 기능 매핑표가 기준 | 사용자 결정 (2026-10-19) | 신규 |
| ADR-011 | 단계 절차는 `skills/run/phases/*.md`에 두고 필요한 단계만 읽는다 | 전 기능을 담아도 컨텍스트를 필요한 만큼만 사용 | 신규 |
| ADR-012 | 사용자에게 질문해야 하는 단계(인터뷰·승인)는 메인 세션에서 수행 | 서브에이전트는 사용자에게 직접 질문 불가(M0 실증) | 신규 |
| ADR-007 | 검증 유효성은 **작업트리 해시** 기준(커밋 여부 무관) | 커밋 전 상태도 판정해야 함 | commit_sha → tree hash |
| ADR-008 | 외부 쓰기·승인은 PreToolUse 훅의 `ask`/`deny`로 강제 | 스킬 지시문은 무시될 수 있음. 훅만 결정적 | 구체화 |
| ADR-009 | 모드(Quick/Standard/Full)는 모델이 사유와 함께 제안 → 상태에 기록 → 사용자가 변경 가능. 위험 신호가 있으면 하향 불가 | LLM 판단은 "규칙 버전으로 재현"이 불가능 | 변경 |

---

## 2. 추적표 (PRD 수용기준 → 구현 → 검증)

| PRD AC (11.1) | 구현 메커니즘 | 자동 테스트 | MS |
|---|---|---|---|
| #1 입력 → 목표·제약·완료조건 정리 | `run` 스킬 1단계, `mis plan set`으로 `plan.json` 저장 | 스키마 검증 unit | M1 |
| #2 Quick/Standard/Full 분류·변경 | `run` 스킬이 제안, `mis mode set <mode> --reason` 기록, 하향 시 위험 플래그 검사 | 위험 플래그 하향 거부 unit | M1 |
| #3 계획·작업 목록 한곳에서 확인 | `plan.json` + `mis status` 출력 | status 렌더 snapshot | M1 |
| #4 승인 범위 내 코드 변경 | Standard/Full은 `mis approve plan`(훅이 사용자 확인 강제) 후 EXECUTING | 미승인 상태 전이 거부 unit | M1 |
| #5 테스트·빌드 **실제 실행**, 불가 시 표시 | `mis check <name>` 만 증거 생성. 명령 없음/실행 불가 → `BLOCKED` 증거 | check 실행·exit code 기록 integration | M1 |
| #6 요구사항 적합성·코드 품질 점검 | `reviewer` 에이전트(읽기 전용) 2회: spec / quality. `mis review add` 기록 | review 미기록 시 VERIFIED 불가 unit | M1 |
| #7 불필요한 의존성·구현 검토 | `mis check` 시 매니페스트/락파일 변경 감지 → 사유(`mis note dep`) 없으면 경고 | 의존성 변경 감지 unit | M2 |
| #8 코드 변경 시 검증 재판정 | 모든 증거에 tree hash 기록, 판정 시 현재 해시와 비교 → `STALE` | 파일 수정 후 STALE integration | M1 |
| #9 4상태 결과 보고 | `mis verdict` 가 §6 규칙으로 계산. 모델은 판정 불가 | 판정 우선순위 table-driven unit | M1 |
| #10 중단 후 재확인 | `state.json` + `events.jsonl`, `resume` 스킬 → `mis resume` | 강제 종료 후 재개 integration | M2 |
| #11 원격·위험 작업 무승인 금지 | `hooks/guard.mjs` (§7) | 명령 분류 table-driven unit | M1 |
| #12 외부 플러그인 없이 동작 | 외부 플러그인 참조 0. `mis doctor`가 중복 플러그인 감지 시 경고만 | 깨끗한 설정에서 smoke | M1 |
| PRD 문제#1 요구사항 이해 | **Deep interview** 단계(§14.2): 미해결 `HIGH` 모호성 항목이 있으면 `mis approve plan` 거부 | 미해결 HIGH 시 승인 거부 unit | M1 |
| PRD 6.1 P0-03 단일 계획 품질 | **계획 Critic 리뷰**: Standard/Full은 `plan-critic` 리뷰 기록 없이는 승인 불가 | critic 미기록 승인 거부 unit | M1 |
| PRD 5.4 원인 분석 | **디버깅 단계**: check FAIL 후 `task retry`는 `mis note rootcause`(가설·검증 결과) 없으면 거부 | rootcause 없는 재시도 거부 unit | M2 |
| PRD 8.1 보안 | **보안 리뷰**: riskFlags가 있으면 `security` 리뷰가 현재 treeHash로 있어야 VERIFIED | 위험 플래그 + 보안 리뷰 누락 → PARTIAL unit | M2 |
| 데모 A/B | TS·Python 예제 저장소 `evals/` | 수동 E2E 로그 | M1 |
| 데모 D | 실패 테스트 저장소 + 세션 강제 종료 | 수동 E2E 로그 | M2 |
| 데모 C | md 요구사항 → 소형 앱 | 수동 E2E 로그 | M4 |

---

## 3. PRD 대비 정정 사항

PRD 원문은 수정하지 않고, 아래 해석을 구현 기준으로 삼는다.

1. **P1-03(단순성)·P1-05(최신성) vs AC#7·#8**: MVP에는 최소형(의존성 변경 경고, tree hash STALE)만 넣는다. 정교한 버전은 P1.
2. **상태 우선순위**: PRD 5.6 예시의 "테스트 2개 실패 → PARTIAL"은 §6 규칙에 따라 **FAILED**로 보고한다.
3. **P0-10 중복 방지**: "Make It Ship 흐름 내부의 중복 없음 + 겹치는 플러그인 감지 시 경고". 다른 플러그인 훅을 끄는 것은 불가능하며 보장하지 않는다.
4. **비용 상한(PRD 8.3)**: 플러그인은 토큰 사용량을 얻을 수 없다. MVP는 **실행 시간 상한 + 재시도 횟수 상한**만 강제하고, 토큰 예산은 "미지원"으로 보고한다.
5. **패키지 설치 승인(PRD 8.1)**: guard 정책에 `package_install`을 추가한다.

---

## 4. 저장소 구조

```text
make-it-ship/
├── .claude-plugin/plugin.json
├── skills/
│   ├── run/
│   │   ├── SKILL.md          # 오케스트레이터: 모드별 단계 순서와 게이트
│   │   └── phases/           # 단계별 절차서 (§14.2) — 필요한 단계만 읽음
│   │       ├── discover.md  interview.md  product-review.md  design.md
│   │       ├── plan.md      plan-critique.md  implement.md   debug.md
│   │       ├── verify.md    review.md     qa.md          simplify.md
│   │       ├── design-explore.md
│   │       └── ship.md      retro.md      learn.md
│   ├── status/SKILL.md  resume/SKILL.md
│   └── <단계명>/SKILL.md      # 선택 직접 호출 명령 (§14.3), phases/*.md 를 참조
├── agents/                   # 전부 읽기 전용 (disallowedTools: Write, Edit, MultiEdit, NotebookEdit)
│   ├── explorer.md           # 코드베이스 조사
│   ├── architect.md          # 설계·대안 비교·ADR 초안
│   ├── critic.md             # 계획/설계 반론 검토
│   ├── product-reviewer.md   # 제품·범위·UX·DX 관점
│   ├── spec-reviewer.md      # 요구사항 충족·과잉 구현
│   ├── quality-reviewer.md   # 정확성·성능·유지보수·단순성
│   ├── security-reviewer.md  # 신뢰 경계·비밀·주입·권한
│   └── qa-tester.md          # 실동작 시나리오 설계·결과 해석 (실행은 mis check)
├── hooks/hooks.json          # PreToolUse → scripts/guard.mjs
├── scripts/
│   ├── mis.mjs               # CLI 진입점 (하위명령 디스패치만)
│   ├── guard.mjs             # 훅 진입점
│   ├── statusline.mjs        # HUD 한 줄 출력
│   └── lib/                  # state.mjs, tree-hash.mjs, verdict.mjs, policy.mjs, config.mjs
├── templates/report.md
├── evals/                    # 데모 A/B/C/D 픽스처 저장소 생성 스크립트
├── tests/                    # node:test (unit/, integration/)
├── docs/
├── package.json              # "type":"module", scripts.test, engines.node, 의존성 없음
└── README.md
```

---

## 5. 상태 저장

### 5.1 위치

- 상태 루트: `$(git rev-parse --git-common-dir)/make-it-ship/`
  - `.git` 내부이므로 작업트리 해시에 포함되지 않고 커밋되지 않는다.
  - worktree가 여러 개여도 같은 위치를 공유한다.
- 실행별 디렉터리: `runs/<run_id>/{state.json, events.jsonl, logs/<evidence_id>.log}`
- 공유용 보고서: `docs/make-it-ship/<run_id>/report.md`
  - `mis report`가 생성한다.
  - 이 경로는 tree hash 계산에서 제외한다(§5.4).
- 프로젝트 설정: `<repo>/.make-it-ship.json`(커밋 대상).

### 5.2 `state.json` (요약)

```jsonc
{
  "schema": 1,
  "runId": "20261019-0953-ab12",
  "state": "EXECUTING",           // §5.3
  "mode": "standard", "modeReasons": ["..."], "riskFlags": ["auth"],
  "input": { "kind": "file", "ref": "docs/requirements.md", "sha256": "..." },
  "baseCommit": "abc123",
  "configHash": "sha256 of .make-it-ship.json",
  "startedAt": "...", "deadlineAt": "...",
  "plan": { "goal": "...", "constraints": [], "tasks": [
    { "id": "T1", "title": "...", "acceptance": ["..."], "status": "DONE", "attempts": 1 }
  ]},
  "approvals": [ { "action": "plan", "treeHash": "...", "configHash": "...", "at": "..." } ],
  "evidence": [ { "id": "E3", "check": "unit", "argv": ["npm","test"], "exitCode": 0,
                  "status": "PASS", "treeHash": "...", "configHash": "...", "log": "logs/E3.log",
                  "startedAt": "...", "endedAt": "..." } ],
  "reviews": [ { "kind": "spec|quality", "treeHash": "...", "blocking": 0, "major": 1, "file": "..." } ],
  "notes": [ { "kind": "dep", "text": "..." } ],
  "blockedReason": null
}
```

- **쓰기 규칙**: 임시 파일에 쓴 뒤 `rename`으로 교체한다. 모든 변경은 `events.jsonl`에 한 줄씩 append한다.
- **잠금**: `runs/<run_id>/lock`을 `O_EXCL`로 생성한다. lock 파일에는 PID와 시각을 기록한다. 기록된 PID가 살아 있지 않으면 stale lock으로 보고 회수한다.

### 5.3 실행 상태 전이

```text
PLANNING → AWAITING_APPROVAL → EXECUTING → VERIFYING → REPORTED
              (Quick·저위험은 건너뜀)          ↑   |
                                          EXECUTING ← (FAILED 시 수정, 재시도 상한 내)
어느 상태에서든 → BLOCKED | CANCELLED
```

`mis`가 허용되지 않은 전이를 거부한다. `SHIPPED` 상태는 MVP에 없다. push/PR은 사용자 승인으로 수행할 뿐, 실행 상태로 기록하지 않는다.

### 5.4 작업트리 해시

```sh
GIT_INDEX_FILE=<tmp> git add -A -- . ':(exclude)docs/make-it-ship'
GIT_INDEX_FILE=<tmp> git write-tree
```

- untracked 파일도 포함하고 `.gitignore`는 존중한다.
- `git stash create`는 untracked 파일을 빠뜨리므로 사용하지 않는다.
- 사용자의 실제 인덱스는 건드리지 않는다.

---

## 6. 판정 규칙 (`mis verdict`)

**증거 단위 상태**

| 상태 | 조건 |
|---|---|
| PASS | exit 0, 증거의 `treeHash`와 `configHash`가 현재 값과 일치 |
| FAIL | exit ≠ 0, 두 해시 모두 현재 값과 일치 |
| STALE | 해시 불일치 |
| BLOCKED | 실행 불가: 명령 미정의, 바이너리 없음, 타임아웃, 하드웨어 필요 등 |

**필수 check**는 모드별로 정한다.
- Quick: 설정의 `required.quick`
- Standard/Full: `required.standard`
- 기본값: 설정에 정의된 모든 check

**실행 결과는 다음 순서로 판정한다.** 위에서부터 처음 맞는 조건으로 결정된다.

1. 실행 상태가 BLOCKED, 또는 필수 check 중 BLOCKED가 있고 FAIL은 없음 → **BLOCKED**
2. 필수 check 중 FAIL이 있음, 또는 blocking 리뷰 이슈가 있음 → **FAILED**
3. 다음 중 하나라도 해당 → **PARTIAL**
   - 미완료 task 있음
   - 필수 check가 STALE이거나 미실행
   - Standard/Full인데 spec·quality 리뷰가 현재 treeHash 기준으로 기록되지 않음
   - riskFlags가 있는데 security 리뷰가 현재 treeHash 기준으로 기록되지 않음
   - 미해결 HIGH 모호성 항목이 남아 있음
   - 의존성 변경 사유 누락
4. 위에 해당하지 않음 → **VERIFIED**

보고서에서 VERIFIED가 아닌 결과는 "배포 준비 완료"로 표기하지 않는다(PRD 7.3).

**정직성 표기**: 보고서는 다음 세 가지를 구분해 표시한다.
- **기계 검증**: check 결과
- **모델 판단**: 리뷰, task 완료, AC 충족 여부
- **미지원**: 토큰 예산 등

---

## 7. 정책 강제 (`hooks/guard.mjs`)

PreToolUse에 적용한다. matcher는 `Bash|Write|Edit|MultiEdit|NotebookEdit|mcp__.*`.

| 분류 | 예 | 결정 |
|---|---|---|
| 상태 위조 | Write·Edit 경로가 상태 루트 아래, 또는 Bash 명령에 `make-it-ship/runs` 포함(단 `scripts/mis.mjs` 호출은 허용) | **deny** |
| 승인 명령 | `mis.mjs approve ...` | **ask** — 사용자 확인이 곧 승인 기록 |
| 원격 쓰기 | `git push`, `gh pr create\|merge\|release`, `git -C … push` | **ask** |
| 기본 브랜치 강제 push | `git push --force*` 대상이 main/master | **deny** |
| 패키지 설치 | `npm i/install/add`, `pnpm add`, `yarn add`, `pip install`, `brew install`, `cargo add` | **ask** |
| 파괴적 로컬 | `rm -rf` 저장소 밖 경로나 `/`·`~`, `git reset --hard`, `git clean -fdx` | **ask** |
| 설정 변경 | `.make-it-ship.json` Write/Edit | **ask** (configHash가 바뀌면 기존 증거 STALE) |
| 계획 범위 밖 편집 (M2) | Write/Edit 대상이 plan의 `plannedFiles` glob 밖 | **ask** (범위 확대는 PRD 8.2 질문 대상) |
| 외부 MCP 쓰기 | 도구 이름에 `create\|update\|delete\|send\|push\|merge\|upload\|transition\|edit\|write` 포함 | **ask** |
| 그 외 | — | 개입 없음(Claude Code 기본 권한 정책에 맡김) |

- **적용 범위**: guard는 진행 중인 실행이 있을 때만 정책을 적용한다. 단, 상태 위조 deny는 항상 적용한다.
- **오류 처리**: 훅 내부 오류 시 `ask`를 반환한다(fail-closed).

**위협 모델 (명시)**

- **방어 대상**: 모델의 부주의하거나 습관적인 거짓 완료, 실수로 일어나는 외부 변경.
- **비목표**: 적대적 모델의 의도적 우회. 예를 들어 Bash 문자열을 난독화하는 경우는 막지 않는다.

**잔여 위험과 보완책**

| 잔여 위험 | 보완책 |
|---|---|
| check 명령 자체를 `true`로 바꿔 무력화 | 설정 변경은 ask, configHash로 증거 무효화, 보고서에 사용된 argv 전부 노출 |
| `mis.mjs`에 결과를 직접 써 넣기 | 결과값을 입력받는 하위명령을 두지 않음. 증거는 오직 `check`의 직접 실행으로만 생성 |

---

## 8. `mis.mjs` 하위명령

| 명령 | 동작 |
|---|---|
| `init` | `.make-it-ship.json` 탐지·생성 제안: package.json scripts, pyproject, Makefile 등 탐지 |
| `start --input <file\|text>` | run 생성, baseCommit·deadline 기록, 현재 run 포인터 설정 |
| `plan set <json-file>` | plan 저장(스키마 검증) |
| `mode set <quick\|standard\|full> --reason <txt>` | riskFlags가 있으면 하향 거부 |
| `approve <plan\|...>` | 승인 기록(현재 treeHash·configHash 바인딩). 훅이 ask 강제 |
| `task <id> <start\|done\|fail>` | task 상태 전이, attempts 증가. 상한 초과 시 BLOCKED |
| `check <name>` | 설정의 argv를 `spawn`(shell 없음)으로 실행. 로그는 비밀값 마스킹 후 저장. 타임아웃 적용 |
| `review add <plan-critic\|product\|spec\|quality\|security\|design> <md-file>` | 리뷰 파일을 상태 디렉터리로 복사하고 blocking/major 개수를 파싱 |
| `interview add <json>` / `interview resolve <id> <answer>` | 모호성 항목(impact HIGH/MED/LOW) 기록·해소 |
| `note dep <text>` | 의존성 추가 사유 |
| `note design <md-file>` | 선택한 디자인 시안·디자인 시스템 기록 (design-explore) |
| `note rootcause <task> <md-file>` | 재현·가설·검증 결과. FAIL 후 재시도의 전제 |
| `task <id> retry` | 직전 FAIL 이후 rootcause 노트가 없으면 거부 |
| `verdict` | §6 판정 결과 JSON 출력 |
| `status` | 사람이 읽는 요약: 단계, 작업, 증거, 결정 필요 항목 |
| `resume [run_id]` | lock 회수, 현재 해시로 STALE 재계산, 마지막 이벤트 이후 변경 파일 목록 출력 |
| `report` | `templates/report.md`로 `docs/make-it-ship/<run_id>/report.md` 생성 |
| `block <reason>` / `cancel` | 종료 상태 전이 |
| `doctor` | Node 버전, git 저장소 여부, 설정 유효성, 중복 플러그인 활성 여부(경고) |

### 8.1 `.make-it-ship.json`

```json
{
  "version": 1,
  "checks": {
    "typecheck": { "argv": ["npm", "run", "typecheck"], "timeoutSec": 300 },
    "unit":      { "argv": ["npm", "test"], "timeoutSec": 600 }
  },
  "required": { "quick": ["unit"], "standard": ["typecheck", "unit"] },
  "limits": { "maxAttemptsPerTask": 2, "maxRuntimeMinutes": 120 },
  "dependencyManifests": ["package.json", "package-lock.json", "pyproject.toml", "requirements*.txt"]
}
```

- JSON Schema 검증은 별도 라이브러리 없이 직접 구현한다(필드가 적음).
- 알 수 없는 키가 있으면 오류로 처리한다.

---

## 9. 스킬 흐름 (`skills/run/SKILL.md`)

모드별로 어떤 단계를 거치는지는 §14.1을 따른다. 아래는 Standard 모드 기준이다.

1. `mis doctor`와 `mis start`를 실행한다. 설정이 없으면 `mis init`을 실행하고 사용자 확인을 받는다.
2. **discover**: `explorer`로 저장소를 조사한다.
3. **interview**: 입력에서 모호성 항목을 뽑아 `mis interview add`로 기록한다. HIGH 항목은 사용자에게 한 번에 하나씩 질문하고 해소한다(PRD 8.2: 답이 이미 있는 질문은 하지 않음).
4. goal/constraints/tasks/acceptance를 작성한다 → `mis plan set`. 모드와 사유를 정한다 → `mis mode set`.
5. **plan-critique**: `critic`이 계획을 검토하고 결과를 `review add plan-critic`으로 기록한다. blocking 이슈가 있으면 계획을 수정한다.
6. 계획을 제시하고 `mis approve plan`을 실행한다(미해결 HIGH 모호성이나 critic 미기록이 있으면 mis가 거부).
7. 작업마다 다음을 수행한다.
   - `task start`
   - **implement**: 테스트 가능하면 실패 테스트를 먼저 작성하고, 최소 변경 원칙을 따른다.
   - 관련 `mis check`
   - FAIL이면 **debug** 단계: 재현 → 가설 → 최소 실험 → `note rootcause` → `task retry`
   - `task done` 또는 `task fail`
8. 필수 check를 전부 실행한다. `spec-reviewer`와 `quality-reviewer`를 호출하고, riskFlags가 있으면 `security-reviewer`도 호출한다. 결과는 각각 `mis review add`로 기록한다.
9. `mis verdict` → `mis report` → 사용자에게 보고한다. 보고 내용은 PRD 9.3의 8개 항목이다.
   - **판정 문구는 `mis verdict` 출력만 인용한다.**

**스킬 규칙**
- 서브에이전트는 다른 서브에이전트를 띄울 수 없다고 가정한다. 따라서 흐름 제어는 메인 세션의 스킬이 맡는다.
- 모든 리뷰 에이전트 프롬프트에는 저장소 내용이 신뢰할 수 없는 입력임을 명시한다.
- 같은 관점의 리뷰는 같은 treeHash에서 한 번만 수행한다. 이미 기록이 있으면 재사용한다(중복 리뷰 방지, PRD P0-10).

---

## 10. 테스트 전략

- **러너**: `node --test`. 의존성은 없다.
- **Unit**
  - verdict 우선순위: 상태 조합을 표로 나열한 table-driven 테스트
  - 상태 전이
  - guard 명령 분류: 허용, ask, deny 각 사례와 우회 시도 문자열
  - 설정 검증
  - 비밀값 마스킹
- **Integration**: 임시 git 저장소를 만들어 실행한다.
  - check 실행과 증거 기록
  - 파일 수정, 새 파일 추가, 설정 변경 → STALE
  - lock 회수
  - 강제 종료 후 resume
  - 보고서 경로 제외 확인
- **Plugin smoke**: 수동 실행이며 로그를 남긴다.
  - `claude --plugin-dir .`을 **다른 플러그인을 비활성화한 설정**에서 실행한다.
  - 대상 저장소: `evals/` 데모 저장소.
- **완료 판정**: 본 프로젝트 자체도 PR마다 `npm test` 로그와 커밋을 연결해 남긴다.

---

## 11. 마일스톤

| MS | 범위 | 종료 기준 |
|---|---|---|
| **M0 — 호스트 실증** (반나절) | 최소 플러그인으로 아래 항목 실측 | 각 항목 결과를 `docs/adr/0001-host-smoke.md`에 기록 |
| **M1 — 핵심 경험** | §4 구조, mis 핵심 명령, guard, run/status 스킬, discover·**interview**·plan·**plan-critique**·implement·verify·review | 데모 A/B 수동 E2E 통과, unit/integration 통과 |
| **M2 — 신뢰성** | resume, 재시도 상한, 시간 상한, **debug**, **보안 리뷰**, simplify(의존성 경고·shortcut 목록), doctor, 범위 밖 편집 경고, **HUD** | 데모 D 통과, guard 우회 사례 테스트 |
| **M3 — 선택형 협업** | 독립 task 병렬(worktree), 파일 소유권, product-review·design·**design-explore**(Full 모드, UI 프로젝트). 필요 시 SQLite 재검토 | 충돌 재현 테스트 |
| **M4 — 제품화** | qa(CLI·API·Web·**iOS 시뮬레이터** 프로파일), ship(PR·체인지로그·릴리스 체크리스트), 문서 단계, 데모 C, 파일럿 과제 8종 | 새 환경 설치 → 소형 프로젝트 완료 |
| **M5 — 확장** | retro, learn, 멀티모델 second opinion, **iOS 실기기 브리지**, BSP QA 프로파일, 성능 벤치마크, 토큰 예산(호스트 지원 시), Codex 어댑터 | 별도 AC |

**M0 실증 항목**: 아래는 단정하지 않고 M0에서 실측해 확인할 항목이다.

1. 네임스페이스: `/make-it-ship:run`으로 스킬이 노출되는지
2. 훅 command에서 `${CLAUDE_PLUGIN_ROOT}`가 확장되는지
3. PreToolUse의 `permissionDecision: ask|deny` 출력 형식, 그리고 auto 권한 모드에서 `ask`가 실제로 사용자 확인을 띄우는지
4. 플러그인 에이전트의 `disallowedTools`가 적용되는지
5. 서브에이전트 중첩이 제한되는지
6. MCP 도구 이름 matcher(`mcp__.*`)가 동작하는지
7. 외부 플러그인 활성 목록을 어떤 경로에서 읽을 수 있는지(`doctor`용)
8. 플러그인이 `statusLine`을 직접 등록할 수 있는지, 아니면 사용자 설정에 등록해야 하는지(HUD용)

**3번 항목이 실패하면**(auto 모드에서 ask가 무시되면) 승인 메커니즘을 재설계해야 한다. 대안은 다음과 같다.
- `deny`로 막고 사용자가 `!` 명령으로 직접 승인을 실행하게 한다.

---

## 12. 비범위 (MVP)

- MCP 서버, SQLite, TypeScript 빌드
- 병렬 에이전트, worktree
- 토큰 예산 강제
- 외부 플러그인 어댑터, Codex
- 대시보드, 자동 배포, 자가 개선
- 적대적 모델 방어(§7 위협 모델)

## 13. 운영 메모

- 원격 push와 PR 생성은 사용자 승인 후 수행한다.
- 평가셋과 파일럿에 사내 코드(BSP 등)를 넣지 않는다.
- 오픈소스·라이선스 정책은 공개 전에 결정한다(PRD 16).

---

## 14. 기능 매핑 (ADR-010)

기준 버전: OMC 4.15.6, Superpowers 6.1.1, Ponytail 5.2.0, gstack(로컬 설치본). 이 표는 2026-10-19에 로컬 설치본의 스킬·에이전트 목록에서 작성했다.

- 원본 기능을 그대로 복제하지 않는다. 하나의 단계에 책임자를 하나만 둔다.
- 개발과 무관한 기능은 §14.4에 제외 사유를 적는다.

### 14.1 모드별 단계

| 단계 | Quick | Standard | Full | 강제 지점 (mis/guard) |
|---|---|---|---|---|
| discover | ○ (축약) | ○ | ○ | — |
| interview | 모호할 때만 | ○ | ○ (idea 입력이면 office-hours식 문제 정의 포함) | 미해결 HIGH → 승인 거부 |
| product-review | — | — | ○ | Full은 `product` 리뷰 없으면 승인 거부 |
| design | — | 필요 시 | ○ (ADR 작성) | — |
| design-explore | — | 요청 시 | UI 프로젝트면 ○ | 디자인 선택 기록 없으면 승인 거부 |
| plan | ○ (변경 요약) | ○ | ○ | 스키마 검증 |
| plan-critique | — | ○ | ○ | critic 없으면 승인 거부 |
| implement (TDD) | ○ | ○ | ○ | — (지시문) |
| debug | FAIL 시 | FAIL 시 | FAIL 시 | rootcause 없으면 retry 거부 |
| verify | ○ | ○ | ○ | 증거·판정 |
| review spec/quality | quality만 | ○ | ○ | 미기록 시 PARTIAL |
| review security | 위험 시 | 위험 시 | 위험 시 | 미기록 시 PARTIAL |
| simplify | ○ | ○ | ○ | 의존성 사유 누락 시 PARTIAL |
| qa (실동작) | — | 해당 표면 있으면 | ○ | qa check가 필수 목록에 포함 |
| ship (PR 준비) | 요청 시 | 요청 시 | ○ | push/PR은 ask |
| retro / learn | — | — | ○ | — |

위험 신호(auth, 결제, 개인정보, 마이그레이션, 하드웨어)가 있으면 변경 규모와 관계없이 Standard 이상으로 올린다(ADR-009).

### 14.2 원본 기능 → Make It Ship 단계

| Make It Ship 단계 | 흡수하는 원본 기능 | 재구성 방식 |
|---|---|---|
| **discover** | OMC deepinit·explore·analyst, gstack health, OMC external-context·document-specialist | `explorer`가 구조·빌드·테스트 명령을 조사. 외부 문서는 context7 등이 있으면 사용 |
| **interview** | OMC deep-interview·deep-dive, gstack office-hours·spec·plan-tune, Superpowers brainstorming | 모호성 항목을 HIGH/MED/LOW로 분류해 상태에 기록하고, HIGH는 해소될 때까지 한 번에 하나씩 질문. 질문 민감도는 설정 `interview.threshold` |
| **product-review** | gstack plan-ceo-review·plan-design-review·plan-devex-review·autoplan | `product-reviewer` 한 명이 제품·UX·DX 관점을 한 번에 검토 |
| **design** | OMC architect, gstack plan-eng-review·diagram, Superpowers brainstorming(대안 탐색) | `architect`가 대안 2개 이상 비교하고 ADR 초안 작성 |
| **plan** | Superpowers writing-plans, OMC plan·planner·ultragoal, gstack spec | task·acceptance·`plannedFiles`·의존성을 `plan.json`에 기록 |
| **plan-critique** | OMC ralplan·critic, gstack autoplan | `critic`이 반론 검토. 계획이 바뀌면 다시 검토 |
| **implement** | Superpowers test-driven-development·executing-plans·subagent-driven-development, OMC executor·deep-executor·test-engineer·autopilot·ralph | 메인 세션이 TDD로 구현. 계획 범위 밖 편집은 guard가 사용자에게 확인 |
| **debug** | Superpowers systematic-debugging, OMC debugger·tracer·trace·debug, gstack investigate | 재현 → 가설 → 최소 실험 → rootcause 기록. 같은 실패의 무근거 재시도는 차단 |
| **verify** | Superpowers verification-before-completion, OMC verify·verifier·ultraqa, gstack health | `mis check` / `mis verdict` (원본보다 강제력이 강함) |
| **review** | Superpowers requesting/receiving-code-review, OMC code-reviewer·quality-reviewer·security-reviewer, gstack review·cso, ponytail-review | spec / quality / security 리뷰어 3명을 분리. 같은 treeHash에서는 재사용 |
| **simplify** | Ponytail(ponytail·audit·debt), OMC ai-slop-cleaner·code-simplifier | quality 리뷰의 단순성 항목, 의존성 사유 요구, 보고서에 `shortcut:` 목록 |
| **qa** | gstack qa·qa-only·browse·benchmark·design-review·devex-review·ios-design-review, OMC qa-tester·visual-verdict, gstack ios-qa | QA 프로파일(CLI·API·Web·iOS·BSP)별 check 명령. 브라우저 QA는 프로젝트의 Playwright 등 실행 도구 사용. 실행 불가 시 BLOCKED |
| **ship** | gstack ship·document-release·document-generate·land-and-deploy(준비 부분만), OMC writer, OMC release·merge-readiness·git-master, Superpowers finishing-a-development-branch | 브랜치 정리, 체인지로그, 릴리스 체크리스트, PR 초안. push/PR/배포는 ask |
| **retro / learn** | gstack retro·learn, OMC learner·remember·wiki·skillify, Superpowers writing-skills | `events.jsonl`에서 지표 집계, 학습 내용을 `docs/make-it-ship/learnings.md`에 기록. 프로세스 변경은 승인 후 적용 |
| **parallel (M3)** | OMC team·ultrawork·omc-teams·project-session-manager, Superpowers dispatching-parallel-agents·using-git-worktrees | 독립 task만 worktree로 격리해 병렬 실행 |
| **resume / cancel** | gstack context-save·context-restore, OMC notepad·state·cancel | run 상태 + `mis resume` / `mis cancel` |
| **guard** | gstack careful·guard·freeze·unfreeze | `guard.mjs` (§7) |
| **hud (M2)** | OMC hud | `scripts/statusline.mjs`가 현재 run의 단계·task 진행·필수 check 상태·판정을 한 줄로 출력. 예: `MIS ▸ EXECUTING · T3/7 · unit✓ typecheck✗ · PARTIAL`. 사용자 `statusLine` 설정 등록은 `mis init`이 제안하고 사용자가 승인 |
| **design-explore (M3)** | gstack design-consultation·design-shotgun·design-html·design-review, OMC designer | UI 프로젝트(Web·iOS)의 Full 모드에서 실행. ① 디자인 시스템 제안(`DESIGN.md`: 색·글꼴·간격 토큰) ② 시안 2~3개를 정적 HTML(iOS는 SwiftUI Preview)로 생성해 비교 ③ 사용자가 선택하면 `mis note design`으로 기록. 이 기록이 없으면 계획 승인 불가. 구현 후 디자인 일관성 검토는 qa 단계에서 수행 |
| **ios (M4 시뮬레이터 / M5 실기기)** | gstack ios-qa·ios-design-review·ios-fix·ios-clean·ios-sync | M4: `xcodebuild build/test` + `simctl` 시뮬레이터 실행을 iOS QA 프로파일 check로 제공. M5: DEBUG 빌드 한정 실기기 디버그 브리지(SPM 패키지 + `#if DEBUG`)로 실기기 상태 조회·스크린샷. **ship 단계는 브리지 코드가 남아 있으면 PARTIAL**(ios-clean 대응). 실기기가 없으면 BLOCKED |
| **second opinion (M5)** | OMC ccg·ask, gstack codex·benchmark-models | 다른 모델 CLI가 설치돼 있으면 리뷰를 한 번 더 받는 선택 기능 |

### 14.3 선택 직접 호출 명령

`run`을 쓰지 않고 단계 하나만 단독으로 쓸 때 사용한다.

| 명령 | 제공 시점 |
|---|---|
| `/make-it-ship:interview` | M1 |
| `/make-it-ship:plan-review` | M1 |
| `/make-it-ship:review` | M1 |
| `/make-it-ship:debug` | M2 |
| `/make-it-ship:qa` | M4 |
| `/make-it-ship:ship` | M4 |
| `/make-it-ship:retro` | M5 |

각 명령은 해당 `phases/*.md`를 사용한다. 실행 중인 run이 있으면 결과를 그 run에 기록한다.

### 14.4 제외 (개발 워크플로와 무관)

| 원본 기능 | 제외 사유 |
|---|---|
| OMC configure-notifications·omc-setup·omc-doctor·mcp-setup·setup·skill·local-build-reminder·omc-reference, gstack gstack-upgrade·setup-*·sync-gbrain | 각 도구 자체의 설정·운영 기능 (Make It Ship은 `doctor`만 둠) |
| OMC writer-memory | 소설 집필용 |
| Superpowers using-superpowers, ponytail-help·ponytail-gain | 각 도구의 사용 안내·자기 홍보 지표. Make It Ship은 README와 `status`로 대체 |
| OMC sciomc·scientist·autoresearch·self-improve | 연구·자가 개선 루프. 자가 개선은 PRD 11.2 제외 항목 |
| gstack canary·landing-report | 배포 이후 운영 영역 (PRD 비목표) |
| gstack pair-agent·connect-chrome·setup-browser-cookies·scrape·skillify(browser) | 브라우저 자동화 도구 자체. QA 단계는 프로젝트의 실행 도구를 사용 |
| gstack make-pdf | 문서 변환 유틸 |
