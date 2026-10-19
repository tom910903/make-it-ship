# M5 독립 검증 보고서 (2026-10-19)

검증자는 구현에 참여하지 않았다. `docs/PROGRESS.md`, `M5-e2e.md`, 커밋 메시지는 참고만 했고, 모든 항목을 직접 다시 실행해 확인했다. 대상은 `develop` 브랜치, HEAD `5820b7f`다.

## 1. 요약 판정

**DEFECTS FOUND**

- M5의 코드 기능(retro, learn, second-opinion detect, bench, BSP 탐지·필수화, HUD 비용 표시, bridge 템플릿)은 테스트와 실사용에서 모두 동작했다.
- **D-1 (MEDIUM)**: AC 문구 그대로 판정해도 실패다. `mis ios bridge-scan`이 앱 저장소에 복사된 브리지 패키지(소스·의존성 선언)를 찾지 못한다. 그래서 브리지 코드가 남아 있는데도 `mis ship`이 READY / VERIFIED를 낸다.
- **D-2 (MEDIUM)**: 연결 누락으로, AC 정의의 충실성 판단에 해당한다. iOS 실기기 브리지와 `mis ios devices`, `mis ios bridge-scan`이 스킬·phase·에이전트·README 어디에도 연결되어 있지 않다. `mis ios devices`를 직접 실행하면 BLOCKED를 출력하지만, run 흐름에서는 이 명령에 도달하지 않는다.
- 이 밖에 LOW 결함 7건이 있다(§7).

## 2. 실행한 명령과 결과 수치

| 명령 | 결과 |
|---|---|
| `npm test` | tests 313, pass 313, fail 0, skipped 0, todo 0 (EXIT 0) |
| `claude plugin validate .` | ✔ Validation passed |
| 스텁 검사 `grep -rnE "TODO\|FIXME\|\.skip\|\.only\|not implemented\|todo\(" scripts skills agents hooks tests templates evals adapters` | 걸린 곳은 모두 task 상태 문자열 `'TODO'`다. 스텁·skip은 없다 |
| headless Standard run (stream-json) 2회(승인 전 / 승인 후 재개) | 승인 단계에서 정지했다. 운영자(검증자)가 터미널에서 `mis approve plan`을 실행했고, 재개한 run이 VERIFIED로 보고했다 |
| headless `/make-it-ship:retro` (stream-json) | 지표가 독립 재집계 결과와 일치했다(§6) |
| iOS SDK 타입체크·심볼 | DEBUG / non-DEBUG 모두 rc=0. Release 심볼 0개, DEBUG 심볼 60개 |

## 3. 종료 기준(AC)별 판정 — PROGRESS "## M5 — 확장"

| AC | 판정 | 증거 |
|---|---|---|
| M5-01 retro | **PASS** | `scripts/lib/retro.mjs`, `commands.mjs:601`. 테스트 `mis-retro.test.mjs`는 합성 run 2개로 판정 분포, 실패→통과, 재시도, 차단 사유, 리뷰 blocking 값을 단언한다(동어반복 아님). 실사용: run 3개를 headless로 회고했고 6/1/0, 실패→통과 1, 재시도 1, 원인 기록 1, 중앙값 3.4분이 독립 재집계(`xcheck.mjs`)와 일치했다. 회고는 `retro-2026-10-19.md`만 만들었고 HEAD와 프로세스 파일은 그대로였다. 보조 결함은 L-5 |
| M5-02 learn | **PASS** (보조 결함 L-4) | `learn.mjs`. 실사용 결과: 잘못된 type, key, confidence, source, 알 수 없는 키, 비JSON은 모두 rc=1로 거부됐다. 같은 key는 최신 기록이 우선했고 jsonl은 3줄 그대로 남아 추가 전용이었다. 참조 파일을 삭제하자 `list`에서 `stale:false→true`로 바뀌었다. 단, `learnings.md`는 다음 `add` 때까지 갱신되지 않는다 |
| M5-03 second opinion | **PASS** (보조 결함 L-1) | `detect`에서 이 환경은 `available: []`였다. 테스트는 PATH에 가짜 codex를 두고 탐지하고, 노트가 판정 사유를 바꾸지 않으며 보고서에 표시되는지 확인한다. guard는 활성 run이 있을 때 `codex exec …`, `codex review`, `gemini -p`, `timeout 300 codex exec`, `git diff \| codex exec -`, `env FOO=1 codex exec`, `bash -c "codex exec x"`, `omc ask codex`에 모두 **ask**를 냈고, `codex --version`은 allow였다. 외부 모델은 실제로 호출하지 않았다(사내 정책) |
| M5-04 iOS 실기기 브리지 | **FAIL** (D-1, D-2) | 템플릿 불변식(`#if DEBUG`, 127.0.0.1 바인딩)과 SDK 타입체크는 통과했다. 앱 코드의 `import DebugBridge`가 남아 있으면 ship은 `ready:false, PARTIAL`이었다. 그러나 `Packages/DebugBridge`(Package.swift, Sources)가 남아 있거나 앱 `Package.swift`에 `.package(path: "Packages/DebugBridge")`, pbxproj에 `XCLocalSwiftPackageReference`가 남아 있어도 scan은 `clean:true`, ship은 `ready:true, VERIFIED`였다. 실기기 동작 자체는 NEEDS_HUMAN이다 |
| M5-05 BSP QA | **PASS** (보조 결함 L-3) | 합성 Yocto(`oe-init-build-env`, `meta-foo/conf/layer.conf`)와 커널(`Kbuild`, `Kconfig`, `arch/`) 트리에서 `build-bsp`를 제안하고 타깃 검증이 필요하다고 안내했다. 커널 트리에서 Standard run을 끝까지 진행했다(critic → 승인 → task → `check build-bsp` PASS → spec·quality 리뷰). 판정은 `PARTIAL`, 사유는 "required check qa-bsp is not run"이었다. 즉 타깃 check 없이는 VERIFIED가 될 수 없다(`commands.mjs:384`) |
| M5-06 bench | **PASS** | 실사용 결과: BASELINE 120ms, 이어서 OK(0%), SLOW 파일을 두면 420ms·+250% REGRESSION이 나왔고 보고서에 "성능 회귀: perf 중앙값 120ms → 420ms (+250%)"가 실렸다. `--runs 0`은 usage 오류, 정의되지 않은 check는 오류였다 |
| M5-07 토큰 예산 | **PASS** | statusline에 `cost.total_cost_usd: 1.2345`와 `workspace.current_dir`를 넣으면 `… · PARTIAL · $1.23`이 나왔다. cost가 없으면 비용을 표시하지 않았다. 문자열 cost와 run 없음은 빈 출력, 깨진 stdin은 빈 출력·rc 0이었다. doctor의 `token-budget` 경고, `templates/report.md:42`, README:68에 "미지원"이 명시되어 있다. 실제로 생성된 보고서(bench 데모 48행, demoA 60행)에도 이 문구가 들어 있다 |
| M5-08 Codex 어댑터 | **PASS** (보조 결함 L-6) | 실제 mis 명령과 대조했다: `status --json`, `approve plan`·`approve continue`, `review add` 엄격 헤더(BLOCKING/MAJOR), `interview add`·`resolve`, `note rootcause`, `task retry`가 모두 존재했다. 나열된 phase 파일 12개도 모두 존재했다. guard가 강제되지 않는다는 점도 명시되어 있다. 테스트(`plugin-files.test.mjs:127`)는 전체 경로가 적힌 phase 1개(discover)만 검사한다 |
| M5-09 E2E 기록 | **PASS** | 인용된 증거 파일 `evidence/m5/retro-pilot2.md`, `retro-final-message.txt`가 존재한다. `M5-e2e.md`의 주장(SDK 26.0 DEBUG 타입체크, Release 심볼 0, devices 없음)을 직접 재현했다. 실기기와 외부 모델 항목은 NEEDS_HUMAN으로 남아 있고 통과로 적지 않았다 |

### AC 정의의 충실성 (Spec §11 M5, §14.2)

- §11 M5 범위 8개 항목이 M5-01~08에 1:1로 대응한다. Spec 결정을 바꾼 부분은 없다.
  - 토큰 예산은 §3-4에 따라 "미지원"으로 보고한다.
  - ship은 §14.2 "PARTIAL"과 AC "NOT READY"를 함께 만족한다.
- §14.2 retro/learn의 "events.jsonl 집계, learnings.md, 프로세스 변경은 승인 후"는 M5-01·02에 반영되어 있다.
- §14.2 second opinion의 "설치 시 선택적 재리뷰"는 M5-03에 반영되어 있다.
- §14.2 ios M5의 "DEBUG 한정 브리지로 실기기 상태 조회·스크린샷, ship PARTIAL, 실기기 없으면 BLOCKED"는 M5-04에 반영되어 있다.
- **누락**: AC가 기능이 실행 흐름(phase·스킬)에서 쓰이는지를 요구하지 않는다. 그래서 D-2(브리지·기기 검사 미연결)가 DONE으로 통과했다.
- **SPEC_CHANGES "guard가 다른 모델 CLI 호출 전에 ask" 판단**: 이 해석은 충실하다. §7의 "외부 쓰기·원격 쓰기 → ask" 행을 같은 성격(저장소 내용의 외부 전송)으로 확장한 것이고, PRD 8.1에도 부합한다. ask를 deny로 강화하거나 판정 규칙을 바꾸지 않았으므로 Spec 결정을 변경하지 않는다. 다만 §7 적용 범위("진행 중인 실행이 있을 때만")가 그대로 적용된다. 따라서 활성 run이 없으면 guard는 묻지 않는다. 이 사실이 사용자 안내 문구에는 반영되지 않았다(L-1).
- **해석 차이**: M5-05 AC는 타깃 검증을 "BLOCKED"라고 한다. 실제 판정은 `qa-bsp MISSING` 때문에 PARTIAL이다. VERIFIED가 불가하다는 핵심은 지켜지므로 결함으로 보지 않는다.

## 4. 추적표 행별 (§2 MS=M5 행, §14.3 M5 명령)

| 행 | 판정 | 비고 |
|---|---|---|
| §2에 MS=M5인 행 | 해당 없음 | §2 표에 M5 행이 없다 |
| §14.3 `/make-it-ship:retro` (M5) | **PASS** | `skills/retro/SKILL.md`. headless 실행 결과는 §6 |
| §14.1 Full 모드의 retro/learn | PASS(문서) | `skills/run/SKILL.md:54,87`. Full run 실행은 하지 않았다 |
| §14.2 qa BSP 프로파일 | PASS(코드) / L-2 | `qa.md` 1단계 문구에 bsp가 빠져 있다 |

## 5. 스텁·skip 검사

`.skip`, `.only`, `FIXME`, "not implemented"는 0건이다. `TODO`가 걸린 곳은 모두 task 상태 값이다(`commands.mjs:152,309,512,550`, 테스트 픽스처). 빈 구현은 찾지 못했다.

## 6. 실사용 검증 기록

모든 실험은 저장소 밖 scratchpad의 데모 복사본에서 했다. 사전 사실이 하나 있다: `demoA` 경로에 이전 세션(11:27)이 남긴 run `20261019-1127-b0c8`(REPORTED, VERIFIED)와 `.make-it-ship.json`이 있었다. `setup-demo`는 그 위에 픽스처를 다시 커밋했다(`8741311`). 그래서 회고 대상은 run 3개다.

1. **Standard headless (stream-json)**: `/make-it-ship:run Implement docs/feature-request.md in Standard mode …`
   - interview(MED 3건) → plan → critic(ACCEPT 0/0) 순서로 진행했고, `mis approve plan`에서 guard가 ask를 냈다. headless라 확인할 수 없어 run이 정지했다(ADR-014에 따라 정상 동작).
   - 운영자가 터미널에서 승인한 뒤 `--resume`으로 이어갔다: T1~T3 → `check unit` PASS → spec PASS, quality SHIP → `report` VERIFIED.
   - 직접 `npm test`를 실행한 결과는 pass 4 / fail 0이었다.
   - **guard 개입**: 승인 ask 외에 deny가 1건 있었다. 대상은 `git ls-files && for f in $(git ls-files | grep -v '^\.git/make-it-ship'); …`, 즉 읽기 전용 명령이다. L-1에 기록했다. 재개 세션에서는 denial이 0건이었다.
   - **깨기**: `toLowerCase`를 `toUpperCase`로 바꾸자 npm test가 2건 실패했고, `mis verdict`가 PARTIAL(unit stale, 리뷰 missing)이 됐다. 원래 내용으로 복원하자 다시 VERIFIED였다.
2. **두 번째 run(Quick, mis 직접 실행)**: check FAIL → `task fail` → rootcause → retry → PASS → quality → report VERIFIED.
3. **`/make-it-ship:retro` headless**:
   - `mis retro` 지표를 그대로 인용했고, 지표에 근거한 습관 3개를 "판단"으로 구분해 제시했다. 학습 기록은 0건(기준 미충족)이었고 프로세스 변경 제안은 없었다. 새로 생긴 파일은 `retro-2026-10-19.md`뿐이다.
   - 독립 재집계(`xcheck.mjs`): runs 3, REPORTED 3, VERIFIED 3, checks 6, fail 1, blocked 0, 실패→통과 1, retry 1, rootcause 1, 소요 시간 [3.41, 5.14, 0.03]분이다. 중앙값 3.4가 일치한다.
   - guard deny 1건: `grep … .git/make-it-ship/runs/*/events.jsonl`. §7 기본 행("make-it-ship/runs" 포함 → deny) 그대로이므로 결함이 아니다.
4. **learn / bench / BSP / HUD**: §3 표의 해당 행 참조.
5. **iOS**:
   - `xcrun --sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios16.0-simulator [-D DEBUG]`는 둘 다 rc=0이었다.
   - `-emit-library` 후 `nm -j`로 보면 Release의 DebugBridge 심볼은 0개, DEBUG는 60개다.
   - `mis ios devices` → `{devices: [], blocked: "no connected iOS device …"}`
   - bridge-scan과 ship 결과는 D-1 참조.
6. **second opinion**: `detect` → `[]`. guard 판정은 §3 M5-03 행 참조. 활성 run이 없으면 `codex exec`가 allow다(L-1 참조).

## 7. 결함 목록

| ID | 심각도 | 내용 | 재현 | 위치 |
|---|---|---|---|---|
| D-1 | MEDIUM | bridge-scan 정규식(`import DebugBridge\|DebugBridge\.start\|DebugBridgeManager`)이 브리지 패키지 자체의 소스(`public enum DebugBridge`), `Package.swift`의 `.package(path: "Packages/DebugBridge")`, pbxproj의 `XCLocalSwiftPackageReference`를 잡지 못한다. 템플릿 README의 제거 2~3단계(의존성 제거, 폴더 삭제)를 기계로 확인할 수 없다. 테스트는 앱 코드에 연결된 형태만 다룬다 | 복사한 폴더가 잡히는 경우는 README 본문의 예시 코드가 우연히 정규식에 맞을 때뿐이다(README를 남기는 것은 해결책이 아니다). 앱 저장소에 템플릿을 `Packages/DebugBridge`로 복사하고(README.md는 제외) 앱 코드 연결만 지운다 → `mis ios bridge-scan` = `clean:true`, `mis ship` = `ready:true, VERIFIED` | `scripts/lib/ios.mjs:9`, `tests/integration/mis-ios.test.mjs:26` |
| D-2 | MEDIUM | 브리지 템플릿, `mis ios devices`, `mis ios bridge-scan`이 `skills/`, `skills/run/phases/`, `agents/`, README, `adapters/codex/AGENTS.md` 어디에서도 언급되지 않는다. 실행 흐름에서 실기기 QA를 시도하거나 "기기 없음 → BLOCKED"를 기록할 경로가 없다. `render.mjs`와 `templates/report.md`에도 device/기기 관련 문구가 0건이다. README에는 bench, learn, BSP, second opinion, Codex 어댑터 설명도 없다 | `grep -rn -i "bridge\|ios devices" skills agents README.md adapters` → 0건. `grep -n -i 'codex\|adapter' README.md` → 0건 | `skills/run/phases/qa.md`, `ship.md`, README |
| L-1 | LOW | `review.md:27`과 `second-opinion detect`의 note는 "the guard asks the user first"라고 무조건 단정한다. 그러나 guard는 활성 run이 있을 때만 ask한다(§7 적용 범위). 그래서 run 없이 `/make-it-ship:review`에서 second opinion을 실행하면 `codex exec`가 확인 없이 허용된다. 외부 전송에 관한 사용자 안내가 사실과 다르다 | run 없는 저장소에서 guard에 `codex exec "review"` 입력 → allow | `scripts/lib/policy.mjs:75`, `commands.mjs:630`, `skills/run/phases/review.md:27` |
| L-7 | LOW (guard, 판정 기준 (b)) | 실사용 기록에 나온 읽기 전용 명령 `git ls-files \| grep -v '^\.git/make-it-ship'`이 deny됐다(오탐). §7 기본 행(`make-it-ship/runs`)보다 넓은 `BASH_STATE` 정규식(`\.git/…make-it-ship`) 때문이다. 이 정규식은 M1 L-5 수정 때 의도적으로 넓혔지만 PROGRESS RISKS에는 기록되지 않았다. 모델은 한 번에 우회해 진행했다 | 활성 run에서 guard에 위 명령 입력 → deny (`git status --porcelain \| grep -v make-it-ship`는 allow) | `scripts/lib/policy.mjs:13` |
| L-2 | LOW | `qa.md` 1단계가 감지 표면을 "(web, cli, api, ios)"로만 적어 bsp가 빠져 있다. 판정 강제는 `verdictContext`가 `qa-bsp`를 자동으로 필수에 넣으므로 동작한다 | 파일 확인 | `skills/run/phases/qa.md:7` |
| L-3 | LOW | BSP 제안 명령이 실제 트리에서 맞지 않는다. 커널은 `arch/`를 알파벳순으로 정렬한 첫 항목을 고르므로 실제 리눅스 트리에서는 `ARCH=alpha`가 된다. Yocto는 `oe-init-build-env`를 source하지 않고 `bitbake`를 spawn(shell 없음)하므로 실패한다. 설정 변경은 사용자가 확인하는 제안이라 영향은 제한적이다 | 실측: 커널 트리에 `arch/alpha`, `arch/arm64`, `arch/x86` 생성 → `mis qa detect`의 argv가 `["make","ARCH=alpha","-j8"]`. Yocto 실패는 코드 판독 결과다(bitbake가 없어 재현하지 않았다) | `scripts/lib/qa.mjs:79-85` |
| L-4 | LOW | `learnings.md`는 `add` 때만 다시 만들어진다. 참조 파일이 삭제된 뒤 `list`(JSON)에는 STALE이 나오지만 md에는 다음 add 전까지 나오지 않는다 | `learn add`(files 지정) → 파일 삭제 → `learn list`(stale:true), md에는 STALE 없음 | `scripts/lib/learn.mjs:34-48` |
| L-5 | LOW | 회고 문서의 "## 다음 습관" 절에 모델용 지시문("…모델 판단으로 덧붙인다(retro phase)")이 그대로 남는다. 실사용에서 모델은 습관을 채팅으로만 제시하고 문서에 쓰지 않았다(phase 2단계가 어디에 쓰라는지 모호하다). 짝수 개 run의 중앙값은 위쪽 값을 고른다 | headless retro 후 `retro-2026-10-19.md` 확인 | `scripts/lib/retro.mjs:62`, `skills/run/phases/retro.md:8` |
| L-6 | LOW | Codex AGENTS.md는 `$MIS_HOME/agents/<name>.md`를 안내하면서 이름을 "critic, spec, quality, security, product, qa-tester"로 나열한다. 실제 파일은 `spec-reviewer.md` 등이다. phase 파일의 `make-it-ship:<agent>` 표기로 추론할 수는 있다. 테스트는 phase 경로 1개만 검사한다 | `ls agents` | `adapters/codex/AGENTS.md`, `tests/unit/plugin-files.test.mjs:127` |

## 8. 미검증 항목 (NEEDS_HUMAN)

- NH-6 실기기 브리지(`/healthz`, `/state`, `/screenshot`, 터널): 기기가 없다. 참고로 `devicectl` 결과도 "기기 없음"이었다.
- NH-7 second opinion 실제 호출: 사내 데이터 정책 때문에 호출하지 않았다. guard 확인 창 자체도 대화형 확인이라 NEEDS_HUMAN이다.
- NH-8 Codex CLI로 어댑터 흐름 실사용.
- NH-9 실제 BSP 빌드와 타깃 검증.
- NH-3 HUD 비용 표시를 실제 상태 줄에서 보는 것(스크립트 출력만 확인했다).
- 대화형 승인 확인 창(NH-1): 이번 검증에서는 운영자가 터미널에서 직접 승인했다.
- Full 모드 run 끝의 retro 자동 실행은 실행해 보지 않았다.

## 9. 남은 위험

- guard 매트릭스 밖 형태: `npx @openai/codex exec …`는 allow다. 인자 없는 `codex`(대화형 TUI)도 allow다. 스킬이 지시하는 형태는 아니다.
- 활성 run이 없을 때는 외부 모델 호출에 guard가 개입하지 않는다(§7 적용 범위의 결과, L-1 참조). 사내 정책상 의미가 크므로 사람이 결정해야 한다.
- retro와 learn은 jsonl의 깨진 줄 하나에 `JSON.parse` 예외로 중단된다. `--days`에 숫자가 아닌 값을 주면 조용히 0개 run을 집계한다.
- `mis bench`는 활성 run을 확인하기 전에 명령을 N회 먼저 실행한다(결과는 기록되지 않는다).
- 회고 중에 모델이 `.git/make-it-ship/runs/*/events.jsonl`을 읽으려다 §7 규칙으로 deny됐다. 회고가 필요로 하는 세부 정보(어떤 check가 실패했는지 등)를 `mis retro` 출력이 주지 않아서 생긴 시도로 보인다.
- 브리지는 `#if DEBUG`로 감싸져 있어 Release 빌드에는 포함되지 않는다. 따라서 D-1이 실제로 배포물에 미치는 영향은 작다. 다만 AC가 정한 "코드가 남으면 NOT READY"는 지켜지지 않는다.

## 2차 검증 (round 2)

대상: `develop` HEAD `62903ab` (M5-fix). 1차 결함 D-1, D-2, L-1~L-7을 원래 재현 방법으로 다시 실행한다.

### R2-1. 기본 검사

| 명령 | 결과 |
|---|---|
| `npm test` | tests 317, pass 317, fail 0, skipped 0, todo 0 (EXIT 0) |
| `claude plugin validate .` | ✔ Validation passed |
| 스텁 검사(1차와 같은 grep, `adapters` 포함) | 걸린 곳은 task 상태 문자열(`'TODO'`, `commands.mjs:512` "next TODO task")뿐이다. `.skip`/`.only`/FIXME/not implemented는 0건이다 |

### R2-2. D-1 재검증 (bridge-scan / ship) — **해소**

scratchpad의 임시 저장소 3개에서 1차 재현을 그대로 다시 실행했다. 각 저장소에 남은 형태 하나를 커밋한 뒤 Quick run을 VERIFIED 조건까지 진행했다(task done, `check unit` PASS, quality 0/0). 그다음 `mis ios bridge-scan`과 `mis ship`을 실행했다.

| 남은 형태 | `mis ios bridge-scan` | `mis ship` |
|---|---|---|
| 템플릿을 `Packages/DebugBridge`로 복사(README.md 제외), 앱 코드 연결 없음 | `clean:false`, `Packages/DebugBridge/Package.swift`, `…/Sources/DebugBridge/DebugBridge.swift` | `ready:false, PARTIAL`, 사유 "iOS debug bridge code remains in …" |
| 앱 `Package.swift`에 `.package(path: "Packages/DebugBridge")` | `clean:false`, `Package.swift` | `ready:false, PARTIAL` |
| `App.xcodeproj/project.pbxproj`에 `XCLocalSwiftPackageReference "Packages/DebugBridge"` | `clean:false`, `project.pbxproj` | `ready:false, PARTIAL` |

- 대조군: 복사한 패키지를 지우자 scan은 `clean:true`가 됐다. ship은 처음에 "dependency manifest changed without a recorded reason"으로 PARTIAL이었다(패키지의 Package.swift 삭제가 매니페스트 변경으로 잡힌 것이며 정상 동작이다). `mis note dep`를 기록한 뒤에는 `ready:true, VERIFIED`였다.
- 커밋하지 않은(untracked) 복사본도 잡혔다(`--no-index --exclude-standard`).
- 회귀 테스트 `mis-ios.test.mjs:58`은 세 형태를 scan 수준에서 단언하고, Markdown 산문은 제외하는지 확인한다. ship 연동은 기존 테스트(`:26`)가 앱 코드 형태로 다룬다. 정규식이 이제 `DebugBridge` 단일 토큰이라 형태별 ship 경로는 같은 코드(`commands.mjs:591`)를 탄다.
- 참고(남은 위험): `*.md`를 통째로 제외하므로 DocC 등 Markdown 안의 코드는 잡지 않는다. 반대로 Swift 주석 "// removed DebugBridge"도 잡는다(보수적 오탐이고, 사용자가 주석을 지우면 해결된다).

### R2-3. L-1 ~ L-7 재검증

guard는 `scripts/guard.mjs`에 PreToolUse JSON을 직접 넣어 확인했다(활성 run이 있는 임시 저장소, run이 없는 임시 저장소).

| ID | 결과 | 증거 |
|---|---|---|
| L-1 | **해소(문구)** | 동작은 그대로다. run이 없으면 `codex exec "review"`가 allow이고, 활성 run이 있으면 ask다. 안내 문구는 사실에 맞게 바뀌었다: `mis second-opinion detect` note와 `review.md:27`이 "ask the user first (the guard also asks while a … run is active)"로 적는다. 무조건 "guard asks"라고 단정하는 문구는 skills, scripts, README, adapters 어디에도 남아 있지 않다 |
| L-2 | **해소** | `qa.md:7`의 표면 목록에 bsp가 들어갔다. 9단계가 BSP 타깃 검증을 설명한다 |
| L-3 | **해소** | 커널 트리(`arch/alpha`, `arm64`, `x86`)의 argv가 `["make","-j8"]`(네이티브)로 바뀌었다. `how`에 교차 빌드용 ARCH/CROSS_COMPILE/defconfig 안내가 있다. Yocto argv는 `bash -c ". ./oe-init-build-env build >/dev/null && bitbake core-image-minimal"`이다. 가짜 `oe-init-build-env`와 PATH의 가짜 bitbake로 실행해 보니 rc=0이었고, env 스크립트를 source한 뒤 bitbake까지 도달했다. 실제 poky 빌드는 NH-9로 남는다 |
| L-4 | **해소** | `learn add`(files=src/b.js) → 파일 삭제 → `learn list`만 실행해도 `learnings.md` 6행이 "… observed, STALE"로 바뀌었다 |
| L-5 | **부분 해소** | 회고 파일의 "## 다음 습관 (모델 판단)" 절에 이제 `_(아직 기록되지 않음)_` 자리표시가 들어간다. `retro.md` 2단계는 이 자리를 파일에서 직접 고치라고 지시한다. **미해소(L-5b)**: 1차에 함께 적은 "짝수 개 run의 중앙값은 위쪽 값" 문제가 그대로다. 직접 재현했다: `retroMetrics`에 2분짜리 run과 10분짜리 run을 넣으면 `medianMinutes`가 10이다(관례상 중앙값은 6). 원인은 `retro.mjs:43`의 `minutes[Math.floor(n/2)]`이다. 커밋 본문은 "Fixes M5-report D-1, D-2, L-1..L-7"이라고 적어 L-5 전체를 고쳤다고 주장한다. 따라서 이미 수용한 위험으로 볼 수 없다 |
| L-6 | **해소** | `adapters/codex/AGENTS.md`가 `critic`, `spec-reviewer`, `quality-reviewer`, `security-reviewer`, `product-reviewer`, `qa-tester`를 나열하고, 모두 `agents/`에 파일이 있다. 테스트 `plugin-files.test.mjs:143`이 `agents/<name>.md` 참조가 존재하는지 검사한다 |
| L-7 | **해소** | 활성 run에서 `git ls-files \| grep -v '^\.git/make-it-ship'`와 1차 transcript의 for 루프 원문이 allow다. `cat …/runs/r/state.json`, `grep x …/runs/*/events.jsonl`, `echo x > …/current`, `cd .git/make-it-ship && ls`, `cd …/runs && cat */state.json`은 deny다. run이 없어도 runs 쓰기는 deny다(§7 "항상 적용"). `mis status`는 allow다 |

**L-7 수정이 남긴 부작용(남은 위험)**: 정규식을 §7 문구(`make-it-ship/runs`)에 맞춰 좁혔다. 그 결과 활성 run에서도 `rm -rf .git/make-it-ship`, `mv .git/make-it-ship /tmp/x`, `ls .git/make-it-ship`가 allow가 됐다. 1차에서는 이 셋이 deny였다. 상태 루트를 통째로 지우면 run이 사라지고 guard 적용도 꺼진다. 다만 판정 기준상 결함은 아니다. §7 표 행의 기본 형태가 아니고(행 문구는 `make-it-ship/runs`), 스킬이 지시하거나 transcript에 나온 형태도 아니며, `shell.test.mjs` 매트릭스의 상태 경로 클래스(`runs/…`, `current`, cd)에도 들지 않는다. 이 형태로 위조된 VERIFIED는 만들 수 없다(run이 없으면 판정도 없다). 증거 삭제 위험이므로 사람이 판단해야 한다.

### R2-4. D-2 재검증 (실행 흐름 연결)

**정적 연결 — 해소**

- `skills/run/phases/qa.md:14`(8단계): 시뮬레이터 결과는 실기기 검증으로 치지 않는다. `mis ios devices`로 기기를 찾고, 없으면 기기 QA를 보고서에 BLOCKED로 적는다. 기기가 있고 사용자가 OK하면 `${CLAUDE_PLUGIN_ROOT}/templates/ios-debug-bridge/`를 쓴다. ship 전에 제거하고 `mis ios bridge-scan`으로 확인한다.
- `qa.md:15`(9단계): BSP는 `build-bsp`만으로는 빌드만 증명한다. 타깃 검증에는 `qa-bsp`가 필요하다.
- `skills/run/phases/ship.md:13`: iOS 프로젝트는 `mis ios bridge-scan`이 빈 결과여야 한다.
- `skills/qa/SKILL.md`와 `skills/ship/SKILL.md`는 각각 위 phase 파일을 읽는다. 그래서 `/make-it-ship:qa`, `/make-it-ship:ship`, run의 qa/ship 단계 모두 이 지시에 닿는다.
- README:41-48에 bench, retro, learn, second opinion, BSP, iOS 브리지·devices·bridge-scan, Codex 어댑터가 나온다.
- 회귀 테스트는 `plugin-files.test.mjs:143`이다.
- 남은 차이: `skills/qa/SKILL.md`의 description은 여전히 "iOS-simulator surface"라고만 적는다. 본문은 phase 파일을 따르므로 동작에는 영향이 없다.
- 이 환경의 `mis ios devices` 결과는 `{devices: [], blocked: "no connected iOS device: on-device QA is BLOCKED …"}`였다.


**headless `/make-it-ship:qa` — 해소 확인**

실행 조건: 합성 SwiftPM iOS 패키지(`Counter`, SwiftUI `CounterView`, XCTest 1개, `checks.unit = ["swift","test"]`), 연결된 기기 없음. 명령은 `claude -p "/make-it-ship:qa … including on a real iPhone. Proceed without asking questions; do not install anything." --plugin-dir <repo> --setting-sources project --strict-mcp-config --permission-mode bypassPermissions --max-turns 50 --output-format stream-json --verbose`이다. 결과는 success, 11 turns였다.

- **흐름**: 모델이 `qa.md`를 읽었다 → `mis start` → `mis qa detect`(ios 시뮬레이터 표면, `qa-ios` 제안) → `mis ios devices` → `make-it-ship:qa-tester` 서브에이전트 → `CounterViewQATests.swift` 작성 → 시뮬레이터 `xcodebuild test` 통과. 이어서 소스를 일부러 `value += 2`로 바꿔 테스트가 실패하는 것을 확인한 뒤 원복했다. 원복은 직접 확인했다(`Counter.swift:2` `value += 1`). 마지막으로 `mis check unit` PASS를 기록했다.
- **기기 QA**: 최종 보고는 "I could not verify it on a real iPhone because none is connected"였다. `mis ios devices`의 BLOCKED 문구를 그대로 인용했고, "Still blocked: 1. Real iPhone … the simulator doesn't count as device testing"이라고 적었다. 시뮬레이터 결과를 실기기 검증으로 세지 않았다. 브리지는 기기가 없어서 쓰지 않았다(8단계 지시와 같다).
- **guard 개입**: `permission_denials`는 정확히 1건이다. 대상은 Bash heredoc으로 `.make-it-ship.json`에 `qa-ios`를 추가하려던 명령이다. 같은 형태를 guard에 직접 넣으면 **ask**가 나온다. 이것은 §7 "설정 변경 → ask"이고, `qa.md` 4단계가 예고한 확인이다. headless라 확인할 수 없을 뿐 오탐은 아니다. 모델은 이를 BLOCKED로 보고하고 사용자에게 승인을 요청했다. 그 밖의 ask/deny는 없었다.
- **최종 상태(직접 확인)**:
  - `mis verdict`는 PARTIAL이다(mode·plan 없음, 리뷰 없음, unit STALE — STALE 원인은 아래).
  - `git status`에는 untracked `.build/`와 새 테스트 파일만 있다. 커밋은 없다.

### R2-5. 범위 메모

- 호출자의 지시로 범위를 좁혔다. 이번 라운드는 VERIFIER_PROMPT 4단계의 Standard stream-json 도그푸딩과 판정 기준 끝 문단(Standard run에서 승인 외 guard 개입 없음 확인)을 다시 실행하지 않았다. 그 대신 headless `/make-it-ship:qa` 1회를 실행했다. Standard 흐름에 대한 근거는 1차 기록뿐이다. 1차 이후 바뀐 guard 정규식(L-7)은 위 직접 probe로만 확인했다.
- 외부 모델 서비스는 호출하지 않았다.

### R2-6. 남은 위험 (추가)

- **`.build/` STALE**: `/.build`가 `.gitignore`에 없는 SwiftPM 저장소에서는 `swift test` check가 `.build/`를 만든다. 그러면 트리 해시가 바뀌어 check가 곧바로 STALE이 된다. 실측: `mis check unit` PASS 직후 `mis verdict`가 `unit: STALE`이었다. `/.build`를 무시 목록에 넣자 PASS로 유지됐다. 원인은 이번 합성 픽스처다(`swift package init`은 이 ignore를 만든다). 판정이 거짓 VERIFIED 쪽으로 틀리지는 않는다(안전 방향). 다만 사용자를 헷갈리게 할 수 있다.
- **상태 루트 삭제 허용**: L-7 수정 뒤 `rm -rf .git/make-it-ship`와 `mv .git/make-it-ship …`가 allow다(R2-3 참조).
- **bridge-scan의 `*.md` 제외**: Markdown(DocC 등) 안의 브리지 코드는 잡지 않는다. Swift 주석의 단어도 잡는 보수적 오탐이 있다.
- **qa 스킬 description**: `skills/qa/SKILL.md`의 description은 여전히 "iOS-simulator surface"라고만 적는다. 본문이 phase 파일을 따르므로 동작에는 영향이 없다.

### R2-7. 2차 결과 요약

| 항목 | 결과 |
|---|---|
| npm test / plugin validate / 스텁 | 317/317 PASS / passed / 0건 |
| D-1 (MEDIUM) | 해소 — 세 형태 모두 scan `clean:false`, ship `ready:false, PARTIAL`. 제거하면 VERIFIED |
| D-2 (MEDIUM) | 해소 — qa/ship phase와 README가 연결됐다. headless qa가 `mis ios devices`를 호출했고 기기 QA를 BLOCKED로 보고했다 |
| L-1, L-2, L-3, L-4, L-6, L-7 | 해소 |
| L-5 | 부분 해소 — 자리표시는 고쳤다. 짝수 개 run의 중앙값은 위쪽 값으로 남아 있다(**L-5b, LOW**, 재현: 2분·10분 → 10, 위치 `scripts/lib/retro.mjs:43`). 커밋은 이를 고쳤다고 주장한다 |

ROUND2: DEFECTS FOUND
