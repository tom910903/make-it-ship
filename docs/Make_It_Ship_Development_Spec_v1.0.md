# Make It Ship — 개발 요구사항 및 아키텍처 설계서

> **From Idea to Verified Software**  
> OMC · Superpowers · gstack · Ponytail에서 착안한 독립형 AI 소프트웨어 엔지니어링 프레임워크

| 메타데이터 | 값 |
|---|---|
| 프로젝트명 | **Make It Ship** |
| 프로젝트 식별자 | `make-it-ship` |
| 문서 버전 | **1.0 (구현 착수용 초안)** |
| 작성 기준일 | 2026-10-19 |
| 초기 호스트 | Claude Code / macOS Apple Silicon (Mac Studio M4, 128GB) |
| 장기 목표 | Codex 등 다중 AI 에이전트 런타임 지원 |
| 구현 기술 제안 | TypeScript, Node.js LTS, SQLite, Git, Claude Code Plugin |
| 현재 상태 | **설계 문서** — 아래 명령·경로·API는 구현 예정 사양이며 아직 동작이 보장되지 않음 |

---

## 0. 이 문서의 사용법

이 문서는 Claude Code 등 AI 개발 에이전트에 전달할 **구현 기준 문서**다. 개발자는 본 문서를 기준으로 저장소를 생성하고, 마일스톤별로 동작하는 코드를 작성하며, 각 단계의 테스트 증거를 남긴다.

**사실과 제안의 구분**
- **기존 프로젝트의 기능**: 공식 저장소/문서에 기반하며 개발 시 특정 태그·커밋 기준 재검증이 필요하다.
- **Make It Ship 요구사항**: 이 문서에서 새로 정의한 구현 목표이며 기존 플러그인의 기능 또는 호환성 보증을 뜻하지 않는다.
- **예시 코드/명령어**: Make It Ship이 구현해야 할 목표 인터페이스. 현재 설치 가능한 제품의 명령이라고 가정하지 않는다.

**개발 원칙**: `구현 계획 → 최소 기능 구현 → 검증 증거 → 리뷰 → 마일스톤 승인`을 지킨다. 테스트를 실행하지 않은 작업을 '완료'로 표시하지 않는다.

## 1. 문제 정의와 비전

### 1.1 현재 문제

AI 코딩 도구는 코드 생성은 빠르지만, (1) 계획과 실행의 중복, (2) 다중 에이전트 간 변경 충돌, (3) 근거 없는 완료 선언, (4) 과설계·불필요한 의존성 증가, (5) 긴 작업의 상태 소실, (6) 실제 QA 및 배포 승인 누락 문제가 발생하기 쉽다. OMC, Superpowers, gstack, Ponytail을 동시에 활성화하면 스킬 설명·자동 훅·검증 절차의 중복이 추가될 수 있다.

### 1.2 목표

사용자가 아이디어, 이슈, 요구사항 `.md` 파일을 제공하면 **Make It Ship**이 분석·계획·개발·검증·보고를 하나의 워크플로로 수행한다. 사람의 승인 없이 위험한 외부 변경을 수행하지 않으며, 검증하지 않은 결과를 성공으로 보고하지 않는다.

**제품 슬로건**: **From Idea to Verified Software**.

### 1.3 설계 원칙

1. **Single Owner** — 각 단계에 단일 책임자를 둔다. 중복 오케스트레이터를 실행하지 않는다.
2. **Evidence, Not Claims** — 완료 판정은 실제 명령 실행 결과, 테스트와 소스 리비전에 연결한다.
3. **Correctness Before Simplicity** — 정확성·안전성·요구사항을 유지한 상태에서만 단순화한다.
4. **Adaptive Execution** — 작은 수정에 모든 에이전트를 동원하지 않는다.
5. **Persistent & Recoverable** — 중단된 세션의 상태를 복원하고 손상된 상태를 탐지한다.
6. **Portability by Design** — 핵심 엔진과 Claude 전용 플러그인 계층을 분리한다.
7. **Human-Controlled Shipping** — 공개 배포, 원격 push, 결제 및 데이터 삭제 등 위험 행위는 사전 승인을 요구한다.
8. **Least Privilege** — 도구와 에이전트 권한은 수행하는 작업에 필요한 범위로 제한한다.

## 2. 참고 프로젝트: 흡수할 장점과 제외할 부분

| 출처 | 가져올 **개념/원칙** | Make It Ship의 책임 | 제외/주의 |
|---|---|---|---|
| [OMC](https://github.com/Yeachan-Heo/oh-my-claudecode) | Team, 병렬 작업 분할, 상태 추적, 계획→실행→검증→수정 | 오케스트레이션·에이전트 배치·워크플로 상태 | OMC 비공개 API/훅에 직접 결합 금지 |
| [Superpowers](https://github.com/obra/superpowers) | Spec-first, TDD, 근본 원인 디버깅, 독립 리뷰, 근거 기반 완료 | 개발 방법론·Quality Gate 정책 | 동일한 Planner/Reviewer 중복 호출 금지 |
| [gstack](https://github.com/garrytan/gstack) | 제품/설계 리뷰, 실제 QA, Release/Retro | Product·QA·Ship·Retro 단계 | 브라우저가 없는 CLI/BSP 작업에 브라우저 QA 강제 금지 |
| [Ponytail](https://github.com/DietrichGebert/ponytail) | 재사용 우선, YAGNI, 최소 변경, 의존성·복잡성 검토 | Simplicity 정책과 리뷰 체크 | 테스트·오류 처리·보안 로직 삭제 금지 |

**통합 전략**: **원칙과 책임을 먼저 내재화**하고, 필요하면 안정적으로 공개된 외부 인터페이스를 사용하는 **선택형 어댑터**를 제공한다. 외부 4개 플러그인의 병렬 설치 또는 내부 스킬 호출을 필수로 하지 않는다. 업스트림 코드 복사는 법적 고지·버전 핀·유지보수 계획이 있는 경우에만 허용한다.

### 2.1 중복 기능 단일 책임 표

| 작업 | 단일 책임자 | 차용하는 방법론 |
|---|---|---|
| 제품 목적/범위 | Product Lead | gstack식 제품 리뷰 |
| 기술 설계 | Architect | OMC식 설계 + 독립 Critic |
| 상세 작업 계획 | Planner | Superpowers식 원자적 태스크 |
| 작업 분배·스케줄링 | Orchestrator | OMC식 Team |
| 구현 | Executor | 테스트 가능한 변경에는 TDD |
| 실패 분석 | Debugger | Superpowers식 원인 가설 검증 |
| 요구사항 적합성 | Spec Reviewer | 독립 Spec Compliance 리뷰 |
| 코드·운영 품질 | Code Reviewer | 품질·보안·성능 검토 |
| 불필요한 복잡성 | Simplicity Reviewer | Ponytail 정책 |
| 실제 QA/출시 | QA / Release Manager | gstack식 현장 검증 및 출시 게이트 |
| 개발 회고 | Retrospective Manager | 지표 기반 개선 제안 |

## 3. 범위와 비범위

### 3.1 포함 (In Scope)

- `.md` 요구사항 파일 또는 자연어 요구로 프로젝트 시작
- 저장소 기존 코드·테스트·의존성 탐색
- 범위·제약·수락기준(AC) 생성/검증, 설계 및 ADR 작성
- Quick / Standard / Full 자동 라우팅과 사용자 명시 선택
- 태스크 DAG, 의존성·파일 소유권·병렬성 분석
- Claude Code 기반 에이전트 실행·검토·검증
- 빌드·테스트·정적 분석 실행 증거 수집
- 상태 저장, 재시작·재개, 제한된 재시도, 취소
- 단순화 정책, 변경별 위험 수준·승인 게이트
- Git 기반 작업 격리 및 PR/배포 준비 보고
- 비용·토큰·검증 성공률·재작업량 통계(획득 가능한 범위에서만)
- 로컬 우선 저장, 민감정보 보호, 사용자 승인

### 3.2 초기 비범위 (Out of Scope)

- 자체 LLM 학습/파인튜닝, 모델 가중치 수정
- 인간 승인 없는 실서비스 배포·대금 지출·파괴적 DB 변경
- 모든 호스트/모든 모델의 동일 동작 보장
- 임의 외부 플러그인의 개인용 훅 또는 비공개 API를 호출하는 통합
- AI 자체 보고만으로 품질을 보증하는 자동 완료
- 원격 통합 서비스/대시보드의 P0 개발

## 4. 사용자 시나리오 및 수락기준

### UC-01: 설계문서 기반 신규 프로젝트

1. 사용자가 `requirements.md`를 지정하고 Full 실행.
2. 요구사항 누락·충돌을 발견하면 영향도가 높은 결정만 사용자에게 질문하고 나머지는 가정을 명시.
3. 아키텍처와 작업 계획을 산출하며 필수 사용자 승인(설계 기준 변경 포함)을 받음.
4. 독립 태스크를 병렬 처리하고 각 태스크는 테스트·리뷰에 통과해야 통합됨.
5. 통합 QA 결과와 미검증 항목을 보고. Git push/배포는 별도 승인.

**AC**: 실행 결과에 요구사항→태스크→커밋/변경→검증 로그로 이어지는 추적 정보가 존재한다.

### UC-02: 작은 버그 수정

Quick 모드에서 재현 테스트(가능한 경우) → 원인 분석 → 최소 수정 → 회귀 테스트 → 차이점 보고. 외부 인프라나 병렬 팀을 기본으로 사용하지 않음.

**AC**: 수정 전 실패 근거와 수정 후 통과 근거 또는 그 부재 사유가 명시된다.

### UC-03: 세션 중단 후 재개

`run_id`로 재개하면 완료 태스크는 재실행하지 않고 검증 유효성을 확인. 진행 중 태스크는 상태와 변경 파일을 재검토한 후 안전하게 재개.

**AC**: 동일 태스크의 중복 커밋·이중 배포 없이 재개할 수 있다.

### UC-04: Linux BSP / Yocto 변경

브라우저 테스트 대신 구성 파일 정적 검증, BitBake parse, 빌드, 관련 unit/integration 또는 하드웨어 테스트를 프로젝트별 프로파일로 실행. 실제 하드웨어가 없는 경우 `BLOCKED`를 보고.

**AC**: 미실행 하드웨어 검증을 통과한 것으로 표시하지 않는다.

## 5. 기능 요구사항 (우선순위)

우선순위: **P0 필수(MVP)** / **P1 정식 버전** / **P2 장기 확장**.

| ID | 요구사항 | 우선순위 | 객관적 완료 조건 |
|---|---|---|---|
| FR-001 | Claude Code 설치 가능한 플러그인 패키지 | P0 | `--plugin-dir` 실행 시 `make-it-ship:*` 스킬 확인 |
| FR-002 | Quick/Standard/Full 모드 분기 | P0 | 범위·위험도에 따라 결정, 수동 재정의 가능 |
| FR-003 | Spec/계획 생성과 검토 | P0 | 계획 산출물 + 승인 기록 |
| FR-004 | 태스크 DAG와 의존성 검사 | P0 | 순환 의존성 차단, 선행 미완료 실행 차단 |
| FR-005 | 단일 에이전트 실행 경로 | P0 | 단일 태스크 성공/실패 저장 |
| FR-006 | 실행 결과 및 상태 영속화 | P0 | 중단/재개 통합 테스트 통과 |
| FR-007 | 빌드/테스트 증거 기반 Gate | P0 | 실패/미실행 시 PASS 금지 |
| FR-008 | Simplicity 검토 | P0 | 추가 의존성·추상화 근거 없을 때 리뷰 경고 |
| FR-009 | 정책 기반 승인/금지 동작 | P0 | push/deploy/파괴적 명령 차단 테스트 |
| FR-010 | 작업별 독립된 리뷰 | P1 | Spec/Quality/Simplicity 항목 구분 기록 |
| FR-011 | 병렬 에이전트 + 파일 충돌 제어 | P1 | 독립 태스크 병렬 및 충돌 재현 테스트 |
| FR-012 | Git worktree 격리/정리 | P1 | 실패 후 원본 작업공간 보존 |
| FR-013 | 실동작 QA 어댑터 | P1 | CLI/API/Web 중 해당 표면 검증과 재현 로그 |
| FR-014 | 실패 제한 재시도/원인 추적 | P1 | 지정 횟수 후 BLOCKED 및 원인 표시 |
| FR-015 | 실행 비용 및 예산 제어 | P1 | 한도 도달 시 안전 중지/승인 요청 |
| FR-016 | 외부 도구 어댑터 및 버전 탐지 | P1 | 미설치/비호환 시 자체 실행으로 안전한 대체 |
| FR-017 | CI/Eval/성능 지표 | P1 | 반복 가능한 평가 스위트 생성 |
| FR-018 | Retrospective/지식 저장 | P2 | 제안/평가/승인/롤백 절차 |
| FR-019 | Codex 런타임 어댑터 | P2 | Claude 의존 코어 API 없이 실행 테스트 |
| FR-020 | 대시보드/원격 컨트롤 | P2 | 별도 보안·권한 검토 후 추진 |

## 6. 비기능 요구사항

- **NFR-01 macOS**: macOS arm64에서 설치·빌드·테스트·상태 DB 정상 동작. Linux는 CI 병행 권장.
- **NFR-02 호환성**: Node.js **검증된 LTS 버전**을 핀; 의존성 잠금 파일과 릴리스 테스트 매트릭스 유지. 불확실한 API를 임의로 추정하지 않음.
- **NFR-03 복구성**: 상태 전이·감사 기록은 트랜잭션 처리하며 강제 종료 후 정합성 유지.
- **NFR-04 보안**: 로컬 데이터 최소 저장, 비밀값 로그 마스킹, 실행 도구 allowlist, 위험 행위 승인.
- **NFR-05 비용**: 프로젝트별 에이전트 수, 반복 횟수, 시간/토큰 예산의 상한을 설정.
- **NFR-06 관측성**: 모든 작업에 `run_id`, `task_id`, `attempt_id`, 시작/끝 시간, 코드 리비전 포함.
- **NFR-07 재현성**: 동일 테스트는 동일 실행 명령/환경/커밋 정보를 기록; 외부 서비스를 포함하면 조건 명시.
- **NFR-08 사용성**: Quick 모드에서 불필요한 절차를 생략하되 필수 안전 게이트는 생략 금지.
- **NFR-09 프라이버시**: 코드/문서의 모델 제공자 전송 가능성을 명시; 동의 없는 원격 업로드/텔레메트리 금지.
- **NFR-10 운영 안정성**: 비정상 종료 후 리소스·작업공간 정리; 동시 상태 변경의 잠금·중복 실행 방지.

## 7. 아키텍처

### 7.1 논리 구조

```text
                       User / Jarvis (future)
                               |
                     Claude Code Plugin UI
                 skills / agents / minimal hooks
                               |
                        Make It Ship API
                               |
        +----------------------+-----------------------+
        |                      |                       |
   Workflow Router        Orchestrator            Policy Engine
   - mode detection       - task DAG              - permissions
   - risk scoring         - agent dispatch        - quality gates
   - stage selection      - worktree owners       - simplicity
        |                      |                       |
        +----------------------+-----------------------+
                               |
                         Core Services
          +--------------------+--------------------+
          |                    |                    |
      State Store         Evidence Store       Adapter Registry
      SQLite/WAL          logs/artifacts       Claude / external
          |                    |                    |
          +--------------------+--------------------+
                               |
                         Git / CI / QA
                               |
                      Verified Deliverable
```

### 7.2 모듈 경계

1. **Plugin Layer**: 호스트의 스킬 및 에이전트 정의, 최소 훅. 실제 로직을 스킬 프롬프트에만 의존시키지 않음.
2. **Core Engine**: 런타임에 독립적인 단계 전이, DAG, 정책, 실행 상태.
3. **Runtime Adapter**: Claude Code 실행·권한·결과 정규화, 향후 Codex 어댑터.
4. **Tool Adapter**: Git/파일시스템/빌드/QA/브라우저 기능. capability를 발견해서 선택.
5. **Persistence**: SQLite와 파일 기반 로그·결과물. 테이블 스키마와 마이그레이션 코드 소유.
6. **Policy**: 실행 허용 목록, 승인 Gate, 체크 명령, 위험도 프로파일.

### 7.3 제안 저장소 구조

```text
make-it-ship/
├── .claude-plugin/
│   └── plugin.json              # 공식 Claude Code 플러그인 매니페스트
├── skills/
│   ├── init/SKILL.md
│   ├── plan/SKILL.md
│   ├── build/SKILL.md
│   ├── review/SKILL.md
│   ├── verify/SKILL.md
│   ├── ship/SKILL.md
│   ├── resume/SKILL.md
│   └── status/SKILL.md
├── agents/
│   ├── planner.md
│   ├── architect.md
│   ├── executor.md
│   ├── spec-reviewer.md
│   ├── code-reviewer.md
│   └── qa.md
├── hooks/
│   └── hooks.json               # 최소 이벤트, 재진입 방지
├── src/
│   ├── core/                   # runtime-neutral contracts
│   ├── workflow/               # routing, stages, DAG
│   ├── orchestration/          # scheduling, isolation
│   ├── policies/               # permission, risk, simplicity
│   ├── gates/                  # test/build/quality evidence
│   ├── adapters/               # Claude / git / QA / optional upstream
│   ├── persistence/            # migrations, SQLite, event log
│   ├── telemetry/              # local metrics, redaction
│   └── cli/                    # makeitship executable (future)
├── config/
│   ├── defaults.yaml
│   └── schema.json
├── templates/
│   ├── spec.md
│   ├── plan.md
│   ├── adr.md
│   └── report.md
├── docs/
│   ├── architecture.md
│   ├── security.md
│   ├── user-guide.md
│   └── upstream-notices.md
├── evals/
│   ├── quick-bugfix/
│   ├── standard-feature/
│   └── full-project/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── package.json
├── tsconfig.json
├── LICENSE
└── README.md
```

**주의**: `skills/`, `agents/`, `hooks/`는 `.claude-plugin/` 폴더 내부가 아니라 플러그인 루트에 둔다. 공식 문서에 따라 최종 매니페스트 및 명령 노출을 검증한다.

### 7.4 초기 plugin.json 예시

```json
{
  "name": "make-it-ship",
  "version": "0.1.0",
  "description": "From Idea to Verified Software"
}
```

매니페스트 예시는 최소 초안이다. 실제 배포 시 버전·스키마 검증, 디렉터리 존재·경로 제한 테스트를 추가한다.

## 8. 사용자 인터페이스 계약 (구현 예정)

Claude Code에서는 플러그인 스킬을 **네임스페이스 명령**으로 제공한다.

| 명령어 (목표) | 동작 |
|---|---|
| `/make-it-ship:init` | 저장소 분석, 빌드/테스트 명령 탐지, 사용자 설정 생성 |
| `/make-it-ship:plan <요구사항>` | Spec/Plan 생성, 위험·승인 항목 도출 |
| `/make-it-ship:build <plan>` | 작업 분배·개발 및 검증 실행 |
| `/make-it-ship:review` | Spec/Code/Simplicity 독립 검토 |
| `/make-it-ship:verify` | 최종 증거 확인 및 결과 분류 |
| `/make-it-ship:status` | 실행 상태/실패·차단 이유 확인 |
| `/make-it-ship:resume <run_id>` | 이전 실행 안전 재개 |
| `/make-it-ship:ship` | PR·릴리스 준비, 실제 push/배포 전 승인 |

장기 목표 CLI: `makeitship init|plan|build|status|resume|verify|ship` (MVP 필수 아님). **위 명령은 현재 구현된 명령이 아니다.**

예상 사용법:

```text
/make-it-ship:init
/make-it-ship:plan docs/requirements.md
/make-it-ship:build docs/make-it-ship/plans/feature-001.md
/make-it-ship:status
/make-it-ship:verify
```

## 9. 워크플로와 라우팅

### 9.1 실행 모드

| 모드 | 선택 기준(제안) | 수행 단계 |
|---|---|---|
| **Quick** | 범위 좁고 낮은 위험 | inspect → fix → relevant test → report |
| **Standard** | 일반 기능/변경 | spec-lite → plan → implement → review → verify |
| **Full** | 신제품/대형 변경/고위험 | discovery → architecture → plan → team → QA → release-ready → retro |

보안, 결제, 개인정보, 데이터 손실, 하드웨어 안전 등 **고위험 신호는 변경 규모가 작아도 검증을 상향**한다.

### 9.2 Full 모드 상태 전이

```text
CREATED
   |
   v
DISCOVERY -> DESIGN_REVIEW -> PLANNING -> WAITING_APPROVAL
                                          | approved
                                          v
                                        EXECUTING
                                          |
                                          v
                                       REVIEWING
                                          |
                                          v
                                       VERIFYING
                                          |
                            +-------------+-------------+
                            |                           |
                            v                           v
                       QA_FAILED                    QA_PASSED
                            |                           |
                     FIXING (bounded)                   v
                            |                    READY_TO_SHIP
                            +----> VERIFYING              |
                                                        APPROVAL
                                                           |
                                                    SHIPPED / CLOSED
```

**공통 말단 상태**: `BLOCKED`, `CANCELLED`, `FAILED` (사유·다음 행동 필수 기록). `SHIPPED`는 공개/배포가 실제 완료된 경우에만 사용하고, 배포하지 않은 경우 `READY_TO_SHIP`을 유지한다.

### 9.3 모드 선택 규칙

- 입력: 변경 예상 파일 수, 비즈니스 위험, 서비스 외부 영향, 테스트 유무, 모호성, 예상 작업 DAG 깊이.
- 출력: `mode`, `reasons[]`, `mandatory_gates[]`, `approval_required`.
- 자동 결정은 추적·재현 가능하도록 규칙 버전을 기록.
- 사용자는 상향 조정 가능. 안전 Gate를 우회하는 하향은 거부.

### 9.4 실패와 재시도

- 재시도는 **동일 오류를 무조건 반복하지 않는다**. 실패 유형을 `TRANSIENT / CODE_DEFECT / ENVIRONMENT / PERMISSION / UNKNOWN`으로 분류.
- `TRANSIENT`만 제한된 백오프로 자동 재시도. `CODE_DEFECT`는 진단 후 새 수정 계획 필요.
- 계획 변경과 신뢰 경계 변경은 재승인 대상. 재시도 최대 횟수(기본 제안 2회)를 넘으면 `BLOCKED`.
- 재개 시 `base_commit`, 작업 공간 변경, 잠금 보유자, 테스트 결과의 커밋 일치 여부 확인.

## 10. 에이전트·태스크 실행 계약

### 10.1 AgentRole

```ts
// Make It Ship가 새로 구현할 코어 인터페이스 (제안)
type AgentRole =
  | 'product' | 'architect' | 'planner' | 'executor'
  | 'debugger' | 'spec-reviewer' | 'code-reviewer'
  | 'simplicity-reviewer' | 'qa' | 'release';

type TaskStatus =
  | 'PENDING' | 'READY' | 'RUNNING' | 'REVIEWING'
  | 'PASSED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';

interface TaskSpec {
  id: string;
  runId: string;
  role: AgentRole;
  objective: string;
  acceptanceCriteria: string[];
  dependencies: string[];
  plannedFiles: string[];
  allowedTools: string[];
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  maxAttempts: number;
}

interface TaskResult {
  taskId: string;
  status: TaskStatus;
  changedFiles: string[];
  evidenceIds: string[];
  commitSha?: string;
  summary: string;
  remainingRisks: string[];
}
```

### 10.2 병렬성/격리

1. 서로 의존하거나 동일 파일 소유권을 가진 태스크는 기본 직렬화.
2. 병렬 태스크는 독립 worktree/branch로 격리하고, 통합 직전에 변경 충돌 및 최신 테스트 확인.
3. DB 마이그레이션, 루트 설정, 패키지 잠금 파일은 기본 배타적 소유.
4. 독립 리뷰어는 구현자와 **별도 컨텍스트/결과**를 가지며 원칙적으로 읽기 전용.
5. 병렬성은 사용자 지정 상한(기본 제안 2)을 넘지 않는다. macOS 리소스와 실제 API 비용에 맞게 조정.

### 10.3 런타임 어댑터 계약

```ts
interface RuntimeCapabilities {
  spawnAgent: boolean;
  parallelAgents: boolean;
  worktree: boolean;
  tokenUsage: boolean;
  structuredResult: boolean;
}

interface AgentRuntimeAdapter {
  id: string;
  detect(): Promise<RuntimeCapabilities | null>;
  execute(task: TaskSpec, context: Record<string, unknown>): Promise<TaskResult>;
  cancel(taskId: string): Promise<void>;
}
```

**제약**: Claude Code 플러그인의 스킬 자체가 내부 모델/세션 생성 API를 무조건 제공한다고 가정하지 않는다. 초기 P0는 **Claude Code의 지원되는 도구·서브에이전트 기능을 이용한 인세션 실행**과 독립 Core 상태 관리에 집중한다. 별도 프로세스 실행/병렬화는 지원 API를 확인한 뒤 P1에서 도입한다.

## 11. 상태 저장 및 파일 형식

### 11.1 위치 및 소유권

- 실행 전용 데이터(비밀 제외): 기본 `~/.local/state/make-it-ship/<repo-hash>/` 제안. 설정으로 변경 가능.
- 공유 가능한 보고서: `<repo>/docs/make-it-ship/` (Git 관리 여부는 프로젝트 설정 따름).
- 로그, 워크트리, 임시 파일은 기본 `.gitignore` 또는 외부 상태 경로로 분리.
- 권한은 현재 OS 계정 기준 제한; 비밀값을 DB에 저장하지 않는다.

### 11.2 SQLite 스키마 (개념)

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  repo_root TEXT NOT NULL,
  mode TEXT NOT NULL,
  state TEXT NOT NULL,
  base_commit TEXT,
  policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  status TEXT NOT NULL,
  role TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  input_hash TEXT NOT NULL,
  result_json TEXT
);
CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  kind TEXT NOT NULL,
  command TEXT,
  exit_code INTEGER,
  commit_sha TEXT,
  log_path TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  action TEXT NOT NULL,
  approved_by TEXT,
  decision TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

구현 시 SQLite `WAL`, foreign key 활성화, DB migration, 상태 전이 트랜잭션, 실행별 잠금, 로그 회전/보존 기간을 포함한다. 파일 경로는 저장소를 벗어나지 않도록 검증한다.

### 11.3 무결성 규칙

- 동일 `run_id`의 한 태스크에는 활성 실행 `attempt`가 동시에 최대 하나.
- `PASS`는 `evidence.commit_sha == 현재 검증 대상 commit`일 때만 유효.
- 소스나 테스트 설정이 바뀌면 영향받는 Gate는 `STALE`로 재설정.
- 승인 기록은 변경 범위·위험 행위·커밋과 연결하며 다른 내용에 재사용하지 않는다.

## 12. 품질 게이트 설계

### 12.1 Gate 공통 계약

```ts
type GateStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_APPLICABLE' | 'STALE';

interface QualityGateResult {
  gateId: string;
  status: GateStatus;
  rationale: string;
  evidenceIds: string[];
  sourceRevision: string;
  checkedAt: string;
}
```

**PASS 조건**은 재현 가능한 증거와 검증 대상 리비전 일치다. `NOT_APPLICABLE`에는 범위 근거가 필요하고 `BLOCKED`는 통과가 아니다.

### 12.2 단계별 Gate

| Gate | 검증 사항 | 실패 시 조치 |
|---|---|---|
| G0 Spec | 명확한 범위, 수락기준, 비기능 제약, 승인 | 계획 보완 |
| G1 Architecture | 의존성/인터페이스, 대안 검토, 주요 위험 | 설계 수정/재승인 |
| G2 Implementation | 기능 동작, 관련 테스트, 린트/타입 검사 | 최소 수정 후 재실행 |
| G3 Spec Review | 요구사항 미달/과잉 구현 여부 | 해당 태스크 재작업 |
| G4 Code & Simplicity | 안정성·보안·성능·불필요한 복잡성 | 수정 또는 근거 있는 예외 승인 |
| G5 Integration | 전체 빌드 및 영향 범위 통합 테스트 | 통합 실패 분석 |
| G6 Actual QA | CLI/API/UI/하드웨어 중 적합한 실동작 증거 | 결함 등록/차단 |
| G7 Release | 변경 이력, 롤백 계획, 공개 영향, 사용자 승인 | `READY_TO_SHIP` 유지 |

### 12.3 개발 방법론

- **TDD**: 결정 로직·버그 재현이 가능한 변경은 **Red → Green → Refactor** 적용. 빌드 설정/하드웨어 제약은 동등한 자동/수동 검증 근거를 명시.
- **디버깅**: 현상 재현 → 정상/비정상 비교 → 가설 → 최소 실험 → 수정 → 회귀 테스트.
- **Dual Review**: 최소 Spec Compliance와 Code Quality 결과를 분리 기록. 같은 검사 항목 중복 수행은 캐시/리비전으로 방지.
- **Simplicity**: 기존 코드·플랫폼 기능·표준 라이브러리·기존 의존성을 우선 검토. 안전성과 명확성이 줄 수보다 우선.
- **Evidence Freshness**: 구현 이후 수정이 있으면 영향받는 테스트·리뷰 재검증.

### 12.4 프로젝트별 QA 프로파일

- **Web**: UI 스모크/E2E, 화면 전환, 접근성/콘솔 오류, API 유효성.
- **CLI/Library**: stdin/stdout/stderr, exit code, 에러 입력, 설치/패키징 검증.
- **Backend**: 독립 fixture의 API/DB 연동, 중복 호출·장애·복구.
- **Swift/Flutter**: 타깃 플랫폼 빌드, 단위·UI 테스트(장비 유무 명시).
- **Linux/Yocto/BSP**: 레이어/레시피 파싱, 필수 타깃 빌드, 정적 분석, QEMU/보드 테스트. 실행 불가 검증은 **BLOCKED**.

## 13. 정책/설정 형식 (제안)

```yaml
# .make-it-ship.yaml — Make It Ship 자체 포맷 (아직 미구현)
version: 1
project:
  name: sample-project
runtime:
  preferred: claude-code
  mode: auto                # auto | quick | standard | full
orchestration:
  max_parallel_agents: 2
  max_retry_per_task: 2
  worktree: true
budget:
  max_total_tokens: null    # 사용량 API/메트릭 지원 시 적용
  max_runtime_minutes: 120
security:
  require_approval:
    - git_push
    - release_publish
    - production_deploy
    - destructive_migration
    - external_data_transfer
  deny:
    - force_push_default_branch
    - delete_production_database
engineering:
  tdd: when_testable
  root_cause_before_fix: true
  independent_spec_review: true
  simplicity:
    enabled: true
    prefer_reuse: true
    require_new_dependency_rationale: true
qa:
  profile: auto
  commands:
    typecheck: npm run typecheck
    unit: npm test
    build: npm run build
  manual_hardware_test: optional
```

설정 파일은 JSON Schema로 검증한다. 미지원 설정/명령은 조용히 무시하지 않고 명확한 진단을 제공한다. `budget.max_total_tokens: null`이면 토큰 예산을 자동 보장하지 않는다고 표시한다.

## 14. 외부 플러그인 연동 정책

### 14.1 기본 운영

- Make It Ship만 설치해도 주요 스킬·방법론·상태 관리가 동작해야 한다.
- 사용자 환경에 설치된 OMC/Superpowers/gstack/Ponytail을 탐지하더라도 **자동으로 전체 활성화하거나 권한을 변경하지 않는다**.
- 업스트림의 `SessionStart`, `SubagentStart`, `PreToolUse`, `PostToolUse` 훅은 플러그인별로 별도 실행될 수 있다. **Make It Ship이 다른 플러그인의 훅을 중지할 수 있다고 가정하지 않는다.**
- 통합 모드 사용 시 겹치는 플러그인을 사용자가 별도로 비활성화하도록 가이드하거나 안전한 호환성 모드를 제공한다.
- 네임스페이스는 충돌 예방 수단일 뿐, 훅 중복 자체를 해결하지 않는다.

### 14.2 Adapter Capability Check

`externalPluginAdapter.detect()`에서 이름·버전·명령·지원 플랫폼·권한 요구를 탐지한다. 공식 공개 인터페이스만 연결하고 모호할 경우 `UNSUPPORTED`로 표시 후 자체 기본 실행으로 전환한다.

### 14.3 통합 우선순위

1. 자체 스킬과 품질 정책 — **P0**.
2. Claude Code의 공개 스킬/서브에이전트/훅 지원 — **P0**.
3. OMC식 팀 실행 기능의 안전한 어댑터 — **P1**, 실제 안정적 인터페이스 확인 후.
4. gstack의 브라우저 QA 같은 고유 기능 — **P1**, 호스트/설치/권한에 따라 선택.
5. Superpowers/Ponytail은 초기에는 방법론과 품질 규칙을 독립 재구현 — **P0/P1**.

### 14.4 업스트림 관리

- `UPSTREAMS.md`에 프로젝트 URL, 특정 tag/commit, 분석일, 가져온 기능, 관련 라이선스 고지, 호환성 테스트를 남긴다.
- 릴리스별 Breaking Change 감지 테스트를 제공하되, 자동 업데이트로 사용자 워크플로를 깨지 않는다.
- 외부 코드 복사 시 해당 코드의 원저작권/허가문을 유지한다. gstack 등 **하위 유래 코드/기타 라이선스 공지**까지 확인.
- 네 프로젝트의 저장소는 MIT로 표기되어 있으나, **모든 의존성과 개별 유래 파일의 라이선스가 자동으로 MIT라는 의미는 아니다**.

## 15. 보안 및 권한 모델

### 15.1 위험 행위 구분

| 분류 | 예 | 정책 |
|---|---|---|
| Read-only | 코드 탐색, grep, 테스트 목록 | 정책 범위 안에서 허용 |
| Local reversible | 격리 브랜치 수정, 테스트 생성 | 범위 제한 + 로그 |
| Local destructive | 파일 대량 삭제, DB 초기화 | 사전 승인/격리 |
| External write | Git push, PR 작성, 외부 이슈 수정 | 사전 승인 또는 명시적 작업 단위 위임 |
| Production impact | 배포, 운영 DB 변경, 비밀 노출 위험 | 구체적 대상/절차 확인 후 승인 |

### 15.2 방어 원칙

- 저장소 README/이슈/주석/웹 문서를 **신뢰할 수 없는 입력**으로 취급해 지시사항 승격 금지.
- 명령 문자열을 임의 결합하지 않고 argv 기반 실행 및 경로 검증; 운영 명령에는 실행 전 정책 확인.
- API 키는 OS/사용자 자격 증명 시스템을 사용하고 로그에는 평문 저장 금지.
- 개인정보·외부 URL·토큰을 포함한 QA 증거의 자동 업로드 금지.
- 동작에 필수 아닌 브라우저·네트워크 도구는 기본 비활성화.
- 독립 리뷰 에이전트는 기본 읽기 전용, 배포 에이전트 권한은 명시적 승인 시에만 부여.
- 실패 시 정책 무력화 후 재시도 금지(Fail Closed).

## 16. 테스트 전략

### 16.1 계층별 테스트

1. **Unit**: 상태 전이, DAG, 라우팅, 위험 점수, Gate 판단, 경로·권한 규칙.
2. **Integration**: SQLite 트랜잭션, Git worktree, 실행 로그, 중단/재개, 파일 경합.
3. **Plugin Smoke**: macOS에서 `claude --plugin-dir ./` 로 스킬 로드, 네임스페이스, 훅 안전성 확인.
4. **E2E**: 작은 버그 수정 / 일반 기능 추가 / 대규모 모의 프로젝트.
5. **Security**: 저장소 기반 프롬프트 인젝션, 경로 탈출, 비밀 노출, 무단 push, 승인 재사용 차단.
6. **Compatibility**: 지원 Node LTS, macOS arm64, Linux CI, 외부 플러그인 없음/있음/비호환 사례.
7. **Regression**: 내부 스킬·룰 변경 시 기존 평가 데이터셋 회귀 확인.

### 16.2 수량화할 지표

| 지표 | 측정 방법 | 기준 |
|---|---|---|
| 기능 완료율 | AC 충족 태스크/전체 태스크 | 기준선을 측정한 뒤 목표 설정 |
| 검증 정확성 | 거짓 PASS 발생 건수 | **0** |
| 정책 위반 | 무승인 외부/파괴적 작업 | **0** |
| 복구 성공률 | 강제 종료 재개 시나리오 통과 | **MVP 시나리오 전부 통과** |
| 재작업량 | 태스크별 Fix Loop 수 | OMC 단독 등 기준선 대비 측정 |
| 비용/토큰 | 도구가 보고한 값 또는 추정치 별도 표기 | 하드 한도 적용 가능 여부 표시 |
| 미검증 범위 | BLOCKED/NOT_APPLICABLE 항목 | **보고에서 누락 0** |

벤치마크 대상은 **OMC 단독 / Superpowers 단독 / Make It Ship** 등을 동일 프로젝트·동일 제약에서 비교한다. 완성도·비용 향상을 검증 전 수치로 단정하지 않는다.

## 17. 개발 마일스톤 및 종료 기준

### MS0 — 요구사항·호스트 기능 검증

- 실제 Claude Code 플러그인 매니페스트·스킬·훅·에이전트 로딩 동작 확인.
- 업스트림 네 프로젝트의 기능·라이선스·호환 범위 문서화.
- 아키텍처, 보안 위협 모델, CLI/Skill API 결정.

**완료 기준**: 승인된 ADR, 재현 가능한 plugin smoke, 우선순위 정리.

### MS1 — 최소 플러그인 + 워크플로 (P0)

- 매니페스트, init/plan/build/status/verify 기본 스킬.
- 상태 DB, 모드 라우팅, 태스크 DAG, 단일 실행 경로, 증거 Gate.
- Quick 버그 수정 시나리오 E2E.

**완료 기준**: 새 macOS 환경에서 설치→수정→테스트→결과 보고 가능. 무검증 PASS 불가.

### MS2 — 방법론·품질 (P0/P1)

- TDD, 원인 분석, 요구사항·품질 독립 리뷰, Simplicity Gate.
- 도메인별 테스트 커맨드 지원, 실패 분류 및 제한된 Fix Loop.

**완료 기준**: 의도적 버그/과설계가 Gate에 검출되고 재현 가능.

### MS3 — Team + Worktree + Resume (P1)

- 병렬 작업, 파일 충돌 회피, worktree, 안전한 통합, 상태 복구.
- 여러 세션·강제 종료·코드 리비전 변경 대응.

**완료 기준**: 병렬 안전성 및 복구 통합 테스트 통과, 중복 실행 없음.

### MS4 — QA + Ship + 비용 관리 (P1)

- CLI/API/Web 실동작 QA, 리뷰/배포 체크리스트, 승인 Gate.
- 예산·타임아웃·에이전트 수 관리, 결과 보고서/릴리스 노트.

**완료 기준**: 배포하지 않은 결과를 SHIPPED로 기록하지 않으며 무승인 외부 변경 차단.

### MS5 — 외부 어댑터와 Codex·회고 (P2)

- 업스트림 선택형 어댑터 및 호환성 테스트.
- 런타임 독립 코어와 Codex 연결 PoC.
- 회고·Knowledge Base·프로세스 개선 제안/실험/롤백.

**완료 기준**: 기본 플러그인 단독 실행을 유지하면서 선택 어댑터 추가/제거 가능.

### 17.1 마일스톤 운영 규칙

- 각 MS는 독립 PR, 테스트 로그, 변경 사항, 알려진 위험을 남긴다.
- P0를 완료하기 전에 P2 UI/자율 학습 기능을 구현하지 않는다.
- 새 기능은 AC와 실패 테스트(가능한 경우)를 먼저 정의한다.
- 모든 PR에서 의존성 추가 근거와 최소 변경 원칙 준수 여부를 검토한다.

## 18. 실행 산출물

Make It Ship의 한 실행(run)이 완료되면 최소 다음 파일 또는 이에 상응하는 자료를 생성한다.

```text
docs/make-it-ship/
├── spec.md                   # 요구사항·수락기준
├── plan.md                   # 단계·태스크 DAG·의존성
├── architecture.md           # 주요 설계/ADR 참조
├── verification-report.md    # 어떤 테스트가 어떤 커밋에서 실행됐는가
├── risk-register.md          # 미해결 이슈·미검증 항목
└── release-checklist.md      # 사용자의 승인 여부와 배포 준비 상태
```

보고서에는 반드시 **완료한 내용 / 확인한 증거 / 실행하지 못한 검증 / 남은 위험 / 사용자 승인 필요 항목**을 구분한다.

## 19. 사용자와 AI 개발자의 책임 분리

| 영역 | 사용자가 해야 할 일 | AI 개발자가 해야 할 일 |
|---|---|---|
| 개발 환경 | Mac Studio 접근, Claude Code 로그인/계정, Git 원격 저장소 선택 | 필요한 Node·패키지·도구 확인 및 설치 스크립트 작성 |
| 기술 결정 | 중요한 아키텍처/범위/비용 결정 승인 | 대안 비교, 기술 검증, ADR 문서화 |
| 구현 | 요구사항과 우선순위 제공 | 코드, 테스트, 문서, 예시 프로젝트 개발 |
| Git | 원격 저장소 권한 제공, 외부 push 승인 | 브랜치 관리·커밋·PR 준비·충돌 해결 |
| QA | 실제 하드웨어/유료 외부 계정 등 필요 자원 제공 | 자동 검증, 미검증 항목과 재현 증거 보고 |
| 배포 | 대상 환경·릴리스 승인 | 릴리스 체크리스트·롤백안·배포 자동화 준비 |
| 회고 | 개선 정책 채택 여부 결정 | 데이터 기반 개선안 제시, 회귀 평가 |

**설치 후 사용 형태**: AI 개발자가 Git 저장소에 구현물을 커밋·PR로 제출하고, 사용자는 검토/승인 뒤 Mac Studio에서 checkout하여 플러그인을 설치/실행한다. AI가 접근할 수 없는 OS 계정 승인, 로그인, 외부 서비스 권한은 사용자가 수행한다.

## 20. Claude Code에게 전달할 구현 지시문

아래 지시문을 저장소 초기화 후 Claude Code에 그대로 붙여 넣을 수 있다.

> `Make_It_Ship_Development_Spec_v1.0.md`를 이 프로젝트의 최상위 개발 요구사항으로 사용하라. 우선 공식 Claude Code Plugin 문서에 따라 현재 지원되는 플러그인 구조와 호스트 API를 검증하고 MS0를 수행하라. 검증되지 않은 CLI/SDK 또는 외부 플러그인 비공개 API를 임의로 만들어 사용하지 말라. 이후 MS1부터 순차적으로 구현하되, 각 마일스톤마다 구현 계획, 변경 코드, 자동 테스트, 실행 로그와 완료 판정을 남겨라. TDD 가능한 로직은 테스트 우선으로 개발하고, 근본 원인 분석 없이 반복 패치하지 말라. 기존 네 프로젝트의 장점은 하나의 오케스트레이터에 통합하되 중복 스킬·훅 호출을 발생시키지 말라. 코드 정확성과 보안이 단순성보다 우선이다. 실제로 실행하지 않은 검증은 PASS로 표시하지 말라. 위험한 외부 작업은 사용자 승인을 요청하라. 완료 시 남은 위험과 다음 마일스톤을 보고하라.

### 20.1 개발자에게 추가로 부여할 우선순위

1. **먼저 프로토타입 실행**: 스킬 로딩과 상태 전이 한 건을 실제로 보여준다.
2. **다음으로 Gate**: 테스트 증거 없는 PASS를 차단하는 코드를 구현한다.
3. **그다음 복구**: 중단 후 동일 실행을 안전하게 재개한다.
4. **마지막으로 병렬화**: 안전성이 입증된 뒤 에이전트 수를 늘린다.

## 21. 의사결정 로그 (초기 ADR)

| ADR | 결정 | 근거 | 재검토 조건 |
|---|---|---|---|
| ADR-001 | Make It Ship은 독립형 플러그인 | 외부 4개 도구의 훅·버전 충돌 회피 | 필수 외부 기능 확인 시 |
| ADR-002 | Core Engine과 Claude 어댑터 분리 | Codex 등 호스트 확장 | 호스트 API 변경 시 |
| ADR-003 | TypeScript + Node.js + SQLite | macOS 개발·테스트·상태관리 편의 | 성능/배포 제약 확인 시 |
| ADR-004 | Quick 우선, 병렬은 P1 | MVP의 상태/품질 안정성 확보 | MS1 안정화 시 |
| ADR-005 | 외부 push/배포는 승인 Gate | 위험 행위 통제 | 정책 옵션 추가 검토 시 |
| ADR-006 | 테스트 유효성은 커밋 기준 | 수정 이후 오래된 PASS 방지 | 검증 캐시 설계 시 |
| ADR-007 | 단순성은 정확성보다 후순위 | 안전한 구현 보장 | 도메인별 정책 보완 시 |

## 22. 주요 위험과 대응

| 위험 | 심각도 | 대응 |
|---|---|---|
| Claude Code/외부 플러그인 API 변경 | 높음 | 버전 핀, 어댑터 경계, smoke test |
| 외부 훅/스킬의 중복 실행 | 높음 | 단독 모드 기본, 호환성 탐지, 사용자 비활성화 안내 |
| 자동 완료에 대한 과신 | 높음 | 실행 로그·리비전 필수, 미검증 FAIL/BLOCKED |
| 에이전트 병렬 편집 충돌 | 높음 | worktree, 소유권, 순차 통합 |
| 권한 확대/프롬프트 인젝션 | 높음 | 정책 엔진, 신뢰 경계, 사전 승인 |
| 대규모 API 사용 비용 | 중간 | 작업 유형별 모델/예산, 제한 재시도, 실행 비용 표시 |
| 자율적 프로세스 업데이트로 품질 저하 | 중간 | 변경 제안→평가→승인→롤백 |
| macOS와 Linux의 환경 차이 | 중간 | 플랫폼 매트릭스 및 크로스 CI |

## 23. 개발 완료의 정의 (Definition of Done)

다음 조건을 모두 만족해야 해당 마일스톤을 **완료**로 선언할 수 있다.

- [ ] 사전에 정의한 AC를 충족하고, 추적 가능한 변경 목록이 있다.
- [ ] 해당 플랫폼의 빌드/테스트/검증 명령이 실제 실행되었다.
- [ ] 실패 로그와 예외 사유를 숨기지 않았다.
- [ ] 검증 결과와 코드 리비전이 일치한다.
- [ ] 관련 Spec/Code/Simplicity 리뷰 결과가 기록되었다.
- [ ] 필요한 보안·외부 작업 승인을 받았다.
- [ ] 설치/실행법과 복구/제거 방법이 문서화되었다.
- [ ] 미검증 항목과 알려진 위험이 사용자에게 보고되었다.
- [ ] macOS arm64 대상 자동 테스트 또는 수동 smoke 결과가 있다.

## 24. 공식 참고 자료 (2026-10-19 확인)

- Claude Code Plugins 개요: https://code.claude.com/docs/en/plugins
- Claude Code 플러그인 생성: https://code.claude.com/docs/en/plugins/create
- Claude Code 플러그인 구성 요소: https://code.claude.com/docs/en/plugins/components
- Claude Code 매니페스트 레퍼런스: https://code.claude.com/docs/en/plugins-reference
- Claude Code Hooks 레퍼런스: https://code.claude.com/docs/en/hooks
- OMC 공식 저장소: https://github.com/Yeachan-Heo/oh-my-claudecode
- Superpowers 공식 저장소: https://github.com/obra/superpowers
- gstack 공식 저장소: https://github.com/garrytan/gstack
- Ponytail 공식 저장소: https://github.com/DietrichGebert/ponytail

**기술 문서의 재검증 원칙**: 저장소 `main` 브랜치의 내용은 변경될 수 있으므로 구현 시작 시 실제 사용 버전의 태그/커밋을 `UPSTREAMS.md`에 핀한다. 별도 라이선스/NOTICE 및 의존성 목록도 확인한다.

---

**Make It Ship** — *Build it. Prove it. Ship it.*
