[English](README.md) | 한국어

# Make It Ship

**아이디어, 요구사항 문서, 이슈를 받아 계획 → 구현 → 실제 검증 → 리뷰까지 진행하고, 증거로 판정을 내리는 Claude Code 플러그인입니다.**

결과는 항상 네 단어 중 하나입니다: `VERIFIED`, `PARTIAL`, `BLOCKED`, `FAILED`. "다 됐습니다"라는 말은 `VERIFIED`일 때만 나옵니다.

## 왜 쓰나요: 두 가지 약속

1. **증거 없이는 끝났다고 하지 않습니다.** 테스트와 빌드는 `mis check`만 실행합니다. 이때 종료 코드와 로그를 그 시점의 코드 상태와 함께 기록합니다. 판정은 `mis verdict`가 고정된 규칙으로 내립니다. 모델이 판정하지 않습니다. 기록한 뒤에 코드나 설정이 바뀌면 그 증거는 `STALE`이 되어 다시 돌려야 합니다.
2. **위험한 작업은 먼저 묻습니다.** 훅(guard)이 Claude의 도구 호출을 실행 전에 검사합니다. 계획 승인, `git push`, PR 생성, 패키지 설치, 설정 변경은 run 중에 묻습니다. `git reset --hard` 같은 파괴적 명령과 다른 모델 서비스 호출은 run이 없어도 **언제나** 묻습니다. `main`/`master`로 force push하는 것과 run 상태 파일을 직접 고치는 것은 항상 막습니다.

## 요구사항

- 플러그인을 지원하는 Claude Code (macOS 또는 Linux)
- Node.js 22 이상
- git 저장소

런타임 의존성이 없고 빌드 단계도 없습니다.

## 설치

이 저장소가 곧 플러그인 마켓플레이스입니다(`.claude-plugin/marketplace.json`). 비공개 저장소이므로 `github.com/tom910903/make-it-ship`에 git으로 접근할 수 있어야 합니다. SSH 키를 쓰거나, HTTPS라면 `gh auth setup-git`을 먼저 실행하세요.

### 방법 A: 마켓플레이스로 설치 (권장)

```sh
claude plugin marketplace add tom910903/make-it-ship
claude plugin install make-it-ship@make-it-ship
claude plugin list    # make-it-ship@make-it-ship 가 enabled 로 보이면 성공
```

설치한 뒤에는 플래그 없이 `claude`를 실행하면 됩니다.

- 특정 저장소에만 설치하려면 그 저장소 안에서 두 명령에 `--scope project`를 붙여 실행합니다.
- **업데이트**는 세 단계입니다. 순서를 지켜야 합니다.
  ```sh
  claude plugin marketplace update make-it-ship
  claude plugin update make-it-ship@make-it-ship
  # 그다음 Claude Code 재시작
  ```
  `plugin update`만 실행하면 새 릴리스를 보지 못합니다. 그리고 새 릴리스는 `.claude-plugin/plugin.json`의 `version`이 바뀌어야만 배포됩니다. 버전을 올리지 않은 커밋은 설치되지 않습니다.
- **제거**:
  ```sh
  claude plugin uninstall make-it-ship@make-it-ship
  claude plugin marketplace remove make-it-ship
  rm -rf ~/.claude/plugins/cache/make-it-ship    # uninstall 후에도 캐시가 남습니다
  ```

방법 A는 2026-10-21에 Claude가 GitHub에서 직접 확인했습니다(`docs/milestones/NH-auto-check.md`). 사람이 확인한 것은 아직 아닙니다.

### 방법 B: 클론을 한 세션에만 불러오기

```sh
git clone git@github.com:tom910903/make-it-ship.git ~/make-it-ship
cd /path/to/your/repo
claude --plugin-dir ~/make-it-ship
```

클론은 `git -C ~/make-it-ship pull`로 업데이트합니다.

## 빠른 시작 (5분)

1. 작업할 저장소에서 `claude`를 실행합니다.
2. 환경부터 점검합니다.
   ```
   /make-it-ship:setup doctor
   ```
   플러그인, 훅, MCP 서버, 상태 표시줄을 확인해 줍니다.
3. 할 일을 한 문장으로 맡깁니다.
   ```
   /make-it-ship:run 로그인 실패 시 에러 메시지가 안 나오는 버그 고쳐줘
   ```
4. 처음 실행하면 테스트·빌드 명령을 찾아 `.make-it-ship.json` 초안을 보여 줍니다. 맞으면 승인하세요. 이 파일이 "무엇을 돌려야 검증된 것인가"를 정합니다.
5. 진행 중에는 언제든 확인할 수 있습니다.
   ```
   /make-it-ship:status
   ```
6. 끝나면 판정과 보고서 경로(`docs/make-it-ship/<run>/report.md`)를 받습니다.

명령이 기억나지 않으면 `/make-it-ship:help`를 입력하세요. 명령, 스킬, 에이전트, 키워드 목록을 코드에서 바로 읽어 보여 줍니다.

## 사용법 (How to use)

아래는 실제로 자주 쓰는 상황입니다. 각 상황마다 **입력할 내용**과 **그다음 일어나는 일**을 적었습니다. `mis …` 명령은 Claude가 대신 실행하므로 직접 칠 필요는 없습니다.

### 1. 버그 고치기

```
/make-it-ship:run 장바구니에서 수량을 0으로 바꾸면 합계가 NaN이 됩니다. 고쳐주세요.
```

- 먼저 저장소를 읽고 관련 코드를 찾습니다.
- 작고 위험이 낮은 수정이면 **Quick** 모드를 고르고 이유를 한 줄로 말합니다. Quick이고 위험 플래그가 없으면 계획 승인 단계를 건너뜁니다.
- 고치기 전에 버그를 재현하는 실패 테스트를 먼저 씁니다. 원인을 찾으면 기록한 뒤에 고칩니다.
- `mis check`로 테스트를 돌리고, 품질 리뷰어가 변경을 읽습니다.
- 마지막에 `VERIFIED` 같은 판정과 근거를 받습니다.

인증·결제·개인정보·마이그레이션·보안과 관련된 코드라면 작은 수정이라도 Standard 이상으로 올라가고, 보안 리뷰가 추가됩니다.

### 2. 기능 추가하기 (Standard, 승인 있음)

```
/make-it-ship:run docs/feature-request.md 구현해줘
```

- 요구사항 문서와 코드를 먼저 읽고, 코드로 답할 수 없는 **중요한 질문만 하나씩** 묻습니다.
- 계획을 세우고 모드(보통 **Standard**)와 이유를 알려 줍니다.
- 비평 에이전트(critic)가 계획을 검토합니다.
- **승인 요청이 옵니다.** 목표, 작업 목록, 작업별 완료 기준, 필수 체크를 보여 준 뒤 확인 창이 뜹니다. 승인해야 구현을 시작합니다. 거절하면 그 자리에서 멈춥니다.
- 작업마다 테스트를 먼저 쓰고 구현합니다. 작업이 3개 이상이면 작업마다 새 서브에이전트가 맡고, 스펙 리뷰와 품질 리뷰를 차례로 거칩니다.
- 검증, 리뷰, 보고서 순서로 끝납니다. 배포를 원하면 "PR까지 준비해줘"라고 덧붙이세요. 그래도 push와 PR 생성은 다시 묻습니다.

지금은 계획만 받고 구현은 나중에 하고 싶다면 `/make-it-ship:plan`을 쓰세요. 계획이 `docs/make-it-ship/plans/<slug>.md`에 저장되고, 나중에 그 파일로 바로 run을 시작할 수 있습니다.

### 3. 아이디어만 있을 때 (인터뷰)

```
/make-it-ship:interview 팀 회의록을 자동으로 요약해서 슬랙에 올려주는 도구를 만들고 싶어
```

- 코드는 한 줄도 바꾸지 않습니다.
- 질문을 한 번에 하나씩 합니다. 질문마다 한 줄 요약, 추천 답, 2~4개 선택지가 붙습니다.
- 상황에 따라 office hours(스타트업/빌더), 스펙 작성, 브레인스토밍 방식 중 하나로 진행합니다.
- 결과로 목표, 제약, 하지 않을 것, 테스트할 수 있는 완료 기준, 가정, 남은 질문이 정리된 문서(`docs/make-it-ship/specs/`)를 받습니다.
- 마지막에 `/make-it-ship:run`으로 바로 만들지 물어봅니다.

목표 없이 "그냥 만들어줘"라고만 하면, 바로 만들지 않고 이 인터뷰부터 시작합니다.

### 4. 리뷰만 받기

```
/make-it-ship:review
```

- 현재 작업 트리의 변경을 읽기 전용 리뷰어가 검토합니다. 요구사항이 있으면 스펙 리뷰도, 없으면 품질 리뷰만 합니다.
- 발견 사항마다 심각도와 근거가 붙습니다. 고쳐 달라고 하기 전에는 아무것도 고치지 않습니다.
- 저장소 전체를 보고 싶으면 "저장소 전체 감사해줘" 또는 `cso`라고 입력하세요. 보고서만 내고 파일은 바꾸지 않습니다.
- 보안 관점을 원하면 "보안 리뷰 해줘"라고 하면 보안 리뷰어가 추가됩니다.

### 5. 중단된 작업 이어 하기 / 상태 확인

세션이 끊겼거나, 사용 한도에 걸렸거나, 다음 날 이어서 할 때:

```
/make-it-ship:resume
```

- 어디서 멈췄는지, 그 뒤로 바뀐 파일, 다시 돌려야 하는(STALE) 체크, 진행 중이던 작업, 내 결정이 필요한 것을 요약합니다.
- 작업을 다시 설명할 필요가 없습니다. 계획과 기록이 run 상태에 남아 있습니다.
- 실행 시간이나 재시도 한도에 걸려 BLOCKED가 됐다면, 계속할지 확인 창이 뜹니다. 한도는 사용자만 풀 수 있습니다.

지금 상태만 보고 싶으면 `/make-it-ship:status`를 입력합니다. 단계, 작업, 필수 체크(PASS/FAIL/STALE/BLOCKED/MISSING), 리뷰, 열린 질문, 현재 판정을 보여 줍니다. run을 그만두려면 "run 취소해줘"라고 말하세요.

### 6. 브라우저로 웹 화면 QA (로컬 전용 모드)

```
/make-it-ship:qa http://localhost:3000 회원가입 화면을 로컬 전용 모드로 확인해줘. 프로필 사진 업로드도 테스트해줘
```

- Playwright가 없어도 됩니다. 이미 설치된 Chrome, Chromium, Edge를 헤드리스로 띄워 페이지를 열고, 클릭하고, 스크린샷과 콘솔 오류를 확인합니다. 브라우저가 없으면 `BLOCKED`로 보고합니다.
- **파일 업로드**는 페이지 스크립트가 첨부 파일을 어디로든 보낼 수 있어서 따로 다룹니다.
  - 확인 없이 업로드하는 것은 **로컬 전용 브라우저**에서만 됩니다. 프롬프트에 "로컬 전용 모드"라고 적으면 Claude가 `mis browse start --local-only`로 브라우저를 띄웁니다. 이 모드에서는 이 컴퓨터(localhost, `127.0.0.1` 등) 말고는 아무 데도 연결되지 않습니다.
  - 일반 브라우저에서 업로드하면 **항상 묻습니다**. 파일이 컴퓨터 밖으로 나갈 수 있기 때문입니다.
  - 지금 어떤 모드인지는 `mis browse status`의 `localOnly`로 알 수 있습니다. 모드를 바꾸면 브라우저가 재시작됩니다.
- 실제 사이트에서 쿠키, 헤더, 다운로드처럼 자격 증명에 닿는 명령은 run이 있든 없든 항상 묻습니다.

## 판정 읽는 법

판정은 `mis verdict`가 아래 규칙으로 정합니다. 위에서부터 먼저 걸리는 것이 판정입니다.

| 판정 | 뜻 | 흔한 이유 | 할 일 |
|---|---|---|---|
| `BLOCKED` | 검증할 수 없었음 | run이 막힘(한도, 도구 없음, 자격 증명 없음), 필수 체크가 실행 자체를 못 함(명령 없음, 시간 초과). 실패한 체크가 함께 있으면 FAILED | 이유를 해결하고 `/make-it-ship:resume` |
| `FAILED` | 검증했고 실패함 | 필수 체크 실패, 리뷰에 blocking 이슈 | 보고서의 실패 로그 확인. 계획 범위 안이면 Claude가 먼저 고친 뒤 보고합니다 |
| `PARTIAL` | 실패는 없지만 증거가 모자람 | 아래 FAQ 참고 | 보고서의 이유 목록대로 채우기 |
| `VERIFIED` | 필수 체크 통과, 필요한 리뷰 완료, 모든 작업 완료 | — | 보고서의 실행 방법대로 확인 |

필수 체크는 모드마다 다릅니다. Quick은 `required.quick`, Standard와 Full은 `required.standard`에 `qa-*` 체크가 더해집니다. 필요한 리뷰는 Quick이 품질, Standard·Full이 스펙+품질이고, 위험 플래그가 있으면 보안이 추가됩니다.

## 상시 동작 (run 밖에서도)

플러그인만 설치하면 모든 대화에서 동작합니다.

- **세션 시작:** 스킬 목록, 작업 규칙(모호하면 먼저 묻기, 테스트 먼저, 고치기 전에 원인 찾기, 검증 후 완료 주장), 현재 코딩 스타일, 진행 중인 run 알림, 코드베이스의 짧은 지도를 넣어 줍니다.
- **코딩 스타일:** 기본은 `full`(가장 작은 완전한 변경, 재사용 우선, 추측성 코드 금지)입니다. `/make-it-ship:style off|lite|full|ultra`로 이 세션만 바꾸고, `mis style default <level>`로 새 세션의 기본값을 바꿉니다. 프롬프트에 "normal mode"만 쓰면 이 세션에서 꺼집니다.
- **키워드:** 프롬프트에 넣으면 해당 흐름으로 연결됩니다.

  | 입력 | 동작 |
  |---|---|
  | `ralph: <할 일>` / `랄프: <할 일>` | VERIFIED가 될 때까지 멈추지 않는 루프(`/make-it-ship:loop`) |
  | `autopilot`, "build me an app…" | 전체 run |
  | `ulw`, `울트라워크` | 독립 작업을 서브에이전트에 병렬로 분배 |
  | `ralplan` | critic이 승인할 때까지 계획 다듬기 |
  | `deep interview`, `딥 인터뷰` | 인터뷰 |
  | `코드 리뷰`, `보안 리뷰` | 리뷰 / 보안 리뷰 |
  | `tdd`, `테스트 퍼스트` | 실패 테스트부터 쓰기 |
  | `cso`, "audit the whole repo" | 저장소 전체 감사(보고만) |
  | `ccg` | 다른 모델의 의견(먼저 물음) |
  | `cancelomc` | 활성 모드 취소 |

  ralph는 **접두어로 쓸 때만** 루프를 시작합니다("ralph: …", "랄프: …"). "랄프 꺼줘"처럼 끄는 말만 있으면 취소합니다. 코드, 인용, URL 안에 있는 단어나 키워드에 대한 질문은 무시합니다. 특정 키워드를 끄려면 `~/.make-it-ship/config.json`의 `keywords.disabled`에 넣으세요. 어떤 프롬프트가 무엇을 트리거하는지는 `mis test-prompt "<문장>"`으로 확인합니다.
- **편집 범위 고정(freeze):** `mis freeze <dir>`는 현재 저장소에서 그 디렉터리 밖의 편집을 막습니다. `mis unfreeze`로 풉니다.
- **도구 호출 뒤:** 편집이 많으면 테스트를 돌리라고 알려 주고, 같은 호출이 세 번 실패하면 원인을 찾으라고 알려 줍니다.
- **세션을 끝내기 전:** run 실행 중에 코드를 고쳤다면, 끝내기 전에 `mis check`를 돌리라고 요청합니다(최대 2번).
- **읽기 전용 Bash 자동 허용:** `ls`, `cat`, `grep`, `git status`처럼 단순한 읽기 명령은 저장소 안의 경로만 다루고 비밀 파일(`.env*`, `*.pem`, `.ssh` 등)을 건드리지 않을 때만 확인 없이 실행됩니다. 파이프, 리다이렉트, `&&`가 있으면 평소처럼 묻습니다.
- **상태 표시줄:** `MIS ▸ idle · style full · …` 형태로 스타일, 편집 범위 고정, 실행 중인 서브에이전트, todo, 브랜치를 보여 줍니다. `mis setup`이 설정 diff를 보여 줍니다.

## 명령표

### 슬래시 스킬

| 스킬 | 용도 |
|---|---|
| `/make-it-ship:run` | 메인 진입점. 계획 → 승인 → 구현 → 검증 → 리뷰 → 보고 |
| `/make-it-ship:status` | 현재 run 상태와 판정 |
| `/make-it-ship:resume` | 중단된 run 이어 하기, run 밖의 저장된 작업 맥락 복원 |
| `/make-it-ship:plan` | 계획만 작성(코드 변경 없음) |
| `/make-it-ship:interview` | 요구사항 인터뷰, office hours, 스펙, 브레인스토밍 |
| `/make-it-ship:plan-review` | 계획·설계 문서 비평 |
| `/make-it-ship:review` | 코드 리뷰, 저장소 감사(보고만) |
| `/make-it-ship:debug` | 원인 분석 디버깅 |
| `/make-it-ship:qa` | 실제 사용 QA(CLI, API, 웹, iOS 시뮬레이터) |
| `/make-it-ship:browse` | 내장 헤드리스 브라우저 |
| `/make-it-ship:ship` | 릴리스 준비(문서, changelog, 버전, PR 초안) |
| `/make-it-ship:retro` | 회고와 프로젝트 학습 기록 |
| `/make-it-ship:loop` | 지속 루프(ralph) |
| `/make-it-ship:style` | 코딩 스타일 단계 |
| `/make-it-ship:cancel` | 루프, 팀, merge-readiness 취소 |
| `/make-it-ship:team` | N개 워커 팀 파이프라인(명시적으로 요청할 때만) |
| `/make-it-ship:session` | 이슈·PR·기능별 worktree 세션 |
| `/make-it-ship:setup` | 설치, 점검, 업데이트, 제거 |
| `/make-it-ship:help` | 명령·스킬·에이전트·키워드 목록 |
| `/make-it-ship:reference` | 위임 전에 읽는 에이전트·도구 레퍼런스 |
| `/make-it-ship:skill`, `/make-it-ship:skillify`, `/make-it-ship:writing-skills` | 학습한 스킬 관리, 추출, 테스트 우선 작성 |

그 밖에 `/make-it-ship:ask`(다른 모델의 의견), `/make-it-ship:research`, `/make-it-ship:deploy`, `/make-it-ship:ops`, `/make-it-ship:ios`, `/make-it-ship:telemetry`, `/make-it-ship:gbrain`, `/make-it-ship:design-images`, `/make-it-ship:pair-agent`, `/make-it-ship:writer-memory`가 있습니다. 이 중 데이터를 컴퓨터 밖으로 보내는 명령은 run이 없어도 항상 먼저 묻고, **회사 정책상 금지될 수 있습니다.** 텔레메트리는 기본으로 꺼져 있습니다.

### 주요 `mis` CLI

스킬이 대신 실행하지만 직접 쓸 수도 있습니다. 방법 B로 클론했다면 `node ~/make-it-ship/scripts/mis.mjs <명령>`으로 실행합니다.

| 명령 | 용도 |
|---|---|
| `mis doctor` | 환경 점검(`--fix`로 오래된 상태 복구) |
| `mis init` | `.make-it-ship.json` 제안(`--write`로 저장) |
| `mis status` | run 상태 |
| `mis check <name>` | 체크 실행 + 증거 기록 |
| `mis verdict` / `mis report` | 판정 / 보고서 작성 |
| `mis resume` | run 재개 |
| `mis cancel` | run 취소(`--all`은 루프·팀·merge-readiness만 끝내고, `--all --run`이어야 run도 취소) |
| `mis loop start\|status\|cancel` | 지속 루프 |
| `mis style <level>` | 코딩 스타일 |
| `mis freeze <dir>` / `mis unfreeze` | 편집 범위 제한 |
| `mis browse <command>` | 내장 브라우저(`mis browse start --local-only`) |
| `mis config get\|set` | 사용자 설정(`~/.make-it-ship/config.json`) |
| `mis setup` | 상태 표시줄·CLAUDE.md 설정 diff(`--write`로 적용) |
| `mis layout [--json]` / `mis layout write` | 프로젝트 구조 규칙 확인 / `.ai/` 문서와 CLAUDE.md·AGENTS.md 안내 작성 |
| `mis help [topic]` | 전체 목록(코드에서 생성) |
| `mis info` / `mis version` | 버전과 개수 |
| `mis uninstall` | 플러그인이 만든 파일 정리(`--yes`로 실행) |

전체 목록은 `mis help commands`로 봅니다.

## 프로젝트 구조와 문서 (.ai/는 AI용, docs/는 사람용)

선택 기능입니다. `.make-it-ship.json`에 `layout`이 있으면 코드와 문서가 정해진 폴더로 갑니다. AI용 문서는 `.ai/`(영어, 경로·명령·규칙·불변 조건 같은 짧은 사실), 사람용 문서는 `docs/`에 언어마다 한 파일씩(`docs/guide/x.md` + `docs/guide/x.ko.md`, `README.md` / `README.ko.md`와 같은 방식) 둡니다.

```json
"layout": {
  "paths": ["src/**", "tests/**", "docs/**", ".ai/**", "*.md", "package.json", ".make-it-ship.json"],
  "purposes": { "src/**": "application code" },
  "docs": { "human": "docs", "ai": ".ai", "languages": ["en", "ko"] }
}
```

```
.ai/              AI용 문서(영어)
  index.md        언제 어느 파일을 읽을지(지도)
  product.md      목적, 사용자, 범위
  structure.md    폴더 규칙("layout"에서 생성되는 부분 포함)
  tech.md         스택과 명령(package.json 등을 가리킴)
  conventions.md  스타일, 금지 사항
  decisions.md    결정 한 줄씩
  modules/        디렉터리별 문서(deepinit)
AGENTS.md         핵심 규칙 + 지도(CLAUDE.md가 @AGENTS.md로 가져옴)
docs/             사람용 문서(언어별)
  guide/x.md
  guide/x.ko.md
src/  tests/
```

- `mis init`이 저장소의 최상위 폴더를 보고 `layout`을 제안합니다. `mis init --write`로만 기록됩니다.
- `/make-it-ship:run` 안에서 `mis plan set`은 `paths` 밖의 파일이나 번역이 빠진 사람용 문서가 있는 계획을 거부하고, 위반마다 고치는 방법을 보여 줍니다. 구조를 바꾸는 것은 설정 변경입니다(run 중에는 `mis approve config`). run 밖에서는 강제하지 않습니다.
- `mis layout`은 규칙과 규칙 밖 파일을 보여 줍니다(`--json`). `mis layout write`는 없는 `.ai/` 뼈대만 만들고(있으면 덮어쓰지 않음), `.ai/structure.md`의 표시된 부분을 다시 만들며, AGENTS.md에 표시된 절(규칙 + 지도)과 CLAUDE.md에 `@AGENTS.md`를 씁니다(먼저 묻습니다). `.ai/` 파일은 필요할 때 읽고, import하지 않습니다.
- `layout`이 없으면 이 기능은 꺼져 있습니다.

## 설정: `.make-it-ship.json`

저장소 루트에 두며, `mis init`이 처음 만들어 줍니다.

```json
{
  "version": 1,
  "checks": { "unit": { "argv": ["npm", "test"], "timeoutSec": 600 } },
  "required": { "quick": ["unit"], "standard": ["unit"] },
  "limits": { "maxAttemptsPerTask": 2, "maxRuntimeMinutes": 120 }
}
```

- `checks`: 체크 이름과 실행할 명령. 셸 없이 실행합니다. 명령이 없거나, 설치되지 않았거나, 시간이 초과되면 통과가 아니라 `BLOCKED`(검증 못 함)입니다.
- `required`: 모드별 필수 체크. `quick`과 `standard`만 씁니다(Full은 `standard`를 따름). 이름이 `qa-`로 시작하는 체크는 Standard·Full에서 자동으로 필수가 됩니다.
- `limits`: 작업당 시도 횟수와 run 전체 실행 시간(분). 넘으면 BLOCKED가 되고, 계속하려면 사용자 승인이 필요합니다.
- run 도중 이 파일이 바뀌면 판정이 PARTIAL이 되고 승인을 다시 받아야 합니다.

사용자 단위 설정은 `~/.make-it-ship/config.json`이며 `mis config get`으로 키와 설명을 봅니다(`style.default`, `keywords.disabled`, `update.check`, `proactive` 등).

## 안전장치: guard가 묻는 것과 막는 것

| 구분 | 대상 |
|---|---|
| **run 중에 묻기** | 계획 승인, `git push`, PR 생성, 패키지 설치, 설정 변경, 외부 MCP 쓰기 |
| **언제나 묻기** | `git reset --hard`, `git clean -f`, `git checkout .`, force push, 저장소 밖 재귀 삭제, DB `DROP`/`TRUNCATE`, `kubectl delete`, `docker system prune`, 다른 모델 서비스 호출, 데이터를 밖으로 보내는 `mis` 명령, 브라우저 자격 증명 명령, 일반 브라우저의 업로드, `~/.claude/settings*.json` 등 저장소 밖 설정 쓰기 |
| **항상 막기** | `main`/`master`로 force push, run 상태(`.git/make-it-ship/`) 직접 편집 |

push 전에는 아직 push하지 않은 커밋에서 비밀 정보를 찾아 그 결과를 질문에 함께 보여 줍니다. guard는 실수를 막기 위한 것이며, 모델이 일부러 명령을 숨기는 경우까지 막지는 못합니다.

## 문제 해결 (FAQ)

**`claude -p`(headless)로 돌렸더니 승인 단계에서 멈춰요.**
정상입니다. headless에서는 확인 창을 띄울 수 없어서, 승인이 필요한 단계에서 멈춥니다. 대화형 세션에서 `/make-it-ship:resume`으로 이어 가세요. 요청에 "질문 없이 진행해"라고 명시하면 `.make-it-ship.json` 초안 확인만은 승인으로 간주하지만, 계획 승인·push 같은 확인은 건너뛸 수 없습니다.

**업데이트했는데 새 버전이 안 보여요.**
세 가지를 확인하세요. ① `claude plugin marketplace update make-it-ship`을 **먼저** 실행했는지(`plugin update`만으로는 새 릴리스를 못 봅니다). ② 그다음 `claude plugin update make-it-ship@make-it-ship`를 실행하고 Claude Code를 재시작했는지. ③ 새 릴리스에서 `plugin.json`의 `version`이 실제로 올라갔는지(버전이 같으면 설치되지 않습니다).

**제거했는데 파일이 남아 있어요.**
`claude plugin uninstall`은 `~/.claude/plugins/cache/make-it-ship`를 지우지 않습니다. `rm -rf ~/.claude/plugins/cache/make-it-ship`로 지우세요. 플러그인이 만든 사용자 상태(`~/.make-it-ship`, 상태 표시줄 항목, CLAUDE.md 블록)는 `mis uninstall`이 목록을 보여 주고, `mis uninstall --yes`로 지웁니다.

**테스트가 다 통과했는데 왜 PARTIAL인가요?**
PARTIAL은 "실패는 없지만 증거가 모자라다"는 뜻입니다. 보고서의 이유 목록에 정확한 원인이 있습니다. 흔한 경우:
- 체크를 돌린 뒤 코드를 고쳐서 증거가 `STALE`이 됨 → 다시 `mis check`
- 필요한 리뷰(스펙/품질/보안)가 현재 코드 기준으로 없음
- 끝나지 않은 작업, 병합하지 않은 작업 worktree가 있음
- HIGH 영향의 질문에 답하지 않음
- 의존성 파일이 바뀌었는데 이유를 기록하지 않음(`mis note dep`)
- `.make-it-ship.json`이 run 중에 승인 없이 바뀜
- 필수 체크가 하나도 정의되지 않음

**BLOCKED가 나왔어요.**
체크 명령이 없거나, 시간이 초과됐거나, 한도에 걸렸거나, 도구·자격 증명이 없는 경우입니다. 보고서의 이유를 해결한 뒤 `/make-it-ship:resume`으로 이어 가세요. 한도 때문이라면 확인 창에서 계속을 승인하면 됩니다.

**MCP 도구(`mcp__plugin_make-it-ship_mis__*`)가 안 보여요.**
`--strict-mcp-config`로 실행하면 Claude Code가 플러그인의 MCP 서버를 불러오지 않습니다. 그 플래그 없이 실행하고 `mis doctor`로 확인하세요.

**브라우저 명령이 BLOCKED예요.**
Chrome, Chromium, Edge 중 하나가 설치돼 있어야 합니다. 아무것도 새로 설치하지 않습니다.

## 한계

- guard는 부주의한 실수를 막습니다. 모델이 일부러 명령을 난독화하는 것까지 막지는 못합니다.
- 플러그인은 토큰 사용량을 읽을 수 없어서 토큰 예산은 지원하지 않습니다. 대신 실행 시간과 재시도 횟수를 제한합니다.
- headless(`claude -p`)에서는 확인 창을 띄울 수 없어서 승인이 필요한 단계에서 멈춥니다.
- 원본 플러그인(oh-my-claudecode, Superpowers, Ponytail, gstack)과의 비교는 하네스(`evals/m10/`)만 있고, 검증된 결과는 아직 없습니다. `mis gain`은 비교 결과가 없으면 `BLOCKED`를 출력합니다.
- 기능 전체 설명(팀, 세션, MCP 도구, 브라우저 명령, 배포, iOS 등)은 [영문 README](README.md)에 있습니다.

## 개발

```sh
npm test                       # node:test, 의존성 없음
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .      # 마켓플레이스 매니페스트
node evals/setup-demo.mjs a    # 임시 디렉터리에 데모 저장소
node scripts/mis.mjs capabilities --write  # 명령, 스킬, 에이전트, MCP 도구, 훅을 추가한 뒤
node evals/m10/run.mjs --arms control,mis --demos b --n 1   # 원본 대비 비교 하네스(실제 claude 실행)
node evals/m10/report.mjs <summary.json> [out.html]         # 결과를 로컬 HTML 하나로
```

- 릴리스할 때는 `.claude-plugin/plugin.json`의 `version`을 올리세요. 올리지 않으면 마켓플레이스 사용자는 캐시된 옛 버전을 계속 씁니다.
- 설계 문서: `docs/Make_It_Ship_Spec_v1.1.md`(기준 문서), `docs/adr/`, `docs/PROGRESS.md`.
