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
