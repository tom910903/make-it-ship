# M7 독립 검증 보고서 (MCP 도구 서버)

- 대상: worktree `make-it-ship-m7`, 브랜치 `m7-wip` (HEAD e084ce5)
- 검증자: 독립 검증 에이전트 (구현에 참여하지 않음). PROGRESS·커밋 메시지는 근거로 쓰지 않았다.
- 일시: 2026-10-20

## 요약 판정
**DEFECTS FOUND** (차단급 없음: 높음 0, 중간 3, 낮음 4, 정보 2)

- 54개 도구가 모두 노출되고 stdio로 모두 호출되었다. 49개 PASS, ast_grep 2개는 바이너리가 없어 BLOCKED 안내(PASS 처리), trace 2개와 lsp_diagnostics_directory는 PARTIAL이다. clangd로 LSP 12개를 실제 실행했고, rename과 code action은 디스크에 반영되었다.
- 안전성 확인: 이름·경로 탈출 차단, run 상태 미기록, 내장 모드 읽기 전용, 저장소 밖 wiki_ingest 거부, REPL·LSP 프로세스 정리, guard의 자체 도구 규칙(활성 run에서는 파일 재작성 ask, freeze deny)이 모두 동작했다. 실제 도구 접두어 `mcp__plugin_make-it-ship_mis__`가 policy의 `OWN_MCP`와 같음을 확인했다.
- 실사용: headless 세션에서 모델이 도구 20여 종을 썼고 결과를 디스크에서 확인했다. `--strict-mcp-config`에서는 플러그인 서버가 빠진다는 주장도 확인했다. MCP 서버는 `CLAUDE_CODE_SESSION_ID`를 받는다(style lite가 state_get_status에 반영됨).
- 중간 결함 3개:
  - D1: `workingDirectory`를 검증하지 않아 기억이 조용히 엉뚱한 저장소나 전역 저장소에 쌓인다.
  - D2: `<remember>`를 subagent 위임 prompt에서도 뽑고, 중복·JSON 이스케이프된 채 저장한다. 실사용에서 재현했다.
  - D8: gap §2.3에서 M7로 배정한 project memory 자동 감지(SessionStart)와 학습(PostToolUse) 훅이 빠졌다.

## 실행 명령과 수치
- `npm test`: 401 tests, pass 401, fail 0, skipped 0, todo 0 (약 69초), exit 0
- `claude plugin validate .`: ✔ Validation passed
- 스텁 검색 (`.skip(`, `.only(`, `todo:`, `TODO`, `not implemented`, tests/·scripts/): M7 관련 스텁 없음 (계획 task 상태값 'TODO' 문자열만 검색됨)
- `tools/list` (자체 stdio JSON-RPC 클라이언트 `drive.mjs`, 임시 저장소 `scratchpad/v/repo`, `MIS_STATE_HOME`=임시 디렉터리): **54개**. OMC `mcp-server.cjs`의 54개 이름과 1:1 대응 (스킬 3개만 `list_omc_skills`→`list_skills`, `load_omc_skills_*`→`load_skills_*`로 개명). 중복 이름 없음(registry가 검사).
- 모든 54개 도구를 stdio로 최소 1회 호출했다 (아래 표). LSP는 실제 clangd(Xcode toolchain)로 C 파일에 대해 실행했다.
- 환경: python3 3.9(Xcode), clangd, sourcekit-lsp 존재. typescript-language-server·ast-grep·gopls·pyright 없음.

## 도구별 표

판정: PASS = 기능·입력이 OMC와 같은 의미로 동작, PARTIAL = 동작하지만 OMC 대비 입력·범위 차이, FAIL = 동작 안 함.

| # | 도구 | 판정 | 근거 (호출 결과) | OMC 대비 |
|---|---|---|---|---|
| 1 | list_skills | PASS | plugin 스킬 목록(name/scope/description/path) 반환 | 이름 변경, `projectRoot` 인자 없음(세션 cwd 고정) |
| 2 | load_skills_local | PASS | `.make-it-ship/skills` 없음 → `[]` | `.omc/skills` 대신 `.make-it-ship/skills`; 본문 전체 반환(OMC는 메타데이터만) |
| 3 | load_skills_global | PASS | `~/.make-it-ship/skills` 없음 → `[]` | 동일 성격 |
| 4 | notepad_read | PASS | 없을 때 안내, 작성 후 3섹션 출력, `section` 필터 | 동일 |
| 5 | notepad_write_priority | PASS | 40자 기록, 빈 문자열은 오류 | 동일(500자 경고, 2000자 상한) |
| 6 | notepad_write_working | PASS | 타임스탬프 항목 추가 | 동일 |
| 7 | notepad_write_manual | PASS | 영구 항목 추가 | 동일 |
| 8 | notepad_prune | PASS | `daysOld:1` → pruned 0, `daysOld:0` → 범위 오류 | 동일 |
| 9 | notepad_stats | PASS | size/entries/oldest 반환 | 동일 |
| 10 | project_memory_read | PASS | 첫 읽기 시 감지·저장, `section` 필터(conventions/directives) | 동일(첫 읽기 쓰기 부작용도 OMC와 같음) |
| 11 | project_memory_write | PASS | `merge:true` 깊은 병합, `__proto__` 키 무시 | 동일 |
| 12 | project_memory_add_note | PASS | `[build]` 노트 추가 | 동일 |
| 13 | project_memory_add_directive | PASS | high 우선 지시 추가, 대소문자 다른 중복은 "already present" | 동일 |
| 14 | state_read | PASS | 사용자 모드 읽기, `../../current` 거부 | 내장 모드(run/loop/style/freeze)는 실시간 읽기 전용 |
| 15 | state_write | PASS | 명시 필드가 `state` 객체보다 우선, run/loop 쓰기 거부 | `.omc/state` 대신 `.git/make-it-ship/memory/modes` |
| 16 | state_clear | PASS | 사용자 모드 삭제, `freeze` 거부 | 동일 |
| 17 | state_list_active | PASS | 활성 run·style·사용자 모드 나열 | session_id는 호환용(무시) |
| 18 | state_get_status | PASS | 단일/전체 상태 | 동일 |
| 19 | shared_memory_write | PASS | 값 저장, ttl, `../runs`·`../../current` 이름 거부, value 누락 거부 | 동일 |
| 20 | shared_memory_read | PASS | 읽기, 만료 항목은 not found 후 삭제 | 동일 |
| 21 | shared_memory_list | PASS | 네임스페이스 목록 / 키 목록 | 동일 |
| 22 | shared_memory_delete | PASS | `deleted:true` | 동일 |
| 23 | shared_memory_cleanup | PASS | 만료 1건 제거 | 동일 |
| 24 | wiki_add | PASS | 페이지 생성, 중복 시 오류, `index` 예약어 거부 | 동일; `workingDirectory` 없음 |
| 25 | wiki_ingest | PASS | 기존 페이지에 append 병합(tags·confidence 갱신), `path`로 저장소 파일 수집, 저장소 밖·심볼릭 링크 탈출·`../` 거부 | `path`는 MIS 추가 기능 |
| 26 | wiki_read | PASS | 렌더링, `../../README`·`index` 거부 | 동일 |
| 27 | wiki_list | PASS | 범주별 index.md | 동일 |
| 28 | wiki_query | PASS | "refresh tokens" 순위, 한국어 "인증" 매칭(CJK bigram) | 동일 |
| 29 | wiki_delete | PASS | 삭제, `../README` 거부 | 동일 |
| 30 | wiki_lint | PASS | broken-ref·orphan 탐지 | 동일 |
| 31 | session_search | PASS | 빈 query·잘못된 since 오류, 결과 구조 정상 (실 전사본 양성 검색은 실사용 절 참조) | `workingDirectory` 없음 |
| 32 | trace_timeline | PARTIAL | run 이벤트 + 훅 이벤트 병합, `filter`, `last`, 없는 runId 오류 | OMC는 sessionId 기준, MIS는 runId 기준. 훅 기록은 이벤트 이름·도구 이름뿐(guard 판정 없음, 결함 D3) |
| 33 | trace_summary | PARTIAL | run 상태·이벤트 수·훅 수 | 위와 같음 |
| 34 | deepinit_manifest | PASS | check→scan→diff(added)→save dryRun→save→diff(unchanged), 잘못된 mode 조합 거부 | 동일; `workingDirectory` 없음 |
| 35 | merge_readiness_start | PASS | quick 프로필 시작, 진행 중 재시작 거부, `--upload-pack=…` baseRef 거부 | run 증거(verdict) 연동 추가 |
| 36 | merge_readiness_set_content | PASS | 차원 누락 거부, 정상 제출 시 첫 질문 반환 | 동일 |
| 37 | merge_readiness_record_answer | PASS | 순서 아닌 질문 거부, 3/3 정답 → pass(score 1) | 동일 |
| 38 | merge_readiness_report | PASS | 완료 전 정답 숨김, 증거·경계 문구 | 동일 |
| 39 | merge_readiness_cancel | PASS | 세션별 취소, 감사 기록 유지, 비활성 시 오류, `../../runs` session_id 거부 | 동일 |
| 40 | lsp_hover | PASS | clangd: `function add → int` | 동일 |
| 41 | lsp_goto_definition | PASS | 1:4 정의 위치 | 동일 |
| 42 | lsp_find_references | PASS | 선언+사용 2건 | 동일 |
| 43 | lsp_document_symbols | PASS | add/main/bad | 동일 |
| 44 | lsp_workspace_symbols | PASS | `add` 검색 1건 | OMC와 같이 file로 서버 선택 |
| 45 | lsp_diagnostics | PASS | `undeclared identifier 'undefined_var'` error, severity 필터 | 동일 |
| 46 | lsp_diagnostics_directory | PARTIAL | C 저장소(오류 있는 main.c)에서 `success:true, filesChecked:0` | OMC와 같은 TS/JS 전용 기본값. 결함 D5 |
| 47 | lsp_servers | PASS | clangd·sourcekit-lsp installed, 나머지 installHint | 동일 |
| 48 | lsp_prepare_rename | PASS | 범위 + placeholder `add` | 동일 |
| 49 | lsp_rename | PASS | 미적용 미리보기(2 edits) → `apply:true`로 디스크 반영(`sum`) | OMC는 미리보기 전용("Does NOT apply the changes automatically", lsp-tools.js:268). MIS는 기본 미리보기 + `apply:true` 쓰기 경로 추가(gap §2.4 "파일 쓰기 → guard 범위 적용"대로) |
| 50 | lsp_code_actions | PASS | `insert ';'` quickfix | 동일 |
| 51 | lsp_code_action_resolve | PASS | `;` 삽입 후 파일 변경 확인, 잘못된 index 오류 | **의미 변경**: OMC는 편집 내용만 보여 줌(lsp-tools.js:317 "see what changes an action would make"). MIS는 미리보기 없이 항상 디스크에 쓰고 command도 실행(gap §2.4 "코드 액션 적용 (쓰기)"대로). 남은 위험 참조 |
| 52 | ast_grep_search | PASS(BLOCKED) | `BLOCKED: ast-grep not found on PATH. Install with: brew install ast-grep, …` | OMC는 `@ast-grep/napi`; 인자 `path`→`paths`, `context` 없음 |
| 53 | ast_grep_replace | PASS(BLOCKED) | 위와 같은 BLOCKED 안내 | 인자 `replacement`→`rewrite`, `dryRun`→`apply` |
| 54 | python_repl | PASS | 변수 유지, 예외·SystemExit 후 세션 유지, 1.5초 타임아웃 시 SIGINT 후 상태 유지, SIGINT 무시 코드는 SIGKILL, reset/get_state/interrupt | `executionLabel`·`queueTimeout` 없음(무시됨). 강제 종료 직후 첫 호출은 실행 안 되고 오류 반환(결함 D6) |

미검증 도구 경로: ast-grep 실제 검색·치환(바이너리 없음), TS/Python/Go 언어 서버.

## 안전성 검사

| 항목 | 결과 | 근거 |
|---|---|---|
| 기억 이름 경로 탈출 (mode/namespace/key) | 통과 | `../x`, `..evil`, `../../current`, `../runs` 모두 `invalid ...` 오류. 정규식 `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$` + `..` 금지 |
| run 상태 쓰기 (runs/·current) | 통과 | 저장 위치는 `<git-common-dir>/make-it-ship/memory/`, merge-readiness/, deepinit/. `workingDirectory=<repo>/.git/make-it-ship/runs/<id>`를 줘도 `git rev-parse --git-common-dir`가 절대 경로를 돌려 `memory/`에 기록됨(runs/ 안에 파일 생성 없음, find로 확인) |
| state_write 내장 모드 | 통과 | run·loop·style·freeze 쓰기/삭제 모두 read-only 오류 |
| wiki 경로 | 통과 | `wiki_read/delete`의 `../` 거부, 예약 페이지 거부 |
| wiki_ingest 저장소 밖 파일 | 통과 | 절대 경로 밖 파일, `../outside.txt`, 밖을 가리키는 심볼릭 링크 모두 거부. 단 `.git/config` 같은 저장소 내부 `.git/` 파일은 수집됨(결함 D4) |
| merge-readiness session_id | 통과 | `../../runs` → invalid session_id. baseRef `--upload-pack=evil` 거부 |
| workingDirectory 인자 | **문제** | 다른 저장소 경로를 주면 그 저장소의 `.git/make-it-ship/memory/`에 기록, 존재하지 않는 경로·git 아닌 경로는 조용히 `~/.make-it-ship/memory/`(사용자 전역)에 기록. OMC는 신뢰 루트(세션 저장소)와 다르면 무시. 결함 D1 |
| python_repl 정리 | 통과 | 하위 프로세스(`sleep 300`)까지 프로세스 그룹으로 종료. 서버 stdin EOF·SIGTERM 시 python·clangd 모두 종료 확인(pgrep). 서버가 SIGKILL되면 유휴 REPL·clangd는 stdin EOF로 스스로 종료하지만, 실행 중인 무한 루프 코드와 그 하위 프로세스는 남음(남은 위험) |
| LSP 서버 정리 | 통과 | 서버 종료(stdin end/SIGTERM/SIGKILL) 후 clangd 잔존 없음 |
| guard: 자체 도구 | 통과 | run 없음: 전부 allow. 활성 run: `lsp_rename apply:true`·`lsp_code_action_resolve`·`ast_grep_replace apply:true`는 ask, 미리보기와 notepad/state/wiki/shared/merge_readiness/python_repl은 allow. 다른 서버 `mcp__other__create_issue`는 ask(기존 규칙 유지) |
| guard: freeze | 통과 | freeze=src: `lsp_rename apply`·`lsp_code_action_resolve`는 경로를 알 수 없어 항상 deny, `ast_grep_replace` paths=src allow, `.`·paths 없음·src 안 심볼릭 링크로 밖을 가리킴 → deny |
| 도구 이름 접두어 | 실사용에서 확인 | 아래 실사용 절 |

## 훅 검사 (hooks.mjs를 직접 stdin JSON으로 실행, `MIS_STATE_HOME` 임시)

| 항목 | 결과 | 근거 |
|---|---|---|
| `<remember>` in Read 결과 | 저장 안 됨 (정상) | notepad.json에 FROM_READ 없음 |
| `<remember priority>` in Bash 출력 | 저장 안 됨 (정상) | FROM_BASH 없음 |
| Agent 결과 `<remember>` | 저장됨 | working에 FROM_AGENT |
| Task 결과 `<remember priority>` | 저장됨 | priority = PRIO_FROM_TASK |
| Stop `last_assistant_message` | 저장됨 | working에 FROM_STOP |
| Agent 결과의 여러 줄·따옴표 | **문제** | `"line one\nline \"two\""` 가 `line one\\nline \\\"two\\\"`(JSON 이스케이프 그대로)로 저장됨. `JSON.stringify(tool_response)`에서 정규식으로 뽑기 때문. OMC도 같은 방식(post-tool-verifier.mjs:1093). 결함 D2 |
| SessionStart (startup) | 통과 | `# Project memory` 블록에 priority 노트와 `[high]` 지시. wiki 없으면 wiki 줄 없음 |
| SessionStart (source=compact) | 통과(중복) | wiki 색인 + "preserved across compaction" 블록 주입. priority·지시가 두 블록에 두 번 나옴(정보성 D7) |
| PreCompact | 통과 | `systemMessage`로 priority·지시·wiki 요약 |
| SessionEnd, wiki 없음 | 통과 | `.make-it-ship/` 생성 안 됨 |
| SessionEnd, wiki 있음 | 통과 | `session-log-<hash>.md` 1개, 같은 세션 두 번째 호출은 중복 생성 안 함, log.md 기록 |
| trace 기록 | 부분 | `~/.make-it-ship/trace.jsonl`에 hook 이름·tool 이름만. guard.mjs는 appendTrace를 호출하지 않아 allow/ask/deny 판정이 남지 않음(D3). trace_timeline의 decision/reason 렌더링은 항상 비어 있음 |
| 훅 fail-open | 통과(기존) | 메모리·wiki 블록은 try/catch, 실패 시 빈 문자열 |

## 실사용 기록 (headless `claude -p`, Claude Code 2.1.292)

준비: `node evals/setup-demo.mjs a <scratchpad>/e2e/demo` (경로는 `/tmp/...`로 줘서 `/private/tmp` 실경로와 다른 경로를 일부러 사용), `native.c`(오류 1개) 추가, `src/text.ts`에 주석 한 줄 추가(미커밋). `MIS_STATE_HOME=<scratchpad>/e2e/home`.
공통 플래그: `--plugin-dir <m7 worktree> --setting-sources project --permission-mode bypassPermissions --output-format stream-json --verbose`.

1. **`--strict-mcp-config` 비교** (프롬프트 "Reply with the single word OK.", `--max-turns 1`):
   - 플래그 없음: init `mcp_servers`에 `{"name":"plugin:make-it-ship:mis","status":"connected","source":"plugin"}`, 도구 54개 `mcp__plugin_make-it-ship_mis__*`.
   - 플래그 있음: `mcp_servers: []`, mis 도구 0개. → "strict에서는 플러그인 MCP 서버가 로드되지 않는다"는 주장 **확인**.
   - 실제 도구 접두어 `mcp__plugin_make-it-ship_mis__` = policy.mjs `OWN_MCP` 상수와 일치 → guard 판정 근거 유효.
2. **본 실행** (세션 2ad2ce32-…, 34 turns, $0.64, exit 0). 모델이 호출한 도구와 디스크 확인:
   - Bash `mis style lite` → `home/sessions/<id>.json` = `{"style":"lite"}`.
   - notepad_write_priority/working/read → `.git/make-it-ship/memory/notepad.json`에 priority·working 확인.
   - project_memory_add_directive/add_note/read → project.json에 `[high] Prefer small diffs`, note `[test]`; 자동 감지 `testCommand: npm test`, languages JavaScript.
   - wiki_add ×2, wiki_query("npm test" → testing-guide score 4 우선), wiki_lint(orphan 1), wiki_list → `.make-it-ship/wiki/`에 페이지·index·log·`.gitignore(*)`. `git status`에는 wiki가 보이지 않음(`M src/text.ts`, `?? native.c`만).
   - session_search("ZEBRA-7731") → searchedFiles 3, 1건(현재 세션 user 메시지, sourcePath `~/.claude/projects/-private-tmp-…-e2e-demo/2ad2ce32….jsonl`). 현재 프로젝트 전사본을 찾음. 단 `/tmp/...`로 시작했어도 호스트가 init cwd와 `CLAUDE_PROJECT_DIR`을 이미 `/private/tmp/...` 실경로로 넘겨서, 경로 불일치 상황 자체는 시험되지 않았다(미검증).
   - trace_summary/timeline → 훅 SessionStart·UserPromptSubmit·PostToolUse(Bash) 3건 (run 없음 표시).
   - deepinit_manifest scan/save → `.git/make-it-ship/deepinit/<key>.json`.
   - merge_readiness start(--quick --from-diff) → set_content → answer q1~q3 → report: 디스크 gate `result: pass, readiness_score: 1`.
   - lsp_servers, lsp_diagnostics(native.c: `undeclared identifier 'missing_name'`), lsp_hover(`int twice(int v)`).
   - python_repl: 서버 환경 `CLAUDE_CODE_SESSION_ID=2ad2ce32-…`(init의 session_id와 동일), `CLAUDE_PROJECT_DIR=/private/tmp/…/demo`, `CLAUDE_PLUGIN_ROOT`, `MIS_STATE_HOME`, `CLAUDE_PLUGIN_DATA` 모두 전달; cwd=demo; 두 번째 호출 `print(x)` → 42.
   - state_list_active / state_get_status(style) → `level: lite`. **MCP 서버가 CLAUDE_CODE_SESSION_ID를 받으므로 세션별 스타일이 정확히 보인다.**
   - Agent(general-purpose) 결과의 `<remember>` → working에 저장됨. 최종 답의 `<remember>` → Stop 훅이 저장.
   - 종료 후 `pgrep -fl "clangd|repl_bridge|mcp/server.mjs"` → 없음 (실제 호스트 종료 시 LSP·REPL 정리 확인).
   - SessionEnd → wiki가 있으므로 `session-log-c87f8f581a36.md` 생성.
   - **관찰된 문제**: notepad working에 "E2E remember from subagent"가 **3번** 저장됨. 2건은 PostToolUse(Agent) 한 번에서: 전사본의 `toolUseResult`는 `{status, prompt, agentId, …, content:[…]}`이고 hooks.mjs가 `JSON.stringify(tool_response)` 전체에서 태그를 뽑아 **위임 prompt 안의 태그**까지 저장했다. 1건은 최종 답이 subagent 답을 인용해서(Stop). → 결함 D2.
3. **compaction** (`claude -p "/compact" --resume 2ad2ce32-…`):
   - 이벤트 순서: SessionStart:resume → status compacting → PreCompact(trace에 기록) → SessionStart:compact → compact_boundary.
   - PreCompact `systemMessage`가 compact 결과 메시지(`<local-command-stdout>`)에 그대로 보임.
   - SessionStart:compact의 additionalContext에 `# Project memory`(priority·[high] 지시·test 명령), wiki 색인 3페이지, `# Make It Ship context (preserved across compaction)` 블록이 들어감. priority·지시는 두 번 나옴(D7).

## 결함 목록

| ID | 심각도 | 내용 | 재현 | 위치 |
|---|---|---|---|---|
| D1 | 중간 | 기억 도구의 `workingDirectory`를 검증하지 않는다. 다른 저장소 경로를 주면 그 저장소의 `.git/make-it-ship/memory/`에 쓰고, 존재하지 않는 경로(오타)나 git 밖 경로는 **오류 없이** 사용자 전역 `~/.make-it-ship/memory/`에 쓴다(쓴 위치도 알려주지 않음). OMC `validateWorkingDirectory`는 세션 저장소(신뢰 루트)와 다르면 신뢰 루트를 쓴다. 노트·지시가 엉뚱한 곳에 저장되어 다음 세션에 주입되지 않는다. (run 상태 쪽 탈출은 없음: `.git/make-it-ship/runs/<id>`를 줘도 memory/에 기록) | `notepad_write_working {content:"x", workingDirectory:"<없는 경로>"}` → 성공 응답, 파일은 `$MIS_STATE_HOME/memory/notepad.json`; `workingDirectory:<다른 repo>` → 그 repo `.git/make-it-ship/memory/notepad.json` | `scripts/mcp/tools/memory.mjs` `tool()`의 `a.workingDirectory \|\| cwd`, `scripts/lib/memory.mjs` `memoryDir()`의 catch 폴백 |
| D2 | 중간 | Agent/Task 결과의 `<remember>` 처리 오류 3가지. (a) `JSON.stringify(tool_response)` 전체를 검색해서 **위임 prompt**(`tool_response.prompt`)에 있는 태그도 저장한다. 실사용에서 한 번의 Agent 호출로 같은 항목이 2번 저장됨. prompt에 붙여 넣은 파일 내용 속 태그도 저장되므로 "subagent 결과만, 읽은 파일은 아님"이라는 hooks.mjs 주석·README("in a subagent result")와 어긋난다. (b) 여러 줄·따옴표가 JSON 이스케이프된 채 저장된다(`line one\\nline \\\"two\\\"`). priority면 매 세션 시작에 깨진 문자열이 주입된다. (c) 같은 내용 중복 제거가 없다. (b)는 OMC post-tool-verifier.mjs:1093과 같은 버그(동등성 버그). | 실사용 2단계 기록; 또는 `{"tool_name":"Agent","tool_response":{"content":[{"type":"text","text":"<remember>a\nb</remember>"}]}}`을 `hooks.mjs PostToolUse`에 입력 | `scripts/hooks.mjs` PostToolUse `extractRemember(JSON.stringify(input.tool_response ?? ''), …)` — `tool_response.content[].text`만 써야 함 |
| D3 | 낮음 | trace에 guard 판정이 남지 않는다. `guard.mjs`는 `appendTrace`를 호출하지 않고, hooks.mjs는 이벤트 이름과 도구 이름만 기록한다. `trace_timeline`의 `decision`/`reason` 출력은 항상 비어 있다. 실사용에서 MCP 도구 호출 약 30회가 trace에 한 줄도 남지 않았다(PostToolUse matcher에 `mcp__`가 없고 guard는 기록하지 않음). 따라서 timeline에는 도구 활동이 보이지 않는다. trace.mjs 머리 주석("one JSON line per hook decision")·README("hook activity")보다 약하고, OMC trace(키워드·스킬·에이전트·모드 이벤트)보다 정보가 적다. | trace.jsonl 확인: 실사용 7줄 모두 `{at,cwd,hook[,tool]}` | `scripts/lib/trace.mjs`, `scripts/guard.mjs` |
| D4 | 낮음 | `wiki_ingest {path}`가 저장소 안의 `.git/` 파일도 받는다. `.git/config`(원격 URL에 토큰이 들어 있을 수 있음)가 wiki 페이지로 복사됨. wiki는 git-ignore라 커밋되지는 않지만, `.gitignore`를 지우라는 README 안내대로 커밋하면 노출된다. `path`는 MIS가 새로 추가한 인자(OMC에 없음). | `wiki_ingest {path:".git/config"}` → `git-config` 페이지 생성 | `scripts/mcp/tools/knowledge.mjs` `ingestFile` |
| D5 | 낮음 | `lsp_diagnostics_directory`가 검사한 파일이 0개여도 `success: true`를 돌려준다(오류가 있는 C 파일만 있는 저장소에서 `success:true, filesChecked:0`). 설명에 TS/JS 전용임은 적혀 있고 OMC도 같은 기본값이지만, "증거 없이 통과라고 하지 않는다" 원칙과 어긋나는 거짓 통과 신호다. | 임시 저장소(main.c에 undeclared 오류)에서 `lsp_diagnostics_directory {}` | `scripts/mcp/tools/code.mjs` `lspDirectory` |
| D6 | 낮음 | python_repl이 SIGINT에 응답하지 않아 SIGKILL한 직후의 **다음 호출 1회**는 코드를 실행하지 않고 "python process exited; it will be restarted on the next call"만 돌려준다(죽은 세션 객체가 exit 이벤트 전까지 Map에 남음). 사용자 코드 1회가 조용히 실행되지 않는다(오류 표시는 됨). | `python_repl execute "import signal; signal.signal(signal.SIGINT, signal.SIG_IGN)\nwhile True: pass"` executionTimeout 1000 → 바로 다음 execute | `scripts/lib/repl.mjs` `killGroup` 후 `sessions.delete` 누락 |
| D7 | 정보 | `source=compact` SessionStart에서 priority 노트와 지시가 두 번 주입된다(`# Project memory`와 `# Make It Ship context (preserved…)`). | 실사용 3단계 | `scripts/hooks.mjs` SessionStart |
| D8 | 중간 | gap-matrix §2.3에서 M7로 배정된 OMC 훅 2개가 구현되지도, PROGRESS에 이월로 기록되지도 않았다. (a) `project-memory-session.mjs`: 세션 시작 시 환경을 **자동 감지·저장 후 주입**. MIS는 저장된 기억만 주입하고 감지는 `project_memory_*` 도구를 처음 호출할 때만 한다(새 저장소의 첫 세션에는 프로젝트 요약이 없음). (b) `project-memory-posttool.mjs`: 도구 출력·사용자 메시지에서 학습(자주 쓰는 경로, 사용자 메시지의 지시 감지, 환경 힌트). MIS에 대응 없음. ADR-0003 "OMC를 대체하는 단일 플러그인"과 범위 기준("MISSING 행이 구현 대상")에 비춰 범위 누락이다. | 새 데모 저장소에서 첫 SessionStart 출력에 `# Project memory` 없음(도구 호출 전); hooks.mjs PostToolUse에 학습 코드 없음 | `scripts/hooks.mjs`, `scripts/lib/memory.mjs` |
| D9 | 정보 | PROGRESS의 M7-02~M7-05 행이 코드가 들어온 뒤에도 TODO로 남아 있다(문서 지연). MCP 서버 stderr에 git 아닌 경로에서 `fatal: not a git repository`가 찍힌다(`memoryDir`의 execFileSync가 stderr를 상속). | `docs/PROGRESS.md` 136~139행 | `docs/PROGRESS.md`, `scripts/lib/state.mjs` `stateRoot` |

OMC 대비 의도적 차이로 판단해 결함으로 세지 않은 것(PARTIAL 표기): ast_grep 인자 이름 변경(`path`→`paths`, `replacement`→`rewrite`, `dryRun`→`apply`), wiki·trace·session_search·deepinit에서 OMC의 `workingDirectory` 인자 삭제, trace의 기준이 sessionId→runId, 스킬 도구 이름 변경, `lsp_rename`의 미리보기 기본값. 단 이름이 바뀐 인자는 OMC 사용법을 기억한 전역 지시문(§6.1)과 어긋날 수 있다.

## 미검증
- ast-grep 실제 검색·치환 (바이너리 없음, BLOCKED 안내만 확인). ast_grep_replace의 `--update-all` 경로와 guard freeze 상호작용의 실제 파일 쓰기.
- typescript-language-server·pyright·gopls·rust-analyzer 경로, `lsp_diagnostics_directory`의 tsc 전략(tsc 없음), sourcekit-lsp 실제 호출.
- `.venv/bin/python` 우선 사용 경로.
- 대화형(tmux) 세션에서의 guard ask 창(헤드리스는 bypassPermissions라 ask가 화면에 뜨지 않음; ask/deny는 guard.mjs 직접 실행으로만 확인).
- 자동 compaction(용량 초과로 생기는 compact). 수동 `/compact`만 확인.
- 동시 쓰기(훅과 도구가 같은 notepad를 동시에 수정): 잠금 없음이 코드 주석에 명시됨, 경합 재현은 하지 않음.
- `CLAUDE_CONFIG_DIR`을 바꾼 환경의 session_search, 5MB 넘는 trace 회전.
- session_search에서 세션 cwd와 저장소 실경로가 다른 경우(심볼릭 링크 경로): 호스트가 실경로를 넘겨 재현되지 않았다.
- deepinit·merge-readiness·trace·wiki **스킬**(OMC skills/의 작업 흐름, 예: 계층 AGENTS.md 생성)은 gap §2.1에서 M7 도구 행과 별개 PARTIAL로 남아 있어 이번 범위로 보지 않았다.

## 남은 위험
- freeze 중 `lsp_rename apply`·`lsp_code_action_resolve`는 고칠 파일을 미리 알 수 없어 frozen 디렉터리 안 파일이라도 항상 deny된다(안전 쪽 과잉 차단).
- wiki·notepad·state·shared memory 쓰기와 `python_repl`은 run·freeze와 무관하게 허용된다. README에 "python_repl은 Bash에서 python을 실행하는 것과 같은 범위"라고 적혀 있고 §6.3 결정과 일치하지만, freeze 중에도 python으로 임의 파일을 쓸 수 있다(의도적 우회는 범위 밖).
- MCP 서버가 SIGKILL로 죽으면, 실행 중이던 python 코드(무한 루프 등)와 그 하위 프로세스는 남는다(유휴 REPL·clangd는 stdin EOF로 스스로 종료함을 확인).
- MCP 서버는 inputSchema를 검증하지 않는다(타입이 틀린 인자는 핸들러의 개별 검사에만 의존).
- `<remember>`는 모델이 다른 사람 말을 인용해도 저장된다(Stop 훅 `last_assistant_message` 전체를 검색). OMC와 같은 동작.
- `lsp_code_action_resolve`는 OMC와 달리 미리보기 없이 바로 파일을 쓰고 서버 command를 실행한다. run 밖에서는 guard가 묻지 않는다. OMC 사용 습관("resolve로 내용 확인 후 Edit로 적용")대로 호출하면 예상과 달리 파일이 바뀐다. 도구 설명에는 쓰기가 명시되어 있다.
- `--strict-mcp-config`를 쓰는 사용자는 54개 도구가 모두 사라진다(README에 명시).

## 2차 검증 (round 2)

- 대상: 브랜치 `m7-wip`, HEAD 23a2307 (1차 이후 수정 커밋 1개: 10개 파일, +136/-15). 커밋 메시지의 수정 주장은 근거로 쓰지 않고 재현으로만 판정했다.
- 검증자: 독립 검증 에이전트(구현 미참여). 임시 디렉터리는 모두 저장소 밖(`$TMPDIR`, scratchpad).

### 기본 확인
- `claude plugin validate .`: ✔ Validation passed
- `npm test` 1회차: 411 tests, pass 411, fail 0 (약 108초), exit 0

### D1~D9 재검증 (MCP stdio 직접 구동 + 훅 직접 실행)

| ID | 판정 | 근거 |
|---|---|---|
| D1 | FIXED | 다른 저장소 경로 → 세션 저장소 notepad에 기록, 다른 저장소 `.git/make-it-ship` 생성 안 됨(notepad·state_write·shared_memory_write 모두). 없는 경로 `/nonexistent/zzz` → `isError: workingDirectory not found`. git 아닌 기존 경로 → 세션 저장소(전역 `MIS_STATE_HOME/memory` 생성 안 됨). 상대 경로 `../<other>` → 세션 저장소. 같은 저장소의 linked worktree·하위 디렉터리 → 정상 기록(공유 common dir). 단, 다른 저장소 경로를 줬을 때 대체되었다는 안내가 응답에 없다(OMC와 같음, 정보성). |
| D4 | PARTIAL | `.git/config`, `./.git/HEAD`, 절대 경로, `docs/../.git/config`, `.git/config`를 가리키는 심볼릭 링크, worktree의 `.git` 파일 모두 거부. **그러나 `.GIT/config`는 수집됨**(macOS 대소문자 무시 파일 시스템, `created: ["git-config"]`, index 요약에 `[core]`). `realpathSync`가 대소문자를 정규화하지 않고 검사는 `includes('.git')` 정확 일치라서 우회된다. → 신규 결함 N1. `.git-notes.txt` 같은 일반 dotfile은 정상 수집. |
| D5 | FIXED | C 파일만 있는 저장소에서 `success:false, filesChecked:0, summary "…; nothing was checked"`. |
| D6 | FIXED | SIGINT 무시 무한 루프 1초 타임아웃 → kill 후 다음 호출이 `restarted:true` + `stdout "42"`로 실제 실행. 외부에서 SIGKILL한 직후(대기 없이) 호출도 `restarted:true, stdout "4"`. 300ms 대기 후 호출은 새 세션으로 정상 실행. |
| D7 | FIXED | `source=compact` SessionStart에서 priority 문구 1회. 단 compact 경로는 `memorySessionContext` 대신 `preCompactContext`만 써서 `## Project`(언어·test 명령)가 빠진다(1차 실사용에서는 compact 후에도 test 명령이 주입되었음). → 정보성 N3. |
| D9 | FIXED | PROGRESS M7-02~04 DONE·M7-05 IN_PROGRESS로 갱신. `stateRoot`가 git stderr를 버림(`stdio ignore`). 저장소 밖에서 `stateRoot`는 여전히 throw(호출자 기대 유지 확인). |
| D2 | FIXED | 훅 직접 실행: Agent `tool_response.prompt`·`tool_input.prompt`의 태그 무시, `content[].type=tool_use` 안 태그 무시, Read 결과 태그 무시, 문자열 응답·`{result}` 응답 처리, 같은 내용 재입력·Stop 인용 시 중복 없음. **실제 headless 세션 2회**(`claude -p`, 아래 플래그): 모델이 Agent(general-purpose)에 `<remember>PROMPT-TAG-B-SHOULD-NOT-BE-SAVED</remember>`가 든 prompt를 넘기고, subagent 결과는 `<remember>Fact B line one\nline two has "double quotes" and 'single quotes'</remember>` + `<remember priority>PRIO-B "quoted"</remember>`. 디스크 `notepad.json`: working 1건 `Fact B line one\nline two has "double quotes" and 'single quotes'`(실제 줄바꿈·따옴표, 이스케이프 없음), priority `PRIO-B "quoted"`, prompt 태그 없음. 전사본 `tool_use_result.content[0].text`와 글자 단위로 일치. |
| D3 | FIXED | guard가 판정마다 `{hook:"PreToolUse", tool, decision[, reason]}` 기록(이전 커밋 guard로는 같은 입력에 trace 0줄). ask 행에 reason 포함. 실사용 trace_timeline에 MCP 도구 10건·Bash가 `PreToolUse … allow`로 표시. MCP 도구의 PostToolUse 행은 여전히 없음(matcher에 `mcp__` 없음, 정보성). |
| D8 | PARTIAL | (a) FIXED: 새 데모 저장소 첫 SessionStart에서 `project.json`이 생성되고(lastScanned = SessionStart 시각) additionalContext에 `# Project memory … languages: JavaScript, test: npm test` 주입(실사용 hook_response로 확인). (b) 학습은 test 명령 1개만(`learnTestCommand`): OMC의 사용자 메시지 지시 감지·자주 쓰는 경로 학습은 없음. 학습 조건도 느슨함: `pytest tests/test_one.py -k slow`처럼 범위를 좁힌 명령, 출력이 `1 failed`인 명령(파이프로 exit 0)도 프로젝트 test 명령으로 저장(N4). 그리고 저장소 밖 세션에서 새 결함 N2 발생. |

### 회귀 확인

| 항목 | 결과 | 근거 |
|---|---|---|
| 기억 도구 workingDirectory = 같은 저장소의 linked worktree | 통과 | `git worktree add` 경로 → 세션 저장소 notepad에 기록(common dir 공유) |
| python_repl 정상·타임아웃·reset | 통과 | 변수 유지(x=5→10), 1.5초 타임아웃 SIGINT 후 상태 유지(x=5), ValueError traceback 후 세션 유지, reset 후 `"x" in dir()` False, get_state 빈 목록 |
| lsp (clangd, C 파일) | 통과 | `lsp_diagnostics main.c` → `undeclared identifier 'undefined_var'` error. `lsp_diagnostics_directory`는 C 파일을 검사하지 않으며 이제 `success:false`(설계대로) |
| wiki_ingest 일반 파일 | 통과 | `docs/guide.md` → `guide-title` 생성, `.git-notes.txt` 정상 수집 |
| SessionStart startup의 priority 주입 | 통과 | 여러 줄 priority가 `## Priority notes`로 주입 |
| guard fail-closed | 통과 | 잘못된 JSON → `ask (fail-closed)`. trace 홈을 쓸 수 없는 경우(`MIS_STATE_HOME=/dev/null/x`)에도 판정 출력 동일. `git push`·`rm -rf /`·`gh pr create` 판정이 이전 커밋 guard와 동일 |
| stateRoot 저장소 밖 throw | 통과 | `stateRoot(<git 아닌 디렉터리>)` → throw 유지(memoryDir 폴백·loadRun 호출자 기대 그대로) |

### 실사용 (headless dogfood)
- 준비: `node evals/setup-demo.mjs a <scratchpad>/m7r2/demo`(새 사본), `MIS_STATE_HOME=<scratchpad>/m7r2/home`, 플래그 `--plugin-dir <m7 worktree> --setting-sources project --permission-mode bypassPermissions --output-format stream-json --verbose`(`--strict-mcp-config` 없음). Claude Code 2.1.292.
- init: `plugin:make-it-ship:mis` connected, mis 도구 54개. 13 turns, $0.29, exit 0.
- project_memory_read → 이미 SessionStart가 만든 기억(languages JavaScript, testCommand `npm test`) 반환.
- notepad_write_priority/working/read → 디스크 `notepad.json`에 `R2-PRIORITY: keep diffs small`, `R2-WORKING note`.
- wiki_add → `.make-it-ship/wiki/r2-testing-guide.md`; wiki_query("QUOKKA-42") → 1건 score 2. `git status` 깨끗(wiki git-ignore).
- python_repl `y = 21` → `print(y*2)` → `42`.
- trace_timeline → 13건: SessionStart, UserPromptSubmit, `PreToolUse mcp__plugin_make-it-ship_mis__<도구> allow` 10건, `PreToolUse Bash allow`, `PostToolUse Bash`. trace_summary `PreToolUse: 11`.
- 종료 후 repl_bridge·mcp server·clangd 잔존 프로세스 없음. SessionEnd가 `session-log-*.md` 생성.

### npm test 안정성 (3회 요구)
- 1회차 411/411 (108초), 2회차 411/411 (65초), **3회차 410/411 실패 1** (104초, 내 MCP·훅 probe와 동시 실행, load avg 약 17~22).
- 실패: `tests/integration/mis-concurrency.test.mjs:31` "concurrent mis writers wait for the lock instead of failing or losing updates" — `7 !== 8`. 30행(8개 writer 모두 exit 0)은 통과했으므로 **모든 writer가 성공을 보고했는데 기록 1건이 조용히 사라졌다**(타임아웃이 아니라 lost update).
- 추가 실행: 4회차 npm test 411/411, 해당 테스트 단독 8회·병렬 10회 모두 통과, 20개 동시 `interview add` × 6회 모두 20건. 재현은 안 되었지만 3회 중 1회 실패이므로 "3회 안정" 조건은 **불충족**.
- M7 이전부터 있던 코드다: M7 diff는 `state.mjs`에서 `stateRoot`의 stdio만 바꿨고 `withLock`은 손대지 않았다.
- 가설(미확정): `withLock`의 reclaim 경로가 holder pid 읽기 → `pidAlive` → `unlinkSync(lock)` 순서인데, 지우기 전에 그 파일이 아직 같은 holder의 것인지 확인하지 않는다. 막 끝나고 종료한 writer X의 pid를 읽은 사이 X가 lock을 풀고 B가 새 lock을 잡으면, A는 X가 죽었다고 보고 **B의 lock을 지운다** → A·B 동시 임계 구역 → 갱신 1건 유실.

### 첫 번째 D2 headless 실행 메모
- 1회차(셸 작은따옴표 안 `\"`를 prompt에 그대로 넣음)에서는 저장값에 `\"`가 남았지만, 전사본 `tool_use_result.content[0].text`도 똑같이 `\"`(subagent가 백슬래시를 실제로 출력)였다. 프롬프트 인용 부산물이지 이스케이프 결함이 아니다. 판정은 백슬래시 없는 2회차 기준.

### 추가 확인: python_repl 재실행 (D6 수정 경로)
- 코드 `open(f,'a').write('ran\n'); import os; os._exit(1)` 1회 호출 → 응답은 `error: python process exited; it will be restarted on the next call`, **파일에는 `ran` 2줄**. 인터프리터가 응답 전에 죽으면 "코드가 실행되지 않았다"고 가정하고 새 인터프리터에서 같은 코드를 한 번 더 실행하기 때문. 사용자 코드가 스스로 프로세스를 죽인 경우(os._exit, segfault, OOM kill)에는 부작용(파일 추가, 네트워크 요청, DB 쓰기)이 두 번 일어나고, 응답 문구는 "다음 호출에 재시작"이라 두 번 실행된 사실도 알 수 없다. → N5.

### 2차 결함 목록

| ID | 심각도 | 출처 | 내용 | 재현 | 위치 |
|---|---|---|---|---|---|
| N1 | 낮음 | D4 수정 불완전 | `wiki_ingest`의 `.git` 차단이 대소문자 정확 일치라 macOS(대소문자 무시 FS)에서 `.GIT/config`가 수집된다(D4와 같은 노출). `realpathSync`는 대소문자를 정규화하지 않는다. | `wiki_ingest {path:".GIT/config"}` → `created:["git-config"]`, 요약 `[core]` | `scripts/mcp/tools/knowledge.mjs` `ingestFile` (`.includes('.git')`) — 대소문자 무시 비교 또는 `realpathSync.native` |
| N2 | 중간 | D8 수정이 만든 회귀 | SessionStart가 `projectEnsure(cwd)`를 무조건 호출한다. 저장소 밖에서는 `memoryDir`가 throw하지 않고 전역 `~/.make-it-ship/memory/`로 폴백하므로 `catch { /* not a repo */ }`는 동작하지 않는다. 처음 연 비저장소 디렉터리의 감지 결과가 전역 `project.json`에 저장되고, 이후 **관계없는 모든 비저장소 세션**에 그 언어·test 명령이 주입된다. `learnTestCommand`도 저장소 밖에서는 같은 전역 파일에 쓴다. | `Cargo.toml`만 있는 비저장소 A에서 SessionStart → 빈 비저장소 B에서 SessionStart: B의 additionalContext에 `languages: Rust`, `test: cargo test` | `scripts/hooks.mjs` SessionStart, `scripts/lib/memory.mjs` `memoryDir`/`projectEnsure`/`learnTestCommand` |
| N3 | 낮음 | D7 수정이 만든 회귀 | `source=compact`에서 `memorySessionContext` 대신 `preCompactContext`만 넣어 `## Project`(언어·build/test 명령)가 compaction 후 사라진다. 1차 실사용에서는 compact 후 test 명령이 주입되었다. | priority·package.json 있는 저장소에서 SessionStart source=compact → `npm test`/`node --test` 문자열 없음 | `scripts/hooks.mjs` SessionStart |
| N4 | 낮음 | D8(b) 수정 | 첫 test 명령을 성공 여부·범위와 관계없이 프로젝트 test 명령으로 저장한다. `pytest tests/test_one.py -k slow`, 출력 `1 failed`(파이프로 exit 0) 모두 저장됨. 이후 매 세션 이 명령이 "test:"로 주입된다. OMC 학습(지시 감지·경로)은 여전히 없음. | 감지 명령 없는 저장소에서 PostToolUse Bash `pytest tests/test_one.py -k slow` → `build.testCommand` 그 값 | `scripts/lib/memory.mjs` `learnTestCommand`, `scripts/hooks.mjs` PostToolUse |
| N5 | 중간 | D6 수정이 만든 회귀 | 응답 전에 인터프리터가 죽으면 같은 코드를 새 인터프리터에서 자동으로 다시 실행한다. 코드 자체가 프로세스를 죽인 경우 부작용이 2번 일어나고 응답은 이를 알리지 않는다. | 위 "python_repl 재실행" 절: 1회 호출에 `ran` 2줄 | `scripts/lib/repl.mjs` `r === null` 재시도 분기 |
| N6 | 중간 | M7 이전부터(M3 `withLock`), M7 범위 밖 | npm test 3회 중 1회 lost update로 실패(동시 writer 8개 모두 성공, 기록 7건). 재현 안 됨, 원인은 위 가설(reclaim TOCTOU). "npm test 3회 안정" 조건 불충족. | npm test 3회차 로그 | `scripts/lib/state.mjs` `withLock` |

1차 결함 최종: D1·D2·D3·D5·D6·D7·D9 FIXED, D4·D8 PARTIAL. 단 D6·D7·D8 수정이 각각 N5·N3·N2 회귀를 만들었다.

### 2차 미검증
- 대화형(tmux) 세션, 자동 compaction, Linux(대소문자 구분 FS)에서의 N1(재현되지 않을 것으로 예상).
- N6의 원인 확정(재현 실패, 가설만).

ROUND2: DEFECTS FOUND

## 3차 검증 (round 3)

- 대상: 브랜치 `m7-wip`, HEAD 9b35d38 (2차 이후 수정 커밋 1개: N1~N6, 9개 파일). 커밋 메시지·2차 보고서의 수정 주장은 근거로 쓰지 않고 재현으로만 판정했다.
- 검증자: 독립 검증 에이전트(구현 미참여). 임시 디렉터리는 모두 저장소 밖(`$TMPDIR`, scratchpad `r3/`).

### 기본 확인
- `claude plugin validate .`: ✔ Validation passed
- `npm test` 5회 연속(순차 실행. 1~3회차는 내 lock 스트레스 smoke·REPL·N1~N5 프로브와 동시에 돌아 부하가 있었다): 1회 417/417 (72초), 2회 417/417 (90초), 3회 417/417 (54초), 4회 417/417 (45초), 5회 417/417 (43초). 모두 exit 0, 실패·flake 없음 (`mis-concurrency` 포함).

### N1~N5 재검증 (MCP stdio 직접 구동 + 훅 직접 실행)

| ID | 판정 | 근거 |
|---|---|---|
| N1 | FIXED | `wiki_ingest` 거부: `.GIT/config`, `.Git/HEAD`, `.gIT/config`, `sub/../.GIT/config`, 절대 경로 `<dir>/.GIT/config`, 대문자 저장소 경로 `<DIR>/.git/config`, `.GIT`를 가리키는 심볼릭 링크 `lnk/config`, `.GIT/./config`, `.GIT//config`, `.git/logs/HEAD`. 정상 수집 유지: `notes.git.md`, `x.git/a.md`(이름에 .git이 들어간 일반 파일·디렉터리). |
| N2 | **PARTIAL (미해결)** | SessionStart 경로는 고쳐짐: Cargo.toml만 있는 비저장소 A에서 SessionStart → 전역 `MIS_STATE_HOME/memory/project.json` 생성 안 됨, 이어진 빈 비저장소 B에 주입 없음. 저장소·저장소 하위 디렉터리에서는 감지 유지. **그러나 PostToolUse 경로는 그대로**: 같은 A에서 Bash `cargo test` PostToolUse 1회 → `learnTestCommand`가 `projectEnsure`로 전역 `project.json`을 만든다(`projectRoot: <A>`, languages Rust, testCommand `cargo test`). 이후 관계없는 비저장소 B의 SessionStart에 `## Project / languages: Rust / test: \`cargo test\``가 주입된다. 2차 N2 본문이 지적한 "learnTestCommand도 저장소 밖에서는 같은 전역 파일에 쓴다"가 수정되지 않았다(`scripts/hooks.mjs:119`는 저장소 여부를 확인하지 않음). 추가된 테스트 M7 N2는 SessionStart만 본다. |
| N3 | FIXED | priority·package.json 저장소에서 `source=compact`: `## Project` 1회, priority 1회, test 명령 포함. `source=resume`: `## Project` 1회, priority 1회(중복 없음). |
| N4 | FIXED | 학습 안 됨: `pytest tests/test_one.py -k slow`, `npm test -- --grep foo`, `npm test 2>&1 \| tail`, `npm test; echo hi`, `npm test && rm -rf x`, `cargo test some_fn`, `go test ./pkg/...`, `FOO=1 npm test`. 학습됨: `npm test`, `npm run test`, `pytest`, `node --test`, `make test`, `npm  test`(공백 2개 그대로 저장, 무해). 감지된 test 명령(`npm test`)은 이후 `pytest`로 덮어쓰지 않음. 실패한 명령은 PostToolUse가 아니라 PostToolUseFailure로 가므로 학습 대상이 아니다. |
| N5 | FIXED | MCP: `open(f,'a').write('x'); os._exit(1)` 1회 호출 → 파일 1줄, 응답 `python process exited while running this code (it was not retried)…`, 다음 호출 정상(`7`). 유휴 인터프리터를 외부 SIGKILL 직후 호출 → `restarted:true`, 코드 1회 실행(`y` 1줄, `42`). 300ms 후 호출 → 새 세션 정상. SIGINT 타임아웃 1초 → 1006ms에 `KeyboardInterrupt`, 상태 유지(`w=9`). SIGINT 무시 루프 → 3059ms에 kill, 다음 호출 `restarted:true` 정상. 실행 중(ack 후) 외부 SIGKILL → 재시도 없음(`z` 1줄). `repl.mjs` 직접 구동으로 ack/exit 순서 경쟁도 확인: 이벤트 루프를 0/60/300/1000ms 바쁘게 막아 ack 줄과 프로세스 종료가 동시에 준비되게 한 상태에서 `os._exit` 85회, `os.kill(getpid(), SIGKILL)` 30회, `ctypes.string_at(0)`(segfault) 20회 → 모두 1회 실행, 재실행 0회. 종료 후 `repl_bridge` 잔존 프로세스 없음. |

추가 확인 (N4): 감지된 test 명령이 없는 저장소에서 `PostToolUseFailure` Bash `npm test`(실패) → `build.testCommand` null. `PostToolUseFailure` 핸들러는 실패 횟수만 세고 `learnTestCommand`를 호출하지 않는다(`scripts/hooks.mjs` 130행대).

### D1~D9 회귀 (손으로 5개 + N 재검증에 포함된 것)
| ID | 결과 | 근거 |
|---|---|---|
| D1 | 유지 | 다른 저장소·git 아닌 기존 경로 `workingDirectory` → 세션 저장소 notepad에 기록, 다른 저장소 notepad null, 전역 `MIS_STATE_HOME/memory` 생성 안 됨, 없는 경로 → `isError` |
| D2 | 유지 | Agent `tool_input.prompt` 태그·`tool_use` 블록 태그·Read 결과 태그 무시, 텍스트 결과의 `R3 "q" line\nl2` 1건만 원문 그대로 저장, 같은 결과 재입력에도 중복 없음 |
| D3 | 유지 | guard가 Bash·MCP 도구 각 1건씩 `{"hook":"PreToolUse","tool":…,"decision":"allow"}`를 trace.jsonl에 기록 (2줄) |
| D5 | 유지 | C 파일만 있는 저장소에서 `lsp_diagnostics_directory` → `success:false, filesChecked:0` |
| D9 | 유지 | 저장소 밖 `stateRoot` → throw, stderr 빈 문자열 |
| D4 / D6 / D7 | 유지 | 위 N1(.git 차단 11가지), N5(재시작·타임아웃), N3(compact priority 1회)에서 확인 |
| D8 | PARTIAL 유지 | 저장소 감지·학습은 동작(N3·N4), 저장소 밖 PostToolUse 학습이 전역에 새는 문제(N2) 남음 |

### 실사용 (headless dogfood)
- 준비: `node evals/setup-demo.mjs a <scratchpad>/r3/demo`(새 사본), `MIS_STATE_HOME=<scratchpad>/r3/home`, 플래그 `--plugin-dir <m7 worktree> --setting-sources project --permission-mode bypassPermissions --output-format stream-json --verbose`(`--strict-mcp-config` 없음). Claude Code 2.1.292.
- init: `plugin:make-it-ship:mis` connected(source plugin), mis 도구 54개. 결과 success, 12 turns, $0.28.
- 모델이 실제로 부른 도구(모두 `mcp__plugin_make-it-ship_mis__` 접두어): notepad_write_priority, notepad_write_working, notepad_read, project_memory_read, wiki_add, wiki_query, python_repl ×2, trace_timeline, 그리고 Bash `git status --short`.
- 디스크: `.git/make-it-ship/memory/notepad.json`에 priority `R3-PRIORITY: run tests before shipping`, working `R3-WORKING note`. project_memory_read는 SessionStart가 만든 기억(languages JavaScript, `projectRoot` = demo) 반환.
- wiki_add → `.make-it-ship/wiki/r3-testing-guide.md` 생성, wiki_query("WOMBAT-77") → 1건 score 2. `git status --short` 출력 없음(깨끗).
- python_repl `z = 6*7` → `print(z)` → `42\n` (execution 1→2, 상태 유지).
- trace_timeline 11건(SessionStart, UserPromptSubmit, MCP 도구 PreToolUse allow…). 종료 후 `MIS_STATE_HOME/trace.jsonl` 15줄, MCP 도구 9종 10건 + Bash 1건 모두 `decision:"allow"`.
- 종료 후 m7의 `repl_bridge`·`server.mjs`·clangd 잔존 프로세스 없음(보이는 `server.mjs` 2개는 다른 worktree `make-it-ship-m8`의 것). SessionEnd가 `session-log-*.md` 생성.

### N6 (stale lock reclaim) 재검증

코드 검토 (`scripts/lib/state.mjs` `withLock`/`reclaimLock`): 2차 가설의 경로(holder X가 lock을 풀고 종료한 사이 B가 새 lock을 잡으면 A가 B의 lock을 지움)는 막혔다. 지우기 전에 `.reclaim` 파일로 reclaimer끼리 직렬화하고, lock 내용(pid + ms 시각)이 판단 당시 읽은 내용과 같을 때만 지운다. 남은 경쟁·문제는 아래와 같다.
- (재현) **빈 lock 영구 잠김**: `openSync('wx')`와 `writeFileSync` 사이에 writer가 죽거나 `writeFileSync`/`closeSync`가 예외(예: ENOSPC)를 던지면 빈 lock이 남는다(예외 경로에서는 fd도 샌다). 빈 내용이면 pid가 없어 reclaim 대상이 아니므로 이후 모든 writer가 대기 시간 후 `run is locked by pid `(빈 pid)로 실패한다. 손으로 파일을 지울 때까지 run이 잠긴다. 재현: 빈 lock 파일 + `MIS_LOCK_WAIT_MS=1500` → `mis interview add` exit 1. M7 이전부터 있던 코드이고 창은 아주 좁다.
- (추론, 재현 안 됨) **오래된 `.reclaim` 파괴 경쟁**: `.reclaim`이 5초보다 오래되면 `statSync` 후 `unlinkSync`로 지우는데, 이 두 호출은 원자적이지 않다. 두 waiter가 같은 오래된 파일을 보면 두 번째 waiter가 새 reclaimer C의 새 `.reclaim`을 지울 수 있고, 그러면 D가 C와 동시에 들어온다. `readLock(lock) === seen` 비교와 `unlinkSync`도 원자적이지 않으므로 C가 stale lock을 지우고 E가 새 lock을 잡은 뒤 D가 E의 lock을 지우는 순서가 가능하다(lost update). 전제: reclaimer가 `.reclaim`을 잡은 채 5초 넘게 멈추거나 죽어야 한다(SIGSTOP, 심한 스왑).
- (관찰) **바쁜 대기**: 새 `.reclaim`이 있으면 `reclaimLock`이 그냥 반환하고 `continue`가 `sleepMs`를 건너뛰어 waiter가 최대 5초 동안 CPU 100%로 돈다. 재현: dead-pid lock + 방금 만든 `.reclaim` → `interview add`가 5931ms 뒤 성공. 아무것도 회수하지 않았는데도 `run.reclaimedLock`이 설정된다(사소).
- 정상 확인: dead-pid lock + 10초 된 `.reclaim`(죽은 reclaimer) → 회복해서 성공, `.reclaim` 남지 않음.

스트레스 (각 반복마다 새 저장소·새 run, 동시 `mis interview add` writer N개. exit 0인 writer의 항목이 하나라도 없으면 lost update로 판정. id 중복, lock·`.reclaim` 잔존도 검사):

| 시나리오 | 코드 | 반복 | lost update | 기타 |
|---|---|---|---|---|
| plain, N=8 | 9b35d38 | 60 | 0 | 없음 |
| dead-pid lock 미리 둠, N=12 | 9b35d38 | 60 | 0 | 없음 |
| dead-pid lock 미리 둠, N=8 | 9b35d38 | 60 | 0 | 없음 |
| dead-pid lock + writer 1/4을 40~160ms에 SIGKILL, N=10 | 9b35d38 | 50 | 0 | 1회: 죽은 reclaimer의 `.reclaim`이 남음(5초 뒤 자가 회복 경로, 위 바쁜 대기) |
| **대조군** plain, N=12, `yes` 10개로 CPU 부하(load avg 약 35~41) | **23a2307 (수정 전)** | 60 | **2회** (iter 9: exit 0 12개 중 4건 유실, iter 18: 1건 유실) | 6회는 30초 대기 초과 실패(오류로 보고됨, 조용한 유실 아님) |
| 같은 부하·같은 조건 | 9b35d38 | 60 | **0** | 9회 30초 대기 초과 실패(부하 때문, 오류로 보고됨) |

대조군에서 수정 전 코드는 같은 하네스로 조용한 유실을 재현했고(2/60), 수정 후 코드는 0/60이었다. 이 경로는 고쳐졌다고 판단한다. 부하에서 생긴 대기 초과는 writer가 오류로 보고하므로 lost update가 아니다. 다만 위의 빈 lock 영구 잠김과 오래된 `.reclaim` 경쟁은 남아 있다.

### 정보: N5의 남은 이론적 경쟁
`proc.on('exit')`가 waiter를 `null`로 깨우는데, Node의 `'exit'`는 stdio를 다 읽기 전에 올 수 있다. ack 줄이 아직 fd3 버퍼에 있으면 `acked`가 false로 보여 코드가 다시 실행될 수 있다. 이벤트 루프를 바쁘게 막은 135회 시험에서는 한 번도 일어나지 않았다. `'close'`를 기다리면 이 경쟁이 사라진다. 차단 사유는 아니다.

### 3차 결함 목록

| ID | 심각도 | 출처 | 내용 | 재현 | 위치 |
|---|---|---|---|---|---|
| N2 | 중간 | 2차 N2 수정 불완전 | 저장소 밖 세션에서 PostToolUse Bash test 명령(`cargo test` 등)이 `learnTestCommand` → `projectEnsure`로 전역 `MIS_STATE_HOME/memory/project.json`을 만든다. 이후 관계없는 모든 비저장소 세션의 SessionStart에 그 언어와 test 명령이 주입된다. SessionStart 경로만 고쳐졌고 추가된 테스트도 SessionStart만 본다. | 비저장소 A(Cargo.toml)에서 PostToolUse Bash `cargo test` → 빈 비저장소 B SessionStart에 `languages: Rust`, ``test: `cargo test` `` | `scripts/hooks.mjs:119` (저장소 확인 없이 `learnTestCommand` 호출), `scripts/lib/memory.mjs` `learnTestCommand` |
| N7 | 낮음 | M3 `withLock` (M7 이전), N6 검토 중 발견 | 빈 lock 파일(생성과 기록 사이 크래시, 또는 기록 예외)은 회수되지 않아 run이 영구 잠긴다. 예외 경로에서는 fd도 샌다. | 빈 lock + `MIS_LOCK_WAIT_MS=1500` → `run is locked by pid ` exit 1 | `scripts/lib/state.mjs` `withLock` |
| N8 | 낮음 | N6 수정 | 오래된(5초 이상) `.reclaim`을 지울 때 stat→unlink가 원자적이지 않아 reclaimer 둘이 동시에 들어갈 수 있다. reclaimer가 5초 넘게 멈추면 이론상 lost update가 가능하다(재현 안 됨). 새 `.reclaim`이 있는 동안 waiter는 sleep 없이 최대 5초 동안 바쁜 대기를 한다(재현: 5931ms). | 위 N6 절 | `scripts/lib/state.mjs` `reclaimLock`, `withLock`의 `continue` |

2차 결함 최종: N1·N3·N4·N5·N6 FIXED(N6은 대조군으로 확인), **N2 PARTIAL**(PostToolUse 경로 미수정). 새로 N7(M7 이전부터 있던 문제)과 N8(N6 수정의 남은 경쟁·바쁜 대기)을 찾았다. npm test 5/5 통과, validate 통과, dogfood 정상.

### 3차 미검증
- 대화형(tmux) 세션, 실제 자동 compaction, Linux(대소문자 구분 FS).
- N8의 lost update 경로(5초 넘게 멈추는 상황을 만들지 않았다), N5 `'exit'`/stdio 순서 경쟁의 실제 발생.

ROUND3: DEFECTS FOUND

## 4차 검증 (round 4)

- 대상: 브랜치 `m7-wip`, HEAD 4decb41 (3차 이후 수정 커밋 1개: N2 나머지·N7·N8, 5개 파일). 커밋 메시지의 수정 주장은 근거로 쓰지 않고 재현으로 판정했다.
- 검증자: 독립 검증 에이전트(구현 미참여). 임시 디렉터리는 모두 저장소 밖(`$TMPDIR`, scratchpad `r4/`). 비교용 옛 코드는 `git archive 9b35d38`/`23a2307`로 scratchpad에 풀어 썼다.

### 기본 확인
- `claude plugin validate .`: ✔ Validation passed
- `npm test` (순차 실행): 1회 420/420 (133초), 2회 420/420 (106초), **3회 419/420 실패 1건** (68초), 추가 4회 420/420 (96초). 1~3회는 내 N7·N8 probe·스트레스 smoke와 시간이 겹쳤다.
  - 실패한 것: `tests/unit/lsp-client.test.mjs` "LspClient against the fake server…" — `hover 한글 1:2 cfg=none`이 `/cfg=\[null\]/`와 맞지 않음. 이 파일은 a51d38f(M7-04) 이후 바뀌지 않았으므로 4decb41의 회귀는 아니다.
  - 이 파일만 반복 실행: 스트레스 부하 중 0/30 실패, 유휴 상태 2/30 실패, 추가 40회 안에서 다시 같은 메시지로 실패를 잡았다.
  - 원인(코드 확인): `LspClient.onServerRequest`는 `workspace/configuration`에 바로 응답한다(클라이언트 순서는 문제없음). 그런데 fake server(`tests/fixtures/fake-lsp.mjs:60`)는 응답을 `.then`(microtask)에서 `configResult`에 넣는다. 설정 응답과 hover 요청이 같은 stdin chunk로 도착하면 동기 파싱 루프가 hover를 먼저 처리해 `cfg=none`을 돌려준다. **테스트 fixture의 경쟁이고 제품 결함은 아니다.** 다만 필수 검사 `npm test`가 약 5% 확률로 실패한다.

### N2 나머지 (저장소 밖 PostToolUse 학습)

| 시험 | 결과 |
|---|---|
| 비저장소 A(Cargo.toml)에서 PostToolUse Bash `cargo test`, `npm test`, `pytest`, `make test`, `node --test` 각 1회, 그리고 A/sub에서 `cargo test` | 전역 `MIS_STATE_HOME/memory/project.json` **생성 안 됨**(`sessions/`, `trace.jsonl`만 생김). 모두 exit 0 |
| 이어서 빈 비저장소 B의 SessionStart | `## Project` 0회 (주입 없음) |
| 저장소 R의 하위 디렉터리 `R/sub`에서 PostToolUse `pytest` | `R/.git/make-it-ship/memory/project.json`에 `testCommand: "pytest"` 학습됨. 이후 R SessionStart에 ``## Project / test: `pytest` `` 주입 |
| 새 저장소 R2: 루트 SessionStart → `R2/sub`에서 PostToolUse `pytest` | `projectRoot` = R2, languages JavaScript 유지, `testCommand: "pytest"` 학습 |

판정: **FIXED**. 추가된 테스트 "M7 N2 (rest)"도 같은 경로를 본다.

정보(기존 동작, 판정과 무관):
- SessionStart 없이 저장소 하위 디렉터리에서 PostToolUse가 먼저 오면 `projectRoot`가 `R/sub`, languages `[]`로 기록된다. 이후 루트 SessionStart도 고치지 않는다. 9b35d38·23a2307에서도 같다.
- 저장소 밖 SessionStart는 git의 `fatal: not a git repository…`를 stderr로 내보낸다(exit 0, 주입 내용 정상). 9b35d38·23a2307에서도 같다.

### N7 (빈/깨진 lock 회수, fd 누수)

`withLock`을 직접 호출하는 probe:

| lock 내용 | 나이 | 결과 |
|---|---|---|
| `''`, `garbage`, `{"pid":`, `null`, `{"x":1}`, `{"pid":0}`, `"  \n"` | 10초 | 모두 회수 후 실행(113~205ms), lock·`.reclaim` 남지 않음 |
| `''` | 새로 만듦 | `waitMs 1500` → `run is locked by pid ` 오류, lock은 그대로(빈 내용). 빼앗지 않음 |
| `''` | 3초 | `waitMs 8000` → 2127ms에 회수(5초가 될 때까지 기다린 뒤 회수) |
| `garbage` | 새로 만듦 | `waitMs 1000` → 대기 후 오류, lock 그대로 |

**fd 누수**: `fs.writeFileSync`를 ENOSPC를 던지게 바꾸고(`syncBuiltinESMExports`) `withLock` 500회를 호출했다.
- 4decb41: 500회 모두 ENOSPC, `/dev/fd` 12→12, lock 남지 않음, 이어진 정상 lock은 2ms에 성공.
- 대조군 9b35d38: fd 12→13(누수), 빈 lock이 남아 이후 499회가 `run is locked by pid `로 실패, 정상 lock도 실패.

판정: 위 기준(오래된 빈/깨진 lock 회수, 새 lock 대기, fd 누수 없음)은 **충족**. 그러나 아래 결함 N9를 찾았다.

**N9 (새 결함, N7 수정이 만든 경로): 오래된 빈 lock을 회수할 때 막 생긴 새 lock을 지울 수 있다.**
- 원인: `reclaimLock`은 "판단 당시 내용과 지금 내용이 같은가"만 비교한다. 그런데 `''`는 모든 새 lock이 `openSync('wx')`와 `writeFileSync` 사이에 잠깐 갖는 내용과 같다. 또 `.reclaim`을 잡은 뒤 lock의 나이를 다시 보지 않는다.
- 사고 순서: waiter A와 B가 같은 오래된 빈 lock을 orphan으로 판정 → B가 회수 → writer W가 새 lock을 만들고 아직 내용을 쓰기 전 → A가 `.reclaim`을 잡고 `readLock === ''`이므로 W의 lock을 지움 → W는 lock을 쥐었다고 믿고, X도 새 lock을 잡는다. 두 writer가 동시에 들어가 lost update가 난다.
- 결정적 재현(한 프로세스에서 순서를 그대로 실행): A의 `reclaimLock(lock, '')`가 0ms 된 W의 lock을 지우고 `true`를 반환했다. 이어서 X의 `openSync('wx')`도 성공했다.
- 창을 넓힌 재현: HEAD 사본에서 `openSync`와 `writeFileSync` 사이에 30ms, orphan 판정과 `reclaimLock` 사이에 0~300ms sleep을 넣고, 아래 스트레스 하네스로 실프로세스 writer 10개를 돌렸다.
  - `empty` 시나리오 15회: **lost update 19건(5회)**. 유실이 난 회차는 모두 lock 내용이 `''`인 홀수 회차였고, `{"pid":` 회차에서는 없었다.
  - 대조 `dead`(dead-pid lock) 10회: 0건.
  - 넓히지 않은 실제 코드에서는 재현되지 않았다(아래 표 `empty` 25회, `empty-kill` 20회 모두 0건).
- 범위와 위험: dead-pid lock과 내용이 있는 깨진 lock은 해당 없다(내용에 pid+ms 시각이 들어 있어 유일하다). 전제는 두 가지다. 먼저 생성과 기록 사이의 크래시로 빈 lock이 남아 있어야 하고, waiter 하나가 판정과 회수 사이에서 µs~ms 동안 선점돼야 한다. 5초 넘는 정지는 필요 없다. 4decb41 전에는 빈 lock을 아예 회수하지 않았으므로 이 경로가 없었다.
- 수정 방향(참고): `.reclaim`을 잡은 뒤 lock의 나이(mtime > 5초)나 inode를 다시 확인하고 나서 지운다.

**정보**: `closeSync`가 기록 후 EIO를 던지는 경우를 모의하면 자기(살아 있는) pid가 담긴 lock이 남는다. 같은 프로세스의 다음 `withLock`은 `run is locked by pid <자기 pid>`로 실패한다(fd 누수는 없다). 로컬 파일에서 close가 실패하는 일은 거의 없고, 의미가 있는 것은 MCP 서버처럼 오래 사는 프로세스뿐이다.

### N8 (회수 대기 중 바쁜 대기, RISKS 기록)

**CPU 측정**: dead-pid lock과 방금 만든 `.reclaim`을 둔 상태에서 `withLock` 1회 호출(`process.cpuUsage`).

| 코드 | 벽시계 | CPU | 결과 |
|---|---|---|---|
| 4decb41 | 5073ms | 49ms (**1%**) | 5초 뒤 `.reclaim` 회수 → 성공, 잔존 없음 |
| 9b35d38 (대조) | 5038ms | 3825ms (76%) | 같음 |

바쁜 대기는 **FIXED**. `.reclaim`이 사용 중이면 `reclaimLock`이 `false`를 반환하고 waiter는 `sleepMs`로 간다. 아무것도 회수하지 않았을 때 `run.reclaimedLock`이 설정되던 사소한 문제도 사라졌다.

**RISKS 기록**(`docs/PROGRESS.md` "(M7 N8)") 정확성: **부분적으로만 정확하다.**
- 맞는 부분: 오래된 `.reclaim`의 stat→unlink가 원자적이지 않아 reclaimer 둘이 겹칠 수 있다는 점, 겹쳐도 lost update까지 가려면 µs 창이 더 필요해 실사용 위험이 낮다는 점.
- 틀리거나 빠진 부분:
  1. 전제를 "reclaimer가 5초 넘게 멈추면(SIGSTOP)"으로만 적었다. **`.reclaim`을 쥔 채 죽는 경우(SIGKILL, 크래시)**도 같은 전제를 만들고, 이쪽이 더 흔하다. 이번 스트레스에서도 160회 중 2회 죽은 reclaimer의 `.reclaim`이 남았다(5초 뒤 자가 회복). 3차에서도 1회 관찰됐다.
  2. 근거로 든 "230회 동시성 스트레스에서 유실 0건(M7 3차)"은 9b35d38(이번 수정 전 코드)에서 잰 값이다. 또 그 스트레스는 이 경쟁을 일부러 만들지 않았으므로 이 위험의 근거가 되지 않는다.
  3. 위 N9(빈 lock 회수 ABA)는 5초 정지 없이 µs 선점만으로 생기는데 RISKS에 없다. 코드의 `shortcut:` 주석도 같은 내용만 적고 있다.

**스트레스 (4decb41)**
- 각 회차마다 새 저장소와 `mis start --input x`로 새 run을 만들고, `mis interview add` writer N개를 동시에 실행했다.
- 판정 기준: exit 0인 writer의 질문이 `state.json`에 없으면 lost update. id 중복, `state.json` 파싱 실패, lock·`.reclaim` 잔존도 함께 검사했다.
- 하네스 자체 검증: lock을 끈 사본(`R4_NOLOCK`)으로 5회×8개를 돌려 **35건 유실을 검출**했다.
- 부하: load average 22~37(다른 worktree 작업과 내 LSP 반복 실행이 겹침).

| 시나리오 | 반복 | N | exit 0 | SIGKILL | lost update | 기타 |
|---|---|---|---|---|---|---|
| plain | 30 | 8 | 240 | 0 | **0** | 없음 (최대 9.2초) |
| dead-pid lock 미리 둠 | 30 | 12 | 360 | 0 | **0** | 없음 |
| dead-pid lock + writer 1/4을 40~160ms에 SIGKILL | 30 | 10 | 210 | 90 | **0** | 없음 |
| 10초 된 빈/깨진 lock(`''`·`{"pid":` 번갈아) | 25 | 10 | 250 | 0 | **0** | 없음 |
| 위 + writer 1/4 SIGKILL | 20 | 12 | 180 | 60 | **0** | 1회 `.reclaim` 잔존 |
| dead-pid lock + writer 1/2을 5~200ms에 SIGKILL | 25 | 12 | 150 | 150 | **0** | 1회 `.reclaim` 잔존 |
| 합계 | **160** | | **1390** | 300 | **0** | 실패(exit≠0) 0, id 중복 0, state 손상 0, lock 잔존 0 |

`.reclaim` 잔존 2회는 죽은 reclaimer가 남긴 것이고, 다음 writer가 5초 뒤 지운다. 바로 RISKS 경쟁의 전제 조건이다.

### 이전 수정 spot-check (MCP stdio + 훅 직접 실행)
- N1: `wiki_ingest`가 `.GIT/config`, `.Git/HEAD`, `sub/../.GIT/config`, 절대 경로 `<repo>/.GIT/config`를 모두 `git internals are not wiki material`로 거부 — 유지.
- N5: `open(f,'a').write('x\n'); os._exit(1)` → `python process exited while running this code (it was not retried)`, 파일 1줄, 다음 호출 `7\n` — 유지.
- N3: priority 메모가 있는 저장소에서 `source=compact`·`resume` 모두 `## Project` 1회, priority 1회, test 명령 포함 — 유지.

### 4차 결함 목록

| ID | 심각도 | 출처 | 내용 | 재현 | 위치 |
|---|---|---|---|---|---|
| N9 | 낮음 | N7 수정(4decb41) | 오래된 빈 lock을 회수할 때 내용(`''`)만 비교하고 나이를 다시 보지 않는다. 그래서 다른 waiter가 먼저 회수한 뒤 생긴 새 lock(생성~기록 사이)을 지울 수 있고, 두 writer가 동시에 들어간다. "새 빈 lock은 빼앗지 않는다"는 N7 기준에 어긋난다. RISKS에도 없다. | 순서 재현 probe: 0ms 된 새 lock 삭제 후 두 번째 `wx` 성공. 창을 넓힌 사본: `empty` 15회 중 19건 유실. 실제 코드 무부하 재현은 안 됨 | `scripts/lib/state.mjs` `reclaimLock`(`readLock(lock) === seen`), `withLock` orphan 분기 |
| N10 | 낮음 | M7-04 테스트 fixture (회귀 아님) | `lsp-client.test.mjs`가 fake server의 `workspace/configuration` 응답 처리(`.then`)와 hover 처리 순서 경쟁으로 가끔 실패한다(유휴 2/30, `npm test` 4회 중 1회). 필수 검사가 flaky하다. | 그 파일만 30~40회 반복 | `tests/fixtures/fake-lsp.mjs:60`, `tests/unit/lsp-client.test.mjs:72` |
| N8-doc | 낮음 (문서) | N8 RISKS 기록 | 위험 전제가 "5초 넘게 멈춤"만 적혀 있다. `.reclaim`을 쥔 채 죽는 경우가 빠졌고, 근거 수치는 수정 전 코드의 값이다. N9도 누락됐다. | 위 RISKS 절 | `docs/PROGRESS.md` RISKS, `state.mjs` `shortcut:` 주석 |

3차 결함 최종:
- N2: **FIXED** (저장소 밖 PostToolUse에서 전역 기록 없음, 저장소 안 학습 유지).
- N7: **FIXED** (오래된 빈/깨진 lock 회수, 새 lock 대기, fd 누수 없음은 대조군으로 확인). 단, 수정이 새 경쟁 N9를 만들었다.
- N8: **바쁜 대기 FIXED** (CPU 76%→1%). 남은 경쟁의 RISKS 기록은 불완전하다(N8-doc).
- 스트레스 160회·1390 쓰기에서 lost update 0. validate 통과. npm test는 4회 중 3회 통과(실패 1회는 N10 fixture 경쟁).

### 4차 미검증
- 대화형 세션, Linux(대소문자 구분 FS), headless dogfood(이번 수정은 훅·lock 경로뿐이라 직접 실행으로 대체).
- N9를 넓히지 않은 실제 코드에서 재현하는 것, RISKS 경쟁(죽거나 멈춘 reclaimer 뒤 이중 회수)의 실제 lost update.

ROUND4: DEFECTS FOUND

## 5차 검증 (round 5)

- 대상: 브랜치 `m7-wip`, HEAD e30ce81 (4차 이후 수정 커밋 1개: N9·N10·RISKS, 4개 파일). 커밋 메시지의 주장은 근거로 쓰지 않고 재현으로 판정했다.
- 검증자: 독립 검증 에이전트(구현 미참여). 임시 디렉터리는 모두 저장소 밖(scratchpad `r5/`, `$TMPDIR`). 대조용 옛 코드는 `git archive 4decb41`로 풀었다. 내가 띄운 프로세스만 PID로 관리했다.
- 부하: load average 10~22. 다른 worktree 작업이 계속 돌았으므로 "유휴" 측정은 없다.

### 기본 확인
- `claude plugin validate .`: ✔ Validation passed
- `npm test` 3회: 421/421 (106초, 스트레스와 겹침), 421/421 (53초), 421/421 (235초). 실패 0, skip 0.

### N9 (빈 lock 회수 ABA)

**순서 재현 probe** (`withLock`과 같은 순서로 A·B가 내용과 inode를 판정 → B 회수 → W가 `wx`로 새 lock 생성, 아직 기록 전 → A 회수 시도). 200회 반복:

| 코드 | W의 새 inode가 A가 본 inode와 같음 | W lock 삭제 | 두 번째 writer `wx` 성공 |
|---|---|---|---|
| e30ce81 (APFS) | 0/200 | **0/200** | **0/200** |
| 4decb41 (대조) | 0/200 | 200/200 | 200/200 |
| e30ce81, inode 재사용을 흉내(A의 `seenIno` = W의 inode) | 해당 | 200/200 | 200/200 |

**창을 넓힌 스트레스** (4차와 같은 하네스. `openSync`~`writeFileSync` 사이 30ms, orphan 판정~`reclaimLock` 사이 0~300ms sleep을 넣은 사본, writer 실프로세스):

| 코드 | 시나리오 | 반복×N | exit 0 | SIGKILL | lost update |
|---|---|---|---|---|---|
| 4decb41 넓힌 사본 (대조) | empty (`''`·`{"pid":` 번갈아) | 15×10 | 150 | 0 | **29건 (6회, 모두 `''` 회차)** |
| e30ce81 넓힌 사본 | empty | 20×10 + 30×10 | 500 | 0 | **0** |
| e30ce81 넓힌 사본 | empty-kill | 20×12 | 180 | 60 | **0** |

판정: macOS(APFS)에서 **FIXED**. 하네스는 대조군에서 유실을 잡으므로 0건은 의미가 있다.

다만 보호는 전적으로 "새 lock의 inode가 옛 lock과 다르다"에 기댄다(위 흉내 실험에서 inode가 같으면 4decb41과 똑같이 지운다). APFS는 inode 번호를 재사용하지 않지만, README가 지원한다고 적은 Linux의 ext4 등은 지운 inode 번호를 곧바로 다시 쓰는 일이 흔하다. 그런 파일시스템에서는 N9가 그대로 남을 수 있다. 이번 커밋의 단위 테스트도 inode가 재사용되면 `return`으로 아무것도 검사하지 않고 통과한다(`tests/unit/state.test.mjs` "M7 N9"). Linux VM이 없고 설치도 금지라서 실제 Linux에서는 재현하지 못했다(아래 N9-fs).
- 수정 방향(참고): 내용이 없는(pid 없는) 경우 `.reclaim`을 잡은 뒤 lock의 mtime이 여전히 5초보다 오래됐는지 다시 확인하고 지운다. 파일시스템과 무관하다.

### 전체 동시성 스트레스 (e30ce81, 작업 트리 그대로)

판정 기준과 하네스는 4차와 같다(exit 0 writer의 질문이 `state.json`에 없으면 lost update, id 중복·state 손상·lock/`.reclaim` 잔존도 검사).

| 시나리오 | 반복 | N | exit 0 | SIGKILL | lost update | 기타 |
|---|---|---|---|---|---|---|
| plain | 30 | 8 | 240 | 0 | **0** | 없음 |
| dead-pid lock | 30 | 12 | 360 | 0 | **0** | 없음 |
| dead-pid + writer 1/4 SIGKILL | 30 | 10 | 210 | 90 | **0** | 없음 |
| 10초 된 빈/깨진 lock | 25 | 10 | 250 | 0 | **0** | 없음 |
| 위 + writer 1/4 SIGKILL | 20 | 12 | 180 | 60 | **0** | 없음 |
| dead-pid + writer 1/2 SIGKILL | 25 | 12 | 158 | 142 | **0** | 1회 `.reclaim` 잔존(죽은 reclaimer, 5초 뒤 자가 회복) |
| 합계 | **160** | | **1398** | 292 | **0** | 실패(exit≠0) 0, id 중복 0, state 손상 0, lock 잔존 0 |

넓힌 사본 70회(위 N9 표)를 더하면 230회, lost update 0.

### N10 (lsp-client 테스트 flaky)

수정 확인(코드): fake server가 `initialized`에서 받은 `workspace/configuration` 왕복을 `configReady`로 두고, hover는 그것을 기다린 뒤 답한다. 알림은 순서대로 처리되므로 hover보다 `configReady` 설정이 항상 먼저다.

| 코드 | 조건 | 실패 |
|---|---|---|
| 4decb41 fixture (대조) | 순차 80회 | **7/80** (모두 `cfg=none`) |
| e30ce81 | 순차 40회 (load ~10) | 0/40 |
| e30ce81 | 스트레스와 동시에 순차 60회 (load ~17) | 0/60 |
| e30ce81 | 4개 병렬 루프×30 (load ~17) | 0/120 |
| e30ce81 | 스트레스 후 순차 40회 (load ~22) | 0/40 |

합계 HEAD 0/260, 대조 7/80. 판정: **FIXED**. `npm test` 3회도 모두 통과했다.

### RISKS 기록 (`docs/PROGRESS.md` "(M7 N8·N9)") 정확성

4차 지적 중 고쳐진 것:
- 전제에 "5초 넘게 멈추거나 **죽으면**"이 들어갔다. 엄밀히는 죽은 회수자가 남긴 오래된 `.reclaim`을 다른 두 회수자가 지우고 다시 만드는 과정(stat→unlink가 원자적이지 않음)에서 겹친다. 하지만 위험을 알리는 문장으로는 충분하다.
- N9가 기록에 들어갔다.

아직 틀린 것:
1. **"(빈 lock도 구분)"은 일반 규칙으로 쓰기에 넓다.** inode를 재사용하는 파일시스템에서는 구분하지 못한다. 같은 커밋의 단위 테스트도 그 경우를 "nothing to distinguish here"로 건너뛴다. README는 Linux 지원을 명시한다.
2. **근거 수치가 또 수정 전 코드의 값이다.** "M7 4차 스트레스(160회 …) 유실 0건(수정 후 코드 기준)"은 4decb41에서 쟀다. 4decb41에는 inode 확인이 없고 N9가 있었다. 또 4차에서 이미 밝혔듯이, 넓히지 않은 스트레스는 N9 경쟁을 만들지 못한다. 4차가 N8 기록에서 지적한 것과 같은 문제다. 올바른 근거는 e30ce81에서 잰 이번 수치다(전체 160회 0건, 넓힌 사본 70회 0건, 대조 15회 29건).
3. `state.mjs` `reclaimLock` 위의 `shortcut:` 주석(125~126행)은 바뀌지 않았다. 아직 "SIGSTOP 정지"만 적고 있고, 죽은 회수자나 inode 재사용 한계는 없다. 4차에서 N8-doc의 위치로 함께 지적한 부분이다.

판정: **N8-doc 부분 해결, 미해결 항목 남음.**

### 5차 결함 목록

| ID | 심각도 | 출처 | 내용 | 재현 | 위치 |
|---|---|---|---|---|---|
| N8-doc (잔여) | 낮음 (문서) | 4차 N8-doc | RISKS의 근거 수치가 수정 전 코드(4decb41) 값이다. "빈 lock도 구분"은 inode 재사용 FS에서 성립하지 않는다. `shortcut:` 주석이 갱신되지 않았다. | 위 RISKS 절 | `docs/PROGRESS.md` RISKS, `scripts/lib/state.mjs:125-126` |
| N9-fs | 낮음 (조건부, 실제 Linux 미재현) | N9 수정(e30ce81) | 빈 lock 회수 보호가 inode 차이에만 기댄다. inode가 재사용되면 N9와 똑같이 새 lock을 지운다(흉내 200/200). 이때 N9 단위 테스트는 아무것도 검사하지 않고 통과한다. | `reclaimLock(lock, '', <W의 inode>)`로 흉내 | `scripts/lib/state.mjs` `reclaimLock`, `tests/unit/state.test.mjs` "M7 N9" |

4차 결함 최종:
- N9: macOS(APFS) **FIXED** (순서 재현 0/200, 넓힌 스트레스 70회 0건, 대조 29건). inode를 재사용하는 FS에는 N9-fs가 남는다.
- N10: **FIXED** (HEAD 0/260, 대조 7/80).
- N8-doc: **부분 해결** (위 잔여 항목).
- 스트레스 160회·1398 쓰기에서 lost update 0. validate 통과. `npm test` 3/3 통과.

### 5차 미검증
- 실제 Linux(ext4 등)에서 inode 재사용으로 N9가 다시 생기는지. colima VM이 꺼져 있고 설치가 금지돼 띄우지 않았다. macOS의 msdos 램디스크는 커널 확장 권한이 없어 마운트하지 못했다(만든 램디스크는 바로 분리함).
- 대화형 세션, headless dogfood(이번 수정은 lock 경로와 테스트 fixture뿐이라 직접 실행으로 대체).

ROUND5: DEFECTS FOUND
