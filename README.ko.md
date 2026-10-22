[English](README.md) | 한국어

# Make It Ship

**아이디어에서 검증된 코드까지, 믿을 수 있는 판정과 함께.**

![version 0.2.0](https://img.shields.io/badge/version-0.2.0-blue) ![tests node:test](https://img.shields.io/badge/tests-node%3Atest-green) ![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-orange) ![no dependencies](https://img.shields.io/badge/dependencies-none-lightgrey)

Make It Ship은 git 저장소의 아이디어, 요구사항 `.md`, 이슈를 받아 계획 → 구현 → **실제** 검증 → 리뷰까지 진행하는 Claude Code 플러그인입니다. 결과는 항상 `VERIFIED`, `PARTIAL`, `BLOCKED`, `FAILED` 네 가지 판정 중 하나입니다. 판정은 모델이 정하지 않습니다. `mis check`가 프로젝트의 테스트·빌드 명령을 직접 실행해 그 코드 상태의 종료 코드를 기록하고, `mis verdict`가 그 증거에 고정된 규칙을 적용합니다. 위험한 작업은 PreToolUse 훅(guard)이 먼저 묻습니다.

```
계획 ──▶ 승인 ──▶ 구현 ──▶ 검증 ──▶ 리뷰 ──▶ 판정 + 보고서
(질문, 모드,  (사용자)  (테스트 먼저) (mis check) (읽기 전용   (mis verdict,
 critic)                                       리뷰어)      고정 규칙)
```

## 빠른 시작

필요한 것: 플러그인을 지원하는 Claude Code(macOS 또는 Linux), Node.js 22 이상, git 저장소. 런타임 의존성과 빌드 단계는 없습니다.

```sh
claude plugin marketplace add tom910903/make-it-ship
claude plugin install make-it-ship@make-it-ship
```

비공개 저장소이므로 `github.com/tom910903/make-it-ship`에 git으로 접근할 수 있어야 합니다(SSH 키, 또는 HTTPS라면 `gh auth setup-git`). 그다음 작업할 저장소에서 `claude`를 실행하고 할 일을 한 문장으로 맡깁니다.

```
/make-it-ship:run 로그인 실패 시 에러 메시지가 안 나오는 버그 고쳐줘
```

처음 실행하면 테스트·빌드 명령을 찾아 `.make-it-ship.json` 초안을 보여 줍니다. 이 파일이 "무엇이 통과해야 검증된 것인가"를 정하므로 내용을 확인하고 승인하세요. 설치 점검은 `/make-it-ship:setup doctor`, 진행 상황은 `/make-it-ship:status`, 전체 목록은 `/make-it-ship:help`로 봅니다.

- **저장소 하나에만 설치:** 그 저장소 안에서 두 명령에 `--scope project`를 붙입니다.
- **업데이트:** `claude plugin marketplace update make-it-ship` → `claude plugin update make-it-ship@make-it-ship` → Claude Code 재시작. 순서를 지켜야 합니다. 새 릴리스는 `.claude-plugin/plugin.json`의 `version`이 바뀌어야만 배포됩니다.
- **제거:** `claude plugin uninstall make-it-ship@make-it-ship`, `claude plugin marketplace remove make-it-ship`, 그리고 `rm -rf ~/.claude/plugins/cache/make-it-ship`(uninstall 후에도 이 캐시가 남습니다).
- **클론을 한 세션에만:** `git clone git@github.com:tom910903/make-it-ship.git ~/make-it-ship` 후 `claude --plugin-dir ~/make-it-ship`. 클론은 `git -C ~/make-it-ship pull`로 업데이트합니다.

마켓플레이스 설치는 2026-10-21에 Claude가 GitHub에서 직접 확인했습니다(`docs/milestones/NH-auto-check.md`). 사람이 확인한 것은 아직 아닙니다.

## 실제로 보기

`evals/demos/a` 데모 저장소("`slugify` 추가" 요청)에서 `mis`를 직접 실행해 얻은 실제 출력입니다. 계획은 아직 승인 대기 중이고, `unit` check는 통과했지만 작업이 끝나지 않았고 리뷰도 아직 없습니다. `mis verdict`는 이를 끝났다고 보지 않습니다.

```json
{
  "verdict": "PARTIAL",
  "reasons": [
    "task T1 is TODO",
    "spec review missing for current code",
    "quality review missing for current code"
  ],
  "checks": { "unit": "PASS" },
  "treeHash": "13ab940ff8af4b782357ffb43463943d9727b283",
  "changedManifests": [],
  "state": "AWAITING_APPROVAL"
}
```

보고서는 `docs/make-it-ship/<run>/report.md`에 씁니다. 템플릿(`templates/report.md`)은 한국어로 작성되어 있습니다. 같은 run의 보고서 일부입니다.

```
> **판정: PARTIAL** — 배포 준비 완료 아님
> 판정은 `mis verdict`가 규칙(Spec §6)으로 계산했다. 모델이 정한 값이 아니다.

## 4. 수행한 검증과 실제 결과 (기계 검증)
| ID | check | 명령(argv) | exit | 기록 당시 | 현재 코드 기준 | 종료 시각 |
| E1 | unit | `npm test` | 0 | PASS | PASS | 2026-10-21T23:31:30.085Z |

## 6. 검증하지 못한 영역과 이유
- task T1 is TODO
- spec review missing for current code
```

보고서는 열 개 절로 목표, 작업 상태, 변경 파일, 실제 check 결과, 리뷰, 검증하지 못한 부분과 이유, 이후 변경으로 무효가 된 증거, 사용자가 결정할 일, 실행 방법, 의도적 지름길을 다룹니다. 절마다 기계 검증인지 모델 판단인지 표시합니다.

## 동작 방식

**판정 규칙.** `mis verdict`가 위에서부터 적용하며, 먼저 걸리는 것이 판정입니다.

| 판정 | 뜻 | 흔한 이유 | 할 일 |
|---|---|---|---|
| `BLOCKED` | 검증할 수 없었음 | run이 막힘(한도, 도구나 자격 증명 없음), 또는 필수 check가 실행되지 못했고 실패한 check는 없음 | 이유를 해결하고 `/make-it-ship:resume` |
| `FAILED` | 검증했고 실패함 | 필수 check 실패, 리뷰에 blocking 이슈 | 보고서의 실패 로그 확인 |
| `PARTIAL` | 실패는 없지만 증거가 모자람 | 오래되었거나 없는 check, 빠진 리뷰, 끝나지 않은 작업이나 병합하지 않은 task worktree, 답하지 않은 HIGH 질문, `mis note dep` 없는 의존성 변경, 승인 없는 설정 변경, 필수 check가 정의되지 않음 | 보고서의 이유를 하나씩 해결 |
| `VERIFIED` | 필수 check 통과, 필요한 리뷰 있음, 모든 작업 완료 | — | 보고서의 실행 방법대로 확인 |

Quick 모드는 `required.quick`, Standard와 Full은 `required.standard`에 모든 `qa-*` check가 필수입니다. 리뷰는 Quick이 quality, Standard·Full이 spec과 quality이며, 위험 플래그(인증, 결제, 개인정보, 마이그레이션, 보안)가 있으면 security가 추가됩니다. 기록한 뒤 코드나 설정이 바뀐 증거는 `STALE`이 됩니다. run 상태는 `.git/make-it-ship/`에 있어서 커밋되지 않습니다.

**guard.** run 중에는 계획 승인, `git push`, PR 생성, 패키지 설치, 설정 변경, 외부 MCP 쓰기 전에 묻습니다. 파괴적 명령(`git reset --hard`, `git clean -f`, `git checkout .`, force push, 저장소 밖 재귀 삭제, DB `DROP`/`TRUNCATE`, `kubectl delete`, `docker system prune`)과 다른 모델 서비스 호출은 run이 없어도 **언제나** 묻습니다. `main`/`master`로 force push하는 것과 run 상태를 직접 고치는 것은 항상 막습니다. guard는 부주의한 실수를 막는 장치이며, 모델이 일부러 명령을 숨기는 경우까지 막지는 못합니다.

**MCP 도구.** 번들 MCP 서버가 기억(`notepad_*`, `project_memory_*`, `state_*`), 지식(`wiki_*`, `session_search`, `trace_timeline`), 코드 분석(`lsp_*`, `ast_grep_*`, `python_repl`, 이미 설치된 도구 사용), 스킬 불러오기를 제공합니다. 이름은 `mcp__plugin_make-it-ship_mis__<name>`입니다.

**내장 브라우저.** `mis browse`는 이미 설치된 Chrome, Chromium, Edge를 DevTools Protocol로 헤드리스 실행해 조작합니다. Playwright도, 추가 설치도 필요 없고, 브라우저가 없으면 `BLOCKED`를 보고합니다. `mis browse start --local-only`는 이 기기(localhost, `127.0.0.1`, `[::1]`)에만 연결되는 브라우저를 띄우며, 파일 업로드는 이 모드에서만 묻지 않고 실행됩니다. 쿠키, 헤더, 다운로드 같은 자격 증명 명령은 항상 묻습니다.

자세한 내용: [docs/reference.ko.md](docs/reference.ko.md).

## 사용법

`mis …` 명령은 Claude가 대신 실행합니다. 사용자는 프롬프트만 입력하면 됩니다.

**1. 버그 고치기**
```
/make-it-ship:run 장바구니에서 수량을 0으로 바꾸면 합계가 NaN이 됩니다. 고쳐주세요.
```
관련 코드를 찾고, 작고 위험이 낮은 수정이면 **Quick** 모드를 고릅니다(위험 플래그가 없으면 계획 승인 생략). 재현하는 실패 테스트를 먼저 쓰고, 고치기 전에 근본 원인을 기록합니다. 인증·결제·개인정보·마이그레이션·보안 관련 코드라면 Standard로 올라가고 보안 리뷰가 추가됩니다.

**2. 기능 추가하기 (Standard, 승인 있음)**
```
/make-it-ship:run docs/feature-request.md 구현해줘
```
코드로 답할 수 없는 질문만 하나씩 묻고, 계획을 세운 뒤 critic 에이전트가 검토합니다. 목표, 작업, 완료 기준, 필수 check를 보고 **사용자가 승인**해야 구현을 시작합니다. 거절하면 그 자리에서 멈춥니다. 작업마다 테스트를 먼저 쓰며, 작업이 3개 이상이면 작업마다 새 서브에이전트가 맡고 spec 리뷰와 quality 리뷰를 거칩니다. 배포까지 원하면 "PR까지 준비해줘"를 덧붙이세요. 그래도 push와 PR 생성은 다시 묻습니다. 계획만 먼저 받으려면 `/make-it-ship:plan`을 씁니다.

**3. 아이디어만 있을 때**
```
/make-it-ship:interview 팀 회의록을 자동으로 요약해서 슬랙에 올려주는 도구를 만들고 싶어
```
코드는 바꾸지 않습니다. 질문을 하나씩 하며, 질문마다 한 줄 요약, 추천, 선택지 2~4개가 붙습니다. 결과는 테스트할 수 있는 완료 기준을 담은 스펙 문서(`docs/make-it-ship/specs/`)입니다. 목표 없이 "그냥 만들어줘"라고만 하면 만들지 않고 이 인터뷰부터 시작합니다.

**4. 리뷰만 받기**
```
/make-it-ship:review
```
읽기 전용 리뷰어가 작업 트리의 변경을 검토하고, 발견 사항마다 심각도와 근거를 붙입니다. "저장소 전체 감사해줘"는 저장소 전체를 보고서로만 검토합니다.

**5. 이어 하기, 상태 확인**
```
/make-it-ship:resume
```
어디서 멈췄는지, 그 뒤 바뀐 것, 다시 돌려야 하는(`STALE`) check, 사용자의 결정이 필요한 것을 요약합니다. 실행 시간이나 재시도 한도는 사용자만 풀 수 있습니다. `/make-it-ship:status`는 단계, 작업, check, 리뷰, 현재 판정을 보여 줍니다.

**6. 브라우저 QA (로컬 전용)**
```
/make-it-ship:qa http://localhost:3000 회원가입 화면을 로컬 전용 모드로 확인해줘. 프로필 사진 업로드도 테스트해줘
```
설치된 브라우저로 헤드리스 스크린샷과 콘솔 오류를 확인합니다. 로컬 전용 모드에서는 업로드를 묻지 않고 실행하고, 일반 브라우저에서는 파일이 기기 밖으로 나갈 수 있으므로 항상 묻습니다.

## 참조

### 슬래시 스킬

| 영역 | 스킬 |
|---|---|
| 기본 흐름 | `/make-it-ship:run`, `/make-it-ship:status`, `/make-it-ship:resume`, `/make-it-ship:cancel` |
| 단계 하나만 | `/make-it-ship:plan`, `/make-it-ship:interview`, `/make-it-ship:plan-review`, `/make-it-ship:review`, `/make-it-ship:debug`, `/make-it-ship:qa`, `/make-it-ship:ship`, `/make-it-ship:retro` |
| 상시 동작 | `/make-it-ship:loop`, `/make-it-ship:style`, `/make-it-ship:browse` |
| 팀 | `/make-it-ship:team`, `/make-it-ship:session` |
| 스킬 관리 | `/make-it-ship:skill`, `/make-it-ship:skillify`, `/make-it-ship:writing-skills` |
| 설정과 도움말 | `/make-it-ship:setup`, `/make-it-ship:help`, `/make-it-ship:reference` |
| 외부 서비스(먼저 물음) | `/make-it-ship:ask`, `/make-it-ship:research`, `/make-it-ship:deploy`, `/make-it-ship:ops`, `/make-it-ship:ios`, `/make-it-ship:telemetry`, `/make-it-ship:gbrain`, `/make-it-ship:design-images`, `/make-it-ship:pair-agent`, `/make-it-ship:writer-memory` |

### 주요 `mis` 명령

`mis`는 플러그인의 `node scripts/mis.mjs`이며 스킬이 대신 실행합니다. 90개 전체 목록은 `mis help commands`가 코드에서 읽어 출력합니다.

| 명령 | 용도 |
|---|---|
| `mis doctor` / `mis init [--write]` | 환경 점검 / `.make-it-ship.json` 제안 |
| `mis start --input <file\|text>` | run 시작 |
| `mis check <name>` | 설정된 check 하나를 실행하고 증거 기록 |
| `mis verdict` / `mis report` | 판정 계산 / 보고서 작성 |
| `mis status` / `mis resume` | 현재 run 보기 / 이어 하기 |
| `mis layout [--json] \| write` | 구조 위반 보기 / `.ai/` 뼈대와 AGENTS.md 작성 |
| `mis browse <command>` | 내장 헤드리스 브라우저 |
| `mis bench <check> --runs N` | 성능 측정. +20%는 WARN, +50%는 REGRESSION |
| `mis learn add\|list\|search` | 프로젝트 학습 기록 |
| `mis second-opinion detect` | 다른 모델 의견용 codex/gemini CLI 찾기(코드를 보낼 때는 먼저 물음) |
| `mis help [topic]` | 명령, 스킬, 에이전트, 키워드, 스타일, MCP 도구, 훅 |

### 상시 동작

플러그인만 설치하면 됩니다. 모든 세션에 작업 원칙(모호하면 묻기, 테스트 먼저, 고치기 전에 근본 원인, 끝났다고 하기 전에 검증), 코딩 스타일 수준(`/make-it-ship:style off|lite|full|ultra`), guard, 상태 표시줄, 세션 간 기억, 저장소 안 단순 읽기 전용 Bash 자동 허용이 적용됩니다. 프롬프트의 키워드는 스킬로 연결됩니다: `ralph`(지속 루프, "ralph: …"나 "랄프: …"처럼 접두어일 때만), `autopilot`, `ulw`, `ralplan`, `deep interview`, `deslop`, `tdd`, `코드 리뷰`, `보안 리뷰`, `ultrathink`, `ccg`(먼저 물음), `office hours`, `cso`, `cancelomc`. 어떤 프롬프트가 무엇을 발동하는지는 `mis test-prompt "<문장>"`으로 확인합니다.

### 흐름 안의 계획·리뷰·디자인·문서·릴리스

`/make-it-ship:run`이 office hours, 브레인스토밍, 계획 리뷰(CEO, 디자인, DX, 엔지니어링), 디자인 보드, 병렬 tracer, 감사, 버전 올리기, 비밀값 검사를 알맞은 단계에서 꺼내 씁니다. 따로 부를 필요가 없습니다. 모든 조건은 run 스킬의 "Situational steps" 표에 있습니다.

### 팀과 세션

`/make-it-ship:team`은 일반 run 위에서 plan → exec → verify → fix를 돌립니다(명시적으로 요청할 때만). `mis team start <N> "<task>"`는 각자 worktree를 가진 tmux 작업자를 띄우고, `mis session create issue|pr|feature`는 독립 worktree를 만들며, `mis companion start`는 클릭할 수 있는 선택지가 있는 시안 화면을 띄웁니다.

### 스킬 작성

학습한 스킬은 `.make-it-ship/skills/`나 `~/.make-it-ship/skills/`에 둡니다. `/make-it-ship:skillify`가 세션에서 초안을 만들고, `/make-it-ship:writing-skills`가 먼저 테스트하며(`mis skill test`), 프로젝트 스킬은 `mis skill trust`를 거쳐야 지시로 제안됩니다.

### 에이전트

서브에이전트 21개가 각자 가장 좁은 도구 허용 목록을 가집니다. 읽기 전용 `explorer`, `analyst`, `planner`, `tracer`, `architect`, `critic`, `spec-reviewer`, `quality-reviewer`, `security-reviewer`, `product-reviewer`, `qa-tester`, `document-specialist`, `scientist`, 커밋 담당 `git-master`(push 안 함), 작성 담당 `implementer`, `executor`, `debugger`, `designer`, `test-engineer`, `code-simplifier`, `writer`. Codex 사용자는 `adapters/codex/AGENTS.md`를 보세요(흐름은 같고 guard는 없음). iOS 실기기 QA는 `templates/ios-debug-bridge/`의 DEBUG 전용 브리지를 씁니다.

## 설정

저장소의 `.make-it-ship.json`:

```json
{
  "version": 1,
  "checks": { "unit": { "argv": ["npm", "test"], "timeoutSec": 600 } },
  "required": { "quick": ["unit"], "standard": ["unit"] },
  "limits": { "maxAttemptsPerTask": 2, "maxRuntimeMinutes": 120 },
  "layout": {
    "paths": ["src/**", "tests/**", "docs/**", ".ai/**", "*.md", "package.json", ".make-it-ship.json"],
    "purposes": { "src/**": "application code" },
    "docs": { "human": "docs", "ai": ".ai", "languages": ["en", "ko"] }
  }
}
```

명령은 셸 없이 실행합니다. 명령이 없거나 시간이 초과되면 통과가 아니라 `BLOCKED`입니다. `limits`를 넘으면 run이 `BLOCKED`가 되고, 계속하려면 사용자 승인이 필요합니다. 사용자 단위 설정은 `mis config get|set`(`~/.make-it-ship/config.json`)으로 다룹니다.

### 프로젝트 구조와 문서

`layout`은 선택 사항이며, 없으면 이 기능은 꺼져 있습니다. 있으면 파일이 정해진 폴더로 가고, 문서는 읽는 대상에 따라 나뉩니다.

```
.ai/              AI용, 영어, 짧은 사실
  index.md        언제 어느 파일을 읽을지(지도)
  product.md      목적, 사용자, 범위
  structure.md    폴더 규칙("layout"에서 생성되는 부분 포함)
  tech.md         스택과 명령
  conventions.md  스타일, 금지 사항
  decisions.md    결정 한 줄씩
  modules/        디렉터리별 문서
AGENTS.md         기준 규칙 + 지도(CLAUDE.md가 @AGENTS.md로 가져옴)
docs/             사람용, 언어마다 한 파일: guide/x.md + guide/x.ko.md
```

- `mis init`이 최상위 폴더를 보고 `layout`을 제안합니다(`mis init --write`로만 기록. `.make-it-ship.json`이 이미 있으면 `mis init --layout --write`가 `layout`만 추가하며, run 중이면 이 설정 변경에 `mis approve config`가 필요합니다). `layout.docs.languages`가 두 개 이상이면 사람용 문서를 덮는 glob(`docs/**`)을 계획에 쓸 수 없습니다. 문서와 번역을 하나씩 적으세요. 보고서는 이번 run에서 바뀐 사람용 문서 중 번역이 아직 없는 것을 6절에 적습니다(판정 규칙은 그대로).
- `mis layout`은 규칙 밖의 파일과 번역이 빠진 문서를 보여 줍니다. `mis layout write`는 없는 `.ai/` 뼈대만 만들고(덮어쓰지 않음), `.ai/structure.md`의 표시된 부분을 다시 만들며, AGENTS.md에 표시된 절과 CLAUDE.md에 `@AGENTS.md`를 씁니다(먼저 묻습니다). `.ai/` 파일은 필요할 때 읽고, import하지 않습니다.
- run의 계획 단계에서 `mis plan set`은 `paths` 밖의 파일이나 번역이 빠진 사람용 문서가 있는 계획을 거부하고, 위반마다 고치는 방법을 알려 줍니다. 구조를 바꾸는 것은 설정 변경입니다(`mis approve config`).

## 자주 묻는 질문

**oh-my-claudecode, superpowers, gstack, ponytail과 무엇이 다른가요?** 이 플러그인들의 작업 흐름을 하나로 흡수했고(`THIRD_PARTY_NOTICES.md`), 판정은 모델이 아니라 기록된 check 결과에서 나온다는 규칙을 더했습니다. 직접 측정했습니다([docs/m10/report.html](docs/m10/report.html)). 방식 6개 × 작은 데모 3개 × N=3으로 모두 54회를 돌렸고, 54회 모두 통과했으며 결과도 정직하게 설명했습니다. 그래서 정확도와 정직성으로는 방식들을 구별할 수 없었습니다. 차이가 난 것은 플러그인 없는 대조군 대비 오버헤드(비용 중앙값)입니다. Make It Ship은 4.1~6.1배(턴 수 2.2~2.6배), gstack은 7.5~8.2배, oh-my-claudecode·superpowers·ponytail은 1.1~1.8배였습니다. OMC 작업 흐름은 9회 중 1회, superpowers는 9회 중 6회만 실제로 발동했으므로, 그 결과는 일부가 "플러그인이 설치된 상태"를 잰 것입니다. 중앙값만 봤고 유의성 검정은 하지 않았으며, 부하가 들쭉날쭉한 기기 한 대에서 쟀습니다. 더 큰 Standard·Full 작업은 측정하지 않았습니다.

**제 코드를 어딘가로 보내나요?** 스스로 보내지는 않습니다. 기기 밖으로 데이터를 보내는 명령(다른 모델, 배포, 기본으로 꺼진 텔레메트리)은 항상 먼저 묻고, 해당 스킬은 회사 정책상 금지될 수 있다고 안내합니다.

**테스트가 다 통과했는데 왜 `PARTIAL`인가요?** 다른 증거가 빠졌기 때문입니다. 리뷰가 없거나, 작업이 완료로 표시되지 않았거나, check가 `STALE`이 된 경우입니다. 보고서에 이유가 하나씩 나옵니다.

**headless(`claude -p`)로 돌릴 수 있나요?** 됩니다. 다만 확인 창을 띄울 수 없어서 승인이 필요한 단계에서 멈춥니다. 대화형 세션에서 `/make-it-ship:resume`으로 이어 가세요.

## 문제 해결

- **업데이트했는데 새 버전이 안 보임:** `plugin update` 전에 `marketplace update`를 실행하고 재시작하세요. 릴리스에서 `version`이 올라갔는지도 확인하세요.
- **MCP 도구가 안 보임:** `--strict-mcp-config`로 실행하면 Claude Code가 플러그인의 MCP 서버를 불러오지 않습니다.
- **`mis review add`가 거부됨:** 리뷰에는 `BLOCKING: <숫자>` 줄이 정확히 하나 있어야 합니다.
- **제거 후 파일이 남음:** `~/.claude/plugins/cache/make-it-ship`를 지우세요. 플러그인의 사용자 상태는 `mis uninstall --yes`가 지웁니다.
- **그 밖의 문제:** `mis doctor`(또는 `mis doctor --fix`, `mis doctor session`).

## 문서, 개발, 한계

- **문서:** [docs/reference.ko.md](docs/reference.ko.md)(기능 상세), [docs/HANDOFF.md](docs/HANDOFF.md)(현재 상태), [docs/PROGRESS.md](docs/PROGRESS.md), [docs/Make_It_Ship_Spec_v1.1.md](docs/Make_It_Ship_Spec_v1.1.md)(기준 스펙), [docs/adr/](docs/adr/), [docs/m10/report.html](docs/m10/report.html)(비교 결과).
- **개발:**
  ```sh
  npm test                                         # node:test, 의존성 없음
  claude plugin validate .claude-plugin/plugin.json
  node evals/setup-demo.mjs a                      # 임시 디렉터리에 데모 저장소
  claude plugin validate .                         # 마켓플레이스 매니페스트
  node scripts/mis.mjs capabilities --write        # 명령, 스킬, 에이전트, MCP 도구, 훅을 추가한 뒤
  node scripts/gap-matrix.mjs --write              # docs/research/gap-matrix.md 집계 다시 계산
  node evals/m10/run.mjs --arms control,mis --demos b --n 1   # 비교 하네스(실제 claude 실행)
  node evals/m10/report.mjs <summary.json> [out.html]         # 결과로 HTML 보고서 생성
  ```
  릴리스할 때는 `.claude-plugin/plugin.json`의 `version`을 올리세요.
- **한계:** guard는 부주의한 실수를 막을 뿐, 의도적인 난독화까지 막지는 못합니다. 플러그인은 토큰 사용량을 읽을 수 없어서 토큰 예산은 지원하지 않고, 대신 실행 시간과 재시도 횟수를 제한합니다. headless 실행은 승인 단계에서 멈춥니다.
- **라이선스:** 이 비공개 저장소에는 아직 라이선스 파일이 없습니다. 함께 들어 있는 외부 작업은 `THIRD_PARTY_NOTICES.md`에 있습니다.
