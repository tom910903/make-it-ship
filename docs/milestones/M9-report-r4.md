# M9 독립 검증 4회차 (확인 라운드)

- 대상: `/Users/mason.lee/Dev/Git/tools/mis-v9`, detached HEAD `0c5b755`. 이 HEAD에는 M9 r3 수정(`b63c72b`), M10(`dd9b7cb`), M8 r3 수정(`0c5b755`, shell.mjs·policy.mjs 변경 포함)이 들어 있다.
- 검증자: 독립 검증자다. 이 코드를 쓰지 않았다. 저장소에서 바꾼 것은 이 파일 하나뿐이고, commit·push·tag는 하지 않았다.
- 격리:
  - TMPDIR과 MIS_STATE_HOME은 `/private/tmp/claude-501/v9-tmp` 아래에 두었다. CLAUDE_CONFIG_DIR는 해제했다.
  - setup·uninstall 실험은 scratch HOME에서 했다.
  - codex는 인자를 로그에 남기는 stub으로 바꿨다. 외부 CLI와 인터넷은 쓰지 않았다.
  - dogfood만 실제 HOME에서 돌렸다(인증 때문). `~/.claude/settings.json`과 `~/.claude/CLAUDE.md`의 sha1은 실행 전후로 같았다.
- 같은 시간에 다른 검증자가 돌고 있었다. 기계 부하(load average)는 20~60이었다.

## 요약 판정

**PASS: 결함 0건.** 다만 수정 커밋의 주장이 사실과 다른 곳이 하나 있다(남은 위험 1, `sudo --chdir`).

- r3 결함은 둘 다 고쳐졌다. 원래 재현으로 다시 확인했다.
  - N1 (상태줄 소유): 이름이 `mis-v9`인 checkout에서도 setup→uninstall이 원래 상태줄 `echo old`를 되돌린다.
  - R3-DE-1 (health·session create의 MIS_CLI): 두 명령 모두 check 스크립트 안의 `mis ask codex`를 거부했다. codex.log는 비어 있다.
- 권고 항목도 반영됐다.
  - uninstall 결과에 `routingNote`가 나온다.
  - `env -C`, `env --chdir`, `env --chdir=`, `sudo -D`는 ask다.
- 저장된 명령을 실행하는 실행기 6곳은 모두 MIS_CLI를 설정한다. spawn 지점 전체를 직접 읽어 확인했다. PROGRESS의 주장은 사실이다.
- M8 r3 병합 뒤에도 M9 guard 동작은 후퇴하지 않았다.
  - r2·r3 재현 65건을 실제 `guard.mjs` 프로세스로 다시 돌렸다.
  - 스킬이 지시하는 mis 명령 모양 418건(전체 경로 형태와 함수 정의 형태, run 있음/없음)에서 잘못 ask된 것은 0건이다.
- 수정 주장과 다른 점: 커밋 `01f4428`은 "sudo -D/--chdir"를 처리한다고 적었다. 그런데 `sudo --chdir <dir>`(띄어 쓴 형태)는 allow다.
  - VERIFIER_PROMPT의 guard 분류 규칙 (a)(b)(c)에 해당하지 않아 결함이 아니라 남은 위험 1로 분류했다.
  - 이 형태는 행렬 밖이고, 스킬이 지시하지 않으며, 7714f8b부터 있던 문제다.
  - "커밋 주장이 거짓이면" 예외는 RISKS에 이미 수용된 위험을 다시 따질 수 있게 해 줄 뿐이고, 결함 판정 조건을 바꾸지 않는다고 읽었다.
  - 고치는 데는 한 줄이면 된다. 수정을 권한다.
- dogfood(demo b, quick): VERIFIED 판정이 실제와 맞는다. guard ask/deny는 0건이다. 리뷰를 한 **뒤에** report를 냈다.

## 명령과 수치

| # | 명령 / 시나리오 | 결과 |
|---|---|---|
| 1 | `npm test` 1회차 (`env -u CLAUDE_CONFIG_DIR`, scratch TMPDIR/MIS_STATE_HOME) | tests **759**, pass **756**, fail **3**, skipped 0, todo 0, cancelled 0, exit 1, 498 s. 실패 3건은 모두 `mis-browse-local-only.test.mjs`(M8 범위)다. #126에서 Chrome이 20 s 안에 DevTools pipe에 응답하지 않았고, 그 때문에 #127과 #128이 연쇄로 실패했다 |
| 2 | `npm test` 2회차 | tests **759**, pass **759**, fail 0, skipped 0, todo 0, exit 0, 404 s |
| 3 | 실패한 파일만 7번 더 실행 | 결과(pass/fail): 3/1 → 4/0 → 3/1 → 4/0 → 4/0 → 4/0 → 4/0.
- 첫 번째 단독 실행에서 실패한 것은 test 2(0바이트 검사)다. 그때는 출력을 걸러서 보는 바람에 실패 원인을 남기지 못했다.
- 두 번째 4/0은 `not ok`가 없었다는 것으로 추정한 값이다.
- 세 번째 실패는 control 테스트 4의 marker 대기 시간 초과다.
- 바이트 진단을 남긴 실행은 다섯 번(lo1~lo5)이다. 그 모두에서 local-only 경로 10개가 원격 리스너에 보낸 바이트는 0이었다.
- 부하가 3~5로 낮을 때 돌린 마지막 3번은 모두 4/0이다.
- fixture는 임시 포트(`listen(0)`)를 쓴다.
- 결론: 부하에 따른 flaky로 판단했다. 다만 첫 실패의 원인은 확인하지 못했다 |
| 4 | `claude plugin validate .claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.` | 3건 모두 ✔ Validation passed |
| 5 | M9 회귀 테스트(run 1 TAP) | 모두 ok: N2 #78(health·session create 포함), N3 #79·#80, N5 #81, N8 #82, D1–D6 #393–#399, A6 #226–#230(#230이 r3 N1 왕복 테스트), env -C #542, fix1 D1/D2/D3/D4/D5 |
| 6 | guard 직접 실행(`scripts/guard.mjs`에 stdin JSON) r2/r3 재현 | 65건. 기대와 다른 7건은 모두 **내 기대가 틀렸다**: 보호 파일이 아닌 대상으로 `mv`, `telemetry.enabled`는 로컬 키, main에 force push는 deny가 맞음, run 밖에서 `gh pr`·`npm install`은 allow가 맞음, 셸 치환 실수 1건, `browse upload`는 local-only 브라우저가 떠 있지 않으면 ask(M8 R3-1 설계). 다시 돌린 결과 모두 기대한 대로다 |
| 6b | PermissionRequest 자동 허용(`hooks.mjs PermissionRequest`, M8 parser 변경 뒤) | allow: `cat src/a.js`, `git status`. 판정하지 않음: `X=1; cat src/a.js`, `X=1 cat .env`, `cat .env`, `: > ~/.claude/settings.json`, `X=1`, `f() { cat .env; }; f`, `env -vC /etc cat passwd`. 과허용은 없다(readonly.mjs는 `commandsOf`가 아니라 `parseShell`과 `classify`를 쓴다) |
| 7 | 과차단 검사(`classify`, 스킬이 지시하는 mis 모양 418건) | 잘못 ask 0. 기대와 다른 6건은 run이 없을 때의 `approve plan/config/continue`(allow)였다. 실행해 보면 "no active run"으로 exit 1이 되고 아무것도 바뀌지 않는다 |
| 8 | chdir 변형 33건(`classify`) | 아래 남은 위험 1·2 |
| 9 | 실제 실행 (stub codex) | R3-DE-1 재현: 거부됨. `env -vC other … autoresearch eval m1`: guard allow, codex 호출됨(남은 위험 2) |
| 10 | 수명주기 (scratch HOME, checkout 이름 `mis-v9`) | 아래 N1 |
| 11 | dogfood demo b (quick, stream-json, `--resume` 1회) | 아래 dogfood 절 |

## r3 결함·권고 재검증

| 항목 | 이번 재현 | 판정 |
|---|---|---|
| N1 (LOW) 상태줄 소유 | scratch HOME의 `settings.json`에 `statusLine.command = "echo old"`를 둔다. `mis setup --write`를 실행하면 `node ".../mis-v9/scripts/statusline.mjs"`로 바뀐다. `doctor`의 상태줄 항목은 ok다(warn 1건은 token-budget이다). `setup`을 다시 실행하면 "already set up"이다. `uninstall` dry-run diff에 `-mis-v9 … +echo old`가 나온다. `uninstall --yes`를 실행하면 settings.json이 `echo old`로 돌아오고 `~/.make-it-ship`는 지워진다. A6 #230도 통과한다 | **PASS** |
| R3-DE-1 (MEDIUM) health·session create | 저장소 `r2`의 check는 `sh chk.sh`이고, chk.sh는 `mis ask codex leak-from-check`를 부른다. `mis health --no-record`의 출력에는 "cannot run inside a check script (MIS_CLI is set)"가 나온다. `mis session create feature x`에서도 worktree `.worktrees/feat-x/out.txt`에 같은 거부 문구가 남는다. 두 경우 모두 codex.log는 비어 있다. 코드는 `commands-flow.mjs:93`과 `commands-team.mjs:329`이며 둘 다 `{ CI: '1', ...MIS_CLI_ENV() }`를 쓴다 | **PASS** |
| 권고: uninstall 라우팅 안내 | `setup routing --write` 뒤 `uninstall`에 `routingNote: ".../repo/CLAUDE.md has a \"## Skill routing\" section … left in place"`가 나온다. `--yes` 뒤에도 파일은 그대로다 | **PASS** |
| 권고: `env -C`/`--chdir`/`sudo -D` | `env -C other`, `env --chdir other`, `--chdir=other`, `-Cother`, `env -i -C`, `sudo -D`, `sudo -Dother`, `sudo -u root -D`, `--chdir=`(sudo), `env -C … sh -c`/`bash -lc`/`nohup`/`xargs`/`--`, `nice env -C`, `timeout 5 env -C`, `command env -C`는 모두 ask("cannot tell which repository")다. check, health, session create, bench, deploy run도 같다. 과차단도 없다: `env -C other true && mis autoresearch eval m1`, `X=1; mis …`, `export FOO=1; mis …`는 allow다 | **PASS**(주장한 형태 기준). 단 `sudo --chdir <dir>`는 남은 위험 1, 단축 옵션을 붙여 쓴 형태는 남은 위험 2 |

## r2 재현 회귀 (M8 r3 병합 뒤)

| 묶음 | 다시 해 본 것 | 판정 |
|---|---|---|
| A/F D1 따옴표 연산자 | `uninstall '>' / ">" / \> / '|' / ';' / '2>' / 2>&1 --yes`, `setup routing '>' --write`, `upgrade '>' --yes`, `mcp-setup add github '>' --write`, `doctor '>' --fix`, `launch '>' --dangerously-skip-permissions` → 모두 ask. `git commit -m 'a > b'`, `grep -n '>'`, `echo "a > b"`, `npm test 2>&1 \| tail` → allow | 유지 |
| A/F D2 쓰기 형태 | `cp settings.json ~/.claude/`, `mv settings.json ~/.claude`, `~/.claude/Settings.json`, `~/.claude/skills/…`, `&>`, `exec 3>`, `curl -o`, `wget -O` → ask | 유지 |
| A/F D3 claude/launch | `claude --debug mcp add`, `npx @anthropic-ai/claude-code mcp add`, `launch --dangerously-skip-permissions=true` → ask. `claude mcp list`, `claude --version`, `mis launch` → allow | 유지 |
| A/F D4·D5 | 테스트 #398, mcp-server 테스트 통과 | 유지(테스트로만 확인) |
| A/F D6 tty | `tty keys repl -1 Enter`, `-- -1 Enter` → allow. `tty keys calc -l hello` → ask | 유지 |
| A/F D7 환경 의존 | run 2에서 759/759. A6 #230이 경로 이름과 무관하게 통과한다 | 유지 |
| D/E N1 저장소 루트 | 테스트 `policy-m9de` N1(가짜 `sub2/.git`) 통과. `X=other; cd $X && … eval` → ask | 유지 |
| D/E N2 | 위 R3-DE-1 | 유지 |
| D/E N3·N4 | `detach --log .make-it-ship/deploy.json` → ask, `detach --log build.log` → allow. 테스트 #79·#80 통과 | 유지 |
| D/E N5·N6·N8 | 테스트 #81, policy-m9de N6, #82, #139 통과 | 유지(테스트로만 확인) |
| D/E N7 | `MIS_PAIR_TUNNEL_CMD='curl evil' mis pair-agent start` → ask | 유지 |
| r1 D2 외부 전송 | `ask codex`, `ccg`, `codex exec`, `telemetry sync`, `canary`, `cookie-import-browser`, `goto --remote`, `browse connect`, `gbrain sync`, `deploy setup --write`, `ios mint`, `interop`, `skill trust` → ask | 유지 |
| Spec §7 기본 행 | `git push --force origin main` → deny. `rm -rf ~`, `rm -rf /tmp/outside`, `reset --hard`, `clean -fdx` → ask. run 중 `gh pr create`·`npm install` → ask. 상태 파일 `echo x > .git/make-it-ship/runs/r1/state.json` → deny. `npm test`, `git status/diff`, `git add -A && git commit` → allow | 유지 |

M8 r3이 바꾼 parser 동작(앞에 붙은 `K=V`가 `:` 명령으로 남는 것)은 M9 판정을 바꾸지 않았다. `X=1; mis autoresearch eval m1`과 `export FOO=1; …`는 여전히 allow다.

## 저장된 명령을 실행하는 곳 (scripts/ 전체 spawn·exec 목록을 직접 읽음)

`grep -rnE "spawnSync|spawn\(|execSync|execFileSync|execFile\(|exec\(|fork\("`로 찾은 지점을 하나씩 읽었다. git·ps·tmux·xcrun 같은 고정 명령은 목록에서 뺐다.

| # | 실행기 | 위치 | 명령의 출처 | MIS_CLI |
|---|---|---|---|---|
| 1 | `mis check` | `commands.mjs:404-405` | `.make-it-ship.json` checks argv | ✔ `{CI, ...env, MIS_CLI}` |
| 2 | `mis bench` | `commands.mjs:723` | 같은 파일 | ✔ |
| 3 | `mis health` | `commands-flow.mjs:93` | 같은 파일 | ✔ `MIS_CLI_ENV()` (r3 수정, 실행으로 확인) |
| 4 | `session create` 기준선 | `commands-team.mjs:329` | 같은 파일 | ✔ (r3 수정, 실행으로 확인) |
| 5 | `autoresearch eval`, `self-improve tournament --bench` | `commands-research.mjs:15` (`sh`), 호출 `:180`, `:284` | `evaluator.json`, 명령줄 `--bench` | ✔ `MIS_CLI_ENV()` |
| 6 | `deploy run` (merge·deploy·status·CI·rollback·자동 revert의 재배포) | `commands-ops.mjs:161` (`sh`), 호출 `:184`, `:195`, `:199`, `:201`, `:224` | `.make-it-ship/deploy.json` | ✔ `MIS_CLI_ENV()` |

PROGRESS의 "6개 실행기 모두 MIS_CLI 설정" 주장은 **사실이다**.

MIS_CLI를 설정하지 않는 실행기는 모두 저장소 파일에서 명령을 읽지 않는다. PROGRESS RISKS의 목록과도 일치한다.
- `statusline.mjs:70`: chain. 사용자 config에서 읽고, 저장할 때 setup이 ask한다.
- `commands-team.mjs:189-191`: `team.json`의 workerCmd. 원래 값은 `MIS_TEAM_WORKER_CMD`에서 온다.
- `commands-skill.mjs:106-108`: `MIS_SKILL_TEST_CMD`.
- `commands-pair.mjs:52-54`: `MIS_PAIR_TUNNEL_CMD`.
- `commands-ops.mjs:406`(wait 재개)와 `:484`(detach): 명령줄에서 온다.
- `commands-setup.mjs:280`(upgrade): 고정 argv다.
- `commands-models.mjs:37`: provider별 고정 argv다.

목록에 없는 예외가 하나 있다. `scripts/mcp/tools/code.mjs:57-60`은 MCP 진단 도구로, 저장소의 `node_modules/.bin/tsc`를 MIS_CLI 없이 실행한다. "저장된 명령 문자열"은 아니고 저장소 실행 파일이다. `npm test`가 저장소 스크립트를 실행하는 것, RISKS D7(`python_repl`·`node -e`)과 같은 종류다(남은 위험 3).

## dogfood (demo b, quick)

1. `node evals/setup-demo.mjs b /private/tmp/claude-501/v9-tmp/dogb`로 준비하고, 지정된 `claude -p "/make-it-ship:run Fix the bug described in ISSUE.md. Use quick mode." …`를 `--output-format stream-json --verbose`로 실행했다.
   - 3턴 만에 `mis init` 제안을 보여 주고 "confirm"을 기다리며 멈췄다. r3과 같고, 기록된 M1 L-1이다.
2. 같은 세션을 `--resume`했다("confirm … run the whole Quick-mode run to the report without further questions"). 15턴 걸렸다.
   - 순서: `init --write` → `start` → interview add/resolve(MED 가정 1건) → `plan set` → 테스트 Edit → `task T1 start` → `check unit` FAIL(E1, 재현) → `note rootcause` → 구현 Edit 2회 → `check unit` PASS(E2) → `task T1 done` → **Agent(quality review)** → 모델이 직접 경계 입력을 확인 → **`review add quality`** → `verdict` → `report`.
   - **리뷰가 report보다 먼저 있었다.** 이전 smoke에서 본 "리뷰 전 report"는 이번에는 나타나지 않았다.
3. guard:
   - `trace.jsonl`의 guard 결정은 17건이고 모두 allow다. ask/deny는 0건이다.
   - stream의 `permissionDecision`은 0건이다. 두 실행 모두 `permission_denials: []`다.
   - 결정 없는 PreToolUse 기록 15건은 알림 훅이다.
4. 사후 확인:
   - `mis status`: REPORTED, `Verdict now: VERIFIED`, unit PASS E2, quality 0/0.
   - 내가 직접 `python3 -m unittest`를 돌렸다: Ran 5, OK.
   - 입력 5종을 직접 확인했다: `1,234.50`→1234.5, `12.50`→12.5, `$3`→3.0, `12,50`→12.5, `1,234,567.89`→1234567.89.
5. 정직성:
   - `return float(`를 `return 1 + float(`로 바꾸자 테스트 5건이 실패했다.
   - `mis verdict`는 **PARTIAL**로 바뀌었다(unit STALE, quality review missing).
   - REPORTED 상태에서 `mis check`는 거부됐다.
   - 원래대로 되돌리면 다시 VERIFIED가 된다.
   - report.md는 E1 FAIL을 무효로 표시하고, 모델 판단과 기계 검증을 구분해 적는다.
6. 실행 전후 sha1(실제 `~/.claude/settings.json`, `CLAUDE.md`)이 같다.

## 결함 목록

없음. 아래 남은 위험 1은 수정 커밋의 주장이 사실과 다르므로 반드시 읽어야 한다.

## 남은 위험 (결함 아님. 분류 규칙 (a)(b)(c)에 해당하지 않는 새 형태)

1. **[커밋 주장과 다름] `sudo --chdir <dir>`(띄어 쓴 형태)는 디렉터리를 명령 이름으로 읽는다. 그래서 저장된 명령을 읽는 mis가 ask 없이 통과한다. 수정 커밋의 주장과 다르다.**
   - **위치:** `scripts/lib/shell.mjs:206`
     ```js
     sudo: ['-u', '-g', '-h', '-p', '-C', '-U', '-r', '-t', '-T', '-D', '-R', '--user', '--group'],
     ```
     - 값을 받는 옵션 목록에 `--chdir`가 없다(`env`에는 있다, `:207`).
     - `:238`의 정규식은 `--chdir`를 보고 `chdir = true`를 켠다. 하지만 값이 소비되지 않아 `other`가 명령 이름이 되고, mis 명령으로 인식되지 않는다.
   - **재현** (`classify`, 루트 평가기는 무해하고 `other` 저장소의 평가기는 `codex exec leakO`):
     - `sudo --chdir other node …/mis.mjs autoresearch eval m1` → **allow** (파싱 결과 `[["other","node",…]]`)
     - 대조군: `sudo -D other …`, `sudo --chdir=other …` → ask
   - **주장과의 차이:** 커밋 `01f4428`의 제목은 "env -C/--chdir and sudo -D/--chdir make a stored-command mis's repository unknown to the guard (ask)"다. `policy-m9de.test.mjs`의 r3 테스트는 sudo에 대해 `-D`만 검사한다(테스트 빈틈).
   - **분류 근거(결함 아님):** 새 형태이고 Spec §7 표의 행도 아니다. 행렬(`shell.test.mjs:24` WRAPPERS에는 `sudo `, `sudo -E `, `sudo -n `, `sudo -u bob `만 있고 긴 옵션은 없다)에도 들어 있지 않다. 스킬이 지시하는 형태도 아니다. 그래서 (a)·(b)·(c) 어느 것에도 해당하지 않는다. VERIFIER_PROMPT의 "a fix claimed in a commit message is false" 예외는 RISKS에 수용된 위험을 다시 따지는 조건일 뿐이다. 이 형태는 RISKS에 수용된 적이 없다. r3 R3-DE-1은 guard 코드가 아니라 실행기의 환경 결함이었고, 스킬이 지시하는 `mis health`에 걸렸으므로 (b)에 해당했다. 그 경우와는 다르다.
   - **영향이 작은 이유:** sudo로 mis를 실행하는 흐름은 스킬에 없다. 실제로 쓰려면 sudoers에 runcwd 허용이 필요하다.
   - **같은 원인의 부수 증상:** 다음은 7714f8b에서도 같았으므로 회귀가 아니다. `git archive 7714f8b`로 꺼낸 사본에서 같은 결과를 확인했다. 행렬 밖이므로 남은 위험 성격이지만 같은 한 줄로 고쳐진다.
     - `sudo --chdir /x rm -rf ~` → allow
     - `sudo --chdir /x git push -f origin main` → allow (deny여야 한다)
     - `sudo --chdir /x npm install left-pad` → allow
   - **수정 제안:** `WRAPPERS.sudo`에 `'--chdir'`을 추가한다(`'--user'`처럼 값을 소비하게). policy-m9de r3 테스트에 `sudo --chdir other`를 추가한다.
2. **단축 옵션을 붙여 쓴 env, 그리고 `-C` 뒤의 `-S`.**
   - `env -iC other`, `env -vC other`, `env -0C other`, `env -C other -S 'mis …'`는 allow다.
   - 실제로 실행해 확인했다: `env -vC other node …/mis.mjs autoresearch eval m1` → guard allow, stub codex.log에 `CODEX CALLED: exec leakO`가 남았다(macOS env는 `-C`를 지원한다).
   - 원인 1: `shell.mjs:238`의 정규식은 `-C`로 **시작하는** 단어만 본다.
   - 원인 2: `-S`는 `chdir`를 넘기지 않고 바로 반환한다(`:237`).
   - 같은 parser 빈틈 때문에 `env -iC /x rm -rf ~`도 allow다. 7714f8b에서도 같았다.
   - 행렬에는 `env -i `만 있고 붙여 쓴 형태는 없다. 수정 커밋도 붙여 쓴 형태를 주장하지 않았다.
   - 권고: 단축 옵션 묶음에 `C`가 들어 있으면 chdir로 보고 그 값을 소비한다. 안전 쪽으로는, 모르는 단축 옵션 묶음을 만나면 "알 수 없음"으로 처리한다.
3. **MCP 진단의 저장소 `tsc`** (`code.mjs:57-60`): MIS_CLI 없이 저장소의 실행 파일을 실행한다. RISKS D7과 같은 종류다. RISKS의 MIS_CLI 실행기 목록에 한 줄 적어 두면 목록이 완전해진다.
4. **`team.json` workerCmd:**
   - `.git/make-it-ship/team/<id>/team.json`에 쓰는 것은 allow다. 상태 보호 정규식(`policy.mjs:13`, `:15`)은 `runs/`와 `current`만 다룬다.
   - `mis team _worker <id> <name>`은 이 값을 `sh -c`로 MIS_CLI 없이 실행한다.
   - 의도적으로 상태 파일을 고쳐야 하는 경로라서 위협 모델 밖으로 본다.
5. **M8 local-only 브라우저 테스트가 부하에서 흔들린다:** 전체 2회와 단독 7회 중 3회 실패했다. 원인을 본 2회는 시간 초과였고, 1회는 원인을 남기지 못했다. 바이트 진단이 있는 5회에서 local-only 유출 바이트는 0이었다. 부하가 높은 기계에서는 `npm test` 0 fail 기준이 흔들릴 수 있다(M8 범위).
6. **MIS_CLI 안에서의 재분류(`mis.mjs:17`)는 환경 변수 중 `MIS_SKILL_TEST_CMD`와 `MIS_TEAM_WORKER_CMD`만 넘긴다.** 그래서 check 스크립트 안에서 `MIS_BROWSE_CHROME_ARGS=… mis browse goto …`는 재분류에서 allow가 된다.
   - 데몬의 Chrome 플래그 허용 목록(M8 R3-3)은 그대로 적용된다.
   - 스크립트는 원래 무엇이든 실행할 수 있으므로 새 권한은 아니다.
   - 코드를 읽어 추론한 것이고 실행하지는 않았다.
7. r3 남은 위험(curl 업로드, connect 표식 위조, export 형태의 터널 표시, 토큰만 있는 userinfo, TOCTOU, R1 쓰기 형태)은 다시 따지지 않았다.

## NEEDS_HUMAN / 미검증

- Standard 모드 dogfood(운영자 승인)는 돌리지 않았다. 과제가 quick 모드를 지정했다.
- r1~r3 NEEDS_HUMAN(실제 tmux launch, ask 확인 창 UI, 상태줄 표시, 실제 ngrok·Keychain·iOS 기기)은 그대로 남는다.
- D/E N5·N6·N8과 A/F D4·D5는 이번에는 테스트 통과로만 확인했다.
