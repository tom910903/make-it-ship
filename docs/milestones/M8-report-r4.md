# M8 4차 독립 검증 (round 4)

- 대상: `/Users/mason.lee/Dev/Git/tools/mis-v8`, 통합 HEAD `0c5b755` (merge m8-r3: `13c61f0`, `800a7c0`, `1e820b1`, `c3fcd00`, `b5c2ae2`, `ddc81fc`, `99a96bf`, `b451dde`). 검증자는 구현에 관여하지 않았다. 아래 수치는 모두 이번 회차에 직접 실행한 결과다.
- 환경: macOS, Chrome 156(headless), LAN IP `10.10.77.78`(en0, `ipconfig getifaddr en0`), IPv6 link-local `fe80::c3b:3803:ab61:3f0%en0`. 인터넷 호스트에는 접속하지 않았다. `TMPDIR`·`MIS_STATE_HOME`는 `/private/tmp/claude-501/v8-tmp` 아래.
- 방법: `VERIFIER_PROMPT.md`의 절차와 guard 결함 분류 (a)(b)(c)를 적용했다.

## 판정: **PASS** (결함 0건, 남은 위험 1건 추가)

R3-1~R3-4와 `_render-pdf` 항목은 모두 고쳐졌다. 로컬 전용 모드에서 유출 경로 24개를 직접 만든 수신기로 측정했고, 받은 바이트는 모두 0이었다. 같은 하네스를 일반 모드(`--remote`)로 돌린 대조군에서는 20개 경로가 실제로 수신기에 닿았다. 데몬 상태 파일을 위조하면 guard 질문은 생략되지만 파일은 나가지 않는다(데몬이 거부함).

새로 찾은 것은 하나다. `MIS_BROWSER=<래퍼> mis pdf`처럼 `mis browse`가 아닌 명령이 브라우저 데몬을 띄우면 guard가 실행 override를 보지 않는다(실측: DevTools TCP 포트가 열림). 분류 기준 (a)(b)(c)에 해당하지 않아 "남은 위험"으로 적었다. 분류 근거는 아래에 있다.

## 실행 명령과 수치

| 항목 | 결과 |
|---|---|
| `npm test` 1회차 | tests 759 / pass 759 / fail 0 / cancelled 0 / skipped 0 / todo 0, 541 s, exit 0 |
| `npm test` 2회차 (flake 확인) | 759 / 759 / 0 / skipped 0, 358 s, exit 0, `not ok` 0건 |
| `claude plugin validate .claude-plugin/plugin.json` | `✔ Validation passed` |
| `claude plugin validate .` (marketplace.json) | `✔ Validation passed` |
| 스텁·skip grep (`TODO|FIXME|.skip(|.only(|skip:|not implemented|todo(`) | M8 범위 0건. 걸린 것은 상태값 `'TODO'`, lint 문구, M9의 `shortcut:` 주석 2개(ios, design)뿐 |

참고: PROGRESS RISKS에는 "A6 uninstall은 경로에 `make-it-ship`이 없으면 실패한다"고 적혀 있다. 그런데 이 worktree(`mis-v8`)에서는 두 회차 모두 통과했다. 문서가 실제 동작보다 낡은 것으로 보이며, 결함은 아니다.

## R3 항목 재검증

| ID | 원래 내용 | 이번 결과 | 판정 |
|---|---|---|---|
| R3-1 | SW·SharedWorker·다른 로컬 문서로 이동·closetab/goto 때 pagehide로 업로드 파일 유출 | 로컬 전용 모드에서는 모든 경로가 0 B다(아래 측정 표). 일반 모드에서 `--remote` 없이 `upload`하면 데몬이 거부한다(`upload without --remote runs only in the local-only browser…`). 단독 upload, inline chain, chain 파일, tab-each 모두 확인했다. 거부 뒤 `f.files.length`=0 | **고쳐짐** |
| R3-2 | WebRTC STUN/TURN UDP가 막히지 않음 | 로컬 전용: TURN/UDP·STUN·TURN/TCP 0 B. 대조군에서는 UDP 8개 패킷(192 B), TURN/TCP 28 B가 도착했다. PROGRESS FIXES에도 기록돼 있음 | **고쳐짐** |
| R3-3 | 원문 정규식 guard 우회 4종, 거부 목록 방식 플래그 필터 | 우회 4종(`env MIS_BROWSE_CHROME_""ARGS`, `ARG\S`, `'MIS_BROWSER'=`, `MIS_BROWSER$'_EXE'`)이 모두 **ask**다. `set -a`, `export`, `declare -x`, `typeset -x`, 함수, `bash -c`, `sudo`, `env -S`도 ask다. 플래그는 허용 목록 방식이며, 요청받은 6종을 포함한 위험 플래그가 모두 거부된다(아래 표) | **고쳐짐** |
| R3-4 | 정렬 3px 한도에서 점수가 절벽처럼 떨어짐 | ±8px에서 정확한 값을 확인했다(아래 표). 단위 테스트도 `assert.equal`로 95/92/94/69를 단언한다 | **고쳐짐** |
| (병합) `_render-pdf` | `b.blocked` 검사가 없었음 | `daemon.mjs`의 `failIfBlocked(browser, seen, 'pdf', …)`. 통합 테스트(50 ms마다 POST하는 보유 페이지 + `mis pdf` → 실패)가 두 회차 모두 통과했다. 정상 `mis pdf`는 `%PDF-` 1쪽을 만든다 | **고쳐짐** |

이전 회차 항목 회귀 점검 (직접 실행):
- R2-1: 로컬 전용 모드에서도 `file://` 폼의 action이 원격(`10.10.77.78`)이면 upload가 거부된다(보조 방어 유지). 로컬 페이지의 정상 upload는 확인 없이 된다(`Uploaded 1 file(s)`).
- R2-3/D2: 일반 모드 Chrome 프로세스 트리의 TCP LISTEN 수는 0이다.
- R2-5 계열의 gate: 원격으로 매핑된 `localhost.`, `x.localhost.`, `0.0.0.0` 페이지에서 `js`를 실행하면 `non-local page` 거부가 난다(로컬 판정과 rules 허용 판정이 일치함).
- `connect`는 로컬 전용에서 거부된다. `start --local-only`를 다시 부르면 같은 pid가 유지되고, `start`(일반)는 모드를 바꾸며, `restart`는 local-only를 유지한다.

## 유출 측정 (과제 2)

수신기: 직접 작성한 `site.mjs`(scratch). 구성은 다음과 같다.
- `10.10.77.78`의 TCP·UDP 수신기
- `fe80::…%en0`의 TCP 수신기
- mDNS 관찰기: 224.0.0.251:5353에 가입해, 질의 이름에 `secret`이 들어간 것을 기록. LAN 멀티캐스트라 인터넷은 쓰지 않음

공격 페이지는 loopback(`127.0.0.1`)에 둔다. 각 공격은 원격으로 보내기 직전에 loopback으로 marker를 보낸다. marker가 도착한 것을 확인해 공격이 실행됐음을 증명한 뒤 2.5초 더 기다려 측정했다.

목적지는 다섯 가지 형태로 동시에 시도했다:
- `http://10.10.77.78:P`
- `http://TC-M-20-0013.local:P` (mDNS 이름. nip.io 대신 인터넷 없이 해석되는 외부 이름으로 사용)
- `http://168447310:P` (10진수 IP)
- `http://[::ffff:10.10.77.78]:P`
- `http://[fe80::…]:P`

파일 내용은 `SECRET-TOKEN-42`다. 로컬 전용 모드는 `upload`(확인 없음), 대조군은 일반 모드 `upload --remote`로 붙였다.

| 경로 | 로컬 전용: 수신 바이트 (marker) | 대조군(일반 + `--remote`): 수신 |
|---|---|---|
| Service Worker POST | **0** (worker ✓) | 1365 B, 비밀 3건 |
| SharedWorker POST | **0** (worker ✓) | 1365 B, 3건 |
| 다른 로컬 문서로 이동 (sessionStorage) | **0** (moved ✓) | 1362 B, 3건 |
| 다른 로컬 문서로 이동 (?query) | **0** (moved ✓) | 1362 B, 3건 |
| fetch POST | **0** (click이 blocked 보고) | 1362 B, 3건 |
| sendBeacon | **0** (blocked 보고) | 1365 B, 3건 |
| WebSocket | **0** | 1689 B, URL에 hex 비밀 3건 |
| WebRTC TURN/UDP + STUN | **0** | UDP 192 B (8 패킷) |
| WebRTC TURN/TCP (신규) | **0** | 28 B |
| WebTransport / QUIC UDP (신규) | **0** | UDP 6250 B |
| `<img>` GET (신규) | **0** | 2148 B, 2건 |
| CSS `url()` (신규) | **0** | 898 B, 2건 |
| `<link rel=prefetch>` (신규) | **0** | 1096 B, 2건 |
| `<link rel=preconnect>` (신규) | **0** | 0 B (대조군에서도 관측 안 됨) |
| dns-prefetch / preconnect / fetch를 `secret<hex>.local`로 (DNS 이름 유출, 신규) | **0**, mDNS 질의 0 | mDNS 질의 2건 |
| form GET 이동 (신규) | **0** | 1014 B, 2건 |
| `window.open` (신규) | **0** | 1008 B, 2건 |
| iframe (신규) | **0** | 1656 B, 3건 |
| top-level `location=` 이동 (신규) | **0** | 1012 B, 2건 |
| EventSource (신규) | **0** | 1395 B, 3건 |
| pagehide beacon + keepalive, `closetab` | **0** (pagehide ✓) | 2739 B, 6건 |
| pagehide, `goto` ×3 | **0 / 0 / 0** | 2739 B ×3 |

- 대조군에서 IPv6 link-local(zone 없는 URL)과 `[::ffff:…]`, `.local` 형태가 실제로 닿았는지는 수신 기록상 구분되지 않는다. 기록에는 `lan4` 경로만 있다. 즉 이 세 형태는 일반 모드에서도 Chrome이 연결하지 못했을 수 있다. 로컬 전용 모드의 0 B는 IP 형태로 증명된다.
- 사용자 지정 rules로 만든 변형도 시험했다. `MIS_BROWSE_CHROME_ARGS`로 `MAP localhost. / x.localhost. / [::ffff:127.0.0.1] / 0.0.0.0 → 10.10.77.78`을 주면 데몬 허용 목록을 통과한다. 그러나 로컬 전용 모드에서 이 이름으로 `goto`하면 모두 연결 실패였고 수신 0 B였다. 일반 모드에서는 연결된다(대조군).

## Guard (과제 3)

### 일반 모드 upload의 ask 행렬

`classify` 직접 호출, 로컬 전용 데몬 없음. 조합은 `shell.test.mjs`의 WRAPPERS 21종 × CONTAINERS 16종 = 336개다(MORE_* 포함).

| 명령 | ask |
|---|---|
| `browse upload '#f' secret.txt` | 336/336 |
| `browse upload @e3 a.txt b.txt` | 336/336 |
| `browse tab-each upload …` | 336/336 |
| `browse upload … --remote` / `browse --remote upload …` | 336/336 / 336/336 |
| `mis browse upload …` | 336/336 |
| inline chain `'[[…,["upload",…]]]'` | 279/336 (주1) |
| 함수 `mis(){…}`, `f(){… upload "$@";}`, `up(){… tab-each upload …;}` | ask |
| chain 파일 / `cat chain.json \| … chain -` | allow (문서화된 한계) |

데몬은 위 allow 경우와 형태 모두를 거부한다(실측): chain 파일, inline chain, tab-each 모두 `upload without --remote runs only in the local-only browser`.

주1: 걸리지 않은 57개는 모두 작은따옴표 컨테이너(`bash -lc '…'`, `sh -e -c '…'`, `bash -o pipefail -c '…'`) 안에 작은따옴표 JSON을 넣은 형태다. bash에서 실제로 실행하면 따옴표가 풀려 JSON이 깨진다. 같은 컨테이너에 큰따옴표 JSON을 넣으면 63/63 ask다. 즉 테스트 생성기가 만든 가짜 형태이고 결함이 아니다.

### 로컬 전용 데몬이 실행 중일 때

| 명령 | 결정 |
|---|---|
| `upload`, `tab-each upload` | allow (설계대로) |
| `upload --remote` | ask |
| `MIS_BROWSE_CHROME_ARGS=… browse upload` | ask |

### 실행 override env

| 명령 | 결정 |
|---|---|
| env 접두(`MIS_BROWSE_CHROME_ARGS='--lang=en' … browse goto`), `export …;`, `set -a; MIS_BROWSER=…;`, `MIS_BROWSER=…; export MIS_BROWSER;`, `declare -x`, `typeset -x` | ask |
| R3 우회 4종, `sudo VAR=…`, `env -S 'VAR=…'`, `bash -c '…'`, 함수 안 env, `… && mis browse status` | ask |
| `MIS_BROWSER_EXE=… mis canary …` | ask |
| `MIS_BROWSER_EXE=…`·`MIS_BROWSER=…`·`MIS_BROWSE_CHROME_ARGS=… mis pdf doc.md`, `MIS_BROWSER_EXE=… mis pair start` | **allow** (남은 위험 N1) |

### `chromeArgs()` 허용 목록

| 구분 | 플래그 |
|---|---|
| 거부 | `--remote-debugging-port=0`, `--disable-web-security`, `--user-data-dir=…`, `--load-extension=…`, `--proxy-server=…`, `--host-resolver-rules=MAP * 10.10.77.78`, `MAP localhost 10.10.77.78`, `MAP LOCALHOST …`, `MAP 127.0.0.2 …`, `MAP 127.1 …`, `MAP 2130706433 …`, `MAP [::1] …`, `MAP app.localhost …`, `EXCLUDE …`, `--no-sandbox`, `--ignore-certificate-errors`, `--renderer-cmd-prefix`, `--headless=old`, `--disable-features`/`--enable-features`, `--remote-debugging-pipe` |
| 거부 (끼워 넣기·대소문자 형태) | `--lang=en --remote-debugging-port=1`, 따옴표 안에 끼운 형태, 탭으로 구분한 형태, `--HOST-RESOLVER-RULES=…` |
| 허용 | `--lang`, `--window-size`, `--disable-gpu`, `MAP foo.test 10.10.77.78[:80]`, `MAP *.test 127.0.0.1`, `MAP foo 127.0.0.1:9` |
| 허용 (해롭지 않음을 실측) | `MAP localhost. …`, `MAP x.localhost. …`, `MAP 0.0.0.0 …`, `MAP [::ffff:127.0.0.1] …`, `MAP localhost.localdomain …`. 데몬이 이 이름들을 비로컬로 판정하고(js 거부), 로컬 전용 모드에서는 연결되지 않음 |

## 상태 위조 (과제 4)

1. 일반 모드 데몬을 띄운 상태에서 `state.json`의 `localOnly`를 `true`로 고쳤다.
2. guard 판정이 `ask`에서 `allow`로 바뀌었다(질문 생략).
3. `upload '#f' secret.txt` 실행 결과는 exit 1이었다. 데몬이 `upload without --remote runs only in the local-only browser`로 거부했다.
4. 이어서 `click`(fetch POST)을 했고 수신기에는 `{"got":[]}`, 0 B가 기록됐다. `browse status`는 `localOnly: false`였다.

데몬은 상태 파일이 아니라 자기 argv(`--local-only`)로 만든 sink 소켓 유무로 판단한다. 따라서 위조로 얻는 것은 질문 생략뿐이다. PROGRESS RISKS의 서술과 일치한다.

다른 경로도 확인했다:
- 명령줄에서 데몬을 재시작하는 경우: `start`가 모드 불일치면 현재 env로 다시 띄우므로, 로컬 전용 데몬에 래퍼나 플래그를 몰래 넣을 수 없다.
- `browse start`/`restart`에 env를 붙이면 guard가 ask한다.

## visual-verdict · pdf · team · companion (과제 5)

### 합성 이미지 400×300 정확값 (`compareImages`, 기본값)

| 이동 | 0 | 1 | 2 | 3 | 5 | 6 | 7 | 8 | 9 | 10 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dy | 100 | 99 | 98 | 97 | 95 | 94 | 93 | **92** | 87 | 82 | 74 |
| dx | 100 | 99 | 98 | 97 | 95 | 94 | 93 | 92 | 88 | 85 | 79 |
| 대각선 | 100 | 98 | 96 | 94 | 90 | 88 | 86 | 84 | 76 | 69 | 57 |

- 높이 차와 이동을 함께 준 경우: +4/2 → 98, +12/6 → 94, +16/8 → 92, +20/10 → 52, +30/15 → 38.
- px당 1점, 8px 92점 등 커밋과 PROGRESS의 서술과 일치한다. 9px 이상은 절벽이 아니라 서서히 내려간다.
- 단위 테스트는 정확값을 단언한다(95, 92, 94, 69, shift 객체까지).

### pdf
- `mis pdf doc.md -o out.pdf`의 결과는 pages 1, 파일 앞부분 `%PDF-`.
- 보유 페이지가 원격으로 요청을 보낸 경우의 pdf 실패는 통합 테스트로 확인했다(통과).

### companion
- `start cdir`를 실행하면 key가 붙은 URL이 나오고, `curl`로 열면 HTML을 돌려준다.
- `stop` 뒤 `status`는 `running:false`다.

### team
- 사용법이 정상 출력된다.
- 실제 tmux 워커 실행은 외부 CLI 금지 규칙 때문에 직접 하지 않았다. 대신 `npm test`의 "real tmux: a failing task is reported, the team still completes"와 "start without tmux reports BLOCKED"가 두 회차 모두 통과했다.

## 결함 목록

없음.

## 남은 위험

- **N1 (분류: 남은 위험, 심각도로 치면 LOW)**: guard는 브라우저 실행 override(`MIS_BROWSER`, `MIS_BROWSE_CHROME_ARGS`)를 `mis browse` 명령에 대해서만 본다. 그런데 `mis pdf`(`_render-pdf`), `mis pair`(pair-server)도 같은 데몬을 `ensureDaemon`으로 띄운다.
  - 재현: `MIS_BROWSER=/tmp/wrap.sh node scripts/mis.mjs pdf doc.md`(래퍼가 Chrome에 `--remote-debugging-port=9399`를 붙임) → guard **allow** → `lsof`에 `127.0.0.1:9399 (LISTEN)`이 보이고, `/json/version`이 `Chrome/156…`로 응답한다. 이 데몬은 계속 남아 이후 `mis browse` 명령도 래퍼 브라우저로 처리된다(`status.browser`가 wrap.sh).
  - `MIS_BROWSE_CHROME_ARGS`는 데몬이 허용 목록을 다시 적용하므로 피해가 제한된다. `MIS_BROWSER_EXE`는 client가 덮어써서 효과가 없다.
  - 업로드 유출로는 이어지지 않는다. 일반 모드라 upload는 ask이고, `start --local-only`는 현재 env로 다시 띄운다.
  - 위치: `scripts/lib/policy.mjs` `browserLaunchOverride`(`if (mis?.[0] !== 'browse') return allow;`).
  - 분류 근거: README가 이 검사의 범위를 "for a `mis browse` command"로 명시한다. Spec §7 표의 행이 아니고(a), 스킬이 지시하는 형태가 아니며(b), shell 행렬의 명령 종류도 아니다(c). 그래서 결함이 아니다. 다만 의도적 난독화가 아닌 기본 형태이므로 `pdf`와 `pair`도 같은 검사에 넣기를 권고한다.
- 로컬 전용 모드에서도 loopback은 열려 있다. 로컬 서비스를 통한 중계는 기존 RISKS에 기록돼 있다.
- chain 파일 안의 upload는 guard가 보지 못한다(문서화됨). 데몬 거부로 막히는 것을 실측했다.
- 대조군에서 `preconnect`가 수신기에 닿지 않았다. 따라서 로컬 전용에서 preconnect 0 B는 증거로 약하다. 다만 DNS 쪽(mDNS 질의)은 대조군 2건 대 로컬 전용 0건으로 차이가 측정됐다.

## 프로세스 정리

- 내가 띄운 것만 정리했다: `site.mjs`(PID 파일로 kill), 브라우저 데몬(`mis browse stop`, 모든 모드 전환 뒤와 마지막), companion(`stop`).
- 다른 worktree와 다른 검증자의 프로세스는 건드리지 않았다.
- 저장소 변경은 이 파일을 만든 것뿐이다. 커밋하지 않았다.

ROUND4: PASS
