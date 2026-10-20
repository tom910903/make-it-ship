ROUND1-AF: FAIL

# M9 독립 검증 1차 — A·B·C·F 묶음

- 검증 대상: 워크트리 `make-it-ship-m9`, 브랜치 `m9-wip`, HEAD `690cbfb`
- 검증자: 독립 검증자. 이 코드를 쓰지 않았다.
- 범위: 행 수가 아니라 수용 기준별 실측으로 판정했다.
- 일시: 2026-10-21
- 격리 환경: 모든 실행에 `HOME`, `MIS_STATE_HOME`, `CLAUDE_CONFIG_DIR`, `MIS_TMUX_SOCKET`을 scratch 경로로 지정했다. 실제 `~/.claude`와 `~/.make-it-ship`은 건드리지 않았다. 외부 모델 CLI는 호출하지 않았고, 네트워크는 사용하지 않았다(update-check 실패 경로는 `127.0.0.1:9`로 확인).
- 판정 근거:
  - HIGH 결함은 없다.
  - MEDIUM 결함 2건(D1, D2)은 guard 우회다. 코드가 스스로 밝힌 규칙과 정면으로 어긋난다.
    - D1이 어기는 규칙: `commands-setup.mjs` 헤더와 `policy.mjs` `outsideRepoMis` 주석의 "저장소 밖(~/.make-it-ship 포함)을 바꾸는 명령은 항상 ask".
    - D2가 어기는 규칙: tty 입력을 Bash와 같게 분류한다는 규칙.
  - 그래서 FAIL로 판정한다.

## 실행한 명령과 결과

| # | 명령 / 시나리오 | 결과 |
|---|---|---|
| 1 | `npm test` | **674/674 pass**, fail 0, skip 0, todo 0 (342 s). 실패가 없어 재실행할 필요가 없었다 |
| 2 | `claude plugin validate .` | ✔ Validation passed |
| 3 | `grep` 검색: `.skip(`·`.only(`·`todo`·TODO·FIXME (대상: tests·scripts·skills·agents) | 가짜 완료 없음. 나온 TODO는 모두 task 상태값이거나 lint 규칙 문자열이다 |
| 4 | A1 `mis setup` (dry run). 대상: OMC 블록과 다른 statusLine이 있는 fixture | diff를 출력하고 파일 해시가 그대로다 (PASS) |
| 5 | A1 `mis setup --write`를 두 번 실행 | 백업을 만든다. 두 번째 실행은 changes가 비어 있다. MIS 블록은 1개다. 기존 statusLine은 `statusLine.chain`으로 옮겨진다 (PASS) |
| 6 | A1 statusLine이 없을 때 SessionStart를 두 번 실행 | 안내는 첫 번째에만 나온다 (PASS) |
| 7 | A1 `mis setup team`, `mis init` | 초안을 보여 준다. init 결과에 `projectType`이 있다 (PASS) |
| 8 | A2 `mis doctor --json` | 다음 항목이 모두 나온다 (PASS): plugin, hooks (11 events), mcp (tools/list 54 = registry 54), statusLine, state, coding-agents |
| 9 | A2 `mis doctor` → `--fix`. fixture: 없는 statusline 경로, pid 999999 lock, 깨진 `memory/modes/ralph.json` | 3건 모두 error에서 repaired로 바뀌고 `ok:true`가 된다 (PASS) |
| 10 | A2 `mis doctor session` | 깨끗한 상태에서는 PASS다. trace에 숫자 cwd가 있으면 **크래시**한다 (D5) |
| 11 | A3 `mis mcp-setup list`, `add github`, `add context7` | env가 없으면 실행하지 않는다. 실행할 argv를 보여 준다 (PASS) |
| 12 | A5 `mis config set`: 잘못된 키·값 / 정상 값, `mis version` | 잘못된 입력은 exit 1이다. version에 버전, node, commit이 나온다 (PASS). 키 누락 결함은 D4 |
| 13 | A6 `mis update-check` (fixture 파일 원천) | 첫 호출 `cached:false`, 두 번째 호출 `cached:true`다. 원천이 닿지 않으면(`127.0.0.1:9`) error를 캐시한다. 그 뒤 새 상태 홈에서 SessionStart를 실행해도 `is available`이 0건이다. 새 버전이 캐시돼 있으면 SessionStart 알림은 한 줄이다 (PASS) |
| 14 | A6 `mis uninstall` dry run과 `--yes` (scratch) | statusLine이 chain 값으로 복원된다. MIS 블록이 제거된다. 상태 홈을 지운다. `MIS_STATE_HOME=$HOME`이나 repo 자신을 가리키면 거부한다. run이 있는 r5에서는 dry run의 `keep`에 `.git/make-it-ship`가 나오고, `--yes` 뒤에도 `runs/`가 남는다(`--purge-runs` 없음) (PASS) |
| 15 | A8 `mis launch --resume` (stub `claude`, 전용 tmux 소켓) | tmux에서 stub이 `--resume`으로 실행되고 attach 명령을 출력한다 (PASS). 인자 전달 문제는 D10 |
| 16 | A8 `mis loop start x` → `mis cancel --all` | `loop:true`가 돌아온다. run은 유지하고 `runKept`로 알린다 (PASS) |
| 16a | A7 SessionStart (새 `MIS_STATE_HOME`). fixture: REPORTED run `old1`(mtime 2020) + 현재 EXECUTING run, 스키마 위반 `.make-it-ship.json` | `old1`은 삭제되고 현재 run은 남는다. `.make-it-ship.json is invalid (checks must define at least one check)` 한 줄이 나오고 exit 0이다 (PASS) |
| 17 | A4 `mis help` / `help bogus` / `gain` / `info` / `capabilities --check\|--write` | 각각 89 commands·33 skills를 출력한다. 모르는 topic은 exit 1이다. 측정값이 없으면 BLOCKED다. lockfile은 쓰고 나면 일치한다. lock에서 항목 하나를 지우면 `--check`가 drift를 보고하고 exit 1이다. 플러그인 저장소 lock도 일치한다 (PASS) |
| 18 | B `mis plan check` (불량 / 정상 계획) → `mis start --plan` | 불량 계획은 exit 1이고 누락 절을 나열한다. 정상 계획은 task 3개가 run으로 옮겨지고 제목도 같다 (유니코드·백틱 포함) (PASS) |
| 19 | B `mis test-prompt` 12개 문장 | `build it`은 clarify, `office hours`는 office-hours, `deepinit`은 deepinit으로 간다. `ralph:`·`autopilot`은 loop→run으로 가고, run의 interview 단계와 approve 게이트(HIGH 모호성이면 거부)가 수용 기준을 강제한다 (PASS). run 밖 문구 범위는 D6 |
| 20 | B5 `mis debt`, `redact scan [--history]`, `health` ×2 | shortcut 1건을 찾는다. 이력에 심은 AKIA·ghp를 찾고 값은 표시하지 않는다. health 추세가 쌓인다 (PASS) |
| 21 | B5 guard의 `git push` (비밀값이 든 미푸시 커밋) | ask 사유에 `SECRET SCAN: 2 possible secret(s)`가 붙는다 (PASS) |
| 22 | B6 `version-bump patch`, `diff-scope`, `repo-mode`, `next-version` | VERSION, package.json, CHANGELOG가 갱신된다. 파일은 4가지로 분류된다 (PASS) |
| 23 | B3 `question log` (JSON) / `pref set` / `profile` | 기록되고 요약이 나온다 (PASS) |
| 24 | B7 `context save`·`restore` (다른 브랜치), `goal add\|list`, `context sessions` | 브랜치 불일치 경고가 나온다. `/goal` 인계문이 나온다. fixture 두 프로젝트의 세션이 나열된다 (PASS) |
| 25 | B8 `decision add\|search`, `learn distill` (`-`, `--yes`), `learn search`, `retro --git --since 7d` | `--yes` 없이는 적용하지 않고, `--yes`가 있으면 적용한다. retro 출력에 다음이 있다: git 블록(commits 3, authors별 commits/added/deleted/files, hotspots), `metrics.reviewers` (PASS) |
| 26 | B8 `jsonl-merge install` 후 두 브랜치 병합 | `docs/make-it-ship/*.jsonl`은 합집합으로 자동 병합되고 충돌이 없다 (PASS) |
| 27 | B4 `diagram x.mmd`, `design-board`, `taste approve\|show` | 4개 파일이 생긴다. excalidraw는 유효한 JSON이고 elements 9개다. board에 `data-choice`가 있다 (PASS). board에 diagram HTML이 섞이는 문제는 D11 |
| 28 | B9 `session create feature csv` | worktree가 생기고 baseline `npm test`가 PASS다 (PASS) |
| 29 | C1 agents frontmatter 21개 | 새 11개가 모두 있다. 읽기 전용 역할(analyst, planner, tracer, document-specialist)에는 Write/Edit가 없다 (PASS) |
| 30 | C2 `mis tty` start/expect/send/keys/save/stop. fixture: node REPL | replay 스크립트는 정상 코드에서 rc 0, 동작을 바꾸면 rc 1이다. 시간 초과 시 출력 tail을 보여 준다 (PASS) |
| 31 | C3 `skill add` (project·user) / `list` / `search` / `lint` / `remove`, `remove ../../x` | 경로 탈출을 거부한다. triggers가 UserPromptSubmit에서 매칭된다 (PASS). 사소한 문제는 D13 |
| 32 | F1 SubagentStart ×2, TodoWrite, statusline | `agents 2 · todo 1/3` → Stop 후 `todo 1/3`이다 (PASS) |
| 33 | F2 SubagentStop: 없는 파일을 보고 / `stop_hook_active` / 부정문 | 첫 경우만 block한다. 재진입과 부정문은 통과시킨다 (PASS) |
| 34 | F3 PermissionRequest, 명령 37개 | 메타문자·쓰기·`find -delete`·`--output`에는 판단하지 않는다. 다만 **저장소 밖 비밀 파일 읽기를 자동 허용한다** (D3) |
| 35 | F4 PreToolUse 알림 | commit할 때 todo 경고가 나온다. Agent 힌트는 1회만 나온다. 판정값은 출력하지 않는다 (PASS) |
| 36 | F5 EXECUTING run에서 편집 후 Stop ×4 | block, block, 그 뒤로는 통과한다(상한 2) (PASS) |
| 37 | F7/F11 PreCompact, compact SessionStart, SessionEnd, 지시문 감지 | todo가 보존된다. 요약 파일이 생긴다. hotPaths는 repo 안 경로만 남는다. 지시문은 제안만 하고 저장하지 않는다 (PASS) |
| 38 | F8 `mis debug scope src/a.js` → 범위 밖 Edit | ask가 나오고 `--clear` 후에는 해제된다 (PASS) |
| 39 | F9 timeline 기록과 `mis timeline --last` | PASS |
| 40 | F10 `setup routing` dry / `--write` ×2 | dry run은 해시가 그대로다. 절은 1개만 생긴다 (PASS) |
| 41 | 훅 퍼즈: 11개 이벤트 × 9개 입력 (빈 값, 깨진 JSON, null, 배열, 문자열, 타입이 틀린 필드, 없는 cwd, `../../etc` 세션 ID) | 모두 exit 0이다. stdout은 비었거나 유효한 JSON이다. 오류는 trace에 기록된다 (PASS) |
| 42 | 훅 지연 (`npm test`와 동시 실행) | UserPromptSubmit 0.32 s, PreToolUse 0.16 s, PostToolUse 0.19 s, PermissionRequest 0.16 s, Stop 0.28 s, SessionStart 1.36 s, guard 0.41 s. 모두 timeout 안이다 |
| 43 | guard 우회 시도 26종 | `mis setup/uninstall/doctor/mcp-setup/upgrade` 실행 플래그는 다음 형태에서도 모두 ask다: env 접두, `bash -c`, `sh -c`, `eval`, 절대경로 node, `./mis.mjs`, 함수, alias. 우회되는 경로는 D1, D2, D8, D9, D10이다 |

## 결함

### D1 (MEDIUM) `mis config set`이 guard 없이 저장소 밖 설정을 바꾼다. 그 결과 statusline이 영구적으로 임의 명령을 실행한다
- 재현 (scratch HOME/MIS_STATE_HOME):
  ```
  node scripts/mis.mjs config set statusLine.chain "touch $S/PWNED"
  echo '{}' | node scripts/statusline.mjs
  ls $S/PWNED
  ```
  - `config set` 줄은 guard에서 **allow**다 (`scratch/g.sh`로 확인).
  - `ls`에서 파일이 생긴 것을 확인했다. 이 명령은 상태줄이 갱신될 때마다 모든 세션에서 `sh -c`로 실행된다.
- 같은 문제: `mis config set update.source http://…`도 allow다. 이후 SessionStart가 하루 한 번 분리된 자식 프로세스로 그 URL에 `fetch`한다 (`scripts/lib/update.mjs:37-38`, `:90-99`).
- 기대: 코드가 스스로 밝힌 규칙대로라면 ~/.make-it-ship을 바꾸는 명령은 ask다. 규칙은 두 곳에 있다.
  - `commands-setup.mjs` 헤더: "Everything that edits files outside the repository … the guard ask"
  - `policy.mjs` `outsideRepoMis` 주석: "~/.make-it-ship … always ask"

  따라서 적어도 실행되는 값을 담는 키(`statusLine.chain`, `update.source`, `telemetry.endpoint`)는 ask여야 한다.
- 실제: allow다.
- 같은 종류 (저장소 밖에 영구적으로 남는 변경인데 allow):
  - `mis skill add <file> --scope user`, `mis skill edit … --scope user`는 allow다. 스킬은 `~/.make-it-ship/skills`에 저장된다. 이후 UserPromptSubmit은 모든 저장소의 매 프롬프트마다 이 스킬을 "read … and follow it"으로 주입한다.
  - `mis mcp-setup add --write`는 ask다. 그러나 그 명령이 출력하는 `claude mcp add x -- npx y`를 직접 실행하면 allow다.
  - `claude plugin uninstall make-it-ship`도 allow다.
  - 따라서 wrapper에만 거는 ask는 실제 사용자 설정 변경을 막지 못한다. guard 판정은 `scratch/g.sh`로 확인했다.
- 위치:
  - `scripts/lib/policy.mjs:251` `outsideRepoMis`에 `config`·`skill --scope user`가 없다. `careful`에는 `claude mcp add|remove`·`claude plugin install|uninstall|update` 규칙이 없다.
  - `scripts/lib/commands-setup.mjs:222,224` (키 정의)
  - `scripts/statusline.mjs:70` (`execFileSync('sh', ['-c', chain])`)

### D2 (MEDIUM) `mis tty keys`가 guard 분류를 우회한다
- 재현:
  ```
  mis tty start shx -- bash --norc
  mis tty keys shx "echo typed-by-keys > $S/keys-proof.txt" Enter
  ```
  두 줄 모두 guard에서 allow다. 파일이 실제로 생겼다(`keys-proof.txt` = `typed-by-keys`).
- guard 판정 비교:

  | 명령 | 판정 |
  |---|---|
  | `mis tty send sh 'rm -rf ~'` | ask |
  | `mis tty keys sh 'rm -rf ~' Enter` | allow |
  | `mis tty send sh 'node /x/mis.mjs uninstall --yes'` | ask |
  | `mis tty keys sh 'node /x/mis.mjs uninstall --yes' Enter` | allow |

  `tmux send-keys`는 `-l` 없이도 키 이름이 아닌 문자열을 그대로 타이핑한다.
- 기대: `keys` 인자도 `send`와 같이 Bash 명령으로 분류한다. 또는 `keys`를 특수 키 이름(C-c, Enter, Up…)으로 제한한다.
- 실제: 분류하지 않는다.
- 위치:
  - `scripts/lib/policy.mjs:244-245` (`start`·`send`만 분류)
  - `scripts/lib/commands-tty.mjs:66-74`

### D3 (MEDIUM) PermissionRequest가 저장소 밖 비밀 파일 읽기를 자동 허용한다
- 재현:
  ```
  printf '{"cwd":"<repo>","tool_name":"Bash","tool_input":{"command":"cat ~/.ssh/id_rsa"}}' | node scripts/hooks.mjs PermissionRequest
  ```
  결과는 `{"decision":{"behavior":"allow"}}`다. `cat .env`도 allow다. `grep`·`find`·`head`도 경로 제한 없이 allow다.
- 기대: PermissionRequest는 Claude Code가 확인 창을 띄울 때만 호출된다. 대표적인 경우가 작업 디렉터리 밖 경로다. 그러므로 이 훅은 바로 그 확인을 무조건 허용으로 바꾼다. 자동 허용은 저장소 안 경로로 한정하고, `~`·절대경로·`..`로 저장소를 벗어나는 인자에는 판단하지 않아야 한다.
- 실제: 경로 검사가 전혀 없다.
- 위치: `scripts/lib/readonly.mjs:12` (`PLAIN`), `:20-38`

### D4 (MEDIUM) 훅이 읽는 설정 키 `simplifier.enabled`·`proactive`가 `mis config`의 스키마에 없다
- 재현:
  ```
  mis config set simplifier.enabled true
  mis config set proactive false
  ```
  둘 다 `unknown key`, exit 1이다.
- README:69와 README:79는 두 키를 설정 방법으로 안내한다. F6 테스트(`hooks-m9f.test.mjs:128`)는 `config.json`을 손으로 써서 이 문제를 피해 간다.
- 기대: `CONFIG_KEYS`에 두 키가 등록돼 있어야 한다. 코드 주석에도 "Groups adding a setting register it here"라고 적혀 있다.
- 실제: F6 opt-in과 F10 proactive 끄기는 파일을 직접 고쳐야만 쓸 수 있다.
- 위치:
  - `scripts/lib/commands-setup.mjs:217-227`
  - `scripts/lib/tracking.mjs:110`
  - `scripts/hooks.mjs:34`

### D5 (LOW) `mis doctor session`이 trace에 문자열이 아닌 cwd가 있으면 크래시한다
- 재현:
  ```
  printf '{"cwd":123}' | node scripts/hooks.mjs SubagentStop
  mis doctor session
  ```
  결과: `mis doctor: e.cwd.startsWith is not a function`, exit 1.
- 훅은 `input.cwd`를 검사 없이 trace에 기록한다. 그래서 잘못된 입력이 한 번만 들어와도 진단 명령이 영구히 깨진다.
- 위치:
  - `scripts/lib/commands-setup.mjs:154`
  - `scripts/hooks.mjs` 마지막 블록 (`appendTrace({cwd: input.cwd})`)

### D6 (LOW) run 밖 clarify 키워드가 다루는 문구 범위가 좁다
- 재현: `mis test-prompt` 결과

  | 입력 | 결과 |
  |---|---|
  | `ralph: build it` | `["loop"]` |
  | `autopilot build me an app` | `["run"]` |
  | `just do it`, `go ahead and build it please`, `만들어줘` | `[]` |

- 정정:
  - `ralph:`는 `/make-it-ship:loop`로 간다. loop 2단계는 `/make-it-ship:run`을 거친다.
  - `autopilot`은 `/make-it-ship:run`으로 간다.
  - run에는 다음 게이트가 있다: interview 단계(`skills/run/SKILL.md:39`), `mis approve plan`의 HIGH 모호성 거부(`:98`).
  - 따라서 ralplan 게이트는 흐름 안에 흡수돼 있다.
- 남는 문제: run 밖에서 `just do it`·`만들어줘` 같은 흔한 모호한 표현은 clarify 힌트를 받지 못한다. 프롬프트 전체가 정확히 일치해야 하는 정규식이기 때문이다.
- 위치: `scripts/lib/keywords.mjs:72` (`VAGUE_EXEC`), `:102`

### D7 (LOW) 저장소 밖에서 훅이 git 오류를 stderr로 흘린다
- 재현: 다음 두 경우 모두 stderr에 `fatal: not a git repository`가 나온다. exit 0은 유지된다.
  - cwd `/tmp`로 SessionStart 또는 UserPromptSubmit을 실행한다.
  - PostToolUse에 Read `/etc/hosts`를 넣는다.
- 위치: `scripts/lib/tree-hash.mjs:10` (`repoRoot`에 `stdio` 지정이 없다)

### D8 (LOW, bypassPermissions 모드에서는 MEDIUM) 사용자 설정 파일을 직접 편집해도 guard가 ask하지 않는다
- 다음은 run이 없을 때 모두 allow다. 지금은 Claude Code 자체의 권한 확인에만 기대고 있다. 그런데 bypassPermissions 모드에서는 그 확인이 없으므로 guard가 유일한 장치다.
  - Write 도구로 `~/.claude/settings.json`, `~/.claude/CLAUDE.md`, `~/.make-it-ship/config.json`을 쓴다.
  - Bash로 `echo '{}' > ~/.claude/settings.json`, `sed -i … ~/.claude/CLAUDE.md`를 실행한다.
- 위치: `scripts/lib/policy.mjs` `classify`의 Write 분기와 `classifyBash`

### D9 (LOW) guard가 일부 실행 형태를 mis로 인식하지 못한다
- 다음 형태는 `mis.mjs` 호출로 인식되지 않아 allow다.
  - `nodejs …/mis.mjs uninstall --yes`
  - `bun …/mis.mjs uninstall --yes`
  - `echo 'setup --write' | xargs node …/mis.mjs`
- 위협 모델 주석은 "obfuscation out of scope"라고 적고 있으므로 기록만 한다.
- 위치: `scripts/lib/policy.mjs` `misSub`

### D10 (LOW) `mis launch`가 claude 인자를 그대로 넘긴다
- `mis launch --dangerously-skip-permissions -p '…'`는 allow다. 결과로 사람이 지켜보지 않는 분리된 tmux 세션에서 권한 확인 없는 Claude가 뜬다.
- 직접 `claude --dangerously-skip-permissions`를 실행해도 allow인 기존 문제와 같은 종류다.
- 위치: `scripts/lib/commands-setup.mjs` `launch`, `scripts/lib/policy.mjs`

### D11 (LOW) `mis design-board`가 `design/`의 모든 HTML을 시안으로 넣는다
- 원인: `phases/design.md`는 diagram을 `design/<name>.mmd`에 쓰라고 안내한다. 그래서 `mis diagram`이 만든 `f.html`이 디자인 시안 비교 보드에 끼어든다.
- 재현: `mis diagram design/f.mmd` 다음에 `mis design-board design`을 실행하면 variants에 `f.html`이 들어간다.
- 위치: `scripts/lib/commands-flow.mjs:290`

### D12 (LOW) 전역 `CLAUDE.md`의 MIS 블록이 `${CLAUDE_PLUGIN_ROOT}`를 그대로 적는다
- 이 변수는 전역 CLAUDE.md에서 치환되지 않을 가능성이 높다. 같은 블록의 statusLine은 절대경로로 적는다.
- 위치: `scripts/lib/install.mjs:22`
- 실제 동작은 NEEDS_HUMAN으로 확인해야 한다.

### D13 (LOW) learned skill 주입의 사소한 문제 두 가지
- 같은 이름의 스킬이 project와 user 범위에 모두 있으면 UserPromptSubmit이 같은 안내를 두 번 주입한다.
- clone한 저장소의 `.make-it-ship/skills/*`도 "read … and follow it"으로 주입된다. 저장소 내용은 신뢰하지 않는 입력이라는 원칙과 충돌한다. 다만 OMC의 `.omc/skills`와 같은 설계다.
- 위치: `scripts/lib/keywords.mjs` `learnedSkills`

### 참고 (결함 아님)
- `mis learn distill --yes`는 guard ask 대상이 아니다. 승인 여부는 스킬 지시문에만 기대고 있다. 같은 성격인 self-improve의 `approve proposal`은 ask다.
- `document-specialist` 에이전트는 WebFetch/WebSearch 권한을 가진다. 외부 전송이지만 guard의 matcher 밖이고, Claude Code 자체 권한 확인에만 기댄다.
- guard의 계획 범위 검사에 묶음 밖의 기존 동작이 있다. `plan.plannedFiles`가 없고 task `files`만 있으면 EXECUTING 중 계획 밖 편집에도 ask하지 않는다(`guard.mjs` context). F5 재현 중 `src/other.js` Write가 allow였다.

## 잘못 분류된 것으로 보이는 gap-matrix 행
ABSORBED로 표시된 127행 중 70행 이상을 코드에서 직접 실행하거나 읽어 대조했다(위 표 4~42). 다음 행은 ABSORBED가 아니라 PARTIAL로 본다.

| 행 | 판단 | 이유 |
|---|---|---|
| `OMC omc config`, `gstack gstack-config` | PARTIAL | 훅이 읽는 키 `simplifier.enabled`·`proactive`를 `mis config`로 설정할 수 없다 (D4) |
| `OMC Stop: code-simplifier.mjs` | PARTIAL | opt-in을 지원하는 CLI 경로가 없다 (D4) |
| `gstack preamble: proactive 제안` | PARTIAL | 끄는 설정을 CLI로 바꿀 수 없다 (D4) |

다음 두 행은 ABSORBED를 유지하되 결함을 함께 적는다.

| 행 | 판단 | 이유 |
|---|---|---|
| `OMC PermissionRequest(Bash): permission-handler.mjs` | ABSORBED + 결함 | 허용 범위가 원본보다 넓다. 저장소 밖 읽기까지 허용한다 (D3) |
| `OMC debug` | ABSORBED + 결함 | `doctor session`이 크래시할 수 있다 (D5) |

나머지 표본은 모두 주장대로 존재하고, 동작하며, 스킬·명령·훅에서 도달할 수 있었다. B0 결정(단독 명령 없이 run 단계와 자연어로 진입)에 따라, B 기능 35개 키워드가 `skills/run/phases/*.md`와 `skills/*/SKILL.md` 또는 키워드 라우터에서 각각 참조되는 것을 확인했다. 스킬·에이전트·README가 언급하는 `mis <cmd>` 중 존재하지 않는 명령은 0건이다.

## NEEDS_HUMAN
1. **PermissionRequest 훅의 실제 효과:** 실제 Claude Code에서 `cat ~/.ssh/...` 확인 창이 자동으로 승인되는지 확인한다 (D3 심각도 확정).
2. **SubagentStop의 `decision: block`:** 실제 서브에이전트가 이 결정을 받아 계속 작업하는지 확인한다.
3. **상태줄 표시:** 실제 UI에 `agents N`·`todo a/b`가 나오는지, chain된 상태줄이 함께 나오는지 확인한다.
4. **전역 CLAUDE.md MIS 블록:** `${CLAUDE_PLUGIN_ROOT}`가 모델에게 어떻게 보이는지 확인한다 (D12).
5. **`mis launch` (실제 `claude`):** tmux 안에서 새 세션으로 뜨는지 확인한다. 여기서는 stub으로만 확인했다.
6. **`mis mcp-setup add --write`, `mis upgrade --yes`:** 실제 `claude mcp add`와 실제 마켓플레이스 갱신을 실행하지 않았다.
7. **guard ask 창:** 실제 확인 창에서 `mis setup --write`·`uninstall --yes`를 승인하거나 거절했을 때의 동작을 확인한다.
8. **`mis skill test`의 기본 경로:** `claude -p` 서브에이전트 실행은 하지 않았다(실제 모델 호출).
