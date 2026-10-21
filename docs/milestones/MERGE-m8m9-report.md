# M8/M9 통합 병합 검증 보고서 (cbf4b29, e8a6d69, 0bf71c0)

검증 대상: 브랜치 `make-it-ship`, HEAD 50fec17. 세 병합 커밋에서 충돌을 어떻게 풀었는지가 맞는지만 본다. M8·M9 기능이 맞는지는 이번 범위가 아니다 (M8은 3차 FAIL, M9는 2차 FAIL 상태로 미검증).
검증자는 이 병합을 만든 사람과 다른 독립 검증자다. 저장소에서는 이 파일만 만들었다.

## 요약 판정

**DEFECTS FOUND (LOW 1건). 기능을 막는 결함은 없다.**

- 세 병합 모두 두 부모 쪽이 의도한 코드가 빠지거나 바뀌지 않았다.
  - D-1, freeze, debugScope, sessionRoot, shell의 redirect no-op과 env, policy의 명령 루프와 browserLaunchOverride, M8 R2-1 held-file 차단, M9 credential 검사, record 순서가 모두 남아 있다.
  - 각 항목은 실행해서 확인했다.
- 결함은 1건이다. 병합 중에 새로 쓴 `RULES.cancel` 설명이 실제 판정 로직보다 좁다 (`mis help`에서 cancelomc/stopomc가 빠짐). 심각도는 LOW다.

## 실행한 명령과 수치

| 확인 | 결과 | 명령 |
|---|---|---|
| 전체 테스트 | 737 pass / 0 fail / 0 skip / 0 todo, exit 0 (101 s) | `npm test` (`node --test "tests/**/*.test.mjs"`) |
| Chrome 존재 (브라우저 테스트가 실제로 돌았는지) | `/Applications/Google Chrome.app/...`이 있다. `M8 R2-1: a file attached without --remote never leaves the machine…`는 24.3 s 동안 실제로 실행됐다 | `findChrome()`, TAP 로그 |
| plugin.json | ✔ Validation passed | `claude plugin validate .claude-plugin/plugin.json` |
| marketplace.json | ✔ Validation passed | `claude plugin validate .` |
| 충돌을 푼 파일 목록 | 선언된 목록과 같다. cbf4b29에서 추가로 바뀐 파일은 keywords.mjs, mis-help.test.mjs 둘뿐이다 | `git show --remerge-diff --stat <m>` |
| 남은 충돌 마커 | 0 | `git grep -nE '^(<<<<<<< \|>>>>>>> \|=======$)' HEAD` |
| 각 부모에 있던 테스트 제목이 HEAD에도 있는지 (파일::제목) | cbf4b29^2 516, e8a6d69^2 519, 0bf71c0^2 322, 0bf71c0^1 534개가 모두 HEAD에 있다. cbf4b29^1(develop)에서는 1개만 HEAD에 없다 (아래 8번 참고). HEAD에는 제목 541개, test() 호출 542곳이 있다 | 임시 스크립트 `titles.mjs` |
| 부모 쪽에서 추가된 줄이 병합 결과에 없는 경우 | 아래 파일별 표에 정리했다. 모두 더 새로운 형태로 대체됐다 | merge-base 대비 `+`줄과 병합 결과를 비교 |

## 병합·파일별 판정

| 병합 | 파일 | 판정 | 근거 |
|---|---|---|---|
| cbf4b29 | scripts/guard.mjs | OK | remerge 결과: develop 쪽 `context(own && own === gitDir(cwd) ? at : cwd)`(D-1)에 M9 쪽 `let freezeDir = null, debugScope = null, sessionRoot = cwd`를 합쳤다. ^1·^2 대비 빠진 줄은 0이다. 실행 결과는 아래 1번에 있다 |
| cbf4b29 | skills/run/SKILL.md | OK | M9 상황표("Situational steps…")와 Partial requests는 남았다. 모드 문장의 위험 플래그는 `(auth, payment, pii, migration, security)`로 `hardware`가 없다. `git grep -n hardware -- scripts skills agents` 결과 2건은 ios.mjs의 `hardwareProperties`와 SKILL.md:119의 차단 사유 문장(“missing tool, hardware, credentials”)이다. 위험 플래그 목록과 관계없다 → 7번 PASS |
| cbf4b29 | tests/unit/keywords.test.mjs | OK | develop의 M6 R6–R11 테스트와 M8 `team and session skills are explicit-only` 테스트가 둘 다 있다. 닫는 `});`도 바르게 보충됐다 |
| cbf4b29 | scripts/lib/keywords.mjs | 결함 1 (LOW) | 아래 6번과 결함 목록 참고 |
| cbf4b29 | tests/integration/mis-help.test.mjs | OK (약함) | 정규식이 `LOOP_PREFIX` 대신 `PREFIX.source`에 들어 있는 `(?:ralph\|랄프\|ラルフ)`를 찾도록 바뀌었다 |
| cbf4b29 | README.md, docs/PROGRESS.md | OK | README의 Keywords 줄에는 양쪽 토큰이 모두 있다. CLI 줄은 develop 형태(`node ~/make-it-ship/...`)를 택했고 M9 명령 토큰(`learn add\|list\|search\|distill`, `retro [--git --since 7d]`, `second-opinion detect\|probe`)이 들어갔다. PROGRESS의 SPEC_CHANGES는 양쪽 항목을 모두 살렸다 |
| e8a6d69 | scripts/lib/shell.mjs | OK | ^1의 no-op 줄 대신 `env: n.env ?? []`이 붙은 같은 줄이 들어갔다. ^2(fix3)에 없던 REDIR 파서 개선은 ^1에서 왔고 그대로 남았다 |
| 0bf71c0 | scripts/lib/policy.mjs | OK | M9 루프(cd/pushd/popd 추적, `lost`, `misPaths`, stored write, misInner/storedMis/externalMis/outsideRepoMis/lastingChange)는 그대로다. `otherModelTeam` 바로 다음에 `browserLaunchOverride(m, text)`가 끼워졌다. m8 쪽의 단순 `cd` 처리는 M9 처리로 대체됐다 |
| 0bf71c0 | scripts/lib/browse/actions.mjs | OK | `runCommand`는 `seen`→`gated`→blocked 검사→`record` 순서다. `gated`는 M9 서명 `(b, h, cmd, args, ctx)`를 따르고 그 안에서 `tab = b.current()`를 얻는다. upload 핸들러의 R2-1 목적지 검사, holdLocalOnly, settle, 비로컬 원인 메시지는 모두 남아 있다 |
| 0bf71c0 | scripts/lib/browse/browser.mjs | OK | M9 필드(headers, userAgent, connected, extensionId, history, watch)와 M8 `blocked`가 둘 다 있다. start()는 M9의 connected/extension 실행 경로와 M8 `autoAttached = false`를 함께 쓴다 |
| 0bf71c0 | scripts/lib/browse/chrome.mjs | OK | M9 쪽 `OWNER_MARK`와 extensions 분기, M8 쪽 `--disable-site-isolation-trials`와 `chromeArgs`/`DENIED`가 모두 있다. 빠진 줄은 주석 하나("(the features alone no longer do it)")뿐이다 |
| 0bf71c0 | scripts/lib/browse/client.mjs | OK | import가 `findChrome, chromeArgs, NO_CHROME, OWNER_MARK`로 합쳐졌다. `chromeArgs(...)` 사전 검사(63행)와 `CHROME_MARK = OWNER_MARK`, `PROFILE_MARK`가 쓰인다 |
| 0bf71c0 | scripts/lib/browse/daemon.mjs | OK | `chromeArgs`(16행)와 `homeDir`(99행 runCommand ctx)를 import하고 실제로 쓴다 |
| 0bf71c0 | README.md, docs/PROGRESS.md | OK | 부모 어느 쪽에서도 추가된 줄이 빠지지 않았다 |

## 확인 항목별 증거

1. **guard.mjs (D-1, freeze, debugScope, sessionRoot)**: 저장소 밖 임시 저장소에서 `mis start --mode quick`, `plan set`(plannedFiles `src/**`), `mode set quick`, `approve plan`, `task T1 start`를 차례로 실행해 state를 `EXECUTING`으로 만들었다. 그다음 `vendor/lib`를 중첩 저장소로 만들고 hook JSON을 `node scripts/guard.mjs`에 파이프로 넣었다.
   - HEAD 결과:
     - `.git/hooks/pre-commit`, `.git/config`, `vendor/lib/x.js`, `other.js`는 모두 ask였다. `src/a.js`는 allow였다.
   - 병합 전 M9 guard(`git archive cbf4b29^2`)로 같은 입력을 넣었다.
     - `.git/config`와 `vendor/lib/x.js`가 **allow**였다.
     - 따라서 D-1이 실제로 효과를 내고 있다.
   - `mis freeze src` 이후:
     - `src/a.js`는 allow, `.git/config`와 `vendor/lib/x.js`는 deny였다. freeze와 D-1이 함께 동작한다.
   - `mis debug scope src/a.js` 이후:
     - `src/a.js`는 allow, `src/b.js`(plan 안이지만 scope 밖)는 ask였다.
     - `--clear` 후 `src/b.js`는 allow로 돌아왔다.
   - sessionRoot는 run이 없는 새 저장소에서 따로 확인했다. run이 있으면 plan 밖 파일이 어차피 ask가 되어 sessionRoot의 효과를 구분할 수 없기 때문이다.
     - 저장소 밖 `CLAUDE.md`는 **ask**, 저장소 밖 `other.txt`는 **allow**였다.
     - 저장소 안 `CLAUDE.md`는 allow였다.
   - 같은 EXECUTING 상태에서 `git push`(Bash)는 ask였다.
2. **shell.mjs**: `commandsOf()`로 직접 확인했다.
   - `exec 3> f`와 `> f`는 둘 다 `[{argv:[':'],redirects:['f'],env:[]}]`로 쓰기가 남는다.
   - `FOO=1 BAR=2 git push`는 env `['FOO=1','BAR=2']`가 붙는다.
   - `env K=V npm i`는 env `['K=V']`가 붙는다.
   - `echo ">" a`의 `>`는 따옴표로 묶였으므로 리터럴 단어로 처리된다.
3. **policy.mjs browserLaunchOverride 인자**: m8 원본의 `browserLaunchOverride(misSub(ws, functions), text)`와 병합본의 `browserLaunchOverride(m, text)`는 같은 값을 받는다.
   - `m = misSub(ws, functions)`이고 misSub는 순수 함수다.
   - 그 사이에 실행되는 `misPaths` flatMap과 `otherModelTeam(m, text)`는 `m`을 바꾸지 않는다. shift/splice/sort/reverse/인덱스 대입을 grep했고 0건이었다.
   - 다만 병합본의 misSub는 M9 버전이어서 `nodejs/bun/deno run`도 알아본다. 즉 m8보다 넓게 잡는다.
   - 실행 확인:
     - ask: `MIS_BROWSE_CHROME_ARGS=--foo mis browse goto …`, `MIS_BROWSER=/bin/x node scripts/mis.mjs browse …`, `export MIS_BROWSER_EXE=/x; mis browse …`, `MIS_BROWSER=/x bun run scripts/mis.mjs browse goto x`, `MIS_BROWSER=/x deno run …`
     - allow: `mis browse goto http://localhost`
4. **actions.mjs 제어 흐름**: m8-wip와 HEAD를 경로별로 비교했다.
   - `chain`은 두 버전 모두 `runCommand` 맨 앞에서 `chain()`으로 바로 돌아간다. 각 단계는 `runCommand(..., inChain:true)`를 거치므로 단계마다 blocked 검사를 받는다. 이 동작은 m8-wip와 같다.
   - `tab-each`(M9)는 HANDLER 안에서 탭마다 `runCommand`를 부른다.
     - 안쪽 blocked 오류는 탭별 error로 기록된다.
     - 바깥 `tab-each` 호출도 같은 `b.blocked` 구간을 보기 때문에 결국 throw한다. fail-closed다.
   - `status`, `stop`, `restart`는 두 버전 모두 daemon과 client가 처리하고 runCommand 경로가 아니다.
   - blocked 검사는 `gated()`를 거치는 명령과 그렇지 않은 명령(`!GATED.has(cmd) || ctx.remote`) 모두에 적용된다. 검사가 `gated()` 호출을 감싸고 있기 때문이다.
   - credential-domain 검사(M9)는 `gated()` 맨 앞에서 GATED 분기보다 먼저 실행된다. ^1과 같다.
   - `record()`는 blocked throw 뒤에만 실행된다. 즉 성공한 명령만 기록된다.
   - 결론: m8-wip가 blocked를 검사하던 경로 중 HEAD에서 빠진 것은 없다. M9 쪽 검사 중 빠진 것도 없다.
5. **browser/chrome/client/daemon**: 위 표에 정리했다.
   - `event()` 맨 앞에서 M8은 `Target.attachedToTarget`(sessionId 없음)와 `Fetch.requestPaused`를 받으면 바로 return한다.
   - `git grep "Fetch\.|setAutoAttach|attachedToTarget" 0bf71c0^1 -- scripts/lib/browse` 결과 M9 쪽은 이 이벤트를 쓰지 않는다 (0건). 따라서 서로 간섭하지 않는다.
6. **keywords.mjs RULES**:
   - `loop` 설명("prefix … and has no off word after it")은 `explicitLoop(raw) && !cancelOnly(raw)`, 그리고 PREFIX 뒤 `OFF_STEM` 검사와 맞는다.
   - `cancel` 설명은 실제 로직보다 좁다 (결함 1).
   - mis-help 테스트는 `PREFIX.source`에서 나온 `(?:ralph|랄프|ラルフ)` 문자열이 출력에 있는지만 본다. PREFIX가 바뀌면 깨지지만, 설명 문장이 맞는지는 검사하지 않는다.
   - `cancel mis`/`stop mis`가 더 이상 cancel로 판정되지 않는 것은 병합에서 생긴 손실이 아니다.
     - M9 쪽 cancel 정규식은 `c8947d7`(M6 5차) 이후 M9가 손대지 않았다. `git show c8947d7` 대비 `cbf4b29^2`의 diff가 없다.
     - develop의 M6 6–11차(`6209a81`…`fa8c1d1`)가 의도적으로 닫힌 목록 방식인 `cancelOnly`로 바꿨다.
     - 병합은 그 더 새로운 결정을 택한 것이다.
7. **SKILL.md / hardware**: PASS (위 표 참고).
8. **테스트 제목**: 각 병합의 ^2 부모에 있던 제목은 HEAD에 전부 있다.
   - develop(cbf4b29^1)의 `qa detect: web with Playwright → runnable check; web without a runner → BLOCKED proposal` 하나만 없다.
   - 이 테스트는 M8에서 `qa detect: web with Playwright → its runner; without one → built-in browser script (BLOCKED only without any browser)`로 이름이 바뀌었다. 같은 파일, 같은 위치다.
   - Playwright 분기의 단언은 그대로다. runner가 없을 때 BLOCKED라는 단언은 "Chrome도 없을 때"로 좁혀졌고, `MIS_BROWSER=/nonexistent` 케이스가 새로 추가됐다.
   - 같은 동작을 확장한 이름 변경이고, 테스트가 사라진 것은 아니다.
9. **npm test / manifest**: 위 표와 같이 737/737 통과했고 manifest 두 개 모두 검증을 통과했다.

## 결함 목록

| # | 심각도 | 위치 | 내용 | 재현 |
|---|---|---|---|---|
| 1 | LOW | scripts/lib/keywords.mjs:130 `RULES.cancel` (cbf4b29에서 병합 중 새로 씀) | `mis help`의 cancel 설명이 "ralph 단어, 채움말, 닫힌 목록의 끄기 단어만으로 된 프롬프트"뿐이다. 그런데 `cancelOnly()`는 프롬프트 안 어디에든 `cancelomc`/`stopomc`가 있으면 true를 돌려준다. 병합 전 M9의 `mis help`는 cancel 정규식(`cancelomc\|stopomc` 포함)을 그대로 출력했으므로, 병합 후 help에서 이 정보가 사라졌다. 판정 동작 자체는 바뀌지 않았다 | `node scripts/mis.mjs help \| grep -n cancel` → 81행에 cancelomc 언급이 없다. `detectKeywords('cancelomc and also refactor parser.js')` → `['cancel']`. 병합 전(`cbf4b29^2`의 `keywordTable()`)에서 cancel trigger는 `/\b(cancelomc\|stopomc)\b\|…/`였다 (실행으로 확인) |

## 남은 위험

- **`_render-pdf` 경로**: daemon이 `runCommand`를 거치지 않고 처리하므로 blocked 검사를 받지 않는다. m8-wip에서도 같았으므로 병합 회귀는 아니다. M8 3차 수정에서 볼 항목이다.
- **`X=1 > f`**: 결과가 `env: []`다. argv가 비면 `normalize`가 env 없이 반환하기 때문이다. 양쪽 부모에 원래 있던 동작이고 쓰기는 정상으로 잡힌다.
- **mis-help 테스트**: 고정된 부분 문자열만 확인한다. RULES 설명이 실제 로직과 어긋나도 잡지 못한다 (결함 1이 통과한 이유).
- **이번 검증의 범위**: 충돌 해소만 검증했다. M8 R3-1(worker/navigation/closetab 경로의 업로드 유출)과 M9 2차 FAIL 항목은 그대로 열려 있다.
- **WebSocket**: 핸드셰이크는 Fetch 도메인에 보이지 않아 차단되지 않는다. M8 코드에 `shortcut:` 주석으로 적혀 있다.
