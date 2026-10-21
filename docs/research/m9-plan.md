# M9 작업 계획 (gap matrix 재감사 결과)

작성: 2026-10-20 (M9-00). 근거: `docs/research/gap-matrix.md` 재감사(`m9-wip` @ f0c4baf). 남은 PARTIAL·MISSING 204행을 M9-A~F에 하나씩 배정했다. 각 항목의 행 목록은 매트릭스의 "→ M9-X" 표시와 같은 데이터에서 만들었다.

공통 조건: 새 상시 훅은 fail-open, guard는 fail-closed. [정책] 외부 전송은 run 여부와 관계없이 guard ask, 텔레메트리 기본 꺼짐. 자격 증명을 다루는 브라우저 기능은 항상 ask. 알림·BSP는 제외. 수용 기준은 `npm test`의 새 테스트로 확인하고, 실사용 확인은 M9 독립 검증에서 한다.

## 요약

| 묶음 | 이름 | 행 수 | 크기 | 의존성 |
|---|---|---|---|---|
| M9-A | 설치·수명주기 | 33 | M | 독립 (A4는 B·C 이후 마감: 도움말·참고서가 새 명령·에이전트를 나열해야 함) |
| M9-B | 단독 계획·리뷰 스킬 | 59 | L | B0 결정 먼저. B5 redact-prepush는 D0 guard 규칙과 같은 파일(`lib/policy.mjs`)을 고치므로 D0 이후. B3은 F10 질문 형식과 같은 규율을 쓴다 |
| M9-C | 에이전트·스킬 작성 | 16 | M | 독립. C3 스킬 형식은 E3(browser skillify)과 D2(scientist 에이전트는 C1 형식)의 선행 |
| M9-D | 연구·운영·배포·외부 | 58 | L | D0 먼저. D2는 C1 에이전트 형식 뒤. D3 canary는 M8 browse 사용 |
| M9-E | 브라우저 자격 증명·고급 | 19 | M | D0(항상 ask 규칙) 뒤. E3은 C3 스킬 형식 뒤 |
| M9-F | 남은 훅 | 19 | M | 독립. F1 상태줄 요소는 A1 상태줄 설치 안내와 같은 파일을 건드리므로 A1과 순서만 맞춘다 |
| 합계 | | 204 | | |

권장 순서: D0·B0(결정·공통 규칙, 작음) → C → A1~A3·A5~A8 → B → F → E → D → A4(도움말·참고서·capabilities는 마지막에 전체 목록으로 마감).

배정 기준이 애매했던 행(가장 가까운 묶음으로 보냄): `cancel`·`omc launch`·`debug`(세션 진단) → A(수명주기), `ponytail-gain`·Ponytail `benchmarks/` → A(정보 표시, M10 결과 사용), `gstack-jsonl-merge`·`gstack-repo-mode`·`gstack-global-discover` → B(learn·ship·context와 같은 저장소), `gstack-detach`·`omc wait`·`omc mission-board` → D(운영), `gstack-open-url` → E(브라우저), `design/` 바이너리 → D([정책] OpenAI 전송), `project-memory-posttool`·PreCompact TODO → F(훅). N/A로 새로 바꾼 행은 없다.

## M9-A 설치·수명주기 (33행, M)

### A1 `mis setup` (전역 설치·라우터·지시문 이전) — M, 8행
행: `OMC omc-setup` · `OMC setup` · `OMC omc install` · `OMC omc setup` · `Ponytail SessionStart: ponytail-activate.js (상태줄 설정 안내)` · `gstack gstack-first-task-detect` · `gstack gstack-settings-hook` · `gstack gstack-team-init`
수용 기준:
- `mis setup` 기본은 dry-run: `~/.claude/settings.json` statusLine, `~/.claude/CLAUDE.md` MIS 블록, OMC 블록 제거안(§6.1)을 diff로 출력하고 아무것도 쓰지 않는다 (테스트: 임시 `CLAUDE_CONFIG_DIR`에서 실행 후 파일 해시 불변)
- `mis setup --write`는 guard ask 후 쓰고, 두 번 실행해도 블록이 하나다 (멱등 테스트)
- statusLine이 없을 때 SessionStart가 설치 안내 한 줄을 하루 1회만 낸다 (같은 날 두 번째 SessionStart 출력에 없음)
- `mis setup team` (gstack-team-init 상당)이 `.make-it-ship.json`·`.gitignore` 초안을 만들고, `mis init`의 감지 결과에 첫 작업 유형(웹/CLI/라이브러리)을 포함한다

### A2 `mis doctor` 확장 + 수리 — M, 4행
행: `OMC debug` · `OMC omc-doctor` · `OMC omc doctor` · `gstack gstack-platform-detect`
수용 기준:
- `mis doctor --json`에 plugin·hooks.json·MCP(서버 기동 후 `tools/list` 54개)·statusLine·상태 디렉터리·설치된 코딩 에이전트 항목이 있다
- `mis doctor --fix`: 고장 낸 fixture(잘못된 statusLine 경로, 오래된 lock, 깨진 `mode-state.json`)가 `fail` → 수리 후 `ok`
- 세션 진단(`mis doctor session`): 활성 run·loop·team·freeze·최근 훅 오류(trace)를 한 화면에 낸다

### A3 `mis mcp-setup` — S, 1행
행: `OMC mcp-setup`
수용 기준:
- `mis mcp-setup list`가 알려진 서버(context7 등)와 등록 여부를 낸다
- `mis mcp-setup add <name>`은 실행할 `claude mcp add …` 명령을 보여 주고 guard ask(설정 변경) 후에만 실행한다

### A4 help·reference·info·capabilities·gain — S, 6행
행: `OMC omc-reference` · `OMC omc info` · `OMC omc capabilities` · `Ponytail ponytail-gain` · `Ponytail ponytail-help` · Ponytail `benchmarks/`, `examples/`
수용 기준:
- `mis help`(와 `/make-it-ship:help`)가 모든 스킬·`mis` 명령·키워드를 나열한다 (테스트: `skills/*/SKILL.md` 이름과 `commands` 키 전부 포함)
- 참고 스킬 `skills/reference/SKILL.md`에 에이전트·MCP 도구·키워드 표가 있고, 테스트가 실제 `agents/`·도구 목록과 대조한다
- `mis capabilities --write`가 lockfile을 만들고 `--check`는 스킬·도구가 바뀌면 exit 1
- `mis gain`은 M10 결과 JSON을 읽어 표시하고, 없으면 `BLOCKED: no benchmark results`

### A5 `mis config`·`mis version` — S, 3행
행: `OMC omc config` · `OMC omc version` · `gstack gstack-config`
수용 기준:
- `mis config get|set <key> <value>`가 `~/.make-it-ship/config.json`을 스키마 검사 후 쓴다 (잘못된 키는 exit 1)
- `mis version`이 plugin.json 버전·Node 버전·커밋을 출력한다

### A6 업데이트 확인·upgrade·uninstall — M, 7행
행: `OMC SessionStart: session-start.mjs (업데이트 확인·캐시 정리)` · `OMC omc update / update-reconcile` · `gstack gstack-upgrade` · gstack preamble: `gstack-update-check` · `gstack gstack-session-update` · `gstack gstack-uninstall` · `gstack gstack-update-check`
수용 기준:
- `mis update-check`는 결과를 24시간 캐시한다 (fixture 원격 버전 파일, 두 번째 호출은 원격을 읽지 않음)
- SessionStart는 새 버전이 있을 때만 한 줄 알린다. 네트워크 실패 시 아무것도 내지 않는다 (fail-open 테스트)
- `mis upgrade`는 guard ask 후 플러그인 갱신 명령을 실행한다
- `mis uninstall --dry-run`은 지울 것(`~/.make-it-ship`, statusLine 항목, browse·team 프로세스)을 나열하고, `.git/make-it-ship` run 기록은 `--purge-runs` 없이는 지우지 않는다

### A7 SessionStart 초기화·정리 — S, 2행
행: `OMC SessionStart(init): setup-init.mjs` · `OMC SessionStart(maintenance): setup-maintenance.mjs`
수용 기준:
- SessionStart가 N일(설정값) 지난 종료 run·browse·team·세션 파일을 정리하고, 활성 run·loop는 건드리지 않는다 (mtime fixture)
- `.make-it-ship.json`이 스키마 위반이면 SessionStart가 한 줄 경고한다 (훅은 exit 0)

### A8 모든 모드 취소·`mis launch` — S, 2행
행: `OMC cancel` · `OMC omc launch`
수용 기준:
- `mis cancel --all`이 loop 종료, team shutdown, merge-readiness 취소를 하고 run은 `--run`일 때만 취소한다 (fixture로 각 상태 확인)
- `mis launch`가 tmux 세션에서 `claude`를 띄우고 attach 명령을 출력한다. tmux가 없으면 BLOCKED

## M9-B 단독 계획·리뷰 스킬 (59행, L)

### B0 결정: 단독 명령 vs `run --phase` — S
수용 기준:
- 결정됨(2026-10-20): 단독 명령이 아니라 개발 흐름에 녹인다. B1~B9의 각 기능은 run 단계(phases/*.md)에서 상황에 따라 자동으로 쓰이고, run 밖에서는 자연어로 기존 스킬·키워드 라우터를 통해 호출된다. 아래 "단독 스킬" 수용 기준은 "해당 단계에서 자동 사용 + 자연어 진입점"으로 읽는다.

### B1 계획·spec 단독 스킬 — M, 8행
행: `OMC deep-dive` · `OMC plan` · `OMC ralplan` · `Superpowers brainstorming` · `Superpowers executing-plans` · `Superpowers writing-plans` · `gstack office-hours` · `gstack spec`
수용 기준:
- `/make-it-ship:plan`이 run 없이 `docs/make-it-ship/plans/<slug>.md`를 쓴다. `mis plan check <file>`가 필수 절(목표·task·수용 기준·검증 명령) 누락 시 exit 1
- `mis start --plan <file>`이 계획 문서의 task를 `plan.json` task로 옮긴다 (task 수·제목 일치 테스트)
- ralplan 자동 게이트: 수용 기준 없는 모호한 실행 요청(`build it`)에 키워드 라우터가 interview 경로를 주입한다 (`mis test-prompt`)
- spec·office-hours(스타트업/빌더 두 모드)·brainstorming이 각자 문서를 남기고 코드를 바꾸지 않는다 (git status 깨끗)
- deep-dive: trace 결과 파일을 interview가 읽는다 (스킬 지시문 + 산출물 경로 테스트)

### B2 계획 리뷰 스킬 — S, 5행
행: `gstack autoplan` · `gstack plan-ceo-review` · `gstack plan-design-review` · `gstack plan-devex-review` · `gstack plan-eng-review`
수용 기준:
- plan-ceo/design/devex/eng-review 스킬 파일이 있고 각각 리뷰를 계획 문서의 절로 추가한다
- autoplan이 네 리뷰를 순서대로 실행하고 6개 결정 원칙으로 자동 결정한 내역을 남긴다

### B3 plan-tune (질문 로그·선호·프로필) — M, 4행
행: `gstack plan-tune` · `gstack gstack-developer-profile` · `gstack gstack-question-log` · `gstack gstack-question-preference`
수용 기준:
- `mis question log` JSONL 추가, `mis question pref set <id> skip|ask`
- interview 단계가 skip 선호 질문을 건너뛴다 (필터 단위 테스트)
- `mis profile`이 로그에서 성향 요약을 도출한다 (fixture 로그 → 고정 출력)

### B4 디자인 스킬 — M, 5행
행: `gstack design-consultation` · `gstack design-html` · `gstack design-shotgun` · `gstack diagram` · `gstack gstack-taste-update`
수용 기준:
- design-shotgun: 시안 N개 + `mis companion` 비교 보드(index에 `data-choice`), 선택이 `mis companion status`에 기록된다
- diagram: `.mmd` + `.excalidraw`(유효 JSON, elements 배열) + PNG(`mis browse screenshot`)
- design-consultation·design-html 단독 실행, 취향 프로필(`taste`) 갱신 파일

### B5 감사·대시보드·비밀값 — M, 8행
행: `OMC ai-slop-cleaner` · `Ponytail ponytail-audit` · `Ponytail ponytail-debt` · `gstack cso` · `gstack devex-review` · `gstack health` · `gstack gstack-redact` · `gstack gstack-redact-prepush`
수용 기준:
- `mis debt`가 `shortcut:` 원장을 단독 출력한다 (report 10절과 같은 내용)
- `mis redact scan [--history]`가 fixture의 작업 트리·git 이력에 심은 키를 찾는다
- push 전 diff에 비밀값이 있으면 guard ask 사유에 표시된다 (policy 테스트)
- `mis health`가 가중 점수 JSON을 내고 이력에 추가한다
- ponytail-audit·cso·devex-review·ai-slop-cleaner(리뷰 전용 모드 포함)는 읽기 전용 보고 후 git status가 깨끗하다

### B6 ship·release VERSION — M, 8행
행: `OMC release` · `Superpowers finishing-a-development-branch` · `gstack ship` · `gstack gstack-diff-scope` · `gstack gstack-next-version` · `gstack gstack-pr-title-rewrite.sh` · `gstack gstack-repo-mode` · `gstack gstack-version-bump`
수용 기준:
- `mis version-bump patch|minor|major`가 VERSION/package.json/CHANGELOG를 결정적으로 갱신한다
- `mis ship` PR 제목이 `v<버전>`으로 시작한다. `mis diff-scope`가 파일을 code/test/docs/config로 분류한다
- `mis repo-mode`가 1인·협업을 판정한다 (fixture 저장소 작성자 수)
- finishing-a-branch·release가 run 없이 동작한다 (4선택, 태그 생성은 guard ask)

### B7 맥락 저장·복원·ultragoal — M, 6행
행: `OMC ultragoal` · `OMC omc ralphthon` · `OMC omc ultragoal` · `gstack context-save` · `gstack context-restore` · `gstack gstack-global-discover / gstack-global-discover.ts`
수용 기준:
- `mis context save <name>` / `restore <name>`: 브랜치 불일치 시 경고
- `mis goal add|list|done` 원장이 저장되고 `/goal` 인계문을 출력한다. ralphthon은 interview→loop→harden 순서를 스킬로 묶는다
- 전 프로젝트 세션 탐색: fixture `CLAUDE_CONFIG_DIR`의 여러 프로젝트 세션이 목록에 나온다

### B8 learn·결정·retro — M, 9행
행: `gstack learn` · `gstack retro` · `gstack gstack-decision-log` · `gstack gstack-decision-search` · `gstack gstack-distill-apply` · `gstack gstack-distill-free-text` · `gstack gstack-jsonl-merge` · `gstack gstack-learnings-search` · `gstack gstack-specialist-stats`
수용 기준:
- `mis learn search <q>`, `mis learn distill`은 제안만 하고 `--yes`일 때만 적용
- JSONL merge 드라이버 설치 후 두 브랜치의 추가 줄이 합집합으로 병합된다 (git fixture)
- `mis decision add|supersede|search`
- `mis retro --git --since 7d`가 커밋 수·핫스팟·작성자별 지표와 리뷰어별 적중률을 낸다

### B9 개발 흐름 스킬 — M, 6행
행: `OMC deepinit` · `OMC external-context` · `OMC trace` · Superpowers subagent-driven-development (+ `scripts/sdd-workspace`, `task-brief`, `review-package`) · `Superpowers using-git-worktrees` · `gstack document-generate`
수용 기준:
- `mis session create feature`가 생성 후 기준 check를 실행하고 결과를 출력한다
- deepinit 스킬이 `deepinit_manifest` 결과로 디렉터리별 `AGENTS.md`를 만들고 재실행 시 변경된 디렉터리만 갱신한다
- trace 스킬이 가설 2개 이상을 병렬 에이전트로 검증한다. external-context·document-generate·subagent-driven-development(task별 2단계 리뷰) 스킬 파일과 산출물 경로 테스트

## M9-C 에이전트·스킬 작성 (16행, M)

### C1 빠진 OMC 에이전트 11개 — M, 11행
행: `OMC analyst` · `OMC code-simplifier` · `OMC debugger` · `OMC designer` · `OMC document-specialist` · `OMC executor` · `OMC git-master` · `OMC planner` · `OMC test-engineer` · `OMC tracer` · `OMC writer`
수용 기준:
- `agents/<name>.md` 11개(frontmatter name·description·tools 허용목록). 읽기 전용 역할(analyst·planner·tracer·document-specialist)은 Write/Edit 없음
- `tests/unit/plugin-files.test.mjs`가 목록을 확인하고 `claude plugin validate .` 통과

### C2 qa-tester 대화형 CLI — S, 1행
행: `OMC qa-tester`
수용 기준:
- qa-tester가 tmux로 fixture REPL을 조작해 기대 출력 확인 스크립트를 남긴다. tmux 없으면 BLOCKED

### C3 스킬 관리·작성 — M, 4행
행: `OMC learner` · `OMC skill` · `OMC skillify` · Superpowers writing-skills (+ `render-graphs.js`, 테스트 방법)
수용 기준:
- `mis skill list|add|remove|search|edit|lint`가 `.make-it-ship/skills`·`~/.make-it-ship/skills`를 다룬다
- skillify/learner가 만든 SKILL.md의 `triggers`가 `learnedSkills`에 매칭된다 (단위 테스트)
- writing-skills 스킬: 서브에이전트로 새 스킬을 시험하는 절차와 `mis skill lint` 통과 조건

## M9-D 연구·운영·배포·외부 (58행, L)

### D0 외부 전송 공통 guard 규칙 — S
수용 기준:
- 새 외부 전송 명령(D1~D8, E1~E2)은 run 여부와 무관하게 guard ask로 분류된다 (명령별 policy 테스트)
- 텔레메트리·동기화 설정의 기본값이 꺼짐이다 (기본 설정에서 이벤트 파일이 생기지 않음)

### D1 다른 모델 실행기 — M, 8행
행: `OMC ask` · `OMC ccg` · `OMC omc interop` · `OMC omc ask` · `gstack benchmark-models` · `gstack codex` · `gstack gstack-codex-probe` · `gstack gstack-model-benchmark`
수용 기준:
- `mis ask codex|gemini "<q>"`: guard ask, PATH의 stub CLI로 결과 파일 `second-opinion-*.md` 생성, verdict 불변
- ccg: stub 두 개 결과를 종합 파일로. probe: 버전·인증 상태. benchmark-models: 같은 프롬프트의 시간·exit 표
- interop: tmux 분할(Claude+Codex), tmux 없으면 BLOCKED

### D2 연구 루프 — L, 6행
행: `OMC autoresearch` · `OMC sciomc` · `OMC self-improve` · `OMC writer-memory` · `OMC scientist` · `OMC omc autoresearch`
수용 기준:
- autoresearch: 평가기 계약 파일 검증, 최대 실행 시간에 멈춤(fixture), 결정 로그 md
- self-improve: 사용자 승인(`mis approve`) 없이는 변경을 적용하지 않는다
- scientist 에이전트(+`python_repl`), sciomc가 N개 병렬 위임. writer-memory 저장소 CRUD

### D3 배포·운영 — M, 7행
행: `OMC omc wait` · `OMC omc mission-board` · `gstack canary` · `gstack land-and-deploy` · `gstack landing-report` · `gstack setup-deploy` · `gstack gstack-detach`
수용 기준:
- setup-deploy가 승인 후 배포 설정을 쓰고, land-and-deploy는 배포 명령 전 guard ask
- canary: `mis browse`로 URL을 N회 확인해 상태 코드·콘솔 오류를 기록
- landing-report·mission-board는 읽기 전용 스냅샷 JSON. `mis wait`는 지정 시각까지 대기 후 재개. detach 프로세스는 부모 SIGTERM 후에도 남는다

### D4 iOS 실기기 계열 — M, 6행
행: `gstack ios-design-review` · `gstack ios-fix` · `gstack ios-qa` · `gstack ios-sync` · `gstack gstack-ios-qa-daemon` · `gstack gstack-ios-qa-mint`
수용 기준:
- 기기 없으면 BLOCKED. ios-sync가 템플릿 diff를 보여 주고 승인 후 갱신
- QA 데몬·mint는 기본 루프백 바인딩, tailnet 사용은 guard ask [정책]

### D5 텔레메트리·분석 — S, 7행
행: gstack preamble: 텔레메트리 (`gstack-telemetry-log`, `-sync`) · `gstack gstack-analytics` · `gstack gstack-community-dashboard` · `gstack gstack-security-dashboard` · `gstack gstack-telemetry-log` · `gstack gstack-telemetry-sync` · gstack `supabase/` (edge functions, config)
수용 기준:
- `mis telemetry on`이면 로컬 JSONL만, `sync`는 엔드포인트 설정 + guard ask 후
- `mis analytics`가 로컬 JSONL로 사용 통계를 낸다. 대시보드 조회(커뮤니티·보안)는 외부 호출이므로 ask

### D6 gbrain 계열 (한 항목) — L, 22행
행: `gstack setup-gbrain` · `gstack sync-gbrain` · `gstack gstack-artifacts-init` · `gstack gstack-artifacts-url` · `gstack gstack-brain-cache` · `gstack gstack-brain-consumer` · `gstack gstack-brain-context-load.ts` · `gstack gstack-brain-enqueue` · `gstack gstack-brain-reader` · `gstack gstack-brain-restore` · `gstack gstack-brain-sync` · `gstack gstack-brain-uninstall` · `gstack gstack-gbrain-detect` · `gstack gstack-gbrain-install` · `gstack gstack-gbrain-lib.sh` · `gstack gstack-gbrain-mcp-verify` · `gstack gstack-gbrain-repo-policy` · `gstack gstack-gbrain-source-wireup` · `gstack gstack-gbrain-supabase-provision` · `gstack gstack-gbrain-supabase-verify` · `gstack gstack-gbrain-sync.ts` · `gstack gstack-memory-ingest.ts`
수용 기준:
- `gbrain` CLI가 없으면 모든 명령 BLOCKED + 설치 안내
- push·원격 MCP·Supabase 호출마다 guard ask. `memory-ingest --probe`는 쓰기 없음. uninstall이 설정을 제거한다

### D7 디자인 이미지 생성 — S, 1행
행: gstack `design/` 바이너리 (generate·variants·compare·iterate·evolve·serve·gallery)
수용 기준:
- API 키가 없으면 BLOCKED, 호출마다 guard ask, 결과는 `design/variants/`

### D8 pair-agent — M, 1행
행: `gstack pair-agent`
수용 기준:
- 터널은 guard ask 후에만 열리고 토큰이 필요하며 `stop` 시 닫힌다 (포트 해제 확인)

## M9-E 브라우저 자격 증명·고급 (19행, M)

### E1 쿠키·헤더·검사 명령 — M, 3행
행: `gstack setup-browser-cookies` · gstack 검사 (`js`, `eval`, `css`, `attrs`, `is`, `console`, `network`, `dialog`, `cookies`, `storage`, `perf`, `inspect`, `ux-audit`, `cdp`) · gstack 쿠키·헤더 (`cookie`, `cookie-import`, `cookie-import-browser`, `header`, `useragent`)
수용 기준:
- `mis browse cookie|cookie-import|cookie-import-browser|header|useragent|cookies`는 run 여부와 무관하게 guard 항상 ask
- fixture Chromium 프로필의 쿠키를 가져와 다음 `goto`에 쓰인다. `inspect`·`ux-audit` 출력 JSON 테스트

### E2 headed·실제 Chrome·확장 — M, 6행
행: `gstack connect-chrome / open-gstack-browser` · `gstack chrome-cdp` · `gstack gstack-extension` · `gstack gstack-open-url` · gstack headed 모드 (`connect`, `disconnect`, `focus`, `state save|load`, `memory`) · gstack `extension/` (사이드패널·인스펙터·터미널)
수용 기준:
- `mis browse connect`(사용자 프로필 Chrome, CDP)는 항상 ask. `disconnect`·`focus`·`state save|load`·`memory`
- 확장 설치 도우미와 사이드바(`extension/`), URL 열기(`open`/`xdg-open`)

### E3 추출·browser skills — M, 5행
행: `gstack scrape` · `gstack skillify` · gstack 추출 (`download`, `scrape`, `archive`) · gstack browser-skills 런타임 (`skill list|show|run|test|rm`, `browser-skills/`) · gstack domain-skills (`domain-skill save|list|show|edit|promote-to-global|rollback|rm`)
수용 기준:
- `download`·`scrape`·`archive`(MHTML)는 항상 ask, 결과 파일 생성
- browser skillify가 성공한 scrape 흐름을 C3 형식 스킬로 저장하고 `skill run`이 재실행한다. domain-skills 승격·롤백

### E4 M8에서 뺀 browse 명령 — M, 5행
행: gstack 읽기 (`text`, `html`, `links`, `forms`, `accessibility`, `media`, `data`) · gstack 스타일·정리 (`style`, `style --undo`, `cleanup`, `prettyscreenshot`) · gstack 탭·프레임 (`tabs`, `tab`, `newtab`, `closetab`, `tab-each`, `frame`) · gstack 스냅샷 (`snapshot -i -c -d -s -D -a -o -C`, `@e`/`@c` 참조, 참조 만료 감지) · gstack 메타 (`chain`, `inbox`, `watch`)
수용 기준:
- `media`, `style`(+`--undo`)·`cleanup`·`prettyscreenshot`, `tab-each`, `snapshot -C`·`-H`와 `@c` 참조, `inbox`·`watch` 각각 통합 테스트

## M9-F 남은 훅 (19행, M)

### F1 서브에이전트 추적 + 상태줄 에이전트·todo — M, 3행
행: `OMC hud` · `OMC SubagentStart/Stop: subagent-tracker.mjs` · OMC HUD 상태줄 (`~/.claude/hud/omc-hud.mjs`, `dist/hud`)
수용 기준:
- SubagentStart/SubagentStop이 실행 중 에이전트 수를 기록하고 5분 이상 정체를 표시한다
- 상태줄에 `agents N`·`todo a/b`가 나온다 (statusline 단위 테스트)

### F2 산출물 확인 (SubagentStop) — S, 1행
행: `OMC SubagentStop: verify-deliverables.mjs`
수용 기준:
- 에이전트가 보고한 파일이 없으면 SubagentStop이 알림을 주입한다 (fixture)

### F3 읽기 전용 Bash 자동 허용 — S, 1행
행: `OMC PermissionRequest(Bash): permission-handler.mjs`
수용 기준:
- PermissionRequest 훅이 `ls`·`git status` 등은 허용, 메타문자·heredoc·리다이렉트가 있으면 판단 안 함 (guard 정책과 같은 표로 테스트)

### F4 pre-tool 알림 — S, 1행
행: `OMC PreToolUse: pre-tool-enforcer.mjs`
수용 기준:
- PreToolUse 알림 훅은 guard와 별도 프로세스, 오류 시 출력 없음 (fail-open 테스트)

### F5 워크플로 이탈 감지 — S, 1행
행: `OMC Stop: workflow-drift-guard.mjs`
수용 기준:
- run이 IMPLEMENTING인데 check 없이 종료하려 하면 Stop이 이유와 함께 막는다. 반복 상한 있음

### F6 opt-in 단순화 Stop — S, 1행
행: `OMC Stop: code-simplifier.mjs`
수용 기준:
- 설정이 켜졌을 때만 최근 수정 파일 목록과 함께 단순화 지시를 주입 (기본 꺼짐 테스트)

### F7 세션 종료 요약·compact TODO — S, 2행
행: `OMC PreCompact: pre-compact.mjs` · `OMC SessionEnd: session-end.mjs (요약·정리)`
수용 기준:
- SessionEnd가 세션 요약 파일을 남기고, PreCompact가 TODO 목록을 보존한다

### F8 debug 중 편집 범위 제한 — S, 1행
행: `gstack investigate: 디버그 범위 제한 훅 (Edit·Write)`
수용 기준:
- debug 단계에서 가설 범위 밖 Edit/Write는 guard ask (policy 테스트)

### F9 타임라인·세션 종류 — S, 4행
행: gstack preamble: 세션 종류·타임라인·질문 로그 (`gstack-session-kind`, `gstack-timeline-log`, `gstack-question-log`) · `gstack gstack-session-kind` · `gstack gstack-timeline-log` · `gstack gstack-timeline-read`
수용 기준:
- run 밖 이벤트가 프로젝트 타임라인 JSONL에 기록되고 `trace_timeline`이 읽는다. 세션 종류(대화형·headless·team 워커) 분류

### F10 CLAUDE.md 라우팅·선제 제안·질문 형식 — S, 3행
행: gstack preamble: proactive 제안 (`gstack-config get proactive`) · gstack preamble: CLAUDE.md `## Skill routing` 섹션 작성 · `gstack ETHOS·AskUserQuestion 형식 규율`
수용 기준:
- `mis setup routing`이 프로젝트 CLAUDE.md 라우팅 절 diff를 보여 주고 승인 후 쓴다
- SessionStart 규율에 질문 형식(재정리·추천·선택지)과 다음 스킬 제안 문구가 있다 (텍스트 테스트)

### F11 project memory 학습 확장 — S, 1행
행: `OMC PostToolUse: project-memory-posttool.mjs`
수용 기준:
- PostToolUse가 자주 읽는 경로 상위 N개를 project memory에 기록하고, 사용자 지시 문장을 directive 후보로 제안한다(자동 저장 아님)
