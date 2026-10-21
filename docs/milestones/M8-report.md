# M8 독립 검증 보고서 — 브라우저·팀·문서 변환

- 대상: worktree `/Users/mason.lee/Dev/Git/tools/make-it-ship-m8`, 브랜치 `m8-wip`, 커밋 `f0c4baf`
- 검증자: 독립 검증 에이전트 (구현에 관여하지 않음). PROGRESS.md·커밋 메시지는 근거로 쓰지 않았고, 아래 수치는 모두 직접 실행한 결과다.
- 범위 기준: ADR-0003, gap-matrix §5.4(쿠키·자격 증명·다운로드·스크랩·connect는 M9), §2.1(omc-teams/team/psm/visual-verdict), §2.6(omc launch/team/teleport), §3(visual companion), §5.1(qa/qa-only/design-review/benchmark/make-pdf), §7 M8 행.
- 환경: macOS (Darwin 27), Node 22+, Google Chrome 155, tmux `/opt/homebrew/bin/tmux`(전용 소켓 `-L misverify`). 모든 웹 페이지는 로컬(127.0.0.1)에서 직접 띄운 것만 사용했다. `*.test` 호스트는 `--host-resolver-rules`로 127.0.0.1에 매핑해 "로컬이 아닌 사이트"를 흉내 냈다 (외부 전송 없음).

## 요약 판정

**DEFECTS FOUND**

핵심 기능(데몬, 명령 그룹 대부분, @e 참조, handoff/resume, pdf, 팀 런타임, 세션, companion)은 실제로 동작하고 테스트도 3회 모두 통과했다. 그러나 다음 때문에 PASS로 볼 수 없다.

0. **[HIGH, 결정적 재현] 원격 사이트가 만든 `blob:` 페이지와 `about:blank` 팝업을 "로컬"로 판정한다.** 그래서 `--remote` 없이도, guard가 묻지 않은 채로 `js`/`storage`가 그 사이트의 localStorage를 읽는다. ADR-0003의 "쿠키·세션 접근은 매번 guard가 ask"에 어긋난다.
1. **[HIGH] `chain` 안에서 연속 `goto` 직후 `js`/`storage`/`eval`이 로컬이 아닌 페이지에서 `--remote` 없이 실행된다** (6/6 재현). README·browse 스킬의 "real sites ask" 약속이 깨지고, guard는 `--remote`가 없으므로 묻지 않는다.
2. **[MEDIUM] 데몬 토큰 인증이 우회된다**: Chrome이 `--remote-debugging-port=0`으로 인증 없는 CDP 포트를 열어 두어, 토큰이 없는 다른 로컬 프로세스가 브라우저를 그대로 조종할 수 있다 (실증).
3. **[MEDIUM] `mis visual-verdict`가 완전히 다른 페이지를 score 98 / pass로 판정한다**. 흰 배경 비율이 점수를 지배한다. OMC 원본은 모델의 시각 판정이 점수이고 픽셀 diff는 보조 수단이다.
4. **[MEDIUM] M8 범위 누락이 문서화되지 않았다**: §5.4 M8 명령(`media`, `inspect`, `ux-audit`, `style`/`style --undo`/`cleanup`/`prettyscreenshot`, `tab-each`, `snapshot -C`/`@c`, `state save|load`, `focus`, `memory`), §7 M8 행의 `omc launch`, OMC `qa-tester` tmux 조작이 없다. 그런데 PROGRESS는 M8-01~04를 DONE으로 적었고, README에는 쿠키·connect·다운로드·스크랩만 "not included yet"으로 적혀 있다.
5. **[LOW–MEDIUM, M2부터 있던 파서 버그] guard 우회 (문서에 나온 그대로 쓴 경우)**: 스킬이 정의한 `mis` 단축형을 셸 함수 `mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }`로 만들면 `mis browse cdp ...`가 allow로 판정된다. `${...}` 안의 `}`를 함수 본문의 끝으로 읽기 때문이다.

그 밖의 LOW 결함은 결함 목록에 있다.

## 실행 명령과 수치

| 항목 | 명령 | 결과 |
|---|---|---|
| 테스트 1회차 | `npm test` | tests 469 / pass 469 / fail 0 / skipped 0, 128.9 s (아래 수동 브라우저 시험과 동시에 실행) |
| 테스트 2회차 | `npm test` | 469 / 469 / 0 / 0, 85.0 s |
| 테스트 3회차 | `npm test` | 469 / 469 / 0 / 0, 81.6 s |
| flake | — | 3회 모두 실패 없음. flake 없음 |
| 플러그인 검증 | `claude plugin validate .` | `✔ Validation passed` |
| stub/skip grep | `grep -E "test\.skip\|\.only\(\|it\.todo\|TODO\|FIXME"` (M8 파일 전체) | 해당 없음 (`--dangerously-skip-permissions`가 없다는 단언 1건만 걸림) |
| 명령 지연 | 직접 측정 (node 기동 포함) | 일반 명령 230–660 ms, 첫 명령(데몬+Chrome 기동) 2.4–2.5 s. 스킬에는 "100–200 ms"라고 적혀 있다 (node 기동을 빼면 근접, LOW) |
| 테스트 후 잔여 프로세스 | `ps` | 테스트가 띄운 데몬·Chrome 잔여 없음 |

## 기능별 표

### 브라우저 (`mis browse`)

| 기능 | 판정 | 증거 |
|---|---|---|
| 수명주기 status/stop/restart | PASS | status `running:false` → goto 후 pid/port/chromePid/mode 표시; `stop` → `{stopped:true}`; `restart` → 새 pid |
| 작업공간(worktree)별 격리 | PASS | 같은 저장소의 다른 worktree는 stateDir `…/browse/27de20d61c13` (main은 `741ed4573026`), `running:false`로 따로 기동 |
| 토큰 인증 | PARTIAL | 데몬 HTTP: 토큰 없음/틀린 토큰/GET → 모두 `401 unauthorized`. state.json 모드 0600. **그러나 Chrome CDP 포트는 인증 없이 열려 있다** (결함 D2) |
| idle 종료 | PASS | `MIS_BROWSE_IDLE_MS=3000` → 4 s 뒤 로그 `shutting down: idle`, 데몬·Chrome 둘 다 종료 |
| 크래시 복구 | PASS | 데몬을 `kill -9` → Chrome 고아가 남음 → 다음 명령이 고아 Chrome을 죽이고 프로필을 삭제한 뒤 새로 기동. Chrome을 `kill -9` → 데몬이 스스로 종료 → 다음 명령으로 복구 (페이지 상태는 사라짐) |
| 이동 goto/back/forward/reload/url/wait/load-html | PARTIAL | 모두 동작하고 상태도 맞다. 다만 `back`/`forward`/`reload` 출력 문구가 한 단계 이전 URL을 말한다 (`back` → "Back to /second.html"인데 실제는 `/`) (D6). `wait sel --timeout 500` 타임아웃, `--load`, `--networkidle` 정상 |
| 읽기 text/html/links/forms/accessibility/data | PASS | forms에 비밀번호 `[redacted]`(fixture 테스트), data `--og` 정상, accessibility 트리 출력 |
| `media` | FAIL (누락) | 명령 없음 (§5.4 M8) |
| snapshot `-i -c -d -s -D -a -o`, @e 참조 | PASS | `@e1..@e11`; 같은 페이지의 같은 요소는 같은 ref; `-a -o`로 라벨 붙은 스크린샷 확인 (육안). `-D`는 직전 스냅샷과 비교 (직전이 `-i`면 diff가 크게 나옴, 사용상 주의) |
| 낡은 ref 감지 | PASS | 요소 삭제 후 `click @e2` → `stale ref @e2`; 이동 후 `click @e3` → `unknown ref … (refs reset on navigation)` |
| `snapshot -C` / `@c` | FAIL (누락) | 플래그 없음 |
| 조작 click/fill/select/type/press/scroll/hover/viewport/upload | PASS | 폼 제출 결과 `name=Kim Lee color=g file=upload.txt`; `press Enter` → `enter:abc`; `type xy` → `abcxy`; `viewport 375x812` → `innerWidth 375`; `--scale 2` → `devicePixelRatio 2`; scroll → `scrollY 1484` |
| 대화상자 dialog-accept/dismiss/dialog | PASS | alert 자동 수락; dismiss 후 prompt → 빈 값; `dialog-accept Alice` → `Alice`; `dialog` 기록 3건 |
| js/eval (localhost) | PASS | `await` 지원; `eval ev.js` → `Demo Page|127.0.0.1:51249`; 작업 디렉터리·임시 디렉터리 밖 파일(`/tmp/...`)은 거부 |
| css/attrs/is | PASS | `rgb(0, 0, 255)`, attrs JSON, `is visible` true |
| console/network/perf | PASS | console에 log/error/404, `--errors` 필터; network에 상태·크기·ms; perf에 ttfb/fcp/lcp/requests/failedRequests |
| `inspect`, `ux-audit` | FAIL (누락) | 명령 없음 |
| screenshot (전체/viewport/요소/clip/기본 경로) | PASS | full 1280x2206, viewport 1280x720, `#f` 요소 1264x22, clip 200x100, 경로를 생략하면 임시 디렉터리에 저장 |
| responsive | PASS | 375x2227 / 768x2206 / 1280x2206, 이후 viewport 원래대로 복원 |
| pdf | PASS | letter 3쪽, `--format a4 --landscape` 4쪽 |
| diff | PASS | 다른 두 페이지 → 줄 diff, 같은 URL → `(no text differences)` |
| tabs/tab/newtab/closetab | PASS | 두 탭 목록, 전환, 없는 id → `no tab 2` |
| `tab-each` | FAIL (누락) | 명령 없음 |
| frame (선택자/--name/--url/main) | PASS | 프레임 안에서 text·click·js(`/frame.html`) 동작 |
| chain | PARTIAL | 순서 실행, 실패 단계에서 멈춤(`chain stopped at step 2`), chain 안의 cdp 거부. **연속 goto 경합으로 원격 게이트 우회** (D1) |
| style/cleanup/prettyscreenshot, state save/load, focus, memory | FAIL (누락) | 명령 없음 (§5.4 M8 / M8·M9) |
| handoff/resume | PARTIAL / NEEDS_HUMAN | handoff 중 `mode: handoff`, headless 프로세스 0개(보이는 Chrome으로 재기동), resume 뒤 `mode: headless`, URL과 localStorage(`tok: abc`) 유지, `snapshot -i` 출력. 창이 실제로 보이고 쓸 만한지는 육안 확인을 못 함 → NEEDS_HUMAN |
| 원격 게이트: blob/팝업 | **FAIL** | `shop.test/blob.html`(로드 시 localStorage를 쓰고 `location = URL.createObjectURL(...)`) → `goto` → URL `blob:http://shop.test:51888/…` → `js "self.origin + ' ' + localStorage.secret"` → `http://shop.test:51888 S3CR3T`, `storage` → `{"secret":"S3CR3T"}` (`--remote` 없음). 팝업: `shop.test/pop.html`에서 `window.open('about:blank')` → 자동으로 붙은 탭 2 → `js "self.origin + ' ' + opener.localStorage.secret"` → `http://shop.test:51888 S3CR3T` (D0) |
| 원격 게이트 (데몬) | PARTIAL | `shop.test`에서 `js`/`storage`/`eval` 단독 실행 → 거부, `--remote`면 실행; 원격 iframe 안 `js` → 거부; chain 안 단일 goto+js/storage → 거부. **연속 goto 경합으로 우회** (D1) |

### guard (PreToolUse, `scripts/guard.mjs`에 hook JSON 입력)

| 명령 | 결과 |
|---|---|
| `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" browse cdp Browser.getVersion` | ask |
| `… browse js document.title --remote`, `… storage --remote`, `… chain '[…]' --remote` | ask |
| `… browse goto http://localhost:3000`, `… browse js 1+1` | allow |
| `node "$MIS_CLI" browse cdp X.y`, `node /abs/scripts/mis.mjs browse cdp X.y` | ask |
| `… team start 2 x --worker codex` / `--worker=gemini` / `MIS_TEAM_WORKER_CMD=… … team start` | ask |
| `… team start 2 x` / `--worker claude` | allow |
| `mis() { node /p/scripts/mis.mjs "$@"; }; mis browse cdp X.y` | ask |
| **`mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }; mis browse cdp X.y`** | **allow** (D5) |
| `… browse chain '[["goto","https://example.com"],["js","document.cookie"]]'` (`--remote` 없음) | allow. guard는 데몬의 거부에 기댄다. 그 거부가 D1 경합으로 뚫린다 |
| `… browse upload '#f' ~/.ssh/id_rsa` | allow (남은 위험 참조) |

### 문서 변환·시각 판정

| 기능 | 판정 | 증거 |
|---|---|---|
| `mis pdf README.md` | PASS | 7쪽(pdfinfo), letter 612x792; 머리글 "Make It Ship"(제목), 바닥글 "1 of 7 … 7 of 7" (pdftotext). 저장소는 변경되지 않음 (`git status` 깨끗) |
| 원격 이미지 차단 | PASS | 기본: `[remote image blocked: remote] (use --allow-network)`, 로컬 서버 접근 로그 0회; `--allow-network`: 정확히 1회 요청; `--no-page-numbers`: "of 2" 0건 |
| 따옴표·대시 변환 | PASS | `"world" --` → `“world” –` |
| `visual-verdict` 동일 이미지 | PASS | score 100, pass, exit 0, diffPixels 0, diff 이미지 생성 |
| `visual-verdict` 작은 변경 (텍스트 1줄 추가) | PASS | score 98, pass, 핫스팟 영역 표시 |
| `visual-verdict` 크기 다름 | PASS | score 25, fail, exit 1, "size differs" 문구와 viewport 제안 |
| `visual-verdict` **완전히 다른 페이지** | **FAIL** | Demo 페이지와 Second 페이지 비교 → score 98, `pass: true`, exit 0 (D3) |

### 웹 QA (Playwright 없음)

| 기능 | 판정 | 증거 |
|---|---|---|
| `mis qa detect` (index.html + package.json, Playwright 없음) | PASS | BLOCKED가 아니라 `qa-web`: `node qa/web-smoke.mjs` 제안, `MIS_CLI` 사용법 안내 |
| 제안된 check 실행 | PASS | `qa/web-smoke.mjs`(앱 기동 → goto → snapshot -i → @ref click → text 확인 → viewport 375 → stop)를 작성하고 `.make-it-ship.json`에 등록 → `mis check qa-web` → `PASS`, exitCode 0, 로그 `PASS Secret revealed 42` |
| qa / qa-only / design-review / benchmark 절차 | PASS (문서) | `skills/run/phases/qa.md` 6–9단계, `skills/qa/SKILL.md` 모드 선택. 실제 실행은 아래 dogfood와 위 check로만 확인 |
| OMC qa-tester tmux 대화형 CLI 조작 | FAIL (누락) | `agents/qa-tester.md`·qa 단계에 tmux가 없다 (§2.1 qa-tester 행, §7 M8 행) |

### 팀 (`mis team`, 전용 tmux 소켓)

| 기능 | 판정 | 증거 |
|---|---|---|
| start (fake worker, `MIS_TEAM_WORKER_CMD`) | PASS | 작업 5개·워커 2개: 1/3 → w1, 2/4/5 → w2, 작업 4(FAIL)는 `failed` exit 1, 나머지 `done`; 각 브랜치 커밋 `task 1/3`, `task 2/5` |
| 리드 세션 환경 변수 제거 | PASS | fake worker는 `CLAUDECODE`를 물려받으면 실패하는데 실패하지 않음 |
| status / wait | PASS | 상태 `running`→`exited`, `wait --timeout 2` 타임아웃 메시지, `complete:true` |
| 동시 claim (6 워커 × 40 작업) | PASS | done 40, 워커당 6–7개, 브랜치 커밋 합계 40, 중복 커밋 0 |
| shutdown | PASS | tmux 세션 종료 (`no server running`), 깨끗한 worktree 삭제, 브랜치 유지; 작업 중(SLEEP) 종료 → fake worker·`team _worker` 프로세스 0개 남음 |
| shutdown 뒤 status | PARTIAL | 작업이 `in_progress`, 워커가 `running`으로 계속 표시된다 (D7) |
| 실제 `claude -p` 워커 1건 (`--max-turns 8`, 아래 참고) | PASS | 작업 `done` exit 0, 브랜치에 `add hello` 커밋과 `hello.txt` = `hi`. worktree에 추적 안 된 `.omc/`(사용자 전역 OMC 훅이 만든 폴더)가 있어서 shutdown이 worktree를 `kept`로 남김 (올바른 보수적 동작) |
| tmux 없을 때 | PASS | `BLOCKED: tmux is not installed` (team, session --tmux 모두) |
| guard: codex/gemini/override | PASS | 위 guard 표 |
| team 스킬 vs OMC team | PASS (차이 있음) | OMC는 team-plan→team-prd→team-exec→team-verify→team-fix. MIS는 plan(discover→interview→plan, prd 역할 흡수)→exec→verify→fix, 최대 3라운드, 단계 handoff는 `shared_memory_write`. prd를 별도 단계로 두지 않은 차이는 있지만 기능은 대응됨 |
| `omc launch` | FAIL (누락) | 구현·문서 모두 없음 (§2.6, §7 M8 행) |

실제 claude 워커는 `MIS_TEAM_WORKER_CMD`로 실행했다. `workerArgv('claude')`와 같은 인자에 `--max-turns 8`만 더한 것이다. 기본 `workerArgv` 자체에는 `--max-turns`가 없어서 실행 횟수를 제한할 수 없었기 때문이다. 따라서 기본 argv를 그대로 쓴 실행은 검증하지 못했다.

### 세션 (`mis session`)

| 기능 | 판정 | 증거 |
|---|---|---|
| `create feature "My Cool X"` | PASS | `.worktrees/feat-my-cool-x`, 브랜치 `feature/my-cool-x` |
| `create issue 12` / `issue abc` | PASS | `fix/12`; `abc` → usage 오류 |
| `create pr 7` (로컬 bare origin에 `refs/pull/7/head`) | PASS | `pr-7-review` 브랜치, HEAD = `pr commit`; 없는 PR 99 → `couldn't find remote ref` |
| `--tmux` | PASS | `mis-feat-x` 세션과 attach 명령; remove하면 tmux 세션도 닫힘 |
| list | PASS | 이름·종류·브랜치·dirty·tmux 표시 |
| remove (미커밋 변경이 있으면 거부) | PASS | `has uncommitted changes … (nothing was removed)`; 깨끗하면 삭제, 브랜치 유지 |
| main 트리 status | PASS | `.worktrees/`가 `info/exclude`에 들어가 `git status`가 깨끗함 |

### Visual companion (`mis companion`)

| 기능 | 판정 | 증거 |
|---|---|---|
| start/stop/status | PASS | URL·pid; stop 뒤 프로세스 사라짐, `running:false` |
| 페이지 목록 | PASS | 최신순 `sub/full.html`, `opt.html` |
| 조각 HTML을 프레임으로 감쌈 | PASS | `<!doctype html>` 추가됨 |
| 접근 키 | PASS | 키 없음·틀린 키 → 403 |
| 경로 탈출 | PASS | `/../`, `%2e%2e`, `..%2f`, `//etc/passwd`, `%2Fetc%2Fpasswd` 7가지 → 모두 404. 단 디렉터리 안 심볼릭 링크는 따라감 (D8, LOW) |
| 라이브 리로드 (SSE) | PASS | 파일 수정 → `data: reload` |
| 클릭 선택 기록 | PASS | POST → 204; `mis browse`로 `[data-choice=a]` 클릭 → choices `['b','a']` |

## 안전성

- 데몬은 127.0.0.1에서만 열리고, bearer 토큰을 상수 시간으로 비교하며, state.json 모드는 0600이다. 그러나 같은 Chrome의 DevTools 포트(예: 52406)는 인증 없이 열려 있다. `curl /json/list`와 WebSocket `Runtime.evaluate`로 현재 페이지(`http://shop.test:51249/second.html`)의 JS를 토큰 없이 실행했다 (D2). `--remote-debugging-pipe`를 쓰면 이 포트가 생기지 않는다.
- 원격 게이트는 단독 명령과 iframe에서는 지켜진다. 그러나 chain 안에서 연속으로 `goto`하면 `tab.url`이 아직 이전 로컬 URL인 상태에서 게이트를 판정한다 (D1). 두 번째 goto의 결과 문구가 "Navigated to http://127.0.0.1…"로 나오는 것도 같은 원인이다. 이전 페이지의 load·stop 이벤트가 새 탐색의 대기자를 미리 깨우는 것으로 추정한다.
- `cdp`는 단독이면 항상 ask, chain 안에서는 거부된다.
- `pdf`는 기본으로 http/https/ws를 차단한다 (실측 요청 0회).
- Chrome은 `--disable-background-networking` 등으로 백그라운드 통신을 끈다. 이 검증 중 외부로 나간 요청은 확인하지 않았지만, 모든 대상 URL은 로컬이었다.
- 팀 워커: `--dangerously-skip-permissions` 없음, push/PR/install은 `--disallowedTools`, codex/gemini/override는 guard ask.

## 프로세스 정리

- 내가 띄운 것을 모두 정리했다: 브라우저 데몬(`mis browse stop`, 작업공간 5곳), companion(`stop`), python http.server 2개, tmux 전용 소켓 `misverify`(`kill-server`), 실제 claude 워커가 남긴 worktree(`git worktree remove --force`, 임시 저장소 안). 마지막 `ps` 확인: 데몬·Chrome(mis 프로필)·companion·http.server·team 워커 0개, `misverify` 소켓 서버 없음.
- 제품 쪽 정리 동작: `stop`·idle·Chrome 크래시 때 데몬과 Chrome이 함께 종료된다. 데몬을 `kill -9`하면 Chrome 고아가 남지만 다음 명령이 그것을 정리한다. team shutdown은 pane의 워커와 자식 프로세스를 모두 종료했다.
- **누수 (D10, LOW)**: 2건 관찰 (다시 3번 시도했을 때는 재현 안 됨). `stop`(로그 `shutting down: stop requested`) 뒤에도 Chrome 프로필 디렉터리(`$TMPDIR/mis-browse-profile-*`, 각 약 6 MB)가 남았다. 3번 다시 시도했을 때는 재현되지 않았다 (간헐적). 남은 2개는 내가 지웠다.
- **테스트 누수 (D11, LOW)**: `tests/integration/mis-browse.test.mjs`가 `$TMPDIR/mis-browse-home-*`와 `mis-browse-out-*`를 실행마다 남긴다 (현재 28개, 일부는 이 검증 전에 생긴 것). 내가 만든 것과 구별할 수 없어 지우지 않았다.
- 저장소 변경: `docs/milestones/M8-report.md` 생성뿐 (`git status`에 `?? docs/milestones/M8-report.md`만 있음). 커밋하지 않았다.

## 실사용 기록

dogfood 명령 (지시 그대로, `MIS_STATE_HOME`은 임시, cwd는 빈 git 저장소, 페이지는 `http://localhost:51777/`):

- **1회차**: 내가 만든 페이지의 따옴표가 잘못 이스케이프되어 버튼이 동작하지 않았다. 에이전트는 `make-it-ship:browse` 스킬 → `mis browse goto` → `snapshot -i`(`@e1 [button] "Show"`) → `click @e1` → `snapshot -D` → `text` → `html body` → `console` 순서로 진행했다. 그리고 "no text appeared. The page has a bug"라고 정직하게 보고했다 (가짜 성공 없음). 8턴, $0.17.
- **2회차** (페이지 수정 후): `make-it-ship:browse` 스킬 → `mis browse goto` → `snapshot -i` → `click @e1` → `snapshot -D` → `text '#o'` → **"The magic word is PAPAYA-7"**를 정확히 보고했다. 7턴, $0.056. transcript(`stream-json`)의 tool_use로 `mis browse`를 썼음을 확인했다.
- 관찰: 두 번 모두 에이전트가 처음에는 `M="node …/mis.mjs"; $M browse …`라고 썼고, zsh가 단어 분리를 하지 않아 실패(exit 127)했다. 그다음 `mis() { node /abs/…/mis.mjs "$@"; }` 함수 형태로 바꿨다. 즉 함수 정의는 실제로 생기는 사용 패턴이며, `${CLAUDE_PLUGIN_ROOT}`가 들어간 형태라면 D5 때문에 guard가 cdp를 놓친다.

## 결함 목록

| ID | 심각도 | 내용 | 재현 | 위치 |
|---|---|---|---|---|
| D0 | HIGH | `isLocalUrl`이 `blob:`·`about:`·`data:`를 출처와 상관없이 로컬로 본다. 원격 사이트가 만든 blob 문서나 about:blank 팝업은 그 사이트의 origin을 물려받으므로, `js`/`storage`/`eval`이 `--remote` 없이 실행되고 guard도 묻지 않는다 (결정적 재현, 경합 아님) | 기능별 표의 "원격 게이트: blob/팝업" 행 | `scripts/lib/browse/util.mjs isLocalUrl` (`['file:','about:','data:','blob:']`), `browser.mjs isLocal` (tab.url만 봄. 실제 실행 컨텍스트의 `self.origin`을 봐야 함) |
| D1 | HIGH | chain 안에서 연속 `goto` 직후 `js`/`storage`/`eval`이 로컬이 아닌 페이지에서 `--remote` 없이 실행된다 (원격 게이트 우회; guard도 묻지 않음) | `MIS_BROWSE_CHROME_ARGS="--host-resolver-rules=MAP *.test 127.0.0.1"` 상태에서 `mis browse chain '[["goto","http://127.0.0.1:P/second.html"],["goto","http://shop.test:P/second.html"],["js","location.host"]]'` → 결과 `shop.test:P` (6/6). 두 번째 goto 결과 문구도 이전 URL | `scripts/lib/browse/browser.mjs` `navigate()`/`waitLoad()`/`wake()` (이전 탐색 이벤트가 새 대기자를 깨움); 게이트 판정은 `actions.mjs runCommand`의 `b.isLocal(tab)` (`tab.url` 기준) |
| D2 | MEDIUM | Chrome의 인증 없는 CDP 포트 때문에 토큰이 없는 로컬 프로세스가 브라우저를 조종할 수 있다 | `lsof`로 Chrome 리슨 포트 확인 → `curl http://127.0.0.1:<port>/json/list` → WebSocket으로 `Runtime.evaluate` → 페이지 URL·제목 반환 | `scripts/lib/browse/chrome.mjs` `launchChrome` (`--remote-debugging-port=0`) |
| D3 | MEDIUM | `visual-verdict`가 완전히 다른 화면을 score 98 / pass / exit 0으로 판정한다 (흰 배경이 점수를 지배). OMC 원본은 시각 판정이 점수이고 픽셀 diff는 보조다. browse 스킬에 "두 이미지를 직접 보라"는 단서가 있지만, `skills/run/phases/qa.md` 8.4 디자인 리뷰 루프는 "90+ passes"를 멈춤 조건으로 쓴다. 그래서 틀린 화면에서도 루프가 끝난다 | Demo 페이지와 Second 페이지 viewport 스크린샷 비교 → `98 pass True 10135` | `scripts/lib/png.mjs:100` (score = 같은 픽셀 비율), `commands-browse.mjs visualVerdict` |
| D4 | MEDIUM | M8 범위 일부가 빠졌는데 문서에 없다. **명확히 M8인 것**: §5.4의 `media`, `inspect`, `ux-audit`, `style`/`style --undo`/`cleanup`/`prettyscreenshot`, `tab-each`, `snapshot -C`/`@c`; §7·§2.6의 `omc launch`; §2.1·§7의 qa-tester tmux 조작. **범위 불명확** (FAIL로 세지 않음): `cookies` 읽기 (§5.4 검사 행은 "M8, guard 확인"이지만 이번 지시상 쿠키 그룹은 M9), `focus`/`state save\|load`/`memory` (행이 "M8·M9"로만 적혀 있음). `omc_run_team_*`는 team 스킬이 deprecated → `mis team`으로 대응시켰으므로 충족으로 본다. PROGRESS는 DONE, README는 쿠키·connect·다운로드·스크랩만 미포함으로 적음 | `mis browse media` → unknown command; `grep -rn "omc launch\|tmux" agents/ skills/run` → 해당 없음 | `scripts/lib/browse/actions.mjs` HANDLERS, `agents/qa-tester.md`, `README.md:91`, `docs/PROGRESS.md:145-148` |
| D5 | LOW–MEDIUM | (M2 때부터 있던 `shell.mjs` 파서 버그를 M8 `misSub`가 물려받음. `shell.mjs`는 M8 diff에 없음.) 파서로 직접 확인한 결과, 함수 본문이 `' node "${CLAUDE_PLUGIN_ROOT'`에서 잘린다. dogfood에서 모델은 절대 경로로 함수를 정의했고, 그 형태는 ask된다. 그래서 `${CLAUDE_PLUGIN_ROOT}` 형태가 나오려면 모델이 스킬 문구를 그대로 옮겨야 한다. 스킬이 정의한 단축형을 셸 함수로 만들면 (`mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }; mis browse cdp X.y`) guard가 allow. 따옴표 없는 절대 경로 함수는 ask | hook JSON으로 `scripts/guard.mjs` 실행 | `scripts/lib/shell.mjs` 함수 본문 추출(`${…}`의 `}`에서 끝남, 138행 부근) → `policy.mjs misSub` |
| D6 | LOW | `back`/`forward`/`reload`의 출력 URL이 한 단계 늦다 (상태는 올바름). D1과 같은 원인으로 추정 | second.html에서 `back` → "Back to …/second.html", 이어서 `url` → `/` | `actions.mjs history()`, `reload` |
| D7 | LOW | shutdown 뒤 `team status`가 작업 `in_progress`, 워커 `running`으로 표시 | SLEEP 작업 2개 → shutdown → status | `commands-team.mjs status()` |
| D8 | LOW | companion이 디렉터리 안의 심볼릭 링크를 따라가 디렉터리 밖 파일을 보여 준다 | `ln -s ../secret.txt mock/link.html` → 내용이 그대로 나옴 | `companion-server.mjs` (realpath 검사 없음) |
| D10 | LOW | `stop` 뒤 Chrome 프로필 임시 디렉터리가 간헐적으로 남는다 (약 6 MB씩) | 긴 세션 뒤 `mis browse stop` → `$TMPDIR/mis-browse-profile-*` 남음 (2건 관찰, 다시 3번 시도했을 때는 재현 안 됨) | `browser.mjs close()` (Chrome 헬퍼가 rmSync 뒤에 다시 쓰는 것으로 추정), 데몬 `shutdown`의 `.catch(() => {})` |
| D11 | LOW | 브라우저 통합 테스트가 임시 디렉터리를 정리하지 않는다 | `npm test` 뒤 `$TMPDIR/mis-browse-home-*`, `mis-browse-out-*` 증가 | `tests/integration/mis-browse.test.mjs:16,27` |
| D12 | LOW | 스킬의 단축형 안내(`mis` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"`)를 따라 에이전트가 `$M` 변수를 만들면 zsh에서 exit 127 (dogfood 2회 모두 첫 시도 실패) | dogfood transcript | `skills/browse/SKILL.md` 1행 |
| D9 | LOW | 문구 다듬기: `team start` 출력이 override를 써도 `"worker": "claude"`로 표시; `session --tmux`의 BLOCKED 문구가 "run the team with … subagents"라고 안내; 스킬의 "100–200 ms"는 node 기동을 포함하면 230–660 ms | 위 실행 출력 | `commands-team.mjs`, `skills/browse/SKILL.md` |

## 미검증

- handoff 창의 육안 확인 (보이는 Chrome 창이 실제로 뜨고 조작할 수 있는지) → NEEDS_HUMAN.
- 기본 `workerArgv('claude')` 그대로의 실제 워커 실행 (`--max-turns`가 없어 실행 횟수를 제한할 수 없음). `--max-turns 8`을 더한 같은 인자로만 1건 확인했다.
- codex/gemini 워커 실행 (금지 사항이라 하지 않음; guard ask만 확인).
- Linux/Windows의 Chrome 탐색, `DISPLAY`가 없을 때의 handoff BLOCKED.
- 실제 외부 사이트 (금지 사항이라 `.test` 매핑으로 대신함).
- benchmark 회귀 기준(+50%/+25%)은 스킬 문구만 확인. 자동 비교 명령은 없고 에이전트가 판단한다.

## 남은 위험

- `upload`, `fill`, `goto`는 원격 사이트에서도 묻지 않는다. 예를 들어 `upload '#f' ~/.ssh/id_rsa`는 guard가 allow한다. 브라우저가 원래 하는 일이지만, 조직 정책(내부 데이터의 외부 전송 금지)에는 맞지 않을 수 있다.
- 데몬이 `kill -9`로 죽으면 다음 `mis browse` 호출 전까지 고아 Chrome이 남는다. 다음 호출이 없으면 계속 남는다.
- 데몬 idle 30분, companion idle 4시간 동안 프로세스가 남는다.
- 추적되지 않는 파일(사용자 전역 훅이 만드는 `.omc/`, 빌드 산출물 등)이 하나라도 있으면 `team shutdown`이 그 worktree를 남긴다. OMC를 함께 쓰는 사용자는 자동 정리를 사실상 받지 못한다 (데이터 보존 쪽이라 안전하지만 수동 정리가 필요).
- ADR-0003은 "외부 사이트 요청"도 매번 ask한다고 적었다. 이 규칙은 자격 증명 기능(M9) 문맥이라고 해석했으며, 현재 `mis browse goto https://…`는 allow다. 해석이 다르면 결함이 된다.
- 팀 워커는 `--allowedTools Bash` 전체에 acceptEdits로 돈다. guard 훅이 주 방어선이어서 D5 같은 guard 파서 허점이 워커에도 그대로 적용된다.
