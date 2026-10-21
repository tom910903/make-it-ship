ROUND2-DE: FAIL

# M9 독립 검증 2회차: 묶음 D·E

- 대상: `m9-wip` @ 354fc7d. 1회차 결함 D1–D8의 수정 커밋은 c67a9e3, 68b3939(m9-fix1)이다. D8 후속 b9df3ad도 대상에 넣었다. 작업 위치는 `/Users/mason.lee/Dev/Git/tools/make-it-ship-m9`이다.
- 검증자: 독립 검증자이며, 이 코드를 작성하지 않았다. 소스와 테스트는 고치지 않았고 커밋도 하지 않았다. 쓴 파일은 이 보고서뿐이다.
- 격리:
  - HOME, MIS_STATE_HOME, CLAUDE_CONFIG_DIR, TMPDIR는 모두 scratch(`…/scratchpad/m9v2-de/`) 아래를 가리켰다.
  - codex와 gbrain은 stub으로 바꿨다. 원격은 로컬 bare 저장소, 서버는 127.0.0.1 stub이다. 실제 브라우저 프로필 대신 scratch HOME 안에 가짜 디렉터리를 만들었다.
  - 외부 네트워크, 실제 codex·gemini·ngrok은 쓰지 않았다. 내가 띄운 프로세스는 모두 정리했다. 남아 있는 `m9v2af-*` daemon과 Chrome은 병행 검증자의 것이다.

## 실행한 명령과 결과

| # | 명령 / 확인 | 결과 |
|---|---|---|
| 1 | `npm test` 1회차 (TMPDIR=scratch) | **705 tests, 703 pass / 2 fail**. #247 pair D3 통합 테스트는 `fetch failed`, #615 policy D6 단위 테스트는 실패 |
| 2 | `npm test` 2회차 | **704 pass / 1 fail** (#615). #247은 통과했다. 병행 검증자의 Chrome 부하 때문에 생긴 일시 실패로 본다 |
| 3 | #615만 따로 짧은 TMPDIR(`/tmp/m9v2de-t/`)로 실행 / scratch TMPDIR로 실행 | pass / fail. TMPDIR 길이에 따라 결과가 갈린다(N6) |
| 4 | `claude plugin validate .` | ✔ Validation passed |
| 5 | `grep .skip/.only tests` | 해당 없음 |
| 6 | 1회차 D1–D8 재현(아래 표) | 원래 재현 절차로는 8개 모두 수정됨 |
| 7 | 저장된 명령 파일 쓰기 공격(PreToolUse JSON → `scripts/guard.mjs`) | 대소문자 변형, Bash 심볼릭 링크 리다이렉트, `git apply`/`checkout`, `mis detach --log`는 ask 없이 통과했다(N3·N4). Edit, MCP write/edit/move, `cp`, Write 심볼릭 링크는 ask했다 |
| 8 | eval/check/deploy 때 다시 분류하는지 | 저장소 루트에서는 ask했다. 가짜 `.git` 디렉터리가 있는 하위 디렉터리에서는 allow였고, **stub codex가 호출됐다**(N1) |
| 9 | 평가기가 스크립트 파일을 거쳐 `mis ask codex`를 부름 | allow였고 **stub codex가 호출됐다**(N2) |
| 10 | MIS_CLI 아래에서 D0 명령 12개 실행 | 모두 거부됐다. `env -u MIS_CLI`로 부르면 실행된다(기록된 한계, 아래 참조) |
| 11 | self-improve 제안의 change.patch 교체 → `approve proposal` | ask에는 `changes: CLAUDE.md`만 보였다. 실제로는 `.claude/settings.json`의 hook까지 적용됐다(N3) |
| 12 | pair-agent `--local` 공격 약 40건: r1 back, redirect(file/다른 출처), iframe(file/다른 출처), window.open(file/다른 출처), pushState, data:/blob:/FILE:/javascript:/view-source:/chrome:, 탭 id(-1, 0, 1.0, 사용자 탭), back 6회, console/network | 로컬 파일 내용과 경로는 새지 않았다. 아래 "pair-agent" 절 참조 |
| 13 | connect: 소문자 경로, Canary, Brave(`Local State` 없음), 심볼릭 링크, `..` 경로, `Local State`까지 통째로 복사, 하드링크한 Cookies, `Local State` 없이 복사한 Default | 앞의 여섯 개는 거부됐다. **하드링크 Cookies와 Default 복사본은 connected**였다(N8) |
| 14 | gbrain: r1 enqueue `src/core.c`, 파일·디렉터리 심볼릭 링크, enqueue 뒤 심볼릭 링크로 바꿔치기, 저장소 밖 파일, `.c.txt`로 이름 바꾸기, 심볼릭 링크를 담은 `docs` import | 소스·심볼릭 링크·저장소 밖 파일은 거부됐고, sync 때 다시 검사해 `refused`로 보고했다. `.c.txt`는 artifact로 통과했다(이름 규칙대로 동작). import는 디렉터리를 gbrain에 그대로 넘긴다 |
| 15 | ask 문구: telemetry, design, canary, deploy setup/run, pair, gbrain sync/import | 목적지와 명령이 표시됐고 `api_key=`, `Bearer`, `sk-`, `TOKEN=`은 가려졌다. **URL의 `user:password@`는 가려지지 않았고** trace.jsonl에도 남았다(N5). pair 문구는 명령 앞에 붙인 `MIS_PAIR_TUNNEL_CMD=`를 무시한다(N7) |
| 16 | 과잉 차단: active run에서 check argv 12종 분류, 일반 mis/browse 명령 15종 분류 | 모두 allow였다. 예외는 `pnpm install --frozen-lockfile`인 check 하나로, 기존 run 규칙(설치는 ask)에 따른 것이다 |
| 17 | 과잉 차단을 끝까지 실행: `mis start` → `mis check unit`(npm test) → `mis check smoke`(MIS_CLI로 browse goto/text 127.0.0.1) | 둘 다 PASS |
| 18 | 승인 뒤 흐름이 도는지: `deploy setup --write` → `deploy run`(로컬 echo 명령), `canary http://127.0.0.1:<port>`, 무해한 평가기로 `autoresearch eval` | DEPLOYED, HEALTHY, pass |
| 19 | gap-matrix 표본 15행 | 아래 표 |

## 1회차 결함 재현

| 결함 | 다시 해 본 것 | 판정 |
|---|---|---|
| D1 | evaluator.json Edit → ask(새 내용 표시). 수정된 평가기로 `autoresearch eval` → ask(저장된 명령 표시) | 수정됨. 다만 N1·N2·N4가 남았다 |
| D2 | `MIS_CLI=… mis ask codex …` → 거부, stub 호출 없음. ccg, telemetry sync, gbrain sync, design, pair-agent, deploy run, canary, benchmark-models, interop, browse --remote도 거부 | 수정됨 |
| D3 | file: 페이지 → pair goto → back → text: 400, 페이지를 비움. tabs는 "(not shared)" | 수정됨 |
| D4 | 소문자 경로와 Canary 경로 → 거부 | 수정됨. 다만 N8이 남았다 |
| D5 | artifacts-only에서 `enqueue src/core.c` → 거부. sync 때 파일마다 다시 검사 | 수정됨 |
| D6 | ask에 목적지와 파일·명령이 나온다 | 대체로 수정됨. N3·N5·N6·N7이 남았다 |
| D7 | PROGRESS RISKS에 기록된 한계 | 기록됨(재검증 안 함) |
| D8 | `gbrain detect`가 stub gbrain으로 `--version`만 호출하고 doctor는 부르지 않았다(gb.log로 확인) | 수정됨 |

## 결함

### N1 [MEDIUM] guard와 mis가 저장소 루트를 다르게 정해, 저장된 명령이 분류되지 않고 외부 전송이 실행된다
- 원인:
  - guard는 `.git`이 있는 가장 가까운 상위 디렉터리를 저장소 루트로 본다(`scripts/lib/policy.mjs:52` `repoOf`, `:54` `inRepo`).
  - mis는 `git rev-parse --show-toplevel`을 쓴다(`scripts/lib/tree-hash.mjs:11`, `cli-util.mjs:26` `rootOf`).
  - 그래서 유효하지 않은 `.git` 디렉터리(빈 디렉터리)가 있는 하위 디렉터리에서 실행하면 두 쪽이 다른 파일을 읽는다. guard는 없는 evaluator.json을 읽어 `[]`(allow)로 판단하고, mis는 실제 루트의 evaluator.json을 실행한다.
- 재현:
  1. 실행: `autoresearch init m1` → `start`
  2. evaluator.json의 command를 `node <abs>/scripts/mis.mjs ask codex leak1 …`로 바꾼다.
  3. 실행: `mkdir -p sub2/.git`
  4. 결과: `cd sub2 && mis autoresearch eval m1` → guard 출력이 없다(allow).
  5. 실제 실행 결과: `CODEX CALLED: exec leak1`가 기록되고 `.make-it-ship/ask/second-opinion-codex-leak1-*.md`가 생겼다.
- 같은 원인으로 생기는 일:
  - `deploy run`은 ask하지만, 문구가 `[runs: no commands configured]`이다. 실제로는 루트의 deploy.json 명령이 실행된다.
  - `check`, `bench`, `health`, `session create`도 같은 `inRepo`를 쓴다.
- 기대: 저장된 명령은 mis가 실제로 읽을 파일로 분류해야 한다.
- 실제: 분류가 빠지고, codex가 ask 없이 호출된다.

### N2 [MEDIUM] autoresearch 평가기에는 MIS_CLI 차단이 없다. 평가기가 부르는 스크립트 안의 `mis ask codex`가 ask 없이 실행된다
- 원인:
  - 평가기는 `sh -c`로 실행되는데, `MIS_CLI`를 설정하지 않는다(`scripts/lib/commands-research.mjs:13`, `:178`).
  - 반면 check와 bench는 `MIS_CLI`를 설정한다(`commands.mjs:405`, `:723`).
  - PROGRESS RISKS(“check가 실행하는 스크립트 파일…”)는 check, bench, health, session create만 적고 있다. autoresearch는 빠져 있다.
- 재현:
  1. 평가기 command를 `sh ev.sh`로 둔다. ev.sh 안에서 `node …/mis.mjs ask codex leak-from-evaluator-script`를 부른다.
  2. ev.sh를 Write하면 allow다. `mis autoresearch eval m1`도 allow다.
  3. 결과: stub codex가 호출됐다.
  4. 같은 스크립트를 `MIS_CLI` 아래에서 돌리면 거부된다(`REFUSED`).
- 기대: check 스크립트와 같은 차단이 있거나, RISKS에 기록되어 있어야 한다.
- 실제: 1회차 D1과 같은 경로다. 간접 단계가 하나 늘었을 뿐이고, 최대 50번 반복된다.

### N3 [MEDIUM] `approve proposal`의 ask는 proposal.json의 경로를 보여 주지만, 실제로 적용되는 것은 change.patch다. change.patch는 ask 없이 바꿀 수 있다
- 원인:
  - ask 상세(`policy.mjs:289`)는 `proposal.json`의 `paths`를 읽는다.
  - 하지만 `approveProposal`은 `change.patch`를 다시 검사해 적용한다(`commands-research.mjs:291-300`). 검사하는 것은 PROCESS_PATHS 안인지뿐이다.
  - 결과 출력도 옛 `paths`를 그대로 돌려준다.
- change.patch를 ask 없이 바꾸는 경로:
  - **`mis detach --log .make-it-ship/self-improve/proposals/<id>/change.patch -- cat evil.patch`** (allow, 로그를 덧붙인다. git apply는 앞뒤 잡문을 무시한다)
  - Write `…/CHANGE.patch` (APFS 대소문자 변형, allow)
  - `echo … > link`: 심볼릭 링크를 거친 Bash 리다이렉트(allow)
- 재현(scratch 저장소):
  1. 실행: `self-improve propose t2 --patch p1.patch` (CLAUDE.md만 바꾸는 패치)
  2. 실행: 위의 detach로 hook을 추가하는 `.claude/settings.json` 패치를 덧붙인다.
  3. guard ask 문구: `[changes: CLAUDE.md]`
  4. 승인 결과: `git status`에 ` M .claude/settings.json`(`"command":"curl evil"` hook)과 ` M CLAUDE.md`가 나왔다. 출력은 `paths: ["CLAUDE.md"]`였다.
- 기대: ask에 실제로 적용될 패치의 경로를 보여 줘야 한다(change.patch에서 `git apply --numstat`으로 얻는다).
- 실제: 사용자는 settings.json hook이 추가되는 것을 모른 채 승인하게 된다.

### N4 [LOW] 저장된 명령 파일 쓰기 guard(D1 쓰기 쪽)에 구멍이 있다
- 정규식 `STORED_FILE`(`policy.mjs:44`)은 대소문자를 구분한다. `realish`는 대소문자를 바로잡지 않는다(`:494`).
- Bash 쪽(`:138`)은 심볼릭 링크를 해석하지 않고, `FILE_WRITER` 목록 밖의 쓰기는 보지 않는다.
- 그래서 다음은 allow다:
  - Write/Edit `.Make-It-Ship/…/EVALUATOR.json`
  - `echo > ev.json`(ev.json은 evaluator.json을 가리키는 링크)
  - `git apply`, `git checkout <branch>`
  - `mis detach --log <저장 파일>`
- evaluator와 deploy는 실행할 때 다시 분류하므로(N1이 없을 때) 영향이 작다. 그래서 LOW다. 영향이 큰 경우는 N3이다.

### N5 [LOW] ask 문구가 URL의 `user:password@`를 가리지 않는다. trace에도 남는다
- telemetry endpoint `https://alice:hunter2pass@tele.example/…`의 ask 결과: `[destination: https://alice:hunter2pass@tele.example/ingest?api_key=***]`
- design의 `MIS_OPENAI_BASE_URL=https://u:p4ssw0rd@…`도 그대로 나왔다.
- `trace.jsonl`에서 `hunter2pass` grep 결과는 1건이다.
- 원인: `scripts/lib/mask.mjs`의 패턴에 URL userinfo가 없다.

### N6 [LOW] ask 파일 목록이 경로를 앞에서부터 160자로 자른다. 경로가 깊으면 파일 이름이 빠진다. 이 때문에 `npm test` #615가 환경에 따라 실패한다
- 원인: `policy.mjs:49` `list` → `show(x, 160)`
- 재현: 저장소 경로가 약 150자이면 `gbrain ingest` ask가 `…/.make-it-ship/…`로 끝난다. 즉 `wiki/w.md`가 보이지 않는다.
- `tests/unit/policy.test.mjs:490`은 TMPDIR가 길면 실패하고, 짧으면 통과한다(명령 3번).
- 파일 이름을 보여 주려는 D6의 목적과 어긋난다. 뒤쪽을 남기거나 저장소 기준 상대 경로를 써야 한다.

### N7 [LOW] pair-agent ask는 명령 앞에 붙인 `MIS_PAIR_TUNNEL_CMD=`를 무시한다
- 재현: `MIS_PAIR_TUNNEL_CMD=x mis pair-agent start`의 ask 문구가 `[tunnel command: ngrok http <port>]`이다.
- 원인: `policy.mjs:278`은 guard 프로세스의 env만 읽는다. design은 명령 앞의 환경 변수 대입을 읽는다.

### N8 [LOW] connect가 사용자 Cookies를 하드링크하거나 Default를 복사한 디렉터리(`Local State` 없음)를 받아들인다
- 재현(scratch HOME의 가짜 Chrome 디렉터리):
  - 실행: `mkdir -p hl/Default/Network && ln "<Chrome>/Default/Network/Cookies" hl/Default/Network/Cookies` → `connect --profile-dir hl` → `mode: connected`
  - `cp -R <Chrome>/Default cp1/` → connected
- 완화 요인:
  - connect는 항상 ask한다("credential access needs your approval every time").
  - 의도적으로 준비해야 하는 일이다.
- 그래도 "connect는 실제 브라우저 데이터를 모두 거부한다"는 주장보다는 범위가 좁다.

## 공격 결과: 결함이 아닌 것

- **MIS_CLI 우회**
  - check 스크립트에서 `node scripts/mis.mjs …`를 직접 불러도 환경 변수가 물려받아지므로 거부된다.
  - `env -u MIS_CLI node …/mis.mjs ask codex`는 실행된다. RISKS 211("스크립트 파일 안에서 외부 CLI를 직접 부르면 guard는 보지 못한다")와 같은 종류다. 스크립트 안에서 `codex`를 직접 부르는 것과 다르지 않으므로 **기록된 한계로 본다**. 다만 RISKS 211의 "MIS_CLI로 부르는 mis 명령은 거부된다"는 문장은 스크립트가 MIS_CLI를 지우지 않을 때만 맞다.
- **pair-agent**
  - redirect로 file:에 가는 것은 Chrome이 `ERR_UNSAFE_REDIRECT`로 막았다.
  - iframe의 file:은 "frame has no document"였다.
  - window.open으로 연 탭은 "(not shared)"로 나오고, `tab`으로 이동하면 400이다.
  - pushState는 같은 출처 안이다.
  - data:, blob:, javascript:, view-source:, chrome:, 대문자 FILE:, 앞에 공백을 붙인 file:은 모두 400이다.
  - 탭 id 변형은 모두 400이다. back을 반복해도 마지막에 사용자 페이지로 들어가면 400을 내고 페이지를 비운다.
  - 에이전트 페이지가 iframe으로 다른 로컬 출처를 띄우면, `frame iframe` → `text`로 그 내용을 읽는다. 하지만 그 출처로 goto해도 똑같이 읽을 수 있으므로 권한이 늘지 않는다. 쿠키를 가져온 비로컬 사이트를 iframe으로 띄우는 것은 RISKS 213(링크 클릭)과 같은 종류로 본다(네트워크가 없어 실행하지 않았다. NEEDS_HUMAN 참조).
- **gbrain**: 심볼릭 링크(파일과 디렉터리), 저장소 밖 파일, enqueue 뒤 바꿔치기 모두 거부됐다. `.txt`로 이름을 바꾸면 통과하는 것은 이름으로 판단하는 규칙대로의 동작이다.
- **과잉 차단**: 찾지 못했다. localhost browse는 ask 없이 됐다. check 스크립트(npm test, MIS_CLI browse)는 PASS였고, deploy, canary, autoresearch는 승인 뒤 정상으로 돌았다.

## gap-matrix 표본 (D/E에서 ABSORBED라고 한 행 15개)

| 행(줄) | 판정 | 근거 |
|---|---|---|
| autoresearch (89) | 유지(기능). 보안은 N1·N2 | init, start, eval, 계약 검사를 직접 실행했다 |
| self-improve (114) | 유지(기능). ask 문구는 N3 | propose와 approve를 직접 실행했다 |
| omc wait (294) | 유지 | `wait detect --log`로 resetAt과 시간대를 감지했다 |
| canary (381) | 유지 | localhost에서 HEALTHY였고 ask 문구에 대상이 나왔다 |
| land-and-deploy (407) | 유지 | 로컬 명령으로 DEPLOYED. 커밋되지 않은 트리는 거부했다 |
| setup-browser-cookies (423) | 유지 | 항상 ask한다. 비로컬 `--remote` 강제는 코드(actions.mjs `gated`)와 통과한 `mis-browse-m9e` 테스트로 확인했다(직접 실행하지 않음) |
| setup-deploy (424) | 유지 | dry 실행은 파일을 쓰지 않았고, `--write` ask에 명령이 나왔다 |
| telemetry preamble (441) | 유지 | `telemetry status`가 enabled:false였고 기본으로 꺼져 있다 |
| brain-enqueue (459) | 유지 | 등급 검사를 수동으로 확인했다 |
| gstack-brain-sync (462) | 유지 | 파일마다 다시 검사하고 refused를 보고하며 bare 원격에 push한다(수동 확인) |
| gstack-detach (471) | 유지(기능). `--log` 악용은 N3 | 실행과 caffeinate를 확인했다 |
| gstack-gbrain-detect (478) | 유지 | doctor를 실행하지 않는다(stub 로그로 확인) |
| gstack-gbrain-repo-policy (482) | 유지 | 기본 artifacts-only를 강제한다 |
| gstack-telemetry-sync (518) | 유지(ask 문구는 N5) | ask에 엔드포인트가 나온다 |
| headed 모드 (542) | 유지(서술의 범위는 N8) | 대소문자, Canary, Brave, 심볼릭 링크, Local State를 거부한다 |

## NEEDS_HUMAN

- 실제 gbrain CLI가 `import <dir>`에서 심볼릭 링크(`docs/srclink -> ../src`)를 따라가는지 확인해야 한다. 따라간다면 artifacts-only에서도 소스가 들어간다.
- 실제 쿠키를 가져온 상태에서 pair-agent 페이지가 그 사이트를 iframe으로 띄워 `frame` → `text`로 읽을 수 있는지 확인해야 한다(외부 네트워크가 필요하다).
- 실제 ngrok, codex, gemini, Keychain, iOS 기기 항목은 1회차와 같다.
- #247(pair D3 통합 테스트)이 부하가 있을 때 `fetch failed`로 실패하는지 다시 봐야 한다. 2회 중 1회 실패했고, 그때 병행 검증자의 Chrome이 동시에 돌고 있었다.
- N2를 고칠지(평가기에 MIS_CLI를 설정) RISKS에 기록할지는 정책 결정이 필요하다.
