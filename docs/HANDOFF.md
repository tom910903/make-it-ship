# 작업 인계 (HANDOFF) — 2026-11-10

새 세션은 이 문서부터 읽는다. 원본 기록은 `docs/PROGRESS.md`, `git log`, `docs/milestones/*-report*.md`다.

## 0. 통합 라인

- **2026-10-30 master로 전환했다**(사용자 결정: NH 사람 확인 전에 전환). 이제 개발 라인과 GitHub 기본 브랜치는 `master`이고, version은 0.3.0이다. 마켓플레이스 설치도 master에서 받는다.
  - 이전 라인 `feature/make-it-ship-m1-m5`와 다른 작업 브랜치는 master에 모두 포함된 것을 확인하고 2026-11-10 로컬·원격에서 지웠다(사용자 결정). 지금은 `master` 하나다.
- (이전 기록) 개발은 `feature/make-it-ship-m1-m5` 한 라인에서 끝낸 뒤 master로 만든다(사용자 결정, 2026-10-21).
  - 작업 worktree: `~/orca/workspaces/make-it-ship/make-it-ship`
  - 저장소 본체 `~/Dev/Git/tools/make-it-ship`(main worktree, `.git`이 있는 곳)는 detached HEAD로 둔다. 같은 브랜치를 두 곳에서 checkout할 수 없기 때문이다.
  - 원격: `github.com/tom910903/make-it-ship` (비공개).
- 2026-10-21에 모든 작업 브랜치를 이 라인으로 병합하고 정리했다.
  - 병합 순서: `develop`(M6·M7 검증 PASS, 병합 검증 PASS) → `m9-fix4` → `m9-fix3` → `m8-wip`.
  - 병합 당시 M8·M9는 검증 FAIL 상태였다. 이후 이 라인에서 고쳐 둘 다 4차 검증 PASS(2026-10-21)를 받았다.
  - 병합할 때마다 전체 `npm test`를 돌려 통과했다(최종 737/737). 병합한 브랜치의 테스트 제목이 하나도 빠지지 않은 것도 확인했다.
  - 병합된 브랜치(`develop` 포함)와 worktree는 모두 지웠다. 이 상태는 원격에 push했다(`8765793`).
- 의미 충돌을 고친 곳:
  - `scripts/lib/keywords.mjs`: M9 코드가 M6 후속 수정에서 없어진 `LOOP_PREFIX`를 참조하고 있었다.
  - browse `actions.mjs`: M8의 업로드 차단 검사를 M9의 `gated()` 바깥, 호출하는 쪽으로 옮겼다.

## 1. 목표 (사용자 요청, 2026-10-20)

Make It Ship 하나만 설치하면 OMC·Superpowers·Ponytail·gstack의 기능을 모두 쓸 수 있게 한다. 여기에는 상시 동작, 도구, 설정, 연구·자가 개선 루프, 배포 후 운영, PDF 등이 포함된다.

- 제외: BSP, 알림
- 마지막 단계(M10): 다 만든 뒤 원본 4종과 같은 데모로 실제 비교하고, 결과를 **로컬 HTML**로 시각화한다.
- 범위와 결정: `docs/adr/0003-single-plugin-full-absorption.md`
- 갭 목록: `docs/research/gap-matrix.md`. `node scripts/gap-matrix.mjs --write`로 다시 집계한다.

사용자 결정 요약:
- npm 의존성 허용(아직 실제 의존성은 없음)
- 알림 제외
- 자격증명은 포함하되 항상 확인
- 외부 전송은 구현하되 항상 확인. 텔레메트리는 기본 꺼짐
- ralph는 접두형만 자동, 나머지는 모델 힌트
- 계획·리뷰·디자인 기능은 run 흐름과 자연어에 녹인다(단독 명령 남발 금지)
- 브라우저 업로드는 "로컬 전용 브라우저 모드"(3장 2번)
- `hardware` 위험 플래그 제거, 문서 업로드는 그대로 둔다(2026-10-21)
- 항상 한국어로 보고

## 2. 마일스톤 상태 (2026-10-22)

| M | 내용 | 상태 | 근거 |
|---|---|---|---|
| M1~M5 | 핵심 | 검증 PASS, 태그 `m1`~`m5-verified` | `FINAL-report.md`, `POST-FINAL-report.md` |
| M6 | 상시 동작 계층(훅, style, loop, freeze 등) | 검증 PASS, `m6-verified` | develop 병합 검증 `MERGE-develop-report.md` |
| M7 | MCP 도구 서버 | 검증 PASS, `m7-verified` | 같음 |
| M8 | 내장 브라우저(CDP pipe), pdf, visual-verdict, team, companion | **4차 검증 PASS**, `m8-verified`(`0c5b755`) | `M8-report-r4.md`: 로컬 전용 모드에서 유출 경로 24개 모두 0 B |
| M9 | 나머지 기능 전부(A~F) | **4차 검증 PASS**, `m9-verified`(`0c5b755`) | `M9-report-r4.md` |
| M10 | 원본 4종 + control vs MIS 실측 비교, 로컬 HTML | 실험 54회, 1차 검증 FAIL(집계 오류) → 원시 로그로 재계산 → **2차 검증 PASS**, `m10-verified`(`215ffca`) | `docs/m10/report.html`, `M10-report.md`, `M10-report-r2.md` |

M8·M9 검증 태그 이후의 수정(`b9b2c2c` 이후): browse 실행 설정 변수 검사를 모든 `mis` 명령으로 넓힘(pdf·canary·pair-agent), `sudo --chdir`·`env -vC` 처리, 브라우저 시작 대기 60초, README 한국어판과 사용법, `mis help` 문구. 모두 테스트를 붙였다(이후 layout 기능까지 전체 792/792).

**2026-10-22 추가 기능 (사용자 요청): 구조화된 폴더와 사람용·AI용 문서 분리.** 독립 검증 2회를 거쳤다(`LAYOUT-report.md`, `LAYOUT-report-r2.md`; r2의 LOW N1·N2는 고침, N3 메시지 가장자리 경우는 남김).
- `.make-it-ship.json`의 `layout`에 경로 규칙이 있으면, `mis plan set`이 규칙 밖 파일과 번역 짝이 빠진 사람용 문서를 거부한다(계획 단계에서만, run 밖에서는 강제하지 않음).
- AI용 문서는 `.ai/`(영어, 짧은 사실 목록): index, product, structure(규칙에서 생성), tech, conventions, decisions, modules/. 사람용 문서는 `docs/`에 `x.md` + `x.ko.md`.
- 루트 `AGENTS.md`가 기준 파일(핵심 규칙 + `.ai/` 지도)이고, `CLAUDE.md`는 `@AGENTS.md` 한 줄만 둔다. 실제 세션에서 로드되는 것을 확인했다(마커 안에 있어도 로드됨).
- `mis layout`(검사), `mis layout write`(문서·안내 생성, guard가 물음), `mis init --layout --write`(기존 설정에 layout만 추가).
- README 영문·한국어판은 유사 GitHub 프로젝트 12개의 README 구성을 조사해 다시 짰다. 긴 참조 내용은 `docs/reference.md` + `.ko.md`로 옮겼다.

M10 결과 요약(중앙값, control 대비): MIS는 비용 4.1~6.1배, 턴 2.2~2.6배, 시간 3.1~5.0배. gstack은 비용 7.5~8.2배. 54회 모두 실제 통과·정직한 보고라서 이 데모로는 통과율·정직성 차이를 말할 수 없고 오버헤드만 비교된다. OMC 워크플로는 9회 중 1회, superpowers는 6회만 실제로 실행됐다. 자세한 주의 사항은 보고서 "Read this first"에 있다.

gap-matrix(병합 전 m9-wip 기준): ABSORBED 341 / PARTIAL 23 / MISSING 8 / EXCLUDED 5 / N/A 15. PARTIAL·MISSING은 대부분 정책(외부 서비스·외부 모델 전송 금지)이나 장비(iOS 실기기) 때문이다.

## 3. 다음에 할 일

Claude가 할 수 있는 개발 항목은 모두 끝났다. 남은 것은 사람 확인과 결정이다.

1. **사람 확인**(사용자가 직접): NH-1~5 확인 창 누르기. NH-6 iPhone 실기기는 "추후 확인 필요"(시뮬레이터 AUTO 통과). NH-7·8은 2026-10-22 실제 codex로 AUTO 통과(gemini 미설치). NH-10 Android 실기기도 "추후 확인 필요"(에뮬레이터 AUTO 통과). 절차는 `docs/milestones/NEEDS_HUMAN.md`.
2. **master 전환 — 완료(2026-10-30, 사용자 결정으로 NH 사람 확인 전에 진행)**
   - master를 만들고 GitHub 기본 브랜치를 master로 바꿨다(`marketplace add tom910903/make-it-ship`는 기본 브랜치에서 설치).
   - 0.3.1(2026-10-30): git 저장소 밖에서 SubagentStop 훅이 오류를 기록하던 문제 수정.
   - 0.3.2(2026-10-30): HUD가 이미 설정되어 있으면 `mis init`이 다시 제안하지 않음. 헤드리스 Chrome의 백그라운드 감속 해제. clangd 테스트 예제 수정, Chrome 테스트 파일 간 잠금으로 동시 실행 시 시간 초과 해결.
   - 0.4.0(2026-11-04): 시각화 기능(`mis chart`, `mis diagram` 확장, `mis doc`, `mis slides`), 아래 3번.
   - 0.5.0(2026-11-10): `/make-it-ship:brainstorm`(브레인스토밍 단독)과 설계 → 슬라이드 덱, 아래 5번. 작업 브랜치는 모두 master에 병합된 뒤 로컬·원격에서 지웠다(사용자 결정).
   - 0.6.0(2026-11-10): claude-mem 흡수(관찰 기록, `mis memory`/`memory_search`, 턴 끝 Haiku 요약, 세션 시작 주입), 아래 6번. 독립 검증 r1·r2 FAIL → 수정 → r3 PASS.
   - 0.8.0(2026-11-13): HUD 항목 구성. Claude Code 입력의 effort·thinking·fast·PR·지출 한도·비용·줄 수·세션 시간·프롬프트 캐시·워크트리·세션/에이전트 이름·vim·출력 스타일 추가, ctx는 `context_window` 우선. `mis hud`·`/make-it-ship:hud`로 항목과 순서(`statusLine.items`), `br`로 줄바꿈.
   - 0.7.0(2026-11-10): 기억 전역화(`~/.make-it-ship/memory`, 프로젝트 = git 원격 주소), 프로젝트 간 검색, claude-mem 기록 자동 가져오기, 아래 7번. 독립 검증 r1 조건부 PASS → 수정 → r2 PASS.
   - 0.3.3(2026-10-30): HUD를 OMC처럼 시각화. ctx·5h·7d를 10칸 막대로 표시하고 리셋까지 남은 시간을 붙임. 70%부터 노랑, 85%부터 빨강. 검사 표시·판정·브랜치·모델에 색. `NO_COLOR`면 색 없음.
   - version 0.3.0: 0.2.0 이후의 `.ai/` layout, Android 기기·에뮬레이터 지원(`mis android`), 보고 뒤 리뷰로 run 다시 열기(PROPOSALS b), HUD 요금제 사용량(5h/7d). MCP 서버는 `plugin.json`의 version을 읽는다. 다음 릴리스 때도 version을 올려야 이미 설치한 사용자가 `plugin update`로 받는다(실측).
3. **시각화 기능 — 0.4.0으로 master에 병합(2026-11-04 사용자 결정, PR)**: `mis chart`(CSV/JSON·mermaid pie/xychart-beta, bar·line·pie·hbar), `mis diagram` 확장(subgraph·sequence·class·ER·state), `mis doc`(마크다운의 ```mermaid → HTML/PDF, en/ko 쌍), `mis slides`(Marp 부분집합, 16:9, PDF). run의 design "Visuals"와 ship Part A에서 쓴다. 독립 검증 1차 FAIL(HIGH: meta refresh로 로컬 파일 유출, 심링크로 저장소 밖 쓰기) → 수정 → 2차 PASS. 2차 MED/LOW(pdf -o 심링크 폴더, sequence `<br>`, 이미지 10MB 상한, hbar 보고값, 슬라이드 넘침)도 고쳤다. 남은 한계: `class Box~T~` 불가, Excalidraw는 사각형만, 여러 층 역방향 선은 직선, `mis pdf`는 mermaid 오류에도 종료 0, Marp 테마·`![bg]` 미지원.
4. ~~선택 개선(PROPOSALS)~~ 2026-10-26 (b)로 해결: 보고 뒤 코드 리뷰를 기록하면 run이 REPORTED → VERIFYING으로 다시 열린다(PROGRESS SPEC_CHANGES).
5. **브레인스토밍 단독 + 슬라이드 연결 — `feat/brainstorm`(2026-11-10 사용자 결정, master에 병합, 0.5.0)**: `/make-it-ship:brainstorm` 스킬(interview의 brainstorming 모드만 따로 실행, run 시작 안 함). 설계 문서 뒤에 `<slug>-design-slides.md`를 제안하고 `mis slides`로 HTML/PDF를 만든다. 새 코드 없음.
6. **claude-mem 흡수 — `feat/memory`(2026-11-10 사용자 결정)**: (1) 도구 호출마다 규칙 기반 관찰 기록, (2) `mis memory search|get`/`memory_search`(BM25), (3) 턴 끝 백그라운드 `claude -p`(Haiku, 기본 켜짐)로 claude-mem 형식 기억·턴 요약을 만들고 새 세션 시작 때 claude-mem 형식으로 주입. 실제 Haiku 스모크: 16초, 3.2k 토큰, 한국어 기록 정상. 독립 검증 r1(HIGH 비밀값) → r2(HIGH 구버전 기록 재마스킹, MED 마스킹 우회·줄 위조·문서) → r3 PASS. 0.6.0으로 master에 병합(사용자 지시). 플러그인으로 설치하면 claude-mem은 끌 것(기억 블록·요약기 중복).
7. **기억 전역화 + claude-mem 가져오기 — `feat/memory-global`(2026-11-10 사용자 결정, 0.7.0으로 master에 병합)**: 저장소 `~/.make-it-ship/memory/projects/<이름>-<해시>/`, 프로젝트 키 = git 원격 주소(자격 증명 제거), `--all`/`--project` 검색, `mis memory projects`, claude-mem DB(node:sqlite 읽기 전용)를 프로젝트별로 첫 세션에 자동 가져오기, 0.6.0 파일 이전, 세션별 요약 커서.

## 4. 열린 결정

- (결정됨, 2026-10-30) master 전환과 version 0.3.0은 NH 사람 확인 전에 진행했다(이전 결정 "NH 뒤"를 대체).
- (결정됨, 2026-10-26) PROPOSALS (b) 적용.
- NH-6: 실기기가 준비되면 유지·닫기·제거 결정. NH-7·8: 사람 확인 후 닫기 결정
- (2026-10-30) 원격 기본 브랜치는 master다.

## 4-1. 남은 위험 (LOW)

- guard에서 allow되는 경우(의도적 우회는 위협 모델 밖이라 결함이 아니라 위험으로 둔다):
  - worktree 안의 implementer가 main 트리의 다른 task 파일을 편집하는 경우
  - `file_path`가 실제 경로가 아닌 경우(예: `/private/tmp`가 아니라 `/tmp`로 준 경우). 계획 범위 검사를 건너뛴다.
- 문서 잔재:
  - `docs/milestones/M5-e2e.md`에 BSP 절차가 남아 있다. 역사 기록이라 그대로 둔다.
  - Spec §435 qa 행에 BSP가 남아 있다. Spec은 수정하지 않고 SPEC_CHANGES에 기록했다.
- 설치 확인 범위:
  - GitHub 마켓플레이스 설치는 user 범위로만 확인했다. `--scope project`는 확인하지 않았다.
  - develop 병합본(`8353e07`)은 로컬 마켓플레이스로 설치해 MCP 서버 연결, 도구 호출, 스킬 동작을 확인했다(AUTO). 최종본은 M10 실험에서 `--plugin-dir`로 54회 중 MIS 9회를 돌렸다(MCP 서버 연결 포함).
- 브라우저 통합 테스트는 CPU 여유가 필요하다. CPU를 포화시키면(코어 수 2배의 `yes`, 또는 Defender 검사와 겹칠 때) Chrome 렌더러가 굶어 간헐적으로 실패한다(PROGRESS RISKS). 실패해도 유출 바이트는 0이었다.

## 5. 운영 메모

- 독립 검증 에이전트는 보고서 파일만 쓰고, 소스는 건드리지 않는다. 커밋은 조정자가 한다. 수정은 별도 worktree에서 하고 조정자가 병합한다.
- 여러 에이전트가 같은 scratchpad를 쓰면 로그가 섞인다. 에이전트마다 고유 TMPDIR과 로그 이름을 지정한다.
- 고부하(load 20~280)에서 시간 상한에 기대는 테스트가 흔들렸다. 테스트는 이벤트나 파일 게이트로 결정적으로 만든다.
- 부하 테스트에 `yes`를 쓸 때는 bash 배열과 `trap … EXIT`로 반드시 종료한다. zsh에서 `kill $pids` 문자열로 넘기면 종료되지 않는다.
- 테스트 env는 `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CONFIG_DIR`를 지우고, `HOME`·`MIS_STATE_HOME`을 임시 디렉터리로 둔다.
- 자동 테스트(`npm test`)는 외부 모델 CLI(codex/gemini), ngrok, 실제 배포 서비스를 호출하지 않는다. stub과 localhost만 쓴다.
- 외부 모델 CLI(codex/gemini)는 수동 검증(NH 등)에서 실제로 호출해도 된다(2026-10-22 사용자 결정: 개인 프로젝트). 합성 데모 저장소(`evals/setup-demo.mjs`)에만 쓴다.
- 플러그인 설치를 확인한 뒤 `~/.claude/plugins/cache/<marketplace>`가 남는다. 직접 지운다.

## 6. 다른 장비에서 시작하기

```sh
git clone git@github.com:tom910903/make-it-ship.git && cd make-it-ship
git checkout master
node --version              # 22 이상
npm test                    # 실패 0 기대
claude plugin validate .claude-plugin/plugin.json   # 통과 기대
claude plugin validate .                            # 마켓플레이스 매니페스트
claude --plugin-dir "$PWD"  # 다른 저장소에서 /make-it-ship:run ... 으로 사용
```
설치해서 쓰는 방법은 README Install에 있다: `claude plugin marketplace add tom910903/make-it-ship` 다음에 `claude plugin install make-it-ship@make-it-ship`.

새 세션 시작 프롬프트 예시:
```
docs/HANDOFF.md를 읽고 3장 "다음에 할 일"을 1번부터 이어서 진행해. 연속 모드, 한국어로 보고, push 금지.
```

## 7. 작업 규칙

- 우선순위: Spec v1.1(`docs/Make_It_Ship_Spec_v1.1.md` §2·§11·§14) > ADR(`docs/adr/`) > 기획서.
  - **기획서와 ADR은 수정하지 않는다.** Spec과 다르게 가야 하면 PROGRESS.md `SPEC_CHANGES`에만 기록한다.
  - ADR-0003(전부 흡수)의 사용자 결정은 M1~M5 때의 규칙보다 우선한다.
- 작업마다 TDD로 진행한다: 실패 테스트 → 최소 구현 → 전체 `npm test` → 커밋.
- **금지:**
  - 테스트 삭제·약화·skip
  - 실행하지 않은 검증을 통과로 기록하기
  - Spec과 ADR에 없는 기능 추가(필요하면 PROGRESS.md 제안으로만)
  - 사내 코드·데이터를 테스트에 쓰기
  - 외부 모델 CLI를 합성 데모 저장소 밖에서 호출하기(2026-10-22 사용자 결정으로 사내 정책 금지는 해제)
- npm 의존성은 ADR-0003에 따라 허용한다. 다만 마켓플레이스 설치는 `npm install`을 하지 않으므로, 런타임 의존성을 넣으려면 배포 방식을 먼저 정해야 한다.
- 사람이 확인해야 하는 항목은 NEEDS_HUMAN으로 둔다. Claude가 대신 확인한 것은 "AUTO"로만 적는다.
- 멈추고 물어볼 때: Spec이나 ADR 결정을 바꿔야 할 때, 같은 문제로 3번 시도해도 진전이 없을 때.

## 8. 구조 요약

| 경로 | 내용 |
|---|---|
| `scripts/mis.mjs`, `scripts/lib/commands.mjs` | `mis` CLI(start/plan/approve/task/check/verdict/report/freeze/loop/…) |
| `scripts/guard.mjs`, `scripts/lib/policy.mjs`, `scripts/lib/shell.mjs` | PreToolUse 훅. 셸 토크나이저로 ask/deny를 판정하고, 내부 오류 시 ask(fail-closed) |
| `scripts/hooks.mjs`, `hooks/hooks.json` | 상시 동작 훅(SessionStart, UserPromptSubmit, Stop 등) |
| `.mcp.json`, MCP 서버 `mis` | memory, wiki, LSP/REPL, trace 등 도구 |
| `scripts/lib/verdict.mjs`, `state.mjs`, `tree-hash.mjs` | 판정 규칙(§6), run 상태(`<git-common-dir>/make-it-ship/runs/`), 증거의 STALE 판정 |
| `skills/`, `skills/run/phases/*.md` | 전체 흐름(discover → plan → 승인 → implement → verify → review → qa → report → ship)과 단독 스킬 |
| `agents/*.md` | 읽기 전용 리뷰어들과 implementer(쓰기 가능) |
| `.claude-plugin/plugin.json`, `marketplace.json` | 플러그인 매니페스트, 저장소 자체 마켓플레이스 |
| `evals/setup-demo.mjs`, `evals/demos/` | 합성 데모 저장소 |
| `tests/` | `node:test` 단위·통합 테스트 |
| `docs/milestones/` | 마일스톤 보고서, 최종·사후 보고서, NEEDS_HUMAN, NH 자동 확인 기록 |

## 9. 대화형 확인을 자동으로 돌리는 방법 (NH-1~5에서 쓴 방식)

```sh
node evals/setup-demo.mjs a /tmp/nh1 && cd /tmp/nh1
mkdir -p .claude && echo '{"permissions":{"allow":["Bash","Read","Write","Edit","Glob","Grep","Agent"]}}' > .claude/settings.local.json
tmux new-session -d -s nh1 -x 220 -y 60 "claude --plugin-dir <repo> --setting-sources project,local"
tmux send-keys -t nh1 -l "/make-it-ship:run Implement docs/feature-request.md. Use standard mode." && tmux send-keys -t nh1 Enter
tmux capture-pane -p -t nh1 | tail -30   # 확인 창 확인 후 Enter(승인) / Down+Enter(거절)
```

- 기본 권한 모드가 auto로 잡혀 있으면 shift+tab(`tmux send-keys BTab`)으로 manual로 바꾼 뒤 확인한다.
- `--strict-mcp-config`를 주면 플러그인 MCP 서버(M7 도구)가 로드되지 않는다(ADR-0003 실측).
- headless 모드(`claude -p`)에서는 ask 확인 창이 뜨지 않는다(ADR-014). 확인 창을 검증하려면 위처럼 대화형 세션을 쓴다.
- 사용자 전역 설정(`~/.claude/settings.json`)은 건드리지 않는다. HUD는 데모 저장소의 `.claude/settings.local.json`에 `statusLine`을 넣어 확인한다.
