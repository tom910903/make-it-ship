# 원본 4종 대비 기능 격차 매트릭스 (Gap Matrix)

작성: 2026-10-20. 읽기 전용 조사 결과. 기준: OMC 4.15.6, Superpowers 6.1.1, Ponytail 5.2.0, gstack 1.58.5.0 (`~/.claude/skills/gstack`), Make It Ship `develop` @ 62df4ea.

재감사(M9-00): 2026-10-20, Make It Ship `m9-wip` @ f0c4baf (M6 상시 계층·M7 MCP 서버·M8 브라우저·팀 반영). 모든 행의 MIS 상태를 현재 코드로 다시 판정했다. 남은 PARTIAL·MISSING 행은 M9 작업 묶음(M9-A~F) 하나에 배정했고, 묶음별 행 목록과 수용 기준은 `docs/research/m9-plan.md`에 있다.

목표: Make It Ship(MIS)을 **유일한 설치 플러그인**으로 만들어 원본 4종을 대체한다. 원본의 모든 기능을 아래 표에 나열하고 MIS 기준 상태를 매긴다.

## 0. 판정 기준과 사용자 결정

| 상태 | 의미 |
|---|---|
| ABSORBED | MIS가 같은 동작을 제공한다. 근거 파일을 적었다. M6–M8의 독립 검증(PROGRESS M6-10·M7-05·M8-05)은 아직 진행 중이므로, 여기서 ABSORBED는 "`m9-wip` 코드에 그 동작이 있고 테스트가 있다"는 뜻이다(사람 확인·최종 검증 전). |
| PARTIAL | 일부만 제공한다. 빠진 부분은 "남은 작업"에 적었다. 항상 켜져 있어야 하는 동작(모든 대화에서 실행)을 MIS가 `/make-it-ship:run` 안에서만 하면 PARTIAL로 본다. |
| MISSING | 제공하지 않는다. MIS에 없는 MCP 도구는 모두 MISSING이다. 예외: 원본이 스스로 deprecated로 표시하고 CLI로 대체한 도구(`omc_run_team_*`)는 같은 동작의 MIS CLI(`mis team`)가 있으면 ABSORBED로 본다. |
| EXCLUDED-BY-USER | 사용자가 제외한 BSP 관련 기능과 알림(Slack·Discord·Telegram 전송, configure-notifications)만 해당한다. |
| N/A | 다른 호스트(Cursor·Copilot·Codex·Gemini 등) 전용 변형, 또는 원본 도구 자체의 개발·설치 내부 구조. 사유를 적었다. 사용자 확인이 필요한 항목은 "사용자 확인"이라고 표시했다. |

반영한 사용자 결정:
1. 항상 켜진 동작과 키워드 트리거를 구현한다.
2. 빠진 도구(LSP, ast-grep, python_repl, notepad, memory, state, browse 데몬, tmux 팀 워커 등)를 구현한다.
3. Spec §14.4에서 제외했던 기능(setup·doctor·mcp-setup, 스킬 관리, upgrade, 연구 루프 sciomc·scientist·autoresearch·self-improve, canary, landing-report, writer-memory, make-pdf, pair-agent, connect-chrome, setup-browser-cookies, scrape, help·gain 등)을 이제 구현한다. 단, 알림과 BSP는 계속 제외한다. 자격 증명을 다루는 기능(cookies, connect-chrome, scrape)은 포함하되 guard가 **항상** 확인을 받게 한다. npm 의존성은 이제 허용한다.
4. 다른 호스트 전용 기능은 N/A로 두고 사유를 적는다.
5. (2026-10-20, PROGRESS SPEC_CHANGES·M9 행) [정책] 외부 전송 기능도 구현한다. 단, 외부 전송마다 guard가 **항상** 확인(ask)하고 텔레메트리는 기본 꺼짐이다.
6. (2026-10-20) ralph는 접두형(`ralph:`, `/ralph`, `랄프:` 등)만 loop를 자동 시작하고, 그 밖의 언급은 모델이 판단하는 힌트(loop-hint)로 둔다. OMC와 다른 동작이지만 사용자 결정이므로 ABSORBED로 센다.

추가 표시: **[정책]** = 외부 서비스(OpenAI·Supabase·원격 터널·외부 모델 CLI 등)로 데이터를 보내는 기능이다. 조직 정책(사내 데이터는 Telechips 테넌트·GitHub·Vercel·Supabase 연동 외 타 클라우드로 업로드 금지)과 충돌할 수 있다. 사용자 결정 5에 따라 구현 대상(M9-D)이며, 외부 전송마다 guard ask, 텔레메트리 기본 꺼짐이 조건이다. 실제 전송 대상이 조직 정책에 맞는지는 사용 시점에 사용자가 확인 창에서 판단한다. 모아 둔 목록은 §6.4에 있다.

경로 약어: `phases/` = `skills/run/phases/`, `lib/` = `scripts/lib/`, `hooks.mjs` = `scripts/hooks.mjs`, `mcp/tools/` = `scripts/mcp/tools/`, `mis X` = `node scripts/mis.mjs X`.

"남은 작업" 표기: `M6 흡수`·`M7 흡수`·`M8 흡수` = 그 마일스톤에서 흡수됨. `M7: …` = 그 마일스톤에서 일부 흡수된 내용. `→ M9-X` = 남은 부분을 맡는 M9 작업 묶음(PARTIAL·MISSING 행마다 정확히 하나). 묶음 정의:
- **M9-A** 설치·수명주기 (setup·install·doctor+수리·mcp-setup·help·reference·info·config·version·upgrade·update-check·uninstall·capabilities, SessionStart init·정리, 전역 지시문 이전, 상태줄 설치 안내)
- **M9-B** 단독 계획·리뷰 스킬 (plan·spec·writing-plans·office-hours·autoplan·plan-*-review·plan-tune·document-generate·design-*·diagram·devex-review·health·context-save/restore·executing-plans·finishing-a-branch·worktree·subagent-driven-development·ai-slop-cleaner·ponytail-audit·`mis debt`·cso·release/ship VERSION·retro git 지표·learn·결정 로그·deep-dive·external-context·trace·ultragoal·ralphthon)
- **M9-C** 에이전트·스킬 작성 (빠진 OMC 에이전트, skill·skillify·learner·writing-skills)
- **M9-D** 연구·운영·배포·외부 ([정책] 항목 전부, sciomc·scientist·autoresearch·self-improve·writer-memory·canary·landing-report·setup-deploy·land-and-deploy·wait·mission-board·iOS 실기기 계열)
- **M9-E** 브라우저 자격 증명·고급 (쿠키·헤더·다운로드·scrape·connect-chrome·확장·browser-skills·domain-skills·browser skillify·inbox/watch, M8에서 뺀 browse 명령)
- **M9-F** 남은 훅 (서브에이전트 추적+상태줄 에이전트/todo, 산출물 확인, 권한 자동 허용, pre-tool 알림, 워크플로 이탈, opt-in 단순화 Stop, 세션 종료 요약, investigate 범위 제한, 타임라인·세션 종류, CLAUDE.md 라우팅 작성)

## 1. 요약 집계

아래 표 행을 스크립트로 센 값이다(셀 구분은 이스케이프되지 않은 `|`만). 행 단위는 "기능 하나"이며 키워드 변형·명령 그룹은 묶어서 한 행으로 셌다. 괄호 안은 M6 이전(62df4ea) 값이다.

| 원본 | ABSORBED | PARTIAL | MISSING | EXCLUDED-BY-USER | N/A | 합계 |
|---|---|---|---|---|---|---|
| OMC (스킬 41 + 명령 2, 에이전트 19, 훅 27, MCP 도구 58, 키워드 18, HUD·CLI 24) | 141 (9) | 26 (49) | 16 (125) | 5 (5) | 1 (1) | 189 |
| Superpowers (스킬 14 + visual companion 1, 훅·호스트 4) | 10 (3) | 6 (9) | 0 (4) | 0 | 3 (3) | 19 |
| Ponytail (스킬 6, 레벨·명령·키워드 7, 훅·상태줄·기타 13) | 16 (1) | 2 (3) | 4 (18) | 0 | 4 (4) | 26 |
| gstack (스킬 54, 훅·preamble 10, bin 74행 = 75개 파일, browse·기타 20) | 36 (7) | 45 (52) | 70 (92) | 0 | 7 (7) | 158 |
| **합계** | **203 (20)** | **79 (113)** | **90 (239)** | **5 (5)** | **15 (15)** | **392** |

M9 묶음별 남은 행(PARTIAL+MISSING 169행; M9-C 완료로 204→188, M9-F 완료로 188→169):

| 묶음 | 행 수 | 그중 [정책] |
|---|---|---|
| M9-A 설치·수명주기 | 33 | 0 |
| M9-B 단독 계획·리뷰 스킬 | 59 | 0 |
| M9-C 에이전트·스킬 작성 | 0 (16행 완료) | 0 |
| M9-D 연구·운영·배포·외부 | 58 | 39 |
| M9-E 브라우저 자격 증명·고급 | 19 | 0 |
| M9-F 남은 훅 | 0 (19행 완료) | 0 |
| **합계** | **169** | **39** |

읽는 법:
- ABSORBED가 20개에서 203개(52%)로 늘었다. M9-F(서브에이전트 추적·상태줄 에이전트/todo, 산출물 확인, 읽기 전용 자동 허용, pre-tool 알림, drift·simplifier Stop, 세션 요약·compact TODO, debug 범위, 타임라인·세션 종류, CLAUDE.md 라우팅·제안·질문 형식, hot paths) 19개와 M9-C(에이전트 11개, qa-tester tmux 조작, skill·skillify·learner·writing-skills) 16개가 더해졌다. 그 전 168개까지 늘어난 148개는 M6(상시 훅·키워드·스타일·loop·careful/freeze·상태줄) 58개, M7(MCP 도구 54개와 기억·wiki 훅) 65개, M8(브라우저·QA·팀·세션·companion·pdf) 24개, 기존 기능 재판정 1개다.
- MISSING 90개 중 58개가 M9-D(대부분 [정책] 외부 전송·gbrain 계열)이고, 나머지는 설치·업그레이드 명령, 브라우저 자격 증명 기능이다.
- PARTIAL 79개의 공통 원인은 여전히 "run 단계 지시문에만 있고 단독 명령이 없음"(M9-B 59행)이다.
- 결함 이력: M6 1~5차, M7 1~2차 검증 결함은 수정 커밋이 있으나 재검증 전이고, M8은 아직 검증 보고서가 없다. 재검증에서 특정 기능의 결함이 남으면 그 행을 PARTIAL로 되돌린다.

## 2. OMC (oh-my-claudecode 4.15.6)

경로: `~/.claude/plugins/cache/omc/oh-my-claudecode/4.15.6/`

### 2.1 스킬 (41개, `skills/`) 및 추가 명령 (`commands/`)

| 원본 | 기능 | 종류 | 한 줄 설명 | MIS 상태 | MIS 대응 위치 | 남은 작업 |
|---|---|---|---|---|---|---|
| OMC | ai-slop-cleaner | skill | 삭제 우선·회귀 안전 방식으로 AI 슬롭 코드를 정리한다. 리뷰 전용 모드가 있다. | PARTIAL | `phases/simplify.md`, `deslop` 키워드 (`lib/keywords.mjs`, M6) | M6: 키워드 흡수. 남음: 단독 명령, 리뷰 전용 모드, 저장소 전체 대상 정리 → M9-B |
| OMC | ask | skill | `omc ask`로 Claude·Codex·Gemini 등 다른 모델에 자문하고 결과 파일을 남긴다. | PARTIAL | `mis second-opinion detect`, `mis note second-opinion` (`lib/commands.mjs`) | 남음: 실제 호출 실행기와 결과 파일 저장, 호출마다 guard ask [정책] → M9-D |
| OMC | autopilot | skill | 아이디어부터 동작하는 코드까지 자율 실행한다. | ABSORBED | `skills/run/SKILL.md`, `autopilot` 키워드 (M6), 지속은 `/make-it-ship:loop` (`lib/loop.mjs`) | M6 흡수. 지속 실행은 loop로 감싼다(OMC처럼 autopilot 자체가 Stop을 막지는 않음) |
| OMC | autoresearch | skill | 평가 계약·결정 로그·최대 실행 시간이 있는 단일 목표 개선 루프. | MISSING | — | 평가기 계약, 반복 루프, 시간 제한 중단 → M9-D |
| OMC | cancel | skill | 활성 OMC 모드(autopilot·ralph·ultrawork·ultraqa·team 등)를 모두 취소한다. | PARTIAL | `skills/cancel/SKILL.md`, `mis loop cancel`, `mis cancel` (run+loop), `cancelomc` 키워드 (M6) | M6: loop·run 취소 흡수. 남음: `mis team shutdown`과 merge-readiness 등 다른 활성 모드까지 한 번에 정리 → M9-A |
| OMC | ccg | skill | Codex·Gemini 결과를 받아 Claude가 종합한다. | PARTIAL | `ccg` 키워드 (M6), `phases/review.md` second opinion 절 | M6: 키워드만. 남음: 두 모델 호출 실행기와 종합 절차, 호출마다 guard ask [정책] → M9-D |
| OMC | configure-notifications | skill | Telegram·Discord·Slack 알림을 설정한다. | EXCLUDED-BY-USER | — | 없음 (알림 제외) |
| OMC | debug | skill | 로그·trace·상태로 현재 OMC 세션·저장소 상태를 진단한다. | PARTIAL | `mis status`, `mis doctor`, `trace_timeline`/`trace_summary` (훅 기록, M7) | M7: 훅·run 기록 조회 흡수. 남음: 세션·모드·훅 상태를 한 번에 진단하는 명령 → M9-A |
| OMC | deep-dive | skill | trace(원인 조사) 결과를 deep-interview에 주입하는 2단계 파이프라인. | PARTIAL | `phases/debug.md`, `phases/interview.md` (따로 존재) | 두 단계 연결과 3지점 주입 → M9-B |
| OMC | deep-interview | skill | 모호성 점수로 실행 승인을 막는 소크라테스식 인터뷰. | ABSORBED | `phases/interview.md`, `skills/interview/SKILL.md`, `deep interview` 키워드 (M6) | — |
| OMC | deepinit | skill | 계층형 `AGENTS.md` 문서를 만들어 코드베이스를 초기화한다. | PARTIAL | `agents/explorer.md`, `deepinit_manifest` (M7) | M7: 매니페스트 도구. 남음: 계층형 `AGENTS.md` 생성 스킬 → M9-B |
| OMC | external-context | skill | document-specialist 여러 개로 외부 문서를 병렬 검색한다. | PARTIAL | `phases/discover.md` (context7 있으면 사용) | 병렬 외부 문서 조사 절차 → M9-B |
| OMC | hud | skill | HUD 상태줄의 레이아웃·프리셋·표시 요소를 설정한다. | ABSORBED | `scripts/statusline.mjs` (스타일·loop·freeze·에이전트 수·todo·브랜치·모델·ctx, 체이닝) | M6+M9-F 흡수: `agents N (k stale)`·`todo a/b` 추가(F1). 요소 선택·프리셋은 만들지 않음(`statusLine.chain`으로 다른 상태줄 병행) |
| OMC | learner | skill | 현재 대화에서 재사용 가능한 스킬을 추출한다. | ABSORBED | `skills/skillify/SKILL.md` (learner 모드), `mis skill add` (`lib/commands-skill.mjs`) | M9-C 흡수. 대화의 교훈을 learned skill(SKILL.md+triggers)로 추출. learner는 skillify 스킬에 합침 |
| OMC | local-build-reminder | skill | OMC 포크에서 TypeScript를 고친 뒤 재빌드를 알린다. | N/A | — | OMC 개발용 포크 전용이고 MIS에는 빌드 단계가 없다. 사용자 확인 |
| OMC | mcp-setup | skill | 자주 쓰는 MCP 서버를 설정한다. | MISSING | — | MCP 서버 등록 마법사 → M9-A |
| OMC | merge-readiness | skill | 상태 기반 머지 준비 보고서와 설명 가능성 퀴즈. | ABSORBED | `mis ship`, `merge_readiness_*` 5개 (퀴즈 포함, `mcp/tools/knowledge.mjs`, M7) | M7 흡수 |
| OMC | omc-doctor | skill | OMC 설치 문제를 진단하고 고친다. | PARTIAL | `mis doctor` (`lib/setup.mjs`) | 플러그인·훅·MCP·상태줄 설치 진단과 자동 수리 → M9-A |
| OMC | omc-reference | skill | 에이전트 목록·도구·팀 파이프라인·커밋 규칙 참고서 (위임 시 자동 로드). | PARTIAL | SessionStart 스킬 목록 (`lib/discipline.mjs`, M6), README | M6: 스킬 목록만. 남음: 에이전트·도구·키워드 참고 스킬 → M9-A |
| OMC | omc-setup | skill | 플러그인·npm·로컬 개발 설치를 설치·갱신한다. | PARTIAL | `mis init` (프로젝트 설정만) | 전역 설치: 훅·상태줄·CLAUDE.md 블록 갱신 → M9-A |
| OMC | omc-teams | skill | tmux 창에 claude·codex·gemini CLI 워커를 띄워 병렬 실행한다. | ABSORBED | `mis team start --worker claude\|codex\|gemini` (tmux, `lib/commands-team.mjs`, M8) | M8 흡수. codex·gemini 워커는 guard ask |
| OMC | plan | skill | 인터뷰 포함 전략 계획. `--consensus`·`--review` 모드. | PARTIAL | `phases/plan.md` (run 안), `/make-it-ship:plan-review` | 단독 계획 명령과 계획 문서 출력 → M9-B |
| OMC | project-session-manager | skill | 이슈·PR·기능별 worktree 개발 환경 관리 (tmux 선택). | ABSORBED | `mis session create\|list\|remove`, `skills/session/SKILL.md` (M8) | M8 흡수 |
| OMC | ralph | skill | 검증자가 통과시킬 때까지 스스로 반복하는 루프. | ABSORBED | `skills/loop/SKILL.md`, `mis loop`, Stop 훅 (`lib/loop.mjs`), 접두형 키워드 (M6) | M6 흡수. 사용자 결정으로 접두형만 자동 시작, 그 밖의 언급은 loop-hint (OMC와 다름) |
| OMC | ralplan | skill | Planner·Architect·Critic 합의 계획. 모호한 실행 요청을 자동으로 계획 단계로 돌린다. | PARTIAL | `phases/design.md`, `phases/plan-critique.md`, `ralplan` 키워드 → plan-review 반복 (M6) | M6: 키워드·합의 반복 흡수. 남음: 모호한 실행 요청 자동 게이트 → M9-B |
| OMC | release | skill | 저장소 릴리스 규칙을 분석·캐시하고 릴리스를 안내한다. | PARTIAL | `phases/ship.md`, `mis ship` (체인지로그·체크리스트 초안) | 릴리스 규칙 분석·캐시, 태그·배포 절차 → M9-B |
| OMC | remember | skill | 지식을 project memory·notepad·문서 중 어디에 둘지 정한다. | ABSORBED | `notepad_*`, `project_memory_*`, `wiki_*`, `<remember>` 태그 (M7) | M7 흡수 |
| OMC | sciomc | skill | scientist 에이전트를 병렬로 돌려 분석한다. | MISSING | — | 병렬 분석 오케스트레이션 → M9-D |
| OMC | self-improve | skill | 토너먼트 선택 방식의 자율 진화 코드 개선. | MISSING | — | 토너먼트 개선 루프, 적용 전 사용자 승인 → M9-D |
| OMC | setup | skill | setup·doctor·MCP 요청을 알맞은 흐름으로 보낸다. | MISSING | — | setup·doctor·mcp-setup 라우터 → M9-A |
| OMC | skill | skill | 로컬 스킬 목록·추가·삭제·검색·편집. | ABSORBED | `skills/skill/SKILL.md`, `mis skill list\|search\|add\|edit\|remove\|lint` (`lib/commands-skill.mjs`, `lib/skills.mjs`) | M9-C 흡수. 프로젝트·사용자 위치만 쓰고 플러그인 스킬은 읽기 전용. setup 마법사는 없음 |
| OMC | skillify | skill | 반복 작업을 재사용 스킬 초안으로 만든다. | ABSORBED | `skills/skillify/SKILL.md`, `mis skill add`, `mis test-prompt`로 triggers 확인 | M9-C 흡수. 만든 SKILL.md의 triggers가 `learnedSkills`에 매칭됨(테스트) |
| OMC | team | skill | 공유 task 목록으로 N개 에이전트를 단계별로 조율한다. | ABSORBED | `skills/team/SKILL.md` (plan→exec→verify→fix), `mis team` (M8) | M8 흡수 |
| OMC | trace | skill | 경쟁 가설을 여러 tracer로 동시에 검증한다. | PARTIAL | `phases/debug.md`, `trace_timeline`/`trace_summary` (M7, 실행 기록용) | 남음: 경쟁 가설 병렬 추적 스킬 → M9-B |
| OMC | ultragoal | skill | 여러 목표의 계획·원장을 `.omc/ultragoal`에 저장하고 `/goal` 인계문을 출력한다. | PARTIAL | `plan.json` task, `ultragoal` 키워드 → run + loop (M6) | M6: 키워드 흡수. 남음: 다중 목표 원장, `/goal` 인계문 → M9-B |
| OMC | ultraqa | skill | 테스트→검증→수정을 목표 달성까지 반복한다. | ABSORBED | `phases/verify.md`, `phases/debug.md`, `mis task retry` (rootcause 필수) | — |
| OMC | ultrawork | skill | 최대 병렬 실행 엔진. | ABSORBED | `ulw` 키워드 → 병렬 위임 지시 (M6), `phases/parallel.md` | M6 흡수 |
| OMC | verify | skill | 완료 주장 전에 실제로 동작하는지 확인한다. | ABSORBED | `mis check`, `mis verdict`, SessionStart 검증 규율 (M6) | — |
| OMC | visual-verdict | skill | 스크린샷을 기준 이미지와 비교해 구조화된 판정을 낸다. | ABSORBED | `mis visual-verdict` (0~100 점수, 90 통과, `lib/commands-browse.mjs`, M8) | M8 흡수 |
| OMC | wiki | skill | 세션을 넘어 쌓이는 마크다운 지식베이스. | ABSORBED | `wiki_*` 7개, wiki 키워드, SessionStart·PreCompact·SessionEnd 훅 (M7) | M7 흡수 |
| OMC | writer-memory | skill | 소설가용 인물·관계·장면 기억 시스템. | MISSING | — | 인물·관계·장면 기억 저장소 → M9-D |
| OMC | compact | command | 수동 `/compact` 전에 OMC 맥락을 정리한다. | ABSORBED | PreCompact 훅 + compact 후 SessionStart 재주입 (`hooks.mjs`, M7) | M7 흡수 (명령의 일인 compact 전 맥락 정리를 훅이 자동 처리. TODO 체크포인트는 pre-compact.mjs 행) |
| OMC | psm | command | project-session-manager 별칭. | ABSORBED | `mis session` (M8) | M8 흡수 |

### 2.2 에이전트 (19개, `agents/`)

| 원본 | 기능 | 종류 | 한 줄 설명 | MIS 상태 | MIS 대응 위치 | 남은 작업 |
|---|---|---|---|---|---|---|
| OMC | analyst | agent | 계획 전 요구사항 분석 (Opus). | ABSORBED | `agents/analyst.md` | M9-C 흡수. 역할에 맞는 최소 도구 허용목록, 증거 규칙(`mis check`·실제 명령 출력) 포함 |
| OMC | architect | agent | 설계·디버깅 자문 (읽기 전용). | ABSORBED | `agents/architect.md` | — |
| OMC | code-reviewer | agent | 심각도별 종합 코드 리뷰. | ABSORBED | `agents/spec-reviewer.md`, `agents/quality-reviewer.md` | — |
| OMC | code-simplifier | agent | 기능을 유지하며 코드를 단순화한다. | ABSORBED | `agents/code-simplifier.md` | M9-C 흡수. 역할에 맞는 최소 도구 허용목록, 증거 규칙(`mis check`·실제 명령 출력) 포함 |
| OMC | critic | agent | 계획·코드 비판 검토 (Opus). | ABSORBED | `agents/critic.md` | — |
| OMC | debugger | agent | 근본 원인 분석, 회귀 격리, 빌드 오류 해결. | ABSORBED | `agents/debugger.md` | M9-C 흡수. 역할에 맞는 최소 도구 허용목록, 증거 규칙(`mis check`·실제 명령 출력) 포함 |
| OMC | designer | agent | UI/UX 설계·구현. | ABSORBED | `agents/designer.md` | M9-C 흡수. 역할에 맞는 최소 도구 허용목록, 증거 규칙(`mis check`·실제 명령 출력) 포함 |
| OMC | document-specialist | agent | 외부 문서·레퍼런스 조사. | ABSORBED | `agents/document-specialist.md` | M9-C 흡수. 역할에 맞는 최소 도구 허용목록, 증거 규칙(`mis check`·실제 명령 출력) 포함 |
| OMC | executor | agent | 구현 작업 실행 (Sonnet). | ABSORBED | `agents/executor.md` | M9-C 흡수. 역할에 맞는 최소 도구 허용목록, 증거 규칙(`mis check`·실제 명령 출력) 포함 |
| OMC | explore | agent | 파일·코드 패턴 탐색. | ABSORBED | `agents/explorer.md` | — |
| OMC | git-master | agent | 원자적 커밋·rebase·이력 관리. | ABSORBED | `agents/git-master.md` | M9-C 흡수. 역할에 맞는 최소 도구 허용목록, 증거 규칙(`mis check`·실제 명령 출력) 포함 |
| OMC | planner | agent | 인터뷰 포함 전략 계획 (Opus). | ABSORBED | `agents/planner.md` | M9-C 흡수. 역할에 맞는 최소 도구 허용목록, 증거 규칙(`mis check`·실제 명령 출력) 포함 |
| OMC | qa-tester | agent | tmux로 CLI를 실제 조작해 테스트한다. | ABSORBED | `agents/qa-tester.md` + `mis tty start\|send\|keys\|expect\|capture\|save\|stop` (`lib/commands-tty.mjs`) | M9-C 흡수. tmux로 대화형 CLI를 조작하고 `qa/*.sh` 재생 스크립트를 남김. tmux 없으면 BLOCKED |
| OMC | scientist | agent | 데이터 분석·연구 실행. | MISSING | — | 분석 에이전트 (`python_repl`은 M7에 있음) → M9-D |
| OMC | security-reviewer | agent | OWASP·비밀값·위험 패턴 탐지. | ABSORBED | `agents/security-reviewer.md` | — |
| OMC | test-engineer | agent | 테스트 전략, e2e, flaky 테스트 보강, TDD. | ABSORBED | `agents/test-engineer.md` | M9-C 흡수. 역할에 맞는 최소 도구 허용목록, 증거 규칙(`mis check`·실제 명령 출력) 포함 |
| OMC | tracer | agent | 경쟁 가설 기반 인과 추적. | ABSORBED | `agents/tracer.md` | M9-C 흡수. 역할에 맞는 최소 도구 허용목록, 증거 규칙(`mis check`·실제 명령 출력) 포함 |
| OMC | verifier | agent | 완료 증거 검증. | ABSORBED | `mis verdict` (기계 판정, 원본보다 강함) | — |
| OMC | writer | agent | README·API 문서·주석 작성 (Haiku). | ABSORBED | `agents/writer.md` | M9-C 흡수. 역할에 맞는 최소 도구 허용목록, 증거 규칙(`mis check`·실제 명령 출력) 포함 |

### 2.3 훅 (`hooks/hooks.json`, 이벤트별 스크립트)

MIS `hooks/hooks.json`은 PreToolUse(`scripts/guard.mjs`, fail-closed)와 상시 훅 8개(SessionStart, SubagentStart, UserPromptSubmit, Stop, PostToolUse, PostToolUseFailure, PreCompact, SessionEnd → `scripts/hooks.mjs`, fail-open)를 등록한다(M6·M7). SubagentStop·PermissionRequest 훅은 아직 없다.

| 원본 | 기능 | 종류 | 한 줄 설명 | MIS 상태 | MIS 대응 위치 | 남은 작업 |
|---|---|---|---|---|---|---|
| OMC | UserPromptSubmit: keyword-detector.mjs | hook | 프롬프트에서 매직 키워드(§2.5)를 찾아 해당 스킬·모드를 주입한다. 사용자 비활성 키워드 목록, 충돌 해결. | ABSORBED | `hooks.mjs` UserPromptSubmit, `lib/keywords.mjs` (M6) | M6 흡수 |
| OMC | UserPromptSubmit: skill-injector.mjs | hook | 학습된 스킬(하위 디렉터리 포함)을 프롬프트 트리거에 맞춰 주입한다. | ABSORBED | `lib/keywords.mjs` `learnedSkills` (`.make-it-ship/skills`, `~/.make-it-ship/skills`, M6) | M6 흡수 |
| OMC | SessionStart: session-start.mjs (모드 복원) | hook | 세션 시작 시 지속 모드(ralph 등) 상태를 복원하고 남은 상태를 정리한다. | ABSORBED | `hooks.mjs` SessionStart (활성 run·loop·freeze 안내, M6) | M6 흡수 |
| OMC | SessionStart: session-start.mjs (업데이트 확인·캐시 정리) | hook | 24시간 캐시로 새 버전을 확인하고 오래된 플러그인 캐시를 정리한다. | MISSING | — | MIS 자체 업데이트 확인(24시간 캐시) → M9-A |
| OMC | SessionStart: session-start.mjs (알림 전송) | hook | 세션 시작 알림을 보낸다. | EXCLUDED-BY-USER | — | 없음 |
| OMC | SessionStart: project-memory-session.mjs | hook | 프로젝트 환경을 자동 감지하고 project memory를 주입한다. | ABSORBED | `hooks.mjs` SessionStart `projectEnsure` + 주입 (`lib/memory.mjs`, M7) | M7 흡수 |
| OMC | SessionStart: wiki-session-start.mjs | hook | wiki 맥락과 관련 페이지를 주입하고 색인을 재구성한다. | ABSORBED | `lib/wiki.mjs` `wikiSessionContext` (M7) | M7 흡수 |
| OMC | SessionStart(init): setup-init.mjs | hook | `.omc` 디렉터리 구조 생성, 설정 검증, 환경 설정. | PARTIAL | `mis init` (수동), 상태 디렉터리 지연 생성, SessionStart 프로젝트 감지 (M7) | M7: 감지만. 남음: 최초 설치 초기화·설정 검증 → M9-A |
| OMC | SessionStart(maintenance): setup-maintenance.mjs | hook | 오래된 상태 파일 정리, 고아 상태 정리, SQLite vacuum. | PARTIAL | SessionStart `pruneSessions` (`lib/posttool.mjs`, M6) | M6: 세션 파일 정리만. 남음: 오래된 run·모드·브라우저 상태 정리 → M9-A |
| OMC | PreToolUse: pre-tool-enforcer.mjs | hook | 모든 도구 실행 전에 상황별 알림(위임·모델 라우팅 등)을 주입한다. | ABSORBED | `hooks.mjs` PreToolUse (guard와 별도 항목·프로세스) | M9-F 흡수(F4): Agent 호출 시 산출물 파일 명시 알림(세션 1회)·실행 중 4개 이상 대기 알림, `git commit` 시 열린 todo 알림. 결정은 내지 않고 오류 시 출력 없음 |
| OMC | PermissionRequest(Bash): permission-handler.mjs | hook | 안전한 읽기 전용 Bash를 자동 허용한다 (메타문자·heredoc 검사). | ABSORBED | `hooks.mjs` PermissionRequest → `lib/readonly.mjs` | M9-F 흡수(F3): guard가 run 유무 모두 allow + 같은 shell 파서로 단일 읽기 전용 명령 + 사용자 `permissions.ask` 미해당일 때만 allow. 메타문자·heredoc·리다이렉트·래퍼·대입은 판단 안 함. guard 테스트의 ask/deny 문자열 전부 자동 허용 안 됨을 테스트 |
| OMC | PostToolUse: post-tool-verifier.mjs | hook | 도구 결과를 보고 검증 알림을 주고 `<remember>` 태그를 notepad에 저장한다. | ABSORBED | `hooks.mjs` PostToolUse 편집 후 검증 알림 (M6), `<remember>` 처리 (M7) | M6·M7 흡수 |
| OMC | PostToolUse: project-memory-posttool.mjs | hook | 도구 출력에서 project memory를 학습·갱신한다. | ABSORBED | `hooks.mjs` PostToolUse/SessionEnd/UserPromptSubmit, `lib/tracking.mjs`, `lib/memory.mjs` | M7+M9-F 흡수(F11): Read 경로를 세션에서 세고 SessionEnd에 상위 10개를 `hotPaths`로 기록(`often read`로 주입). 지시 감지는 UserPromptSubmit에서 하고 directive 후보로 제안만(자동 저장 안 함) |
| OMC | PostToolUse: post-tool-rules-injector.mjs | hook | 파일 접근 시 관련 규칙 파일(`.claude/rules`, `~/.claude/rules` 등)을 세션당 한 번 주입한다. | ABSORBED | `hooks.mjs` PostToolUse, `lib/posttool.mjs` `matchingRules` (M6) | M6 흡수 (`.claude/rules`는 Claude Code가 직접 로드) |
| OMC | PostToolUseFailure: post-tool-use-failure.mjs | hook | 도구 실패와 재시도 횟수를 기록해 Stop 훅에 넘긴다. | ABSORBED | `hooks.mjs` PostToolUseFailure (3회 반복 실패 시 근본 원인 안내, M6) | M6 흡수 |
| OMC | SubagentStart/Stop: subagent-tracker.mjs | hook | 서브에이전트 생성·종료 추적, 5분 이상 정체 감지, HUD 표시, 고아 정리. | ABSORBED | `hooks.mjs` SubagentStart/SubagentStop, `lib/tracking.mjs` | M9-F 흡수(F1): 에이전트별 파일로 실행 중 수 기록, 5분 이상 stale 표시, 6시간 넘은 고아는 세지 않음, SessionEnd에 정리 |
| OMC | SubagentStop: verify-deliverables.mjs | hook | 완료한 에이전트가 기대 산출물을 실제로 만들었는지 확인한다. | ABSORBED | `hooks.mjs` SubagentStop, `lib/tracking.mjs` `missingDeliverables` | M9-F 흡수(F2): 보고에서 created/wrote/saved 등으로 언급한 저장소 안 파일이 없으면 그 서브에이전트를 1회 block(이유 포함). `stop_hook_active`면 다시 막지 않음 |
| OMC | PreCompact: pre-compact.mjs | hook | compact 전에 활성 모드·TODO·notepad 지혜를 체크포인트로 남긴다. | ABSORBED | `hooks.mjs` PreCompact·SessionStart(compact), `lib/tracking.mjs` `todoBlock` | M7+M9-F 흡수(F7): 우선 노트·지시·run·loop에 더해 열린 todo 목록 보존 |
| OMC | PreCompact: project-memory-precompact.mjs | hook | 사용자 지시·프로젝트 맥락을 compact 후에도 남긴다. | ABSORBED | `preCompactContext` 지시 보존 + compact 후 프로젝트 블록 재주입 (M7) | M7 흡수 |
| OMC | PreCompact: wiki-pre-compact.mjs | hook | wiki 요약을 compact 후에도 남긴다. | ABSORBED | `lib/wiki.mjs` `wikiPreCompact` (M7) | M7 흡수 |
| OMC | Stop: context-guard-stop.mjs | hook | 컨텍스트 사용률이 기준(기본 75%)을 넘으면 세션 갱신을 제안한다. | ABSORBED | `hooks.mjs` Stop (75% 이상 경고, `lib/context.mjs`, M6) | M6 흡수 |
| OMC | Stop: workflow-drift-guard.mjs | hook | 결정적 신호로 워크플로 이탈을 감지해 Stop을 막는다. | ABSORBED | `hooks.mjs` Stop, `lib/tracking.mjs` `driftDecision` | M9-F 흡수(F5): run EXECUTING + 이 세션이 편집함 + 현재 트리에 증거 없음 → 이유와 함께 block, run당 2회 상한. 우선순위: loop > drift > simplifier > ctx 경고 |
| OMC | Stop: persistent-mode.mjs | hook | ralph·autopilot·ultrawork·team 등 모드에서 작업이 끝나기 전 종료를 막는다 ("The boulder never stops"). | ABSORBED | `hooks.mjs` Stop + `lib/loop.mjs` (M6) | M6 흡수. 지속 대상은 loop 하나(autopilot·ultragoal은 loop로 감쌈, ultrawork·team은 자체 대기) |
| OMC | Stop: code-simplifier.mjs | hook | (opt-in) 최근 수정 파일을 code-simplifier에 넘긴다. | ABSORBED | `hooks.mjs` Stop, `lib/tracking.mjs` `simplifyDecision` | M9-F 흡수(F6): `simplifier.enabled: true`일 때만, 편집 파일 집합당 1회, 재진입 Stop에서는 안 함. loop·drift가 먼저 |
| OMC | SessionEnd: session-end.mjs (요약·정리) | hook | 세션 요약과 상태 정리를 비동기로 한다. | ABSORBED | `hooks.mjs` SessionEnd (wiki 세션 로그 + 요약 + 정리) | M7+M9-F 흡수(F7): `.git/make-it-ship/session-summaries/<id>.md`(편집 파일·열린 todo·run·많이 읽은 파일), 에이전트 추적 정리, hotPaths 반영. 비동기는 아님(작은 동기 쓰기) |
| OMC | SessionEnd: session-end.mjs (알림 전송) | hook | 세션 종료 알림 콜백(Telegram·Discord·Slack). | EXCLUDED-BY-USER | — | 없음 |
| OMC | SessionEnd: wiki-session-end.mjs | hook | 세션 메타데이터를 wiki에 추가 기록한다. | ABSORBED | `lib/wiki.mjs` `wikiSessionEnd` (M7) | M7 흡수 |

### 2.4 MCP 도구 (`bridge/mcp-server.cjs`, 서버 이름 `t`, 54개) 및 팀 MCP (`bridge/team-mcp.cjs`, 4개)

도구 이름은 `mcp-server.cjs`의 `name: "…"` 정의에서 뽑았다 (`clangd`·`gopls`·`invalid`·`t`·`team`은 도구가 아니라 제외). 플러그인 `.mcp.json`은 `t` 서버만 등록한다. `team-mcp.cjs`는 `docs/REFERENCE.md`에 수동 등록 예시만 있고 4개 도구 모두 **Deprecated**(`omc team` CLI로 대체)로 표시되어 있다. MIS는 플러그인 `.mcp.json`으로 MCP 서버 `mis`(`scripts/mcp/server.mjs`, 도구 54개)를 번들한다(M7). 도구 이름은 `mcp__plugin_make-it-ship_mis__<이름>`이며, 스킬 도구 3개는 `list_skills`·`load_skills_local`·`load_skills_global`로 이름이 다르다. 팀 MCP 4개는 원본처럼 CLI(`mis team`, M8)로 대체했다.

| 원본 | 기능 | 종류 | 한 줄 설명 | MIS 상태 | MIS 대응 위치 | 남은 작업 |
|---|---|---|---|---|---|---|
| OMC | lsp_hover | mcp-tool | 위치의 타입·문서 정보 | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 (설치된 언어 서버 사용, 없으면 설치 안내) |
| OMC | lsp_goto_definition | mcp-tool | 정의로 이동 | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 |
| OMC | lsp_find_references | mcp-tool | 참조 찾기 | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 |
| OMC | lsp_document_symbols | mcp-tool | 파일 심볼 목록 | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 |
| OMC | lsp_workspace_symbols | mcp-tool | 작업공간 심볼 검색 | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 |
| OMC | lsp_diagnostics | mcp-tool | 파일 진단(오류·경고) | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 |
| OMC | lsp_diagnostics_directory | mcp-tool | 디렉터리 전체 진단 | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 |
| OMC | lsp_servers | mcp-tool | 사용 가능한 언어 서버 목록 (clangd·gopls 등) | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 |
| OMC | lsp_prepare_rename | mcp-tool | 이름 변경 가능 여부 확인 | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 |
| OMC | lsp_rename | mcp-tool | 심볼 이름 변경 | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 |
| OMC | lsp_code_actions | mcp-tool | 코드 액션 목록 | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 |
| OMC | lsp_code_action_resolve | mcp-tool | 코드 액션 적용 | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 |
| OMC | ast_grep_search | mcp-tool | AST 패턴 검색 | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 (`ast-grep` CLI 필요, 없으면 설치 안내) |
| OMC | ast_grep_replace | mcp-tool | AST 패턴 치환 | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 (`ast-grep` CLI 필요, `apply: true`일 때만 쓰기) |
| OMC | python_repl | mcp-tool | 지속형 Python REPL (`gyoshu_bridge.py`) | ABSORBED | `mcp/tools/code.mjs` | M7 흡수 (`python3` 사용) |
| OMC | notepad_read | mcp-tool | notepad 읽기 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | notepad_write_priority | mcp-tool | 우선 맥락 기록 (세션 시작 시 주입) | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | notepad_write_working | mcp-tool | 작업 기억 기록 (7일) | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | notepad_write_manual | mcp-tool | 수동 영구 기록 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | notepad_prune | mcp-tool | 오래된 항목 정리 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | notepad_stats | mcp-tool | notepad 통계 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | project_memory_read | mcp-tool | 프로젝트 기억 읽기 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | project_memory_write | mcp-tool | 프로젝트 기억 쓰기 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | project_memory_add_note | mcp-tool | 메모 추가 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | project_memory_add_directive | mcp-tool | 사용자 지시 추가 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | state_read | mcp-tool | 모드 상태 읽기 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | state_write | mcp-tool | 모드 상태 쓰기 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | state_clear | mcp-tool | 모드 상태 삭제 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | state_list_active | mcp-tool | 활성 모드 목록 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | state_get_status | mcp-tool | 모드 상태 요약 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | shared_memory_read | mcp-tool | 에이전트 간 공유 메모리 읽기 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | shared_memory_write | mcp-tool | 공유 메모리 쓰기 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | shared_memory_list | mcp-tool | 공유 메모리 목록 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | shared_memory_delete | mcp-tool | 공유 메모리 삭제 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | shared_memory_cleanup | mcp-tool | 만료 항목 정리 | ABSORBED | `mcp/tools/memory.mjs` | M7 흡수 |
| OMC | session_search | mcp-tool | 과거 세션 기록 검색 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | trace_timeline | mcp-tool | 훅·에이전트 실행 흐름 타임라인 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | trace_summary | mcp-tool | 실행 흐름 요약 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | wiki_add | mcp-tool | wiki 페이지 추가 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | wiki_read | mcp-tool | wiki 페이지 읽기 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | wiki_query | mcp-tool | wiki 검색 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | wiki_list | mcp-tool | wiki 목록 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | wiki_delete | mcp-tool | wiki 페이지 삭제 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | wiki_ingest | mcp-tool | 문서를 wiki로 수집 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | wiki_lint | mcp-tool | wiki 링크·형식 점검 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | merge_readiness_start | mcp-tool | 머지 준비 세션 시작 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | merge_readiness_set_content | mcp-tool | 보고 내용 설정 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | merge_readiness_record_answer | mcp-tool | 퀴즈 답 기록 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | merge_readiness_report | mcp-tool | 머지 준비 보고서 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | merge_readiness_cancel | mcp-tool | 머지 준비 취소 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | deepinit_manifest | mcp-tool | deepinit용 디렉터리 매니페스트 | ABSORBED | `mcp/tools/knowledge.mjs` | M7 흡수 |
| OMC | list_omc_skills | mcp-tool | 스킬 목록 | ABSORBED | `mcp/tools/skills.mjs` | M7 흡수 (이름 `list_skills`) |
| OMC | load_omc_skills_local | mcp-tool | 프로젝트 로컬 스킬 로드 | ABSORBED | `mcp/tools/skills.mjs` | M7 흡수 (이름 `load_skills_local`) |
| OMC | load_omc_skills_global | mcp-tool | 전역 스킬 로드 | ABSORBED | `mcp/tools/skills.mjs` | M7 흡수 (이름 `load_skills_global`) |
| OMC | omc_run_team_start | mcp-tool | (team-mcp, deprecated) 팀 시작 | ABSORBED | `mis team start` (M8) | M8 흡수 (원본도 deprecated로 CLI 대체, §0 참고) |
| OMC | omc_run_team_status | mcp-tool | (team-mcp, deprecated) 팀 상태 | ABSORBED | `mis team status` (M8) | M8 흡수 (CLI 대체) |
| OMC | omc_run_team_wait | mcp-tool | (team-mcp, deprecated) 팀 대기 | ABSORBED | `mis team wait` (M8) | M8 흡수 (CLI 대체) |
| OMC | omc_run_team_cleanup | mcp-tool | (team-mcp, deprecated) 팀 정리 | ABSORBED | `mis team shutdown` (M8) | M8 흡수 (CLI 대체) |

### 2.5 키워드 트리거 (`scripts/keyword-detector.mjs`)

모두 UserPromptSubmit 훅이 프롬프트를 검사해 동작한다. 한국어·일본어 변형(예: 랄프, 오토파일럿, 울트라워크, 딥인터뷰, 코드 리뷰, 보안 리뷰, 딥 서치)이 포함된다. MIS는 `hooks.mjs` UserPromptSubmit + `lib/keywords.mjs`로 전 키워드를 처리한다(M6, 한국어·일본어 변형, 인용·코드·URL·질문 제외, `mis test-prompt`로 확인).

| 원본 | 기능 | 종류 | 한 줄 설명 | MIS 상태 | MIS 대응 위치 | 남은 작업 |
|---|---|---|---|---|---|---|
| OMC | cancelomc / stopomc | keyword | 활성 모드 취소 | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수 |
| OMC | ralph (랄프) | keyword | ralph 지속 모드 시작 | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수. 접두형(`ralph:`, `/ralph`, `랄프:` 등)만 loop 시작, 나머지 언급은 loop-hint (사용자 결정) |
| OMC | autopilot / "build me a…" / "I want a…" / "handle it all" / "end to end" / "e2e this" (오토파일럿) | keyword | autopilot 시작 | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수 (run으로 라우팅) |
| OMC | ultragoal | keyword | ultragoal 시작 (명시적일 때만) | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수 |
| OMC | ultrawork / ulw / uw (울트라워크) | keyword | 병렬 실행 모드 | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수 |
| OMC | ccg / claude-codex-gemini (씨씨지) | keyword | 3모델 종합 | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수 (키워드만; 실행기는 ask 행) |
| OMC | ralplan (랄플랜) | keyword | 합의 계획 | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수 |
| OMC | deep interview / ouroboros (딥인터뷰) | keyword | 심층 인터뷰 | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수 |
| OMC | ai slop / anti-slop / deslop (+ 정리 동사·냄새 단어 조합) | keyword | ai-slop-cleaner 실행 | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수 |
| OMC | tdd / test first / red green (테스트 퍼스트) | keyword | TDD 모드 | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수 |
| OMC | code review / review code (코드 리뷰) | keyword | 코드 리뷰 | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수 |
| OMC | security review (보안 리뷰) | keyword | 보안 리뷰 | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수 |
| OMC | ultrathink / think hard / think deeply (울트라씽크) | keyword | 깊은 추론 지시 주입 | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수 |
| OMC | deepsearch / "search the codebase" / "find in codebase" (딥 서치) | keyword | 코드베이스 탐색 모드 | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수 |
| OMC | deep-analyze / deepanalyze (딥 분석) | keyword | 분석 모드 (debugger 경로) | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6 흡수 |
| OMC | wiki (this/add/lint/query) | keyword | wiki 동작 | ABSORBED | `lib/keywords.mjs` (UserPromptSubmit) | M6·M7 흡수 |
| OMC | 비활성 키워드 설정 (`loadDisabledKeywords`) | keyword | 사용자가 특정 키워드를 끌 수 있다 | ABSORBED | `~/.make-it-ship/config.json` `keywords.disabled` (`lib/keywords.mjs`) | M6 흡수 |
| OMC | `<remember>` / `<remember priority>` 태그 | keyword | 응답 속 태그를 notepad 작업 기억(7일)·우선 맥락(영구)에 저장 | ABSORBED | `lib/memory.mjs`, `hooks.mjs` Stop·PostToolUse | M7 흡수 (`lib/memory.mjs` `extractRemember`, Agent 결과·마지막 응답) |

### 2.6 HUD / statusline 및 `omc` CLI (`bridge/cli.cjs`)

| 원본 | 기능 | 종류 | 한 줄 설명 | MIS 상태 | MIS 대응 위치 | 남은 작업 |
|---|---|---|---|---|---|---|
| OMC | HUD 상태줄 (`~/.claude/hud/omc-hud.mjs`, `dist/hud`) | statusline | 요소: agents, autopilot, ralph, prd, todos, skills, background, call-counts, context·context-warning, token-usage, limits, model, git, cwd, session, last-tool, thinking, permission, mission-board 등. 현재 사용자 `statusLine`이 이것이다. | ABSORBED | `scripts/statusline.mjs` (run 진행 + 스타일·loop·freeze·에이전트·todo·브랜치·모델·ctx, 체이닝) | M6+M9-F 흡수: 핵심 요소(모델·git·ctx·에이전트·todo·모드) 표시. 호출 수·토큰·limits 등 나머지 요소는 만들지 않음(`statusLine.chain`으로 OMC HUD를 이어 붙일 수 있음) |
| OMC | omc launch | bin | tmux 셸 통합으로 Claude Code 실행 | PARTIAL | `mis session create … --tmux` (tmux 세션만, M8) | M8: tmux 세션 생성. 남음: tmux 안에서 Claude Code를 바로 띄우는 실행 명령 → M9-A |
| OMC | omc interop | bin | Claude(OMC)와 Codex(OMX) 분할 tmux 세션 | PARTIAL | `mis team --worker codex\|gemini` (M8, guard ask) | M8: tmux 혼합 워커. 남음: Claude·Codex 분할 세션 명령 [정책] → M9-D |
| OMC | omc ask | bin | 다른 모델 자문 실행·결과 파일 저장 | PARTIAL | `mis second-opinion detect` | 남음: 실행기와 결과 파일 [정책] → M9-D |
| OMC | omc config | bin | 설정 표시 | PARTIAL | `.make-it-ship.json`, `~/.make-it-ship/config.json` (`lib/home.mjs`, M6) | M6: 전역 설정 파일. 남음: `mis config` 조회·설정 명령 → M9-A |
| OMC | omc config-stop-callback | bin | Stop 콜백(file·telegram·discord·slack) 설정 | EXCLUDED-BY-USER | — | 없음 (알림) |
| OMC | omc config-notify-profile | bin | 알림 프로필 관리 | EXCLUDED-BY-USER | — | 없음 (알림) |
| OMC | omc info | bin | 시스템·에이전트 정보 | PARTIAL | `mis doctor` | 에이전트·도구·스킬 목록 출력 → M9-A |
| OMC | omc test-prompt | bin | 프롬프트가 어떻게 보강되는지(키워드) 시험 | ABSORBED | `mis test-prompt` (`lib/commands-always.mjs`, M6) | M6 흡수 |
| OMC | omc update / update-reconcile | bin | 업데이트 확인·설치, 이후 상태 정리 | MISSING | — | 업데이트 확인·설치·정리 → M9-A |
| OMC | omc version | bin | 상세 버전 정보 | MISSING | — | 상세 버전 정보 → M9-A |
| OMC | omc install | bin | 에이전트·명령을 `~/.claude`에 설치 | MISSING | 플러그인 설치로 대체 | 전역 설치 명령 (플러그인 설치 외 훅·상태줄·지시문) → M9-A |
| OMC | omc wait | bin | 사용량 한도 대기 후 자동 재개 | MISSING | — | 사용량 한도 대기 후 재개 → M9-D |
| OMC | omc teleport | bin | 이슈·PR용 git worktree 생성 | ABSORBED | `mis session create issue\|pr` (M8) | M8 흡수 |
| OMC | omc session / sessions | bin | 이전 로컬 세션 기록 조회 | ABSORBED | `session_search` (M7) | M7 흡수 |
| OMC | omc capabilities | bin | 도구·스킬 기능 lockfile 생성·검증 | MISSING | — | 도구·스킬 기능 lockfile 생성·검증 → M9-A |
| OMC | omc doctor | bin | 설치 진단 | PARTIAL | `mis doctor` | 설치·훅·MCP 진단과 수리 → M9-A |
| OMC | omc setup | bin | 훅·에이전트·스킬 동기화 | MISSING | — | 훅·지시문·상태줄 동기화 → M9-A |
| OMC | omc hud | bin | HUD 렌더러 실행 | ABSORBED | `scripts/statusline.mjs` (M6) | M6 흡수 |
| OMC | omc mission-board | bin | 작업공간 미션 보드 스냅샷 | MISSING | `mis status` (run만) | 작업공간 미션 보드 → M9-D |
| OMC | omc team | bin | 팀 워커 생명주기 (start·status·shutdown) | ABSORBED | `mis team start\|status\|wait\|shutdown` (M8) | M8 흡수 |
| OMC | omc autoresearch | bin | deprecated shim (deep-interview + autoresearch로 안내) | MISSING | — | autoresearch와 함께 → M9-D |
| OMC | omc ralphthon | bin | 해커톤 자율 수명주기: interview → execute → harden → done | PARTIAL | `/make-it-ship:run` Full | interview→execute→harden 수명주기를 loop와 결합 → M9-B |
| OMC | omc ultragoal | bin | 다중 목표 워크플로 CLI | PARTIAL | `plan.json` | ultragoal 원장 CLI → M9-B |

## 3. Superpowers 6.1.1

경로: `~/.claude/plugins/cache/superpowers-marketplace/superpowers/6.1.1/`

Superpowers 스킬은 대부분 "어떤 작업에서든 쓰라"는 상시 규율이다. MIS는 같은 규율을 run 단계 지시문으로만 갖고 있어, 상시 적용 기준으로는 PARTIAL이 많다.

| 원본 | 기능 | 종류 | 한 줄 설명 | MIS 상태 | MIS 대응 위치 | 남은 작업 |
|---|---|---|---|---|---|---|
| Superpowers | brainstorming | skill | 창작·기능 작업 전에 반드시 의도·요구·설계를 탐색한다 (spec 문서 리뷰어 포함). | PARTIAL | `phases/interview.md`, `phases/design.md`, SessionStart "불명확하면 먼저 질문" 규율 (M6) | M6: 상시 질문 규율. 남음: run 밖 설계 탐색과 spec 문서 리뷰 → M9-B |
| Superpowers | brainstorming visual companion (`scripts/server.cjs`, `start-server.sh`) | bin | 목업·다이어그램을 브라우저로 보여 주는 로컬 서버. | ABSORBED | `mis companion start\|status\|stop` (M8) | M8 흡수 |
| Superpowers | dispatching-parallel-agents | skill | 공유 상태 없는 2개 이상 작업을 에이전트에 병렬 위임한다. | ABSORBED | SessionStart 규율 + `ulw` 키워드 (M6), `phases/parallel.md` | M6 흡수 |
| Superpowers | executing-plans | skill | 작성된 계획을 다른 세션에서 체크포인트와 함께 실행한다. | PARTIAL | `mis resume`, `plan.json` | 임의의 계획 문서를 체크포인트와 함께 실행 → M9-B |
| Superpowers | finishing-a-development-branch | skill | 머지·PR·유지·폐기 4선택으로 브랜치를 마무리한다. | PARTIAL | `phases/ship.md` 5단계 | run 없이 단독 사용 → M9-B |
| Superpowers | receiving-code-review | skill | 리뷰 피드백을 검증 후 반영하고 틀린 지적은 근거로 반박한다. | ABSORBED | `phases/review.md` 4단계 | — |
| Superpowers | requesting-code-review | skill | 작업 완료·머지 전에 리뷰를 요청한다. | ABSORBED | `skills/review/SKILL.md`, `agents/spec-reviewer.md`, `agents/quality-reviewer.md` | — |
| Superpowers | subagent-driven-development (+ `scripts/sdd-workspace`, `task-brief`, `review-package`) | skill | task마다 새 서브에이전트로 구현하고 task별 리뷰를 받는다. | PARTIAL | `phases/parallel.md`, `agents/implementer.md` | task별 2단계 리뷰, 순차 실행에서도 서브에이전트 위임 → M9-B |
| Superpowers | systematic-debugging (+ `find-polluter.sh`, root-cause-tracing, defense-in-depth) | skill | 수정 전에 근본 원인부터 찾는다. | ABSORBED | `skills/debug/SKILL.md`, `phases/debug.md` | `find-polluter.sh` 상당은 없음 (필요 시 추가) |
| Superpowers | test-driven-development | skill | 구현 전에 실패하는 테스트부터 쓴다 (항상 적용). | ABSORBED | SessionStart 규율 (`lib/discipline.mjs`, M6), `tdd` 키워드, `phases/implement.md` | M6 흡수 |
| Superpowers | using-git-worktrees | skill | 격리 작업공간을 만들고 기준 테스트를 돌린다. | PARTIAL | `mis session create feature` (M8), `mis worktree add` | M8: 일반 worktree 생성. 남음: 생성 후 기준 테스트 실행 → M9-B |
| Superpowers | using-superpowers | skill | 모든 대화 시작 시 스킬 사용 규율(응답 전에 Skill 도구 호출)을 확립한다. | ABSORBED | `lib/discipline.mjs` (SessionStart 스킬 목록·호출 규율, M6) | M6 흡수 |
| Superpowers | verification-before-completion | skill | 완료·통과를 말하기 전에 검증 명령을 실행하고 출력을 확인한다. | ABSORBED | SessionStart 규율 (M6), `mis check`·`mis verdict` | M6 흡수 |
| Superpowers | writing-plans | skill | 코드를 건드리기 전에 다단계 구현 계획을 쓴다. | PARTIAL | `phases/plan.md` (`plan.json`) | 단독 계획 문서 작성 → M9-B |
| Superpowers | writing-skills (+ `render-graphs.js`, 테스트 방법) | skill | 스킬을 만들고 서브에이전트로 시험한 뒤 배포한다. | ABSORBED | `skills/writing-skills/SKILL.md`, `mis skill test` (기준선·스킬 포함 서브에이전트 실행, `MIS_SKILL_TEST_CMD`로 교체 가능), `mis skill lint`, `mis skill graphs` | M9-C 흡수. RED/GREEN 판정, render-graphs는 graphviz `dot`로 SVG(없으면 BLOCKED) |
| Superpowers | SessionStart: `hooks/session-start` (startup·clear·compact) | hook | `using-superpowers` 전문을 `<EXTREMELY_IMPORTANT>`로 세션 맥락에 주입한다. | ABSORBED | `hooks.mjs` SessionStart (startup·resume·clear·compact, M6) | M6 흡수 |
| Superpowers | `hooks/run-hook.cmd` | hook | Windows·Unix 공용 훅 실행 래퍼. | N/A | — | MIS는 macOS·Linux만 지원 (README). 사용자 확인 |
| Superpowers | `hooks/hooks-cursor.json` | hook | Cursor용 훅 설정. | N/A | — | Cursor 전용 |
| Superpowers | `.codex-plugin`, `.cursor-plugin`, `.kimi-plugin`, `.opencode`, `.pi`, `.agents`, `gemini-extension.json`, `GEMINI.md` | bin | 다른 호스트용 매니페스트·확장. | N/A | (`adapters/codex/AGENTS.md`는 별도) | 다른 호스트 전용 |

## 4. Ponytail 5.2.0

경로: `~/.claude/plugins/cache/ponytail/ponytail/5.2.0/`. Claude Code는 `hooks/claude-codex-hooks.json`을 쓴다.

| 원본 | 기능 | 종류 | 한 줄 설명 | MIS 상태 | MIS 대응 위치 | 남은 작업 |
|---|---|---|---|---|---|---|
| Ponytail | ponytail | skill | 가장 작은 완전한 변경과 읽기 쉬운 응답을 강제하는 "게으른 시니어" 모드. | ABSORBED | `lib/style.mjs`, `skills/style/SKILL.md`, SessionStart·SubagentStart 주입 (M6) | M6 흡수 |
| Ponytail | 레벨 lite | keyword | 규칙 완화 단계. | ABSORBED | `lib/style.mjs` (M6) | M6 흡수 |
| Ponytail | 레벨 full (기본) | keyword | 기본 규칙. | ABSORBED | `lib/style.mjs` (M6) | M6 흡수 |
| Ponytail | 레벨 ultra | keyword | 최고 강도 (상태줄 주황 표시). | ABSORBED | `lib/style.mjs`, 상태줄 `style ULTRA` (M6) | M6 흡수 |
| Ponytail | 레벨 off / "stop ponytail" / "normal mode" | keyword | 모드 끄기. | ABSORBED | `lib/keywords.mjs` `styleSwitch` (M6) | M6 흡수 |
| Ponytail | `/ponytail lite\|full\|ultra\|off` | keyword | 세션 레벨 전환. 인자 없으면 기본 레벨로 켜기. | ABSORBED | `/make-it-ship:style`, `mis style <level>` (M6) | M6 흡수 |
| Ponytail | `/ponytail default <mode>` | keyword | 기본 레벨을 설정 파일에 저장. | ABSORBED | `mis style default <level>` (M6) | M6 흡수 |
| Ponytail | 자연어 활성화 ("ponytail", "be lazy", "simplest solution", "yagni") | keyword | 스킬 설명 기반 자동 호출. | ABSORBED | `skills/style/SKILL.md` description (M6) | M6 흡수 |
| Ponytail | ponytail-audit | skill | 저장소 전체 품질 감사(버그·보안·부하·무테스트 위험·느린 경로·삭제 후보), 순위 보고, 변경 없음. | MISSING | — | 저장소 전체 품질 감사 (quality·security 리뷰어 재사용) → M9-B |
| Ponytail | ponytail-debt | skill | `shortcut:` 주석을 부채 원장으로 나열. | PARTIAL | `lib/debt.mjs` (`mis report` 10절에만 출력) | 단독 명령 `mis debt` → M9-B |
| Ponytail | ponytail-gain | skill | 벤치마크 기반 절감 효과(코드·비용·속도) 표시. | MISSING | — | MIS 지표 표시 (M10 결과 사용) → M9-A |
| Ponytail | ponytail-help | skill | 레벨·스킬·명령 빠른 참고. | MISSING | SessionStart 스킬 목록 (M6), README | help 명령 → M9-A |
| Ponytail | ponytail-review | skill | 변경의 논리·안전·부하·테스트·성능·불필요 코드 리뷰. | ABSORBED | `skills/review/SKILL.md`, `agents/quality-reviewer.md` | — |
| Ponytail | SessionStart: ponytail-activate.js (규칙 주입) | hook | 플래그 파일 `~/.claude/.ponytail-active` 작성, 레벨별 규칙을 숨은 맥락으로 주입. | ABSORBED | `hooks.mjs` SessionStart, `lib/style.mjs` (M6) | M6 흡수 |
| Ponytail | SessionStart: ponytail-activate.js (상태줄 설정 안내) | hook | 상태줄 설정이 없으면 설정 안내를 낸다. | PARTIAL | `mis init`의 `hud.statusLine` 제안 | 세션 시작 시 상태줄 미설정 안내 → M9-A |
| Ponytail | SessionStart: ponytail-map.js (코드베이스 지도) | hook | `git ls-files` + 언어별 정규식으로 최상위 함수·클래스·export를 폴더별 한 줄로 주입 (문자 예산 내). | ABSORBED | `lib/codemap.mjs` (M6) | M6 흡수 |
| Ponytail | UserPromptSubmit: ponytail-mode-tracker.js | hook | `/ponytail` 명령과 끄기 문구를 감지해 플래그 파일 레벨을 바꾼다. | ABSORBED | `lib/keywords.mjs` `styleSwitch` (M6) | M6 흡수 |
| Ponytail | SubagentStart: ponytail-subagent.js | hook | 서브에이전트에도 같은 규칙을 주입 (`PONYTAIL_SUBAGENT_MATCHER`로 범위 지정). | ABSORBED | `hooks.mjs` SubagentStart, `subagentMatcher` (M6) | M6 흡수 |
| Ponytail | ponytail-instructions.js | hook | 레벨에 맞는 표·예시만 남기는 규칙 빌더. | ABSORBED | `lib/style.mjs` `styleRules` (M6) | M6 흡수 |
| Ponytail | ponytail-config.js | hook | 기본 레벨 해석: 환경변수 → `~/.config/ponytail/config.json` 등. | ABSORBED | `lib/home.mjs` (`~/.make-it-ship/config.json`, `MIS_STATE_HOME`, M6) | M6 흡수 |
| Ponytail | ponytail-runtime.js | hook | 호스트 감지(Claude·Codex·Copilot 등)와 출력 형식 선택. | N/A | — | Claude Code 경로만 필요. 다른 호스트 분기는 N/A |
| Ponytail | ponytail-statusline.sh | statusline | `[PONYTAIL]`/`[PONYTAIL:ULTRA]` 색 표시. 현재 사용자 statusLine에 등록되어 있지 않다. | ABSORBED | `scripts/statusline.mjs` `style ULTRA` 표시 (M6) | M6 흡수 |
| Ponytail | ponytail-statusline.ps1 | statusline | Windows PowerShell 상태줄. | N/A | — | MIS는 macOS·Linux만 지원. 사용자 확인 |
| Ponytail | `commands/*.toml` (ponytail, -audit, -debt, -gain, -help, -review) | keyword | Gemini CLI 형식 명령 정의. | N/A | — | Gemini 전용 형식. 동작은 위 스킬·레벨 행으로 처리 |
| Ponytail | `benchmarks/`, `examples/` | bin | 절감 효과 벤치마크 데이터와 예제. | MISSING | — | M10 비교 벤치마크 입력, ponytail-gain 표시와 묶음 → M9-A |
| Ponytail | `hooks/cursor-hooks.json`, `copilot-hooks.json`, `qoder-hooks.json`, `.cursor`, `.clinerules`, `.windsurf`, `.kiro`, `.qoder*`, `.devin-plugin`, `.grok-plugin`, `.codex-plugin`, `.kimi-plugin`, `.openclaw`, `.opencode`, `opencode.json`, `pi-extension`, `gemini-extension.json`, `plugin.yaml`, `__init__.py`, `.github/copilot-instructions.md` | hook | 다른 호스트용 설정·확장. | N/A | — | 다른 호스트 전용 |

## 5. gstack 1.58.5.0

경로: `~/.claude/skills/gstack/` (스킬 54개 = 루트 라우터 + 하위 53개) 및 `~/.claude/skills/<이름>` 복사본. gstack은 플러그인 훅 파일이 없다. 대신 일부 스킬 frontmatter에 훅이 있고, 모든 스킬 앞부분(preamble)이 bash로 공통 동작을 실행한다.

### 5.1 스킬

| 원본 | 기능 | 종류 | 한 줄 설명 | MIS 상태 | MIS 대응 위치 | 남은 작업 |
|---|---|---|---|---|---|---|
| gstack | gstack (루트 `SKILL.md`, `~/.claude/skills/_gstack-command`) | skill | gstack 스킬 라우터, 선제 제안(proactive). | ABSORBED | SessionStart 스킬 목록·호출 규율 (`lib/discipline.mjs`), 키워드 라우터 (M6) | M6 흡수 (선제 제안은 §5.2 proactive 행) |
| gstack | autoplan | skill | CEO·디자인·엔지니어링·DX 리뷰를 6개 결정 원칙으로 자동 연속 실행. | PARTIAL | `phases/product-review.md`, `phases/plan-critique.md` | 자동 결정 원칙, 단독 실행 → M9-B |
| gstack | benchmark | skill | browse 데몬으로 페이지 성능 회귀를 감지한다. | ABSORBED | `mis browse perf` + `phases/qa.md` 9단계, `mis bench` (M8) | M8 흡수 |
| gstack | benchmark-models | skill | 같은 스킬을 여러 모델(Claude·GPT·Gemini)로 비교. | MISSING | — | 여러 모델 실행 비교, 호출마다 guard ask [정책] → M9-D |
| gstack | browse | skill | 빠른 헤드리스 브라우저로 QA·dogfooding (§5.4 명령). | ABSORBED | `mis browse` (CDP 데몬, `lib/browse/`), `skills/browse/SKILL.md` (M8) | M8 흡수 (빠진 명령은 §5.4 행) |
| gstack | canary | skill | 배포 후 카나리 모니터링. | MISSING | — | 배포 후 카나리 모니터링 → M9-D |
| gstack | careful | skill | 파괴적 명령 경고. | ABSORBED | `lib/policy.mjs` `careful` (run 여부와 무관, M6) | M6 흡수 |
| gstack | codex | skill | Codex CLI 래퍼 (review·challenge·consult 3모드). | PARTIAL | `mis second-opinion detect` | review·challenge·consult 실행기, guard ask [정책] → M9-D |
| gstack | connect-chrome / open-gstack-browser | skill | 사이드바 확장이 들어간 AI 제어 Chromium 실행. | MISSING | — | headed 실제 프로필 Chrome 연결 + 사이드바, guard 항상 ask → M9-E |
| gstack | context-save | skill | 브랜치·상태·결정·남은 작업을 저장. | PARTIAL | run 상태 자동 저장 (`lib/state.mjs`) | run 밖 임의 작업 맥락 저장 → M9-B |
| gstack | context-restore | skill | 저장한 맥락 복원, 브랜치 불일치 경고. | PARTIAL | `skills/resume/SKILL.md`, `mis resume` (run만) | run 밖 맥락 복원, 브랜치 불일치 경고 → M9-B |
| gstack | cso | skill | 최고보안책임자 모드: 비밀값(코드·git 이력), 의존성 감사, OWASP, 공격 표면 지도. | PARTIAL | `agents/security-reviewer.md` (변경분, 위험 신호가 있을 때) | 저장소 전체 보안 감사, git 이력 비밀값 검사 → M9-B |
| gstack | design-consultation | skill | 디자인 시스템 제안 + 글꼴·색 미리보기 페이지. | PARTIAL | `phases/design-explore.md` ① (`DESIGN.md`) | 글꼴·색 미리보기 페이지, 단독 실행 → M9-B |
| gstack | design-html | skill | 시안을 실서비스 품질 HTML/CSS로 확정. | PARTIAL | `phases/design-explore.md` ② | 단독 실행 → M9-B |
| gstack | design-review | skill | 실제 화면에서 시각 불일치·간격·위계·AI 슬롭을 찾아 고친다. | ABSORBED | `phases/qa.md` 8단계 (라이브 스크린샷 수정 루프 + `mis visual-verdict`, M8) | M8 흡수 |
| gstack | design-shotgun | skill | AI 이미지 시안 여러 개 + 비교 보드 + 피드백 반복. | PARTIAL | `phases/design-explore.md` ② (정적 HTML), `mis companion` 클릭 선택 (M8) | M8: 미리보기 서버. 남음: 시안 비교 보드·피드백 반복 (AI 이미지 생성은 `design/` 행) → M9-B |
| gstack | devex-review | skill | 라이브 개발자 경험 감사 (첫 성공까지 시간 TTHW 등). | PARTIAL | `agents/product-reviewer.md` (계획 단계 DX) | 실제 실행 기반 DX 측정 (TTHW) → M9-B |
| gstack | diagram | skill | 설명·mermaid → 원본 + `.excalidraw` + 이미지 3종. | PARTIAL | `agents/architect.md` (mermaid) | excalidraw·이미지 출력 → M9-B |
| gstack | document-generate | skill | 기능·모듈·프로젝트 문서를 처음부터 생성. | PARTIAL | `phases/ship.md` 1단계 (변경된 공개 표면만) | 단독 문서 생성 → M9-B |
| gstack | document-release | skill | 배포 후 문서 갱신 (사실은 자동, 서술은 질문). | ABSORBED | `phases/ship.md` 1단계 | — |
| gstack | freeze | skill | 세션 동안 편집을 특정 디렉터리로 제한. | ABSORBED | `mis freeze <dir>`, `lib/policy.mjs` (저장소 범위, M6) | M6 흡수 |
| gstack | unfreeze | skill | freeze 경계 해제. | ABSORBED | `mis unfreeze` (M6) | M6 흡수 |
| gstack | guard | skill | careful + freeze 동시 적용. | ABSORBED | `scripts/guard.mjs` + careful 상시 + freeze (M6) | M6 흡수 |
| gstack | gstack-upgrade | skill | gstack 최신 버전으로 업그레이드. | MISSING | — | MIS 자체 업그레이드 → M9-A |
| gstack | health | skill | 코드 품질 대시보드 (가중 점수·추세). | PARTIAL | `phases/verify.md`, `phases/discover.md` | 가중 점수·추세 대시보드 → M9-B |
| gstack | investigate | skill | 근본 원인 디버깅 (편집 범위 제한 훅 포함). | ABSORBED | `skills/debug/SKILL.md`, `phases/debug.md` | 범위 제한 훅은 §5.2 행 |
| gstack | ios-clean | skill | DebugBridge SPM 패키지와 `#if DEBUG` 연결 제거. | ABSORBED | `mis ios bridge-scan`, `templates/ios-debug-bridge/` README, `mis ship`이 남은 브리지를 NOT READY 처리 | — |
| gstack | ios-design-review | skill | 실기기에서 iOS 시각 디자인 감사. | PARTIAL | `phases/qa.md` 8단계 (브리지 스크린샷) | 실기기 디자인 감사 절차 → M9-D |
| gstack | ios-fix | skill | 자율 iOS 버그 수정. | PARTIAL | `phases/debug.md` + iOS QA check | 실기기 수정 루프 → M9-D |
| gstack | ios-qa | skill | SwiftUI 실기기 라이브 QA (tailnet 데몬 포함). | PARTIAL | `lib/ios.mjs`, `mis ios devices`, 디버그 브리지 템플릿 | 원격 iOS QA 데몬은 아래 `gstack-ios-qa-daemon` 행. 남음: 실기기 QA 루프 → M9-D |
| gstack | ios-sync | skill | 디버그 브리지를 최신 업스트림 템플릿으로 재생성. | PARTIAL | `templates/ios-debug-bridge/` (고정 템플릿) | 템플릿 갱신 명령 → M9-D |
| gstack | land-and-deploy | skill | 머지 후 배포까지 진행. | PARTIAL | `phases/ship.md` (준비만, push·PR은 승인 후) | 배포 실행 (guard ask) → M9-D |
| gstack | landing-report | skill | 작업공간 단위 ship 대기열 대시보드 (읽기 전용). | MISSING | — | 작업공간 ship 대기열 대시보드 → M9-D |
| gstack | learn | skill | 프로젝트 학습 조회·검색·정리·내보내기. | PARTIAL | `mis learn add\|list` (`lib/learn.mjs`, STALE 표시) | 검색·정리·내보내기·증류 → M9-B |
| gstack | make-pdf | skill | 마크다운을 출판 품질 PDF로 변환. | ABSORBED | `mis pdf` (marked 벤더, M8) | M8 흡수 |
| gstack | office-hours | skill | YC 오피스아워: 스타트업 모드·빌더 모드. | PARTIAL | `phases/interview.md` (Full의 idea 입력 시 문제 정의) | 단독 실행, 두 모드 → M9-B |
| gstack | pair-agent | skill | 원격 AI 에이전트를 내 브라우저에 연결 (터널). | MISSING | — | 원격 에이전트 브라우저 연결(터널), guard 항상 ask [정책] → M9-D |
| gstack | plan-ceo-review | skill | 창업자 관점 계획 리뷰 (전제 도전, 범위 모드). | PARTIAL | `agents/product-reviewer.md` (Full에서 한 번에) | 단독·대화형 실행 → M9-B |
| gstack | plan-design-review | skill | 디자이너 관점 계획 리뷰 (대화형, 계획 수정). | PARTIAL | `agents/product-reviewer.md` | 단독·대화형 실행 → M9-B |
| gstack | plan-devex-review | skill | DX 관점 계획 리뷰. | PARTIAL | `agents/product-reviewer.md` | 단독·대화형 실행 → M9-B |
| gstack | plan-eng-review | skill | 엔지니어링 매니저 관점 계획 리뷰. | PARTIAL | `agents/architect.md`, `phases/design.md` | 단독 실행 → M9-B |
| gstack | plan-tune | skill | 질문 민감도 자가 조정 + 개발자 성향 기록. | PARTIAL | `interview.threshold` 설정 (`lib/config.mjs`) | 질문 로그·질문별 선호·개발자 프로필 → M9-B |
| gstack | qa | skill | 웹앱을 체계적으로 QA하고 버그를 고친다. | ABSORBED | `skills/qa/SKILL.md`, `phases/qa.md` (내장 브라우저, Playwright 불필요, M8) | M8 흡수 |
| gstack | qa-only | skill | 보고만 하는 QA. | ABSORBED | `phases/qa.md` 7단계 (보고 전용 + 건강 점수, M8) | M8 흡수 |
| gstack | retro | skill | 주간 엔지니어링 회고 (git 이력·핫스팟·사람별). | PARTIAL | `mis retro` (run 이벤트 기반 지표) | git 이력 기반 지표(핫스팟·사람별) → M9-B |
| gstack | review | skill | 머지 전 PR 리뷰. | ABSORBED | `skills/review/SKILL.md` (spec·quality·security) | — |
| gstack | scrape | skill | 웹 페이지에서 데이터를 가져온다. | MISSING | — | browse 위 데이터 추출, guard 항상 ask → M9-E |
| gstack | setup-browser-cookies | skill | 실제 Chromium 쿠키를 헤드리스 세션으로 가져온다. | MISSING | — | 실제 Chromium 쿠키 가져오기, guard 항상 ask → M9-E |
| gstack | setup-deploy | skill | land-and-deploy용 배포 설정. | MISSING | — | 배포 설정 → M9-D |
| gstack | setup-gbrain | skill | gbrain CLI 설치, PGLite·Supabase 브레인 초기화, MCP 등록. | MISSING | — | gbrain 계열, 외부 전송마다 guard ask [정책] → M9-D |
| gstack | sync-gbrain | skill | gbrain을 저장소 코드와 동기화하고 CLAUDE.md 검색 안내 갱신. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | ship | skill | base 머지, 테스트, diff 리뷰, VERSION 증가, CHANGELOG, 커밋, push, PR. | PARTIAL | `phases/ship.md`, `mis ship` (초안·체크리스트, push·PR은 승인 후) | VERSION 증가, base 머지 → M9-B |
| gstack | skillify | skill | 성공한 `/scrape` 흐름을 영구 browser-skill로 저장. | MISSING | — | 성공한 scrape 흐름을 browser-skill로 저장 → M9-E |
| gstack | spec | skill | 모호한 의도를 5단계로 실행 가능한 spec으로. | PARTIAL | `phases/interview.md`, `phases/plan.md` | 단독 spec 문서 출력 → M9-B |

### 5.2 스킬 frontmatter 훅과 preamble 공통 동작

| 원본 | 기능 | 종류 | 한 줄 설명 | MIS 상태 | MIS 대응 위치 | 남은 작업 |
|---|---|---|---|---|---|---|
| gstack | careful: `careful/bin/check-careful.sh` (PreToolUse Bash) | hook | 파괴적 명령이면 경고. | ABSORBED | `scripts/guard.mjs` + `lib/policy.mjs` `careful` (M6) | M6 흡수 |
| gstack | freeze: `freeze/bin/check-freeze.sh` (PreToolUse Edit·Write) | hook | freeze 경계 밖 편집 차단. | ABSORBED | `scripts/guard.mjs` freeze 경계 (M6) | M6 흡수 |
| gstack | guard: careful + freeze 훅 | hook | 두 훅 동시 적용. | ABSORBED | `scripts/guard.mjs` (M6) | M6 흡수 |
| gstack | investigate: 디버그 범위 제한 훅 (Edit·Write) | hook | 디버깅 중 편집 범위 제한. | ABSORBED | `mis debug scope <path…>` (`lib/commands-always.mjs`), guard `debugScope` (`lib/policy.mjs`), `phases/debug.md` | M9-F 흡수(F8): 가설 범위 밖 Write/Edit는 guard ask(freeze와 달리 deny 아님), 저장소별, `--clear`로 해제 |
| gstack | preamble: `gstack-update-check` | hook | 스킬 실행마다 업그레이드 확인. | MISSING | — | 업데이트 확인 (fail-open) → M9-A |
| gstack | preamble: proactive 제안 (`gstack-config get proactive`) | hook | 다음에 쓸 스킬을 선제 제안. | ABSORBED | `lib/discipline.mjs` (SessionStart) | M9-F 흡수(F10): 작업이 끝나면 다음 스킬 한 줄 제안(실행은 안 함). `proactive: false`로 끔 |
| gstack | preamble: 텔레메트리 (`gstack-telemetry-log`, `-sync`) | hook | 스킬 실행 이벤트 기록·Supabase 동기화. | MISSING | — | 로컬 기록 + 동기화, 기본 꺼짐, 동기화는 guard ask [정책] → M9-D |
| gstack | preamble: CLAUDE.md `## Skill routing` 섹션 작성 | hook | 프로젝트 CLAUDE.md에 스킬 라우팅 규칙을 추가한다. | ABSORBED | `mis setup routing [--write]` (`lib/routing.mjs`) | M9-F 흡수(F10): dry-run diff, 기존 `## Skill routing` 절(gstack 것 포함) 교체·멱등, `--write`는 guard ask |
| gstack | preamble: 세션 종류·타임라인·질문 로그 (`gstack-session-kind`, `gstack-timeline-log`, `gstack-question-log`) | hook | 세션 분류, 이벤트 타임라인, AskUserQuestion 기록. | ABSORBED | `lib/timeline.mjs`, SessionStart/End·SubagentStart/Stop·Skill 기록, `trace_timeline` | M9-F 흡수(F9): 세션 종류(interactive·headless·team-worker)와 run 밖 이벤트를 프로젝트 타임라인에 기록. 질문 로그는 B3(`mis question log`) 행 |
| gstack | ETHOS·AskUserQuestion 형식 규율 | hook | 질문 형식·작업 원칙 공통 지시. | ABSORBED | `lib/discipline.mjs` (한 번에 하나씩 질문, 재정리·추천·2-4 선택지), `phases/interview.md` | M6+M9-F 흡수(F10): 질문 형식(재정리·추천·선택지) 규율 추가 |

### 5.3 bin 도구 (`bin/`, 75개 파일, 74행)

| 원본 | 기능 | 종류 | 한 줄 설명 | MIS 상태 | MIS 대응 위치 | 남은 작업 |
|---|---|---|---|---|---|---|
| gstack | chrome-cdp | bin | 원격 디버깅(CDP)을 켠 Chrome 실행. | PARTIAL | `lib/browse/chrome.mjs` (내부용 CDP Chrome 실행, M8) | M8: 헤드리스 내부 실행. 남음: 사용자 Chrome을 CDP로 띄우기, guard ask → M9-E |
| gstack | dev-setup | bin | gstack 저장소 안에서 스킬 개발용 링크 설정. | N/A | — | gstack 자체 개발용. 사용자 확인 |
| gstack | dev-teardown | bin | 개발 링크 제거. | N/A | — | gstack 자체 개발용. 사용자 확인 |
| gstack | gstack-analytics | bin | 로컬 JSONL 기반 개인 사용 대시보드. | MISSING | — | 로컬 JSONL 사용 대시보드 → M9-D |
| gstack | gstack-artifacts-init | bin | `~/.gstack/`를 비공개 원격과 동기화되는 git 저장소로 설정. | MISSING | — | 산출물 원격 동기화, guard ask [정책] → M9-D |
| gstack | gstack-artifacts-url | bin | 산출물 저장소 URL 도우미. | MISSING | — | [정책] 위와 함께 → M9-D |
| gstack | gstack-brain-cache | bin | 브레인 기반 계획 스킬용 3단 캐시. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-brain-consumer | bin | 브레인 소비자 등록 관리. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-brain-context-load.ts | bin | 브레인 검색 표면. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-brain-enqueue | bin | 동기화 대기열에 경로 추가. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-brain-reader | bin | 브레인 소비자 등록 관리 (별칭). | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-brain-restore | bin | 기존 브레인 저장소로 새 머신 부트스트랩. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-brain-sync | bin | 대기열 처리, 허용 경로 커밋, 원격 push. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-brain-uninstall | bin | 브레인 동기화 제거. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-builder-profile | bin | 레거시 shim (developer-profile로 이동). | N/A | — | 레거시 별칭 |
| gstack | gstack-codex-probe | bin | `/codex`·`/autoplan`용 Codex 감지 도우미. | PARTIAL | `mis second-opinion detect` | 버전·인증 상태 확인 [정책] → M9-D |
| gstack | gstack-codex-session-import | bin | Codex 세션에서 질문 로그를 채운다. | N/A | — | Codex 호스트 전용 |
| gstack | gstack-community-dashboard | bin | Supabase 커뮤니티 사용 통계. | MISSING | — | 외부 집계 조회 [정책] → M9-D |
| gstack | gstack-config | bin | `~/.gstack/config.yaml` 읽기·쓰기. | PARTIAL | `lib/config.mjs`, `~/.make-it-ship/config.json` (M6) | M6: 전역 설정 파일. 남음: 설정 명령 → M9-A |
| gstack | gstack-decision-log | bin | 영구 결정 기록(대체·삭제·압축). | PARTIAL | `mis note design`, ADR (`docs/adr`) | 결정 원장 명령(대체·삭제·압축) → M9-B |
| gstack | gstack-decision-search | bin | 유효한 결정 조회. | MISSING | — | 결정 검색 → M9-B |
| gstack | gstack-detach | bin | 긴 작업(평가·벤치마크)을 SIGTERM에 강하게 분리 실행. | MISSING | — | 긴 작업 분리 실행 → M9-D |
| gstack | gstack-developer-profile | bin | 개발자 프로필 조회·도출. | MISSING | — | plan-tune 프로필 → M9-B |
| gstack | gstack-diff-scope | bin | base 대비 diff 범주 분류. | PARTIAL | `lib/tree-hash.mjs`, `mis report` 변경 파일 | base 대비 diff 범주 분류 → M9-B |
| gstack | gstack-distill-apply | bin | 증류 제안 하나를 사용자 승인 후 적용. | MISSING | — | learn 증류 → M9-B |
| gstack | gstack-distill-free-text | bin | 자유 텍스트 일괄 증류("dream cycle"). | MISSING | — | learn 증류 → M9-B |
| gstack | gstack-extension | bin | Chrome 확장 설치 도우미. | MISSING | — | Chrome 확장 설치 → M9-E |
| gstack | gstack-first-task-detect | bin | 프로젝트를 첫 작업 유형으로 분류. | PARTIAL | `mis qa detect`, `mis init` 감지 | 첫 작업 유형 분류 안내 → M9-A |
| gstack | gstack-gbrain-detect | bin | gbrain 상태 JSON. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-gbrain-install | bin | gbrain CLI 설치. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-gbrain-lib.sh | bin | setup-gbrain 공용 함수. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-gbrain-mcp-verify | bin | 원격 gbrain MCP 확인. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-gbrain-repo-policy | bin | 원격별 gbrain 수집 신뢰 등급. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-gbrain-source-wireup | bin | 브레인 저장소를 gbrain 소스로 등록. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-gbrain-supabase-provision | bin | Supabase Management API 래퍼. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-gbrain-supabase-verify | bin | Supabase 세션 구조 확인. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-gbrain-sync.ts | bin | gbrain 통합 동기화. | MISSING | — | gbrain 계열 [정책] → M9-D |
| gstack | gstack-global-discover / gstack-global-discover.ts | bin | Claude Code·Codex·Gemini 세션을 전역에서 찾는다. | PARTIAL | `session_search` (현재 프로젝트, M7) | M7: 프로젝트 단위. 남음: 전 프로젝트 Claude Code 세션 탐색 (Codex·Gemini 세션은 다른 호스트라 제외) → M9-B |
| gstack | gstack-ios-qa-daemon | bin | tailnet·루프백 트래픽을 중계하는 Mac 데몬 (원격 iOS QA). | MISSING | — | tailnet 중계 데몬, guard ask [정책] → M9-D |
| gstack | gstack-ios-qa-mint | bin | 원격 iOS QA 에이전트 tailnet 허용 목록. | MISSING | — | [정책] 위와 함께 → M9-D |
| gstack | gstack-jsonl-merge | bin | 추가 전용 JSONL용 git merge 드라이버. | MISSING | — | learnings·events JSONL merge 드라이버 → M9-B |
| gstack | gstack-learnings-log | bin | 학습 추가. | ABSORBED | `mis learn add` | — |
| gstack | gstack-learnings-search | bin | 학습 검색·필터. | PARTIAL | `mis learn list` | 검색·필터 → M9-B |
| gstack | gstack-memory-ingest.ts | bin | 메모리 수집 도우미. | MISSING | — | 세션·산출물을 gbrain에 수집하는 도구 (gbrain 계열) [정책] → M9-D |
| gstack | gstack-model-benchmark | bin | 같은 프롬프트를 여러 제공자로 실행. | MISSING | — | [정책] benchmark-models와 함께 → M9-D |
| gstack | gstack-next-version | bin | ship용 VERSION 할당. | MISSING | — | ship VERSION 할당 → M9-B |
| gstack | gstack-open-url | bin | 플랫폼별 URL 열기. | MISSING | — | `open`/`xdg-open` 래퍼 (companion·browse handoff에서 사용) → M9-E |
| gstack | gstack-patch-names | bin | 접두사 모드용 SKILL.md `name` 수정. | N/A | — | gstack 설치 구조 전용. 사용자 확인 |
| gstack | gstack-paths | bin | 상태 루트 경로 출력. | ABSORBED | `lib/state.mjs` `stateRoot`, `lib/home.mjs` (`~/.make-it-ship`) | 재판정: 기존 `stateRoot`·`~/.make-it-ship`로 충분 |
| gstack | gstack-platform-detect | bin | 설치된 AI 코딩 에이전트와 gstack 상태. | PARTIAL | `mis doctor`, `mis second-opinion detect` | 설치된 코딩 에이전트·MIS 상태 보고 (capabilities) → M9-A |
| gstack | gstack-pr-title-rewrite.sh | bin | PR 제목을 `v<버전>`으로 시작하게. | MISSING | — | ship VERSION과 함께 → M9-B |
| gstack | gstack-question-log | bin | AskUserQuestion 이벤트 기록. | MISSING | — | plan-tune 질문 로그 → M9-B |
| gstack | gstack-question-preference | bin | 질문별 선호 읽기·쓰기. | MISSING | — | plan-tune 질문별 선호 → M9-B |
| gstack | gstack-redact | bin | 비밀값·개인정보·법률 내용 검사. | PARTIAL | `lib/mask.mjs` (로그 마스킹) | 비밀값·개인정보 스캔 명령 → M9-B |
| gstack | gstack-redact-prepush | bin | push 전 diff 비밀값 검사 git 훅. | MISSING | — | push 전 diff 비밀값 검사 → M9-B |
| gstack | gstack-relink | bin | 접두사 설정으로 스킬 링크 재생성. | N/A | — | gstack 설치 구조 전용. 사용자 확인 |
| gstack | gstack-repo-mode | bin | 1인·협업 저장소 판정. | MISSING | — | 1인·협업 저장소 판정 (ship·review 기본값) → M9-B |
| gstack | gstack-review-log | bin | 리뷰 결과 기록. | ABSORBED | `mis review add` | — |
| gstack | gstack-review-read | bin | 리뷰 기록·설정 조회. | ABSORBED | `mis status` | — |
| gstack | gstack-security-dashboard | bin | 커뮤니티 프롬프트 인젝션 공격 통계. | MISSING | — | 외부 집계 조회 [정책] → M9-D |
| gstack | gstack-session-kind | bin | 세션 종류 분류. | ABSORBED | `lib/timeline.mjs` `sessionKind` | M9-F 흡수(F9): `MIS_TEAM_ID`→team-worker, `MIS_HEADLESS`·CI(대화형 CLI 표시 없을 때)→headless, 그 외 interactive |
| gstack | gstack-session-update | bin | 세션 시작 시 자동 업데이트 (팀 모드). | MISSING | — | 세션 시작 자동 업데이트 (확인 후) → M9-A |
| gstack | gstack-settings-hook | bin | `~/.claude/settings.json` 훅 관리. | PARTIAL | `mis init`이 statusLine 등록 제안 | settings.json 훅·상태줄 관리 → M9-A |
| gstack | gstack-slug | bin | 프로젝트 slug·브랜치 이름 정리. | ABSORBED | `lib/state.mjs` run id, `mis session` slug (M8) | M8 흡수 |
| gstack | gstack-specialist-stats | bin | 리뷰어별 적중률. | PARTIAL | `mis retro` (리뷰 BLOCKING 집계) | 리뷰어별 적중률 → M9-B |
| gstack | gstack-taste-update | bin | 디자인 취향 프로필 갱신. | MISSING | — | 디자인 취향 프로필 → M9-B |
| gstack | gstack-team-init | bin | 팀 모드 저장소 부트스트랩 파일 생성. | MISSING | — | 팀 모드 저장소 부트스트랩 → M9-A |
| gstack | gstack-telemetry-log | bin | 텔레메트리 이벤트를 로컬 JSONL에 기록. | MISSING | — | 로컬 텔레메트리, 기본 꺼짐 → M9-D |
| gstack | gstack-telemetry-sync | bin | 로컬 이벤트를 Supabase로 동기화. | MISSING | — | 동기화, 기본 꺼짐 + guard ask [정책] → M9-D |
| gstack | gstack-timeline-log | bin | 프로젝트 타임라인 이벤트 기록. | ABSORBED | `lib/timeline.mjs`, `mis timeline log <event> [k=v…]`, 훅 자동 기록 | M7+M9-F 흡수(F9): run 밖 이벤트를 `.git/make-it-ship/timeline.jsonl`(저장소 밖이면 홈)에 기록 |
| gstack | gstack-timeline-read | bin | 타임라인 조회. | ABSORBED | `mis timeline [--last N]`, `trace_timeline` (filter `timeline`) | M7+M9-F 흡수(F9): 프로젝트 타임라인 조회, run 이벤트·훅 trace와 병합 |
| gstack | gstack-uninstall | bin | 스킬·상태·browse 데몬 제거. | MISSING | — | MIS 제거·상태 정리 → M9-A |
| gstack | gstack-update-check | bin | 주기적 버전 확인. | MISSING | — | 주기적 버전 확인 → M9-A |
| gstack | gstack-version-bump | bin | ship용 버전 상태 분류·작성. | MISSING | — | ship VERSION 증가 → M9-B |

### 5.4 browse 데몬 (`browse/`, `BROWSER.md`) 및 기타 디렉터리

browse는 작업공간별 포트를 쓰는 Bun 기반 Chromium 데몬(`browse/dist/browse`, 약 58MB)이고, `$B <명령>`으로 호출한다. 아래는 명령 그룹 단위다.

| 원본 | 기능 | 종류 | 한 줄 설명 | MIS 상태 | MIS 대응 위치 | 남은 작업 |
|---|---|---|---|---|---|---|
| gstack | browse 데몬 수명주기 (`status`, `stop`, `restart`, 작업공간별 `.gstack/browse.json`) | bin | 데몬 시작·상태·종료, 작업공간 격리. | ABSORBED | `mis browse status\|stop\|restart`, 작업공간별 `.git/make-it-ship/browse/` (`lib/browse/daemon.mjs`, M8) | M8 흡수 |
| gstack | 읽기 (`text`, `html`, `links`, `forms`, `accessibility`, `media`, `data`) | bin | 페이지 텍스트·구조·구조화 데이터 추출. | PARTIAL | `mis browse text\|html\|links\|forms\|accessibility\|data` (M8) | M8: 대부분 흡수. 남음: `media` → M9-E |
| gstack | 검사 (`js`, `eval`, `css`, `attrs`, `is`, `console`, `network`, `dialog`, `cookies`, `storage`, `perf`, `inspect`, `ux-audit`, `cdp`) | bin | 페이지 JS 실행, CSS·상태·콘솔·네트워크·성능·CDP 직접 호출. | PARTIAL | `mis browse js\|eval\|css\|attrs\|is\|console\|network\|dialog\|storage\|perf\|cdp` (M8) | M8: 대부분 흡수. 남음: `cookies`, `inspect`, `ux-audit` → M9-E |
| gstack | 이동 (`goto`, `load-html`, `back`, `forward`, `reload`, `url`, `wait`) | bin | 페이지 이동·대기. | ABSORBED | `mis browse goto\|load-html\|back\|forward\|reload\|url\|wait` (M8) | M8 흡수 |
| gstack | 조작 (`click`, `fill`, `select`, `hover`, `type`, `press`, `scroll`, `viewport`, `upload`, `dialog-accept`, `dialog-dismiss`) | bin | 사용자 입력 재현. | ABSORBED | `mis browse click\|fill\|select\|hover\|type\|press\|scroll\|viewport\|upload\|dialog-accept\|dialog-dismiss` (M8) | M8 흡수 |
| gstack | 스타일·정리 (`style`, `style --undo`, `cleanup`, `prettyscreenshot`) | bin | CSS 수정·되돌리기, 광고·쿠키 배너 제거. | MISSING | — | `style`·`--undo`·`cleanup`·`prettyscreenshot` → M9-E |
| gstack | 시각 (`screenshot`, `pdf`, `responsive`, `diff`) | bin | 스크린샷 5모드, PDF, 375·768·1280 반응형 3장, URL 텍스트 diff. | ABSORBED | `mis browse screenshot\|pdf\|responsive\|diff` (M8) | M8 흡수 |
| gstack | 쿠키·헤더 (`cookie`, `cookie-import`, `cookie-import-browser`, `header`, `useragent`) | bin | 쿠키 설정·가져오기(실제 브라우저 포함), 요청 헤더. | MISSING | — | cookie·cookie-import·cookie-import-browser·header·useragent, guard 항상 ask → M9-E |
| gstack | 탭·프레임 (`tabs`, `tab`, `newtab`, `closetab`, `tab-each`, `frame`) | bin | 탭·iframe 전환. | PARTIAL | `mis browse tabs\|tab\|newtab\|closetab\|frame` (M8) | M8: 대부분 흡수. 남음: `tab-each` → M9-E |
| gstack | 추출 (`download`, `scrape`, `archive`) | bin | 브라우저 쿠키로 다운로드, 미디어 일괄 저장, MHTML 저장. | MISSING | — | download·scrape·archive, guard 항상 ask → M9-E |
| gstack | 스냅샷 (`snapshot -i -c -d -s -D -a -o -C`, `@e`/`@c` 참조, 참조 만료 감지) | bin | 접근성 트리 + 요소 참조로 안정적 조작. | PARTIAL | `mis browse snapshot -i -c -d -s -D -a -o`, `@e` 참조 (M8) | M8: 대부분 흡수. 남음: `-C`·`-H`, `@c` 참조 → M9-E |
| gstack | headed 모드 (`connect`, `disconnect`, `focus`, `state save\|load`, `memory`) | bin | 보이는 Chrome 연결, 상태 저장·불러오기, 메모리 진단. | PARTIAL | `mis browse handoff` (보이는 창, M8) | M8: handoff 창만. 남음: `connect`·`disconnect`·`focus`·`state save\|load`·`memory` → M9-E |
| gstack | 인계 (`handoff`, `resume`) | bin | CAPTCHA·MFA 등에서 사용자에게 넘겼다가 다시 받기. | ABSORBED | `mis browse handoff\|resume` (M8) | M8 흡수 |
| gstack | 메타 (`chain`, `inbox`, `watch`) | bin | 명령 묶음 실행, 사이드바 메시지, 사용자 탐색 관찰. | PARTIAL | `mis browse chain` (M8) | M8: chain. 남음: `inbox`·`watch` → M9-E |
| gstack | browser-skills 런타임 (`skill list\|show\|run\|test\|rm`, `browser-skills/`) | bin | 사이트별 스크립트 스킬 3단 저장소·실행. | MISSING | — | 사이트별 스크립트 스킬 저장소·실행 → M9-E |
| gstack | domain-skills (`domain-skill save\|list\|show\|edit\|promote-to-global\|rollback\|rm`) | bin | 사이트별 에이전트 메모, 격리 → 활성 → 전역 승격. | MISSING | — | 사이트별 메모와 승격 → M9-E |
| gstack | `extension/` (사이드패널·인스펙터·터미널) | bin | headed Chrome 사이드바 확장. | MISSING | — | headed Chrome 사이드바 확장 → M9-E |
| gstack | `design/` 바이너리 (generate·variants·compare·iterate·evolve·serve·gallery) | bin | OpenAI API로 디자인 시안 이미지 생성·비교 보드. | MISSING | — | OpenAI 이미지 시안 생성, 호출마다 guard ask [정책] → M9-D |
| gstack | `supabase/` (edge functions, config) | bin | 텔레메트리·커뮤니티 집계 백엔드. | MISSING | — | 텔레메트리 집계 백엔드 연동, 기본 꺼짐 [정책] → M9-D |
| gstack | `hosts/` (codex·cursor·factory·kiro·opencode·openclaw·hermes·gbrain), `openclaw/`, `agents/openai.yaml`, `model-overlays/`, `conductor.json` | bin | 다른 호스트·모델용 변환·설정. | N/A | — | 다른 호스트 전용 |

### 5.5 `~/.claude/skills/`의 gstack 외 디렉터리 (참고)

다음은 4개 원본에 속하지 않아 매트릭스 집계에서 뺐다: `computer-use`, `orca-cli`, `orchestration` (Orca 도구, `~/.agents/skills` 링크), `frontend-designer`·`omc-learned/` (OMC learner가 만든 사용자 학습 스킬 → OMC skill-injector가 주입하던 대상이므로 M6 학습 스킬 주입에서 다룬다), `proofshot` (별도 시각 검증 스킬), `synced/` (동기화 데이터).

## 6. 교차 요구사항 (표에 드러나지 않는 암묵 요구)

### 6.1 전역 지시 파일이 원본 도구를 참조한다

원본을 제거하면 아래 지시문이 없는 도구·에이전트를 가리키게 된다. MIS 설치 단계(M9 setup)에서 교체안을 제시하고, 사용자 승인 후에만 고친다.

| 파일 | 참조하는 것 | 제거 후 문제 | 대응 |
|---|---|---|---|
| `~/.claude/CLAUDE.md` OMC 블록 (2벌: 상단 요약 + `<!-- OMC:START -->…<!-- OMC:END -->`) | `/oh-my-claudecode:*` 스킬, `oh-my-claudecode:` 에이전트, `state_*`·`notepad_*`·`project_memory_*`·`lsp_*`·`ast_grep_*`·`python_repl`, `omc_run_team_*`, `TeamCreate`·`TaskCreate` 등, 매직 키워드, `<remember>` 태그, `.omc/` 경로 | 모델이 없는 스킬·도구를 호출하려 한다 | MIS용 블록으로 교체 (`mis setup`이 diff를 보여 주고 승인 받기) |
| 같은 파일의 에이전트 목록 | `deep-executor`, `quality-reviewer`, `build-fixer` | OMC 4.15.6 `agents/`에 **없다** (19개만 존재). Spec §14.2도 `deep-executor`를 인용 | 매트릭스는 실제 19개만 집계. 지시문 교체 시 함께 정리 |
| `~/.claude/CLAUDE.md` CodeGraph 절 | `codegraph_*` MCP | 원본 4종과 무관, 그대로 유지 | 없음 |
| `~/.claude/rules/mcp/00-map.md`, `rules/workflows/10-planner.md`·`20-executor.md`·`30-research.md` | shrimp-task-manager 도구(`init_project_rules`, `plan_task`, `split_tasks`, `list_tasks`, `execute_task`, `research_mode`), context7, browsermcp | 4종 원본 소속은 아니지만 MIS의 plan·run 흐름과 역할이 겹친다 | 사용자 결정 필요: 유지 또는 MIS 흐름으로 교체 |
| 프로젝트 `CLAUDE.md`의 `## Skill routing` | gstack preamble이 추가한 스킬 라우팅 | gstack 스킬 이름을 가리킨다 | M9-F(F10) 완료: `mis setup routing`이 MIS 스킬로 교체하는 diff를 보여 주고 `--write`(guard ask) 때만 쓴다 (M6 검증 보고서 지적: 범위 이동 ADR 없음) |
| `~/.claude/settings.json` `enabledPlugins` | `superpowers@claude-plugins-official`와 `superpowers@superpowers-marketplace`가 **둘 다** 켜져 있다 | 지금도 세션 시작 맥락이 두 번 주입된다 | 원본 제거 시 함께 정리 |

### 6.2 statusLine은 하나뿐이다

- Claude Code의 `statusLine`은 한 슬롯이다. 지금은 OMC HUD(`~/.claude/hud/omc-hud-cache.sh … omc-hud.mjs`)가 차지하고 있고, Ponytail 상태줄은 등록되어 있지 않다.
- (M6 반영) MIS `scripts/statusline.mjs`는 이제 run이 없어도 `MIS ▸ idle · style … · loop … · frozen … · 브랜치 · 모델 · ctx %`를 출력하고, 기존 statusLine을 `statusLine.chain`으로 이어 붙인다. 에이전트 수·todo는 M9-F에서 추가했다(`agents N (k stale) · todo a/b`). 원래 요구는 다음과 같았다: 원본을 대체하려면 한 스크립트가 다음을 모두 그려야 한다: run 진행(현재 기능), 스타일 레벨(`[STYLE:ULTRA]` 등, Ponytail 대응), 활성 모드(ralph·ultrawork·team 등), 그리고 OMC HUD의 핵심 요소(모델, git 브랜치, context 사용률, 에이전트 수, todo).
- 플러그인은 statusLine을 직접 등록할 수 없다(ADR-0001 #8). `mis init`/`mis setup`이 기존 값을 보여 주고 교체를 제안한다. 기존 statusLine을 감싸서 이어 붙이는 방식(체이닝)을 선택지로 둔다.
- 상태줄은 실패하면 아무것도 출력하지 않는다(현재 구현과 같은 fail-open).

### 6.3 훅 실패 정책: 상시 훅은 fail-open, guard는 fail-closed

- 새로 추가할 상시 훅(SessionStart 규율·스타일 주입, UserPromptSubmit 키워드 라우터, SubagentStart 주입, PostToolUse 규칙 주입, Stop 지속 모드 등)은 오류·시간 초과 시 **아무 일도 하지 않고 통과**해야 한다. 이 훅들이 죽어서 대화가 막히면 안 된다.
- `scripts/guard.mjs`는 지금처럼 오류 시 ask(fail-closed)를 유지한다. 새 훅과 같은 프로세스에 합치지 않는다.
- (M6-07 반영) guard의 범위: `lib/policy.mjs` `careful`이 run 여부와 관계없이 적용된다(main/master force push 거부, 파괴 명령·다른 모델 호출 ask). freeze 경계도 run 밖에서 적용된다. 나머지 규칙(설치·push·계획 범위)은 여전히 활성 run이 있을 때만 적용된다. 자격 증명 기능(cookies, connect-chrome, scrape, `cookie-import-browser`, `cdp`)은 run 여부와 관계없이 **항상 ask**로 둔다.
- (M7-01 반영) M7 MCP 서버와 guard의 충돌: guard의 matcher는 `mcp__.*`이고 run 중 `MCP_WRITE`에 맞는 이름이면 ask한다. MIS 자체 도구(`notepad_write_*`, `state_write`, `wiki_add` 등)가 매번 확인을 받지 않도록 MIS 서버 이름을 허용 목록에 두되, 파일을 바꾸는 도구(`lsp_rename`, `lsp_code_action_resolve`, `ast_grep_replace`)는 계획 범위 검사를 그대로 적용한다. `python_repl`은 임의 코드 실행이므로 정책을 따로 정한다.
- OMC식 `state_*` 도구가 쓰는 "모드 상태"는 `.git/make-it-ship/`의 run 상태(오직 `mis.mjs`만 씀)와 다른 경로에 둔다. 그래야 "run 상태는 `mis.mjs`만 쓴다"는 규칙이 유지된다.

### 6.4 외부 전송 기능 [정책] 모음

조직 지침(사내 데이터를 타 클라우드로 업로드·clone 금지, Telechips 테넌트·GitHub·Vercel·Supabase 연동은 허용)과 충돌할 수 있다. 사용자 결정(2026-10-20)에 따라 모두 M9-D에서 구현하되, 외부 전송마다 guard가 항상 ask하고 텔레메트리·동기화는 기본 꺼짐으로 둔다:
- gstack 텔레메트리 동기화(`gstack-telemetry-sync`, `supabase/`, `gstack-community-dashboard`, `gstack-security-dashboard`). 참고: 조직 지침의 Supabase 허용은 "Claude Code로 만든 웹앱 배포"용이며, gstack 공용 Supabase로 보내는 것과는 다르다.
- gbrain 계열 전부(`setup-gbrain`, `sync-gbrain`, `gstack-brain-*`, `gstack-gbrain-*`), `gstack-artifacts-init`.
- `design/` 바이너리(OpenAI API로 이미지 생성), design-shotgun의 AI 시안.
- pair-agent(원격 터널), `gstack-ios-qa-daemon`·`-mint`(tailnet).
- 다른 모델 호출: OMC ask·ccg·`omc interop`, gstack codex·benchmark-models·`gstack-model-benchmark`. MIS는 이미 guard가 ask한다(`isOtherModel`).

### 6.5 플러그인 MCP 서버 로딩 (실측 완료)

- **실측 완료(2026-10-20, ADR-0003):** `--strict-mcp-config`를 켜면 플러그인 번들 `.mcp.json` 서버가 **로드되지 않는다**(probe 응답 `NO_TOOL`). 플래그를 빼면 로드된다(`PONG-7731`). M7 E2E는 플래그 없이 실행하거나 `--mcp-config`로 플러그인 서버를 명시한다.
- 플러그인 MCP 서버 이름은 `plugin:<플러그인>:<서버>` 형식이고, 도구 이름은 `mcp__plugin_make-it-ship_mis__<도구>`임을 M7 실사용(`plugin:make-it-ship:mis` connected, 도구 54개)으로 확인했다.
- 이번 세션에는 Claude Code 내장 `LSP` 도구가 지연 로드 도구로 보이고 `clangd-lsp` 플러그인이 켜져 있다. 이것은 M7 크기 추정에만 영향을 준다(내장 LSP를 감싸는 쪽이 더 작을 수 있음). M7은 언어 서버를 직접 띄우는 방식으로 `lsp_*`를 구현했다.

### 6.6 기타

- Spec §14.4 제외표와 §14.2 흡수표는 이 매트릭스와 사용자 결정 3에 맞게 개정해야 한다(이 문서는 Spec을 고치지 않는다).
- 원본 기능 중 상당수는 "단계 지시문에 흡수"되어 있지만 단독 명령이 없다(plan, spec, office-hours, plan-*-review, document-generate, design-* 등). 단독 명령을 늘릴지, `/make-it-ship:run --phase <이름>` 하나로 열지 결정이 필요하다 (M9-B 착수 전 결정, `docs/research/m9-plan.md`).
- `mis check`·`mis ship`·`mis cancel` 등 대부분의 명령은 활성 run을 요구한다(`lib/commands.mjs` `no active run`). run 밖 기능(verify, finishing-a-branch 등)을 열려면 경량 run 자동 생성 또는 run 없는 모드가 필요하다.

## 7. 마일스톤 제안 (MISSING·PARTIAL 묶음)

M6–M8은 구현 완료(독립 검증 진행 중, PROGRESS M6-10·M7-05·M8-05)이다. 남은 204행의 M9 작업 묶음, 행 목록, 수용 기준, 의존성, 크기는 `docs/research/m9-plan.md`에 있다. 아래는 원래 제안(이력)이다.

크기: S(며칠) · M(1~2주) · L(2주 이상), 상대 추정.

| 마일스톤 | 범위 | 포함 항목 (매트릭스 행) | 크기 |
|---|---|---|---|
| **M6 — 매트릭스 + 상시 계층** | 이 문서 확정. 모든 대화에서 동작하는 훅 계층 (전부 fail-open) | SessionStart 규율 주입 (Superpowers `using-superpowers`·TDD·verification 규율, OMC session-start 모드 복원 안내); 스타일 레벨 lite·full·ultra·off + `/…style` 명령 + 기본값 설정 + 서브에이전트 주입 + 코드베이스 지도 (Ponytail 전 훅); UserPromptSubmit 키워드 라우터 (§2.5 전 키워드, 한·일 변형, 비활성 목록, `test-prompt`); 지속 모드 Stop 훅 (ralph·autopilot·ultrawork), cancel 통합; 규칙 주입·학습 스킬 주입·검증 알림; statusLine 병합 (§6.2); run 밖 careful·freeze 정책 (§6.3); 전역 지시문 교체 제안 (§6.1) | L |
| **M7 — MCP 도구 서버** | 플러그인 `.mcp.json` + Node MCP 서버 (npm 의존성 허용) | `lsp_*` 12개, `ast_grep_search/replace`, `python_repl`, `notepad_*` 6개, `project_memory_*` 4개, `state_*` 5개, `shared_memory_*` 5개, `session_search`, `trace_*` 2개, `wiki_*` 7개 + wiki 훅, `merge_readiness_*` 5개, `deepinit_manifest`, 스킬 목록·로드 3개, `<remember>` 태그 처리, PreCompact 기억 보존. `--strict-mcp-config` 실측과 guard 허용 목록 (§6.3·§6.5) | L |
| **M8 — 브라우저·팀·문서 변환** | browse 데몬 (Playwright 또는 CDP), tmux 팀 워커, make-pdf | browse §5.4 명령 그룹(쿠키·자격 증명 제외 핵심), `qa`/`qa-only`/`design-review`/`benchmark`/`visual-verdict`를 자체 브라우저로 실행, Superpowers visual companion 서버; `omc-teams`, `team` 단계 파이프라인, `omc launch`, OMC `qa-tester` tmux 조작, `omc_run_team_*`; make-pdf (`pdf` 재사용) | L |
| **M9 — 나머지 이전 제외 기능** | Spec §14.4에서 풀린 것 (알림·BSP 제외) | setup·doctor 확장·mcp-setup·setup 라우터·omc-reference·help; skill·skillify·learner·writing-skills; upgrade(업데이트 확인·세션 시작 갱신·uninstall); sciomc·scientist·autoresearch·self-improve·writer-memory; canary·landing-report·setup-deploy·land-and-deploy 배포 실행; connect-chrome·setup-browser-cookies·scrape·skillify(browser)·browser-skills·domain-skills·extension (모두 guard 항상 ask); ponytail-audit·ponytail-gain·`mis debt`; cso 전체 감사; ship VERSION 증가; 단독 명령(plan, spec, office-hours, plan-*-review, document-generate, design-*) ; [정책] 항목은 결정 후에만 | L |
| **M10 — 원본 대비 비교 벤치마크** | 같은 과제를 원본 4종 조합과 MIS로 실행해 비교 | 과제 세트(버그 수정·기능 추가·리팩터·UI·문서), 지표(판정 정확도, 거짓 완료 비율, 변경 줄 수, 질문 수, 소요 시간, 비용), Ponytail `benchmarks/` 참고, 결과로 ponytail-gain 대응 화면 채우기 | M |
