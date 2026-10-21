ROUND3-AF: DEFECTS FOUND

# M9 독립 검증 3차 — A·B·C·F 묶음

- 검증 대상: 워크트리 `mis-v9af` (detached), HEAD `7714f8b`. r2 A/F 수정은 `c11e94e`, `99ceb8f`(WIP)이고 `cbf4b29`로 통합 줄에 병합됐다. 같은 줄에 develop(M6/M7)과 M8도 병합돼 있다.
- 검증자: 독립 검증자. 이 코드를 쓰지 않았다.
- 일시: 2026-10-21
- 격리 환경:
  - TMPDIR과 MIS_STATE_HOME은 모두 `/private/tmp/claude-501/v9af-tmp` 아래 전용 경로를 썼다. CLAUDE_CONFIG_DIR는 해제했다.
  - guard·훅·setup·uninstall 실험은 모두 scratch `HOME`에서 했다.
  - dogfood만 실제 HOME에서 돌렸다(claude 인증이 필요하다). 실행 전후로 `~/.claude/settings.json`과 `~/.claude/CLAUDE.md`의 sha1이 같은지 확인했다(바뀌지 않았다).
  - 외부 모델 CLI와 인터넷 서비스는 호출하지 않았다. dogfood에서도 `Bash(codex:*)`, `Bash(gemini:*)`를 막았다.
- 저장소에서 바꾼 것은 이 보고서 파일 하나뿐이다.

## 요약 판정

**DEFECTS FOUND: LOW 1건 (N1). 이 때문에 `npm test`가 이 워크트리에서 1건 실패한다.**

- r2 결함 D1~D7은 원래 재현으로 다시 돌려 보니 **모두 고쳐졌다**. D1이 핵심이었는데, 따옴표로 감싼 `'>'`, `">"`, `\>`, `'|'`, `';'`, `'2>'`, `'<'`, `'&>'`가 모두 일반 단어로 처리된다.
  - 이 따옴표 연산자를 wrapper 12종 × container 11종 × 위험 명령 15종에 섞은 조합 1980건을 돌렸다. 잘못 판정된 것은 0건이다.
- Spec §7 기본 행, 과차단 회귀, PermissionRequest 자동 허용, 훅 4종, 키워드 라우팅, setup의 쓰기 범위, dogfood의 판정 정직성에서는 결함을 찾지 못했다.
- 새로 찾은 결함은 N1 하나다(아래 결함 목록).
  - 원인: 상태줄이 "우리 것"인지를 플러그인 경로에 `make-it-ship`이라는 글자가 있는지로 판단한다.
  - 영향: 플러그인 디렉터리 이름이 다르면(이 워크트리 `mis-v9af`처럼) `mis uninstall`이 `~/.claude/settings.json`의 상태줄을 지우지도 되돌리지도 않는다. 사용자가 원래 쓰던 상태줄(chain)은 `config.json`과 함께 삭제된다.
  - 이 때문에 `tests/integration/mis-lifecycle.test.mjs:141` (A6 uninstall)가 이 워크트리에서 매번 실패한다. 같은 코드를 `.../make-it-ship/`이라는 경로로 복사해서 돌리면 통과한다.

## 실행한 명령과 수치

| # | 명령 / 시나리오 | 결과 |
|---|---|---|
| 1 | `env -u CLAUDE_CONFIG_DIR TMPDIR=… MIS_STATE_HOME=… npm test` | tests **737**, pass **736**, fail **1**, skipped 0, todo 0, cancelled 0 (184 s), exit 1. 실패한 것은 `not ok 225 - A6 uninstall` (`mis-lifecycle.test.mjs:151`, `dry.settings`에 settings.json이 없다) |
| 2 | 같은 테스트만 2번 더 실행 (`--test-name-pattern "A6 uninstall"`) | 2번 모두 fail. 결정적으로 실패한다 |
| 3 | `git archive HEAD`로 `/private/tmp/…/cp/make-it-ship/`에 복사한 뒤 `mis-lifecycle.test.mjs` 실행 | A6 uninstall **pass**. 경로 이름 때문에 실패한다는 것을 확인했다. 이 복사본에서는 A6 upgrade가 실패하는데, 복사본이 git checkout이 아니기 때문이다(예상된 결과) |
| 4 | `claude plugin validate .claude-plugin/plugin.json` / `claude plugin validate .` | 둘 다 ✔ Validation passed |
| 5 | r2 D7 재현: `CLAUDE_CONFIG_DIR=~/.claude`, TMPDIR 125자로 `mis-init-doctor.test.mjs`와 `policy.test.mjs` 실행 | 127/127 pass |
| 6 | 실제 `scripts/guard.mjs`를 프로세스로 실행(stdin JSON, scratch HOME)해 r2 D1~D6 재현 47건 | 47건 모두 기대한 대로다 (표 아래) |
| 7 | Spec §7 기본 행 + 정상 흐름 63건 (run이 PLANNING인 저장소) | 기대와 다른 것은 1건이다. `~/.make-it-ship/runs/…` Write가 allow였는데, 이것은 내 기대가 틀렸다. 상태 루트는 `.git/make-it-ship`이고 그 경로는 deny다 |
| 8 | 따옴표 연산자 조합 (`classify`, active run) | 1980건 중 잘못 판정 0건 |
| 9 | D2와 같은 종류의 쓰기 형태 44건 + 추가 4건 | 기대와 다른 것은 6건이다.
- 2건은 내 기대가 틀렸다(allow가 맞다). `cp settings.json ~/.make-it-ship/`은 보호되지 않는 `~/.make-it-ship/settings.json`을 만든다. `curl -o~/…`는 셸이 단어 중간의 `~`를 펼치지 않아 상대 경로 `./~/…`에 쓴다.
- 나머지 4건은 수정이 주장한 형태 밖이라 남은 위험 R1로 분류했다 |
| 10 | setup/claude/launch/tty 과차단·과허용 23건 | 23건 모두 기대한 대로다 |
| 11 | PermissionRequest 자동 허용 55건 | 허용된 것: `cat src/a.js`, `git status/show/diff --no-ext-diff/log -p`, `ls`, `rg x`, `rg -z`, `wc -l`, `echo`. 나머지(비밀 파일, 체인, 리다이렉트, `$(…)`, `find -delete/-exec`, `rg --pre/--hidden/-uu`, 심볼릭 링크 경로 등)는 판정을 내지 않는다 |
| 12 | 훅: SessionStart, Stop(loop 활성, 다른 세션), PreCompact, 잘못된 입력(`{"prompt":123}`, `garbage`, `[]`, `{"cwd":5}`) | 모두 exit 0이다. loop는 같은 세션의 Stop만 block한다. PreCompact는 run, loop, todo를 보존한다 |
| 13 | `mis test-prompt` 22종 | 아래 "깨기 시도" 참고. 오탐이나 미탐은 결함 수준이 아니다 |
| 14 | 수명주기 (scratch HOME): `setup` dry-run → `setup --write` → `setup routing --write` → `config set` → `uninstall` → `uninstall --yes` | 쓰기는 다음 파일에만 일어났다: `~/.claude/settings.json`, `~/.claude/CLAUDE.md`(둘 다 백업 남김), `~/.make-it-ship/config.json`, 저장소의 `CLAUDE.md`. dry-run은 아무것도 쓰지 않았다. 비표준 경로에서 uninstall한 결과는 N1이다 |
| 15 | 같은 수명주기를 `…/make-it-ship/` 복사본으로 실행 | uninstall 후 settings.json의 statusLine이 원래 값 `echo old`로 되돌아갔다. `~/.make-it-ship`이 지워졌다. 남은 것은 백업 파일과 run 기록(`--purge-runs` 없음)뿐이다 |
| 16 | `mis capabilities --check` | lockfile과 일치한다 |
| 17 | `node scripts/gap-matrix.mjs` | M9-F에 남은 PARTIAL/MISSING 행은 0이다. A/B/C에도 PARTIAL/MISSING 행이 없다(남은 31행은 모두 D/E/M10) |
| 18 | dogfood (demo a, quick, stream-json) | 아래 "dogfood" 절 |

## r2 결함별 재검증

| r2 결함 | 원래 재현 (이번 실행) | 판정 | 증거 |
|---|---|---|---|
| D1 (MEDIUM) 따옴표 `'>'` | `mis uninstall '>' --yes`, `">"`, `\>`, `setup routing '>' --write`, `upgrade '>' --yes`, `mcp-setup add github '>' --write`, `doctor '>' --fix`, `launch '>' --dangerously-skip-permissions`, `skill add f.md '>' --scope=user`, `tty keys sh echo Space x Space '>' Space '~/.claude/settings.json' Enter`, 그리고 `'|'`, `';'`, `'2>'`, `'<'`, `'&>'`, `2>&1 --yes` | **PASS** | 모두 ask다. `mis uninstall`만 쓰면 allow다(dry-run이므로 맞다). 조합 1980건에서도 잘못 판정 0건. 과차단도 없다: `git commit -m 'a > b'`, `grep -n '>' a.js`, `echo "a > b"`, heredoc `> notes.md`, `npm test 2>&1 \| tail`은 allow다 |
| D2 (LOW) 쓰기 형태 | `cp settings.json ~/.claude/`, `cp … ~/.claude`, `mv … ~/.claude`, `~/.claude/Settings.json`, `~/.Claude/settings.json`, Write `CLAUDE.MD`, `~/.claude/{skills,agents,commands,rules,hooks}/…`, `&>`, `>\|`, `exec 3>`, `curl -o`, `wget -O`, `patch f < p`, 다른 저장소 `CLAUDE.local.md` | **PASS** | 모두 ask다. 추가 변형 중 `-t`, `--target-directory=`, `/.`, `//`, `"$HOME"`, `ln -s`, `tee -a`, `sudo tee`, `{ }`, `( )`, `1>`, `2>>`, `cd ~ &&` 상대경로, `curl --output`, `-sSLo`, `wget -qO`, `--output-document=`, `patch -o`도 모두 ask다. 빠진 형태는 남은 위험 R1에 적었다 |
| D3 (LOW) claude/launch 표기 | `claude --debug mcp add x -- y`, `npx @anthropic-ai/claude-code mcp add`, `launch --dangerously-skip-permissions=true`, `launch --settings '{…bypassPermissions…}'` | **PASS** | 모두 ask다. 과차단 없음: `claude -p "please run mcp add for me"`, `claude mcp list`, `claude --version`, `mis launch`, `launch --resume`은 allow다 |
| D4 (LOW) MCP 쓰기 도구 | `patch_file`, `insert_text`, `set_contents`, `uri: file://…`, `files: [{path}]` | **PASS** | 모두 ask다. `mcp__srv__get_issue`는 allow다 |
| D5 (LOW) `load_skills_local` | `scripts/mcp/tools/skills.mjs` 읽기, `tests/integration/mcp-server.test.mjs:28-40` | **PASS** | trust하지 않은 저장소에는 본문 없이 `trusted:false`와 `note`만 준다. `list_skills`도 `trusted`를 표시한다. 테스트가 trust 전과 후를 모두 검사하고, npm test에서 통과했다 |
| D6 (LOW) `tty keys repl -1` 과차단 | `tty keys repl -1 Enter`, `tty keys repl -- -1 Enter` | **PASS** | 둘 다 allow다. `tty keys calc -l hello`는 여전히 ask다 |
| D7 (LOW) 환경에 민감한 테스트 | 실행 5 | **PASS** | 127/127. 단 같은 종류의 새 환경 의존(경로 이름)이 N1로 남아 있다 |

## 표본 행 판정 (gap-matrix A/B/C/F, 27행)

- "실행"은 내가 직접 명령이나 훅을 돌렸다는 뜻이다.
- "테스트 읽기"는 테스트 본문 전체를 읽고, 그 테스트가 주장을 실제로 검증하는지 판단했다는 뜻이다.
- "제목 확인"은 테스트 제목만 보고 npm test 통과를 확인했다는 뜻이다(본문은 읽지 않았다).
- npm test 실행 1에서 아래 테스트는 모두 통과했다.
- 본문을 읽은 테스트: A1 setup 3건, A2 doctor/--fix, A3, A5, A6 update-check·SessionStart·upgrade·uninstall, A7 maintenance, A8 cancel·launch, F1, F2, F4, F5, F6, F7/F11, F10, tty(real tmux).

| 행 | 대상 (묶음) | 방법 | 판정 |
|---|---|---|---|
| 90 | OMC cancel (A) | 실행: `cancel --all`은 allow. 테스트 A8 읽기: loop, team(endedAt), merge-readiness(cancelled)를 끝내고, run은 `--run`일 때만 CANCELLED가 되며, 활성 항목이 없어도 동작하는지 본다 | ABSORBED 맞음 |
| 93 | OMC debug → `doctor session` (A) | r2 D5 재현 + 테스트 A2 session | ABSORBED 맞음 |
| 101 | mcp-setup (A) | 테스트 A3 읽기(stub claude로 argv를 기록하고 `--write`일 때만 실행하는지, 키 누락을 거부하는지 확인), guard에서 `mcp-setup add … --write`는 ask | ABSORBED 맞음 |
| 103/298 | omc-doctor / omc doctor (A) | 실행: `doctor`는 allow, `doctor --fix`는 ask. 테스트 A2 --fix 읽기 | ABSORBED 맞음. 단 플러그인 경로에 `make-it-ship`이 없으면 doctor가 자기 상태줄을 "another status line"(warn)이라고 보고한다 (N1) |
| 105/293/299 | omc-setup / install / setup (A) | 실행 14·15: dry-run은 쓰지 않음, `--write`는 백업과 함께 쓰고 다시 실행하면 "already set up", 기존 상태줄은 chain으로 보존. guard에서 `setup --write`·`--apply`는 ask | ABSORBED 맞음 |
| 115 | setup 라우터 스킬 (A) | `skills/setup/SKILL.md:15` 읽기 | ABSORBED 맞음 |
| 116 | OMC skill (C) | 제목 확인(mis-skill 9건). guard: `skill add`(project)는 allow, `skill trust`는 ask | ABSORBED 맞음 (본문 미확인) |
| 117/99 | skillify / learner (C) | `skills/skillify/SKILL.md` 읽기, 테스트 "add … triggers match learnedSkills" | ABSORBED 맞음 (모델 동작은 실행하지 않음) |
| 146 | qa-tester + `mis tty` (C) | 테스트 읽기: 실제 tmux(private socket)로 fixture REPL을 구동하고 expect, capture, save 재생 스크립트가 통과하거나 실패하는지 본다. tmux가 이 기계에 있어 실제로 돌았다. guard: `tty keys/send`는 allow, `-l`은 ask | ABSORBED 맞음 |
| 163 | SessionStart 업데이트 확인 (A) | 테스트 A6 update-check와 SessionStart 읽기. 확인한 것: 24h 캐시, `--force`, 접근 불가 소스에서 조용함, SessionStart가 네트워크를 기다리지 않고 분리된 자식이 캐시를 채움 | ABSORBED 맞음 |
| 167 | SessionStart init 설정 경고 (A) | 제목 확인 (A7 invalid config 경고) | ABSORBED 맞음 (본문 미확인) |
| 168 | SessionStart maintenance (A) | 테스트 A7 maintenance 읽기. 지워지는 것: 200일 된 REPORTED run, 끝난 team, 죽은 browse. 남는 것: 오래됐어도 EXECUTING인 run, `current`가 가리키는 run, 깨진 state.json의 run, 살아 있는 team, loop.json. 하루 1회만 돌고, `retainDays 0`이면 꺼진다 | ABSORBED 맞음. 지우는 동작의 안전 조건이 테스트로 고정돼 있다 |
| 169 | PreToolUse 알림 (F) | 테스트 F4 읽기(결정을 내지 않음, fail-open) | ABSORBED 맞음 |
| 170 | PermissionRequest 자동 허용 (F) | 실행 11 (55건) | ABSORBED 맞음. 보수적이다 |
| 172 | project-memory (F) | 테스트 F7/F11 읽기. 다른 저장소의 Read는 hotPaths에 넣지 않고, 작업 트리에는 쓰지 않는지 본다 | ABSORBED 맞음 |
| 175 | subagent tracker (F) | 테스트 F1 읽기. 확인한 것: 실행 중 수, 5분 stale, 세션별 분리, style off에서도 추적, SessionEnd에서 정리 | ABSORBED 맞음 |
| 176 | verify-deliverables (F) | 테스트 F2 읽기: 없는 파일만 보고하고, 이미 있는 파일·저장소 밖·URL은 빼고, 두 번 block하지 않고, transcript로 대체하는지 | ABSORBED 맞음 |
| 177 | PreCompact (F) | 실행 12: run과 loop가 systemMessage로 보존됐다 | ABSORBED 맞음 |
| 181 | workflow-drift-guard (F) | 테스트 F5 읽기: 2회 상한, check 뒤 해제 | ABSORBED 맞음 |
| 183 | code-simplifier opt-in (F) | 테스트 F6 읽기(기본 꺼짐), D4는 제목 확인. guard에서 `config set simplifier.enabled true`는 allow | ABSORBED 맞음 |
| 184 | SessionEnd 요약 (F) | 테스트 F7 읽기(요약 파일 내용, todo, 많이 읽은 파일). "host cwd" 테스트는 제목 확인 | ABSORBED 맞음 |
| 283 | omc launch (A) | guard: `launch`는 allow, bypass 표기는 ask. 테스트 A8 launch 읽기(stub tmux argv, `-u CLAUDECODE`, tmux 없으면 BLOCKED) | ABSORBED 맞음 (실제 tmux claude 실행은 NEEDS_HUMAN) |
| 286 | omc config (A) | guard: 민감 키는 ask, 비민감 키는 allow. 테스트 A5 읽기: 잘못된 키나 값 5종은 exit 1이고 아무것도 쓰지 않는지 본다 | ABSORBED 맞음 |
| 291/399 | update·upgrade / gstack-upgrade (A) | 테스트 A6 upgrade 읽기(stub git으로 argv 기록, `--yes`일 때만), guard `upgrade '>' --yes`는 ask | ABSORBED 맞음 |
| 297 | omc capabilities (A) | 실행 16. 테스트는 제목 확인(drift exit 1) | ABSORBED 맞음 |
| 355 | 상태줄 설정 안내 (A) | 테스트 A1 SessionStart 읽기(하루 1회, 설정돼 있으면 안내 없음) | ABSORBED 맞음 |
| 120 / 96 / 391 | ultragoal, deepinit, design-shotgun (B) | `test-prompt ultragoal`·`deepinit` 라우팅 실행, `commands-flow.mjs:285-295` `data-choice` + companion | ABSORBED 맞음. `commands-design.mjs:77`의 `shortcut:`(정적 보드)은 D 묶음 행 548(PARTIAL)에 해당하므로 이 행과는 관계없다 |

## 스텁·skip

`git grep -nE "\.skip|\.only|todo\(|not implemented|TODO|FIXME" -- scripts skills agents hooks tests` 결과는 19건이다. 모두 문제없다.

- task 상태값 `'TODO'`: `commands.mjs:184,364,567,605`, 테스트 5곳
- 스킬 lint의 placeholder 검출 규칙과 그 테스트: `skills.mjs:50`, `mis-skill.test.mjs:50`
- 지시문: `agents/test-engineer.md:14`, `skills/skill`, `skills/writing-skills`
- 변수명 `skipped`
- 출처 주석: `tracking.mjs:2`
- `shortcut:` 주석 2건: `commands-design.mjs:77`, `commands-ios.mjs:54`. 둘 다 D 묶음이고 해당 행이 PARTIAL로 표시돼 있다
- npm test의 skipped 0, todo 0

## 깨기 시도 (결함 아님)

- **guard §7 기본 행:**
  - 상태 위조 deny: Write, `echo >`, `cat …/events.jsonl` 모두 deny
  - approve, 원격 쓰기, `gh pr/release`, 패키지 8종, `rm -rf /`·`~`·저장소 밖, `reset --hard`, `clean -fdx`, `.make-it-ship.json` Write/Edit, 외부 MCP 쓰기 동사 10종: 모두 ask
  - main/master force push 3종: deny
  - 정상 흐름 20종: allow
- **훅:**
  - Stop: 다른 세션의 loop는 block하지 않는다. `session_id`가 없는 입력에서는 활성 loop가 block한다. Claude Code는 항상 session_id를 주므로 문제가 아니다.
  - 잘못된 JSON이나 타입이 와도 exit 0이고 출력이 없다.
- **키워드:**
  - 자동으로 켜지는 경우: `ralph:`, `랄프:`(loop), `cancelomc`·`please stopomc now`(cancel), `ulw`, `tdd`, `deslop`, `code review`, `security review`, `ralplan`, `deep interview`, `autopilot`, `deepsearch`, `ultrathink`, `ultragoal`, `deepinit`
  - `don't use ralph`는 loop-hint(모델 판단)로만 간다
  - 켜지지 않는 경우: `cancel the subscription feature`, `stop the dev server`, `implement a cancel button`, `취소`
  - `the word ultrawork appears in docs`는 parallel로 간다. 이 키워드 동작은 M6 범위이고 M6에서 이미 검증됐으므로 이번에 다시 따지지 않는다.
- **setup 쓰기 범위:** 실행 14와 같다. 허용된 파일 밖에는 쓰지 않았다. `setup team --write`는 저장소 안 `.make-it-ship.json`과 `.gitignore`만 쓰고 guard는 allow다(`mis init --write`와 같은 취급이고 configHash로 증거가 무효화된다).
- **관찰 (M9 범위 밖, M6 loop):** `mis loop start "task" --max 2`처럼 `--max`를 task 뒤에 쓰면 `--max 2`가 task 문자열에 들어가고 max는 20이 된다. 사용법(`start [--max N] <task>`)과 스킬 지시는 `--max`를 앞에 두므로 스킬 흐름에는 영향이 없다.

## dogfood (demo a, quick)

1. 첫 실행: `claude -p "/make-it-ship:run Implement docs/feature-request.md. Use quick mode." … --output-format stream-json --verbose`
   - 3턴 만에 `mis init` 제안을 보여 주고 확인을 기다리며 멈췄다. 기록된 위험 M1 L-1과 같다.
2. 같은 세션을 `--resume`하고 "confirm … without further questions"로 이어 갔다.
   - 진행: `init --write` → `start` → `plan set` → `mode quick` → `task T1 start` → 실패하는 테스트(RED, export 없음) → 구현 → `check unit` PASS → `task done` → quality-reviewer 서브에이전트 → 지적 2건 수정 → `check` 재실행 → 재리뷰 → `review add` → `verdict` VERIFIED → `report`
   - guard ask/deny는 0건이다(`permissionDecision` 0건, `permission_denials: []`).
   - 실제 `~/.claude/settings.json`과 `CLAUDE.md`의 sha1은 실행 전후로 같다.
3. 사후 확인:
   - 내가 직접 `npm test`를 돌린 결과 3 pass, 0 fail이다.
   - `mis status`: REPORTED, Verdict now VERIFIED, `docs/make-it-ship/<run>/report.md`가 있다.
4. 정직성 검사:
   - 테스트 기대값을 `'HELLO-WRONG'`으로 바꿨다(npm test 1 fail).
   - `mis verdict`는 **PARTIAL**로 바뀌었다. 이유는 "required check unit is stale", "quality review missing for current code"다.
   - REPORTED 뒤의 `mis check`는 "run is REPORTED"로 거부됐다.
   - 원래대로 되돌리면 트리 해시가 같아져 다시 VERIFIED가 된다(맞는 동작).

## 결함 목록

### N1 (LOW) 상태줄 소유를 디렉터리 이름으로 판별한다. 그래서 플러그인 경로에 `make-it-ship`이 없으면 uninstall이 상태줄을 남기고 원래 상태줄을 잃는다. 그 결과 `npm test` 1건이 실패한다

- **위치:** `scripts/lib/install.mjs:14`
  ```js
  export const isOurStatusLine = (cmd) => typeof cmd === 'string' && /make-it-ship[^"]*\/scripts\/statusline\.mjs/.test(cmd);
  ```
  - 이 함수를 쓰는 곳: `commands-setup.mjs:303`(uninstall), `:106`(doctor --fix), `:170`(doctor), `install.mjs:90`(setup chain)
  - 도입 커밋: f662ea1 (M9-A)
- **재현** (scratch HOME, 플러그인은 이 워크트리 `/…/mis-v9af`):
  1. `settings.json`에 `"statusLine":{"command":"echo old"}`를 넣는다.
  2. `mis setup --write`를 실행한다. statusLine이 `node "/…/mis-v9af/scripts/statusline.mjs"`로 바뀌고, chain `echo old`가 `~/.make-it-ship/config.json`에 저장된다.
  3. `mis uninstall`을 실행한다. `settings` 목록에 CLAUDE.md만 있고 settings.json은 없다.
  4. `mis uninstall --yes`를 실행한다. `~/.make-it-ship`(chain이 들어 있던 config.json 포함)는 삭제되지만, settings.json의 statusLine은 그대로 플러그인 경로를 가리킨다.
     - 이후 `claude plugin uninstall`이나 디렉터리 삭제로 플러그인 파일이 사라지면 상태줄 명령이 실패한다.
     - 사용자의 원래 상태줄 `echo old`는 자동으로 복구되지 않는다. 남은 것은 setup 때 만든 `settings.json.mis-backup-*`뿐이다.
- **비교:** 같은 코드를 `…/make-it-ship/`로 복사해 돌리면 uninstall이 statusLine을 `echo old`로 되돌린다(실행 15). A6 테스트도 통과한다(실행 3).
- **테스트 영향:** `tests/integration/mis-lifecycle.test.mjs:141` (A6 uninstall)가 이 워크트리에서 3/3 실패한다. 플러그인 경로 이름에 따라 결과가 달라지므로 r2 D7과 같은 종류의 환경 의존이다. `npm test` 0 fail 기준을 이 워크트리에서 깨뜨린다.
- **그 밖의 증상:**
  - 같은 조건에서 `mis doctor`는 자기 상태줄을 `another status line is set … (mis setup chains it after ours)` warn으로 보고한다.
  - 경로가 바뀐 뒤 `mis setup`을 하면 이전 자기 상태줄을 남의 것으로 보고 chain에 넣을 수 있다. 코드를 읽고 추론한 것이고 실행하지는 않았다.
- **영향 범위:** README의 기본 설치 방법(마켓플레이스 캐시 `…/make-it-ship/<ver>`, `~/make-it-ship` clone)은 경로에 이름이 들어 있어 영향이 없다. 영향을 받는 것은 이름이 다른 clone이나 `--plugin-dir`이다. README:109의 "uninstall removes … the status line entry" 약속이 이 경우에 지켜지지 않는다.
- **분류 근거:** guard 결함이 아니어서 VERIFIER_PROMPT의 guard 분류 규칙은 적용하지 않는다. A6 수명주기 동작 결함이다.
  - 데이터 손실은 사용자의 이전 상태줄 설정이다. 백업 파일로 복구할 수 있다.
  - 기본 설치 경로에서는 일어나지 않는다.
  - 그래서 LOW로 판단했다. 다만 필수 테스트가 실패하므로 PASS로 판정할 수 없다.
- **테스트 빈틈:** A6 테스트는 setup 전에 기존 상태줄을 두지 않는다. 그래서 "uninstall이 chain을 되돌린다"는 경로는 테스트되지 않는다. A1 --write는 chain 저장까지만 본다.
- **기대:**
  - 지금의 경로 패턴은 그대로 둔다. `doctor --fix`가 이미 지워진 이전 버전 경로를 알아보는 데 필요하기 때문이다(`commands-setup.mjs:106`).
  - 여기에 "현재 `statusLineCommand()`와 정확히 같음"(또는 `PLUGIN_ROOT` 아래 경로)을 우리 것으로 보는 조건을 추가한다.
  - 테스트는 플러그인 경로 이름과 무관해야 한다. 기존 상태줄을 둔 setup→uninstall 왕복 테스트를 추가한다.

## 남은 위험 (결함 아님, 분류 규칙 (a)(b)(c)에 해당하지 않는 새 형태)

- **R1** guard의 설정 보호에서 r2 D2 수정이 주장한 형태 밖의 쓰기:
  - `wget -P ~/.claude/hooks URL`
  - `curl -O --output-dir ~/.claude/hooks URL`
  - `patch -p1 -d ~/.claude < p`
  - 붙여 쓴 `curl -o$HOME/.claude/settings.json URL`
  
  위 네 가지는 allow다. 띄어 쓴 `curl -o`, `wget -O`, `patch <file>`는 ask이므로 수정 주장 자체는 거짓이 아니다. 같은 성격의 `tar -C`, `unzip -d`, `git clone … ~/.claude/skills/x`도 목록에 없다(추정이고 실행하지 않았다).
- **R2** `rg -z`(압축 해제 프로그램 실행)는 자동 허용된다. 읽기 전용 동작이고 RISKS의 grep -r 수용과 같은 성격이다.
- **R3** uninstall은 `mis setup routing --write`가 저장소 `CLAUDE.md`에 쓴 `## Skill routing` 절을 지우지 않는다. dry-run의 `keep` 목록에도 나오지 않는다.
  - 실행 14 뒤에 `life/repo/CLAUDE.md` 첫 줄이 여전히 `## Skill routing`인 것을 확인했다.
  - 그래서 플러그인을 제거해도 저장소가 모델에게 없는 `/make-it-ship:*` 스킬을 쓰라고 계속 안내한다.
  - 이 파일은 git으로 팀과 공유되는 저장소 파일이다. 한 사람이 uninstall할 때 자동으로 지우는 것도 맞지 않다. README:109도 이 절을 지운다고 약속하지 않는다.
  - 그래서 결함이 아니라 위험으로 둔다. 제안: uninstall 결과의 `keep`이나 `next`에 이 절이 남는다는 것을 한 줄로 알린다.
- **R4** RISKS에 이미 기록된 항목(스크립트 안의 쓰기, `node -e`, 비저장소 cwd 경계 등)은 다시 따지지 않았다.

## NEEDS_HUMAN (변동 없음)

- 다음은 사람이 확인해야 한다: 실제 `mis launch`가 tmux 안에서 claude를 띄우는지, ask 확인 창 UI, 실제 상태줄 표시, 실제 Claude Code에서 PermissionRequest와 SubagentStop이 반영되는지. r1/r2 NEEDS_HUMAN 목록이 그대로 남는다.

## 미검증 (범위)

- Standard 모드 dogfood(승인 단계에서 운영자가 승인)는 돌리지 않았다. 이번 과제 6단계가 quick 모드를 지정했고, 그 지정이 VERIFIER_PROMPT의 일반 지시보다 우선한다.
