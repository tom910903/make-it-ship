# M4 독립 검증 보고서 (2026-10-19)

검증 대상: `develop` @ `68113bd` (M1–M3는 태그로 검증 완료). 범위는 Spec §11 M4 행, §2 데모 C 행, §14.1 qa·ship 행, §14.3 `/make-it-ship:qa`·`/make-it-ship:ship`이다.
구현자 기록(`docs/milestones/M4-e2e.md`, `evals/PILOTS.md`, PROGRESS)은 참고만 했다. 모든 결과는 직접 다시 실행해서 얻었다.

## 1. 요약 판정

**DEFECTS FOUND**

- **종료 기준 "새 환경 설치 → 소형 프로젝트 완료"는 PASS다.**
  - 새 clone에서 `--plugin-dir`로 실행해 데모 C가 VERIFIED로 끝났다.
  - 결과물을 직접 실행해 REQUIREMENTS를 모두 충족함을 확인했다.
  - 실제 설치 경로(마켓플레이스·`claude plugin install`)는 NH-5로 여전히 열려 있다.
- **qa·ship 기능은 동작한다.** qa 탐지와 `qa-*` 필수화, ship의 READY/NOT READY 구분과 push 금지가 실제로 확인됐다.
- **결함은 7건이다.** MEDIUM 4, LOW 3.
  - **D1 (MEDIUM)**: ship은 보고 뒤(REPORTED, Spec §5.3의 마지막 상태)에 실행된다. 그런데 ship 단계는 "문서·체인지로그 갱신 → 같은 run에서 check 재실행"을 지시하고, 이것은 실행할 수 없다(`mis check: run is REPORTED`). 갱신하면 그 run은 NOT READY로 고정된다. 회복하려면 계획·모드·task·check·리뷰를 갖춘 새 run 전체가 필요하다. `mis approve config`도 보고 뒤에는 거부된다.
  - **D2 (MEDIUM)**: 보고서 6절 "검증하지 못한 영역"이 판정 사유를 걸러 버린다. 그래서 파일럿 6 보고서는 PARTIAL인데도 이유가 "없음"으로 나온다.
  - **D3 (MEDIUM)**: 파일럿 4를 다시 실행하자 모델이 Quick을 골랐다. 그 결과 브라우저에서 한 번도 열지 않은 UI 변경이 다음처럼 보고됐다.
    - 보고서: "VERIFIED · 검증하지 못한 영역 없음"
    - ship: "READY · Not verified 없음"
    - `mis qa detect`는 같은 저장소에서 web 표면을 BLOCKED로 탐지했다.

## 2. 실행한 명령과 결과 수치

| 명령 | 위치 | 결과 |
|---|---|---|
| `npm test` | 저장소 | tests 289 / pass 289 / fail 0 / skipped 0 / todo 0 |
| `claude plugin validate .` | 저장소 | ✔ Validation passed |
| `git clone -b develop <repo> clone` → `npm test` | scratchpad/v/clone (68113bd) | pass 289 / fail 0 |
| `claude plugin validate .` | 새 clone | ✔ Validation passed |
| `node evals/setup-demo.mjs c <tmp>` | 새 clone | 커밋 1개(`demo c fixture`), `.make-it-ship.json`(unit, qa-cli) 포함 |
| 헤드리스 실행 (아래 7절) | 데모 C, pilot-4 ×2, pilot-6 | 모두 `--max-turns ≤ 120` |
| `mis qa detect` | 픽스처 c, pilot-4, pilot-6, pilot-1, a, 합성 API, 합성 xcodeproj, 합성 SPM-iOS | 4절 표 |
| guard 직접 입력 (PreToolUse JSON → `scripts/guard.mjs`) | pilot-4 사본 (REPORTED run) | 6절 표 |

공통 헤드리스 옵션: `--plugin-dir <새 clone> --setting-sources project --strict-mcp-config --permission-mode bypassPermissions --output-format stream-json --verbose`.

## 3. 종료 기준·범위별 표

| 항목 | 판정 | 증거 |
|---|---|---|
| §11 M4 종료 기준: 새 환경 설치 → 소형 프로젝트 완료 | **PASS** (`--plugin-dir` 경로 기준) | 새 clone에서 npm test 289/289, validate 통과. 데모 C 1차 실행은 승인에서 정지했고(유일한 거부가 `mis approve plan`), 운영자가 `mis approve plan` 실행 후 resume하자 `REPORTED · VERIFIED`(unit E6 PASS, qa-cli E7 PASS, spec·quality 0/0). 결과물 직접 확인은 7.1절 |
| 실제 플러그인 설치(마켓플레이스·`plugin install`) | **NEEDS_HUMAN** (NH-5 유지) | 사용자 설정을 바꾸므로 실행하지 않았다 |
| qa 프로파일: CLI | PASS | `qa.mjs:40-45`. 테스트 `mis-qa.test.mjs` "CLI and API surfaces". 실측: 픽스처 c → `qa-cli: node qa/cli-smoke.mjs` |
| qa 프로파일: API | PASS | `qa.mjs:46-51`. 테스트 같음. 실측: express 의존 → `qa-api` |
| qa 프로파일: Web | PASS | `qa.mjs:31-38`. 테스트 "web with Playwright … BLOCKED proposal". 실측: pilot-4 → `check: null`, blocked "no browser test runner" |
| qa 프로파일: iOS 시뮬레이터 (`.xcodeproj`) | **NEEDS_HUMAN** | 테스트는 probe를 주입한 경우만 다룬다(`mis-qa.test.mjs` iOS). 실제 xcodeproj가 없어 `xcodebuild test` 경로를 실행하지 못했다. 가짜 pbxproj에서는 "could not determine a scheme"(정직한 BLOCKED) |
| qa 프로파일: iOS (SwiftPM `.iOS(`) | **FAIL** (D4) | Xcode 26.0.1과 iPhone 시뮬레이터 5대가 있고 `xcodebuild -list -json`이 scheme "App"을 반환하는데도 BLOCKED("could not determine a scheme")로 나온다 |
| Standard/Full에서 탐지된 표면의 `qa-*` 필수화 (§14.1 qa 행) | PASS | `commands.mjs:379-381`. 테스트 "standard/full: a detected user-facing surface makes its qa-* check required". 실측: pilot-4 Standard → `qa-web BLOCKED` → 판정 BLOCKED. 데모 C → 설정 `required.standard`에 없어도 qa-cli 필수 |
| qa 단계 + qa-tester + `/make-it-ship:qa` (§14.3) | PASS | `skills/qa/SKILL.md`, `phases/qa.md`, `agents/qa-tester.md`. 실측(7.4절): 새 run 시작 → qa-tester 호출 → 스모크 36→73개로 확장 → `mis check qa-cli` PASS(E1) → PARTIAL을 정직하게 보고 |
| ship: PR 초안·체인지로그 초안·릴리스 체크리스트, VERIFIED 아니면 NOT READY | PASS (생성 자체) | `ship.mjs`. 테스트 `mis-ship.test.mjs` 2건. 실측: 데모 C(VERIFIED) → READY, 세 절 모두 생성. pilot-6(PARTIAL) → NOT READY와 사유. 코드를 망가뜨리면 → PARTIAL, NOT READY |
| ship: push/PR은 ask, 스스로 push하지 않음 (§14.1 ship 행) | PASS | guard 직접 입력: `git push -u origin HEAD`·`gh pr create` → ask, `git push --force origin main` → deny. 데모 C에 bare 원격을 붙이고 `/make-it-ship:ship` 실행 → 원격 ref가 변하지 않았다(`36a3ad8` 그대로). transcript의 Bash에 push/pr 없음, permission_denials 없음 |
| ship: 문서 단계 + 체인지로그 반영 후 재검증 | **FAIL** (D1) | 7.3절 재현. 같은 run에서는 불가능하고, 새 run 전체로만 회복된다 |
| `/make-it-ship:ship` (§14.3) | PASS (D1 제외) | 두 번 실행: VERIFIED → READY, PARTIAL → NOT READY. 둘 다 merge·push·keep·discard 선택지를 제시하고 대기했다 |
| 문서 단계 | 부분 PASS | 별도 `docs.md` phase는 없다. `ship.md` 1단계(document-release)로 구현돼 있다. 해석상 허용하지만 D1 때문에 실제로 쓰면 막힌다. README 자체도 M4 명령을 반영하지 않았다(D5) |
| 데모 C (§2) | PASS | 위 종료 기준 행과 같음 |
| 파일럿 과제 8종 | 부분 PASS | 픽스처 6종과 `evals.test.mjs` 셋업 테스트는 있다. 다시 실행한 결과: 파일럿 6은 기대와 일치(PARTIAL). 파일럿 4는 Standard면 일치(BLOCKED), 모델이 Quick을 고르면 불일치(D3). 상세는 7.2절 |
| SPEC_CHANGES `mis approve config` | PASS (정직·정합), 단 D1 영향 | 아래 별도 절 |

### SPEC_CHANGES `mis approve config` 검토
- **정합성**: §7 표의 "승인 명령 `mis.mjs approve ...` → ask" 행에 그대로 들어간다.
  - guard 직접 입력 결과: `mis approve config` → ask("approval is recorded only when you confirm this command").
  - `.make-it-ship.json` Write → ask, `mis init --write` → ask.
  - §6 PARTIAL 조건 목록에는 없는 추가 조건이지만, PROGRESS에 "§6의 연장(해석)"으로 명시했다. Spec 본문을 몰래 바꾼 것은 아니다.
- **동작 확인**: 임시 저장소에서 확인했다.
  - `check unit` PASS → VERIFIED.
  - 설정의 argv를 `true`로 바꾸자 PARTIAL. 사유는 "unit is stale"과 "changed during the run without approval"이었다.
  - `approve config`를 해도 PARTIAL. unit이 여전히 STALE이라 재실행이 필요하다.
  - §7 "configHash가 바뀌면 기존 증거 STALE"이 실제로 지켜진다.
- **정직성**: "파일럿 4에서 발견"이라는 서술은 근거와 일치한다.
  - 구현자의 `evidence/m4/pilot4-events.jsonl`에는 `approve config`가 없는데 VERIFIED였다. 즉 수정 전 동작이다.
  - 다만 M4-e2e 표의 파일럿 4 행(VERIFIED)은 수정 전 실행 결과이고, 수정 후 다시 실행한 기록은 없다(D6).
- **한계**: `approve config`는 REPORTED 이후 거부된다(`commands.mjs:228`). 보고 뒤에 사용자가 설정을 승인할 방법이 없다(D1).

### 추적표 행별 표

| 추적 행 | 구현 | 자동 테스트 / 기록 | 판정 |
|---|---|---|---|
| §2 데모 C (md 요구사항 → 소형 앱, 수동 E2E 로그, M4) | `evals/demos/c` | `evals.test.mjs` "demo c" (셋업·qa-cli 기준선 FAIL), `M4-e2e.md` §1, 이번 7.1절 재실행 | PASS |
| §14.1 qa — Quick "—" | `verdictContext`가 quick에서 qa를 반영하지 않음 | `mis-qa.test.mjs` "quick: unit only" | PASS (단, D3) |
| §14.1 qa — Standard "해당 표면 있으면" | `commands.mjs:379-381` | `mis-qa.test.mjs` "standard/full …required" + pilot-4 Standard 재실행(BLOCKED) | PASS |
| §14.1 qa — Full ○ | 같은 코드(non-quick) | 같은 테스트 (mode full은 standard와 같은 분기) | PASS (코드·테스트 기준). Full 실사용은 미실행 |
| §14.1 ship — Quick/Standard "요청 시", push/PR ask | `mis ship`, `phases/ship.md`, guard | `mis-ship.test.mjs` 2건, guard 직접 입력, 7.3절 실행 2회 | PASS (D1 제외) |
| §14.1 ship — Full ○ | run 스킬 "ship (on request, or Full)" (지시문만, mis 강제 없음) | 자동 테스트 없음. 구현자의 유일한 Full 실행(c1)에 ship 이벤트 없음. 이번 실행은 Standard | **NEEDS_HUMAN / 미입증** |
| §14.3 `/make-it-ship:qa` | `skills/qa/SKILL.md` | `plugin-files.test.mjs` (스킬·phase 참조), 7.4절 실행 | PASS |
| §14.3 `/make-it-ship:ship` | `skills/ship/SKILL.md` | `plugin-files.test.mjs`, 7.3절 실행 2회 | PASS (D1 제외) |

## 4. `mis qa detect` 실측

| 픽스처 | 결과 |
|---|---|
| c (package.json `bin`) | cli → `qa-cli: node qa/cli-smoke.mjs`, needsScript |
| pilot-4 (`index.html`) | web → check null, BLOCKED "no browser test runner (e.g. Playwright)…" |
| pilot-6 (`bin/backup.sh`, package.json 없음) | profiles `[]`. 셸 CLI는 표면으로 탐지하지 않는다(남은 위험) |
| pilot-1 (`wc.py`, pyproject 없음) | profiles `[]` (PILOTS.md 기대 "qa 없음"과 일치) |
| a (TS 라이브러리) | profiles `[]` |
| 합성: express 의존 | api → `qa-api: node qa/api-smoke.mjs` |
| 합성: `App.xcodeproj` (가짜 pbxproj) | ios → BLOCKED "could not determine a scheme" (정당) |
| 합성: SwiftPM `platforms: [.iOS(.v17)]` | ios → BLOCKED "could not determine a scheme" (**부당**, D4) |

## 5. 스텁·skip 검사

`grep -rnE "TODO|FIXME|\.skip|\.only|not implemented|todo\(" scripts skills agents hooks tests templates evals` 결과, 모든 hit는 task 상태값 `'TODO'`(`commands.mjs:148,305,502,540`, 테스트 데이터)다. 스텁, skip, only, 미구현은 없다. npm test 출력도 skipped 0 / todo 0이다.

## 6. guard 확인 (판정 기준 적용)

pilot-4 사본(활성 REPORTED run)에 PreToolUse JSON을 직접 넣었다.

| 입력 | 결정 | Spec §7 |
|---|---|---|
| `mis approve config` | ask | 승인 명령 → ask ✔ |
| `mis ship`, `mis qa detect` | allow | ✔ |
| `mis init --write` | ask | 설정 변경 → ask ✔ |
| `git push -u origin HEAD` | ask | 원격 쓰기 ✔ |
| `gh pr create --fill` | ask | ✔ |
| `git push --force origin main` | deny | 기본 브랜치 강제 push ✔ |
| `git add -A && git commit -m x`, `git merge --no-ff feature` | allow | 해당 없음 ✔ |
| Write `.make-it-ship.json` | ask | ✔ |
| Write `CHANGELOG.md` (REPORTED 이후) | allow | 계획 범위 검사는 보고 전까지만(SPEC_CHANGES 해석) ✔ |

dogfood transcript에 나온 guard 거부(stream-json `permission_denials`)는 다음과 같다.
- **데모 C 1차**: `mis approve plan` 1건뿐이다(기대된 승인 정지).
- **데모 C resume, ship, qa**: 0건.
- **pilot-4(Quick)**: 0건.
- **pilot-4(Standard) 1차**: `mis approve plan` 1건.
- **pilot-4(Standard) resume**: `cat …; ls .git/make-it-ship/runs/*/` 1건이 deny됐다. §7 "Bash 명령에 `make-it-ship/runs` 포함 → deny" 행 그대로이고 스킬이 지시한 형태도 아니므로 결함이 아니다.
- **pilot-6**: `…; rm -rf $w`(mktemp 디렉터리 정리) 1건이 ask→거부됐다. §7 "rm -rf 저장소 밖 경로 → ask" 행 그대로이므로 결함이 아니다. 다만 모델이 임시 디렉터리를 습관적으로 정리하다 막힌 사례로 6절 남은 위험에 적는다.

판정 기준 (a)(b)(c)에 해당하는 guard 결함은 없다. Standard 실행(데모 C, stream-json)에서 승인 외의 ask/deny는 0건이었다.

## 7. 실사용 검증 기록

### 7.1 데모 C (종료 기준)
1. **1차 실행**: `/make-it-ship:run Build the app described in REQUIREMENTS.md. Proceed without asking me questions.`
   - 14턴, mode standard. 모델이 고른 모드이고, 사유는 "new small CLI… more than a one-function change"였다.
   - interview 5건은 모두 기본값으로 해소했다. plan-critic은 2회(1회차 MAJOR 2건 → 계획 수정 → 0/0).
   - `mis approve plan`이 거부되자 AWAITING_APPROVAL에서 정직하게 정지했다.
2. **운영자 조치**: 터미널에서 `mis approve plan` 실행 → EXECUTING. bare 원격(`remote.git`)을 붙였다.
3. **2차 실행**: `/make-it-ship:resume …`. T1~T3 완료, `unit` PASS(E6, 24/24), `qa-cli` PASS(E7, 36/36), spec·quality 0/0 → **VERIFIED**, REPORTED. 커밋은 하지 않았다.
4. **내가 직접 실행한 결과**:
   - `npm test`: pass 24 / fail 0. `node qa/cli-smoke.mjs`: exit 0.
   - 명령별 동작은 다음과 같다.

     | 시나리오 | 결과 |
     |---|---|
     | 빈 상태 `today` | `nothing yet` |
     | `add water` 두 번 | `water: 1`, `water: 2` |
     | `today` | `Run_1 1 / apple 1 / water 2` (코드포인트 정렬, 가정으로 기록됨) |
     | `week water` | 7줄, 오래된 날부터, 0일 포함, 마지막이 오늘 |
     | `week nothing` | 0 7줄 |
     | `reset water` | `reset water`, 이후 `today`에서 사라짐 |
     | 32자 이름 | 허용 |
     | 33자, 공백, `é`, 빈 이름 | exit 2, stderr에만 메시지 |
     | 인자 없음, 모르는 명령, `add`/`week`/`reset` 인자 누락 | 사용법을 stderr로, exit 2 |
     | `TALLY_FILE` 미지정 | `$HOME/.tally.json` 생성 |
     | `TZ=Pacific/Pago_Pago` (UTC 06:20 시점) | 로컬 날짜 `2026-10-18`로 기록 |
     | 깨진 JSON 파일 | exit 1, 파일 보존 |

   - REQUIREMENTS의 모든 항목을 충족했다.
5. **망가뜨리기**:
   - `src/tally.js`의 32를 31로 바꿨다 → `mis verdict` PARTIAL(unit·qa-cli STALE, 리뷰 무효), `mis ship` → `ready:false`.
   - 원복하자 VERIFIED로 돌아왔다(treeHash가 같으므로).

### 7.2 파일럿 재실행 (구현자 기록과 비교)

| 파일럿 | 구현자 기록 (M4-e2e) | 이번 재실행 | 비교 |
|---|---|---|---|
| 4 (요청 그대로) | standard, unit·qa-web PASS, VERIFIED. 모델이 설정을 무승인으로 수정(수정 전 코드) | **quick**(모델 선택), unit만 필수 → **VERIFIED**. 보고서 6절 "없음", ship READY, "Not verified: 없음". 모델의 최종 메시지만 "브라우저에서 열지 않았다"고 밝혔다 | 기대(PILOTS.md: VERIFIED 아님) **불일치** → D3 |
| 4 (변형: "Use standard mode") | — | standard, plan-critic 3회, 승인에서 정지 → 운영자 승인 → T1~T4 완료. 모델이 `qa/web-smoke.mjs`(headless Chrome, 의존성 없음)를 작성했지만, 설정 변경은 사용자 몫으로 남겼다. 판정 **BLOCKED**("required check qa-web could not run"), 보고서 6절이 이유를 표시했다. 내가 `node qa/web-smoke.mjs`를 직접 실행하자 13개 모두 ok, 375px 포함 | 기대와 일치. M4 수정(무승인 설정 변경 금지)이 동작한다. 단, 이후 운영자가 qa-web을 등록하고 `mis approve config`를 실행하자 "run is REPORTED"로 거부됐다 → D1 |
| 6 | quick, check `test` BLOCKED(미정의), PARTIAL | quick, 설정 없음(`mis init`이 아무것도 탐지하지 못함), check 0건 → **PARTIAL**. 모델 메시지는 정직하다("no required checks defined"). 그러나 **report.md 6절은 "없음"**이고, 8절은 "6절의 항목을 먼저 해결해야 한다"고 적어 서로 모순된다. 구현자 증거 `pilot6-report.md`의 6절도 "없음"이다 | 판정은 일치. 보고서 정직성 결함 → D2 |

### 7.3 ship
- **데모 C(VERIFIED)**: `/make-it-ship:ship` 실행(5턴, 거부 0).
  - `ship.md`에 READY, PR 초안(Summary/Changes/Verification/Not verified/Commits), CHANGELOG 초안(Added), 릴리스 체크리스트가 들어 있다. 체크리스트는 미커밋·main 브랜치·CHANGELOG 없음·문서 수동 확인·push 승인을 미체크로 정확히 표시했다.
  - 원격 ref는 그대로였다. 모델은 README 추가 여부와 브랜치 마무리 4지선다를 묻고 멈췄다.
- **pilot-6(PARTIAL)**: `/make-it-ship:ship` → NOT READY, 사유 2건, 커밋·push 없음.
- **D1 재현**:
  1. 데모 C 사본에서 ship 2단계대로 `CHANGELOG.md`를 추가했다.
  2. `mis ship`이 PARTIAL(unit·qa-cli STALE)을 냈다.
  3. `mis check unit`은 "run is REPORTED"로 exit 1이었다.
  4. `mis resume`은 stale 목록만 보여 줬다.
  5. 새 run(`mis start`)을 만들자 처음에는 plan·mode·리뷰가 없어 PARTIAL이었다.
  6. 그 새 run에서 `plan set` → `mode set quick` → `task T1 start/done` → `check unit`·`check qa-cli` → `review add quality`까지 마치자 VERIFIED, `mis ship` READY가 됐다.
  - 결론: 회복은 가능하지만, 계획·리뷰를 다시 갖춘 별도 run이 필요하다. ship.md 1·6단계가 말하는 "check 재실행"은 그대로는 실행할 수 없다.

### 7.4 `/make-it-ship:qa` 단독
- 데모 C 사본(REPORTED run)에서 실행했다(8턴, 거부 0).
  - 새 run을 시작하고 `mis qa detect`로 cli 하나를 찾았다.
  - qa-tester가 BLOCKING 0, MAJOR 5(스모크 누락 시나리오)를 보고했다. 모델이 스모크를 73개로 확장하고 변이 6종으로 검출력을 확인했다.
  - `mis check qa-cli` PASS(E1), unit PASS(E2). 판정은 PARTIAL이었고 사유(no plan, no reviews)를 정직하게 밝혔다.

## 8. 결함 목록

| ID | 심각도 | 내용 | 재현 | 위치 |
|---|---|---|---|---|
| D1 | MEDIUM | REPORTED는 Spec §5.3 상태 전이의 마지막 상태이고, 구현도 보고 뒤의 `mis check`·`mis approve config`를 거부한다(Spec과 일치). 그런데 run 스킬은 ship을 "after the report"에 두고, ship.md 1단계와 6단계는 "문서·CHANGELOG 갱신 후 (같은 run에서) check 재실행"을 지시한다. 문서나 CHANGELOG를 고치면 증거가 STALE이 되고, 그 run은 NOT READY로 고정된다. 회복하려면 새 run 전체(계획·모드·task·check·리뷰)를 만들어야 하는데, 이 경로는 어디에도 안내되지 않는다. 같은 원인으로, 보고 뒤 사용자에게 안내하는 "`mis approve config` 후 `mis check qa-web`"(pilot-4 Standard의 최종 메시지)도 실행할 수 없다. 거짓 VERIFIED는 없지만, ship의 핵심 흐름이 막힌다. `mis-ship.test.mjs`는 보고 전 run에서만 ship을 호출하고, 갱신 후 재검증도 시험하지 않는다 | 7.3절 단계, 7.2절 pilot-4 변형 | 원인은 단계 설계다: `skills/run/SKILL.md` ("ship … after the report"), `skills/run/phases/ship.md:7,12`, `phases/qa.md:10`. 제약 지점은 `scripts/lib/state.mjs:24`(TERMINAL), `commands.mjs:228,327` |
| D2 | MEDIUM | 보고서 6절이 판정 사유 중 "check"라는 단어가 들어간 것을 모두 버린다. "no required checks defined: nothing was machine-verified"와 "no .make-it-ship.json: no required checks are defined"가 사라져, PARTIAL 보고서의 6절이 "없음"이 된다. 8절은 "6절의 항목을 먼저 해결"이라고 적어 보고서가 스스로 모순된다. 공유용 보고서가 검증하지 못한 이유를 말하지 않는다(파일럿 6 기대 "검증하지 못한 이유 보고" 미충족). 구현자 증거에도 같은 현상이 있다 | pilot-6 실행 후 `docs/make-it-ship/*/report.md` 6절 | `scripts/lib/render.mjs:73` (`if (!/check/.test(r))`) |
| D3 | MEDIUM | §14.1 Quick의 qa는 "—"이므로, Quick에서 qa-web을 요구하지 않는 것 자체는 규칙 위반이 아니다. 결함은 기계적인 부분에 한정한다. `mis qa detect`가 BLOCKED로 보고하는 표면이 보고서 6절과 `ship.md`의 "Not verified / risks"에서 빠진다. 브라우저에서 한 번도 열지 않은 UI 변경이 "VERIFIED — 배포 준비 완료, 검증하지 못한 영역 없음"과 "READY"로 나온다. 같은 저장소에서 `mis qa detect`는 qa-web을 BLOCKED로 보고한다. 원인은 모델의 모드 선택이다. run 스킬은 "Standard = a normal feature"라고 하지만 강제하는 곳이 없다. PILOTS.md 파일럿 4의 기대 결과를 재현하지 못했다. 표본은 1건이다(구현자의 같은 파일럿 실행은 Standard를 골랐다) | pilot-4를 요청 그대로 실행 (모델이 quick 선택) | `commands.mjs:379-381` (non-quick일 때만 qa 반영), `render.mjs:67-73`, `ship.mjs` "Not verified" |
| D4 | MEDIUM | SwiftPM iOS 패키지의 qa 탐지가 항상 틀린 이유로 BLOCKED가 된다. `probeIos(root, undefined)`가 `-project undefined`를 그대로 넘긴다(Node가 문자열 "undefined"로 전달함을 확인). SPM의 `-list -json` 결과 키는 `workspace`인데 코드는 `project.schemes`만 읽는다. 단위 테스트는 probe를 주입하므로 이 경로를 실행하지 않는다 | 합성 SPM(`.iOS(.v17)`) + Xcode 26.0.1 + iPhone 시뮬레이터 → `mis qa detect` → "could not determine a scheme". 같은 디렉터리에서 `xcodebuild -list -json`은 scheme "App" 반환 | `scripts/lib/qa.mjs:11-12, 52` |
| D5 | LOW | README가 M4를 반영하지 않았다. 직접 호출 명령 목록에 `/make-it-ship:qa`·`ship`(및 debug·resume)이 없다. `mis` CLI 목록에 `qa detect`, `ship`, `approve config/continue`, `resume`, `note`, `parallel`, `worktree`가 없다. "What happens"에 qa·ship 단계가 없다. M4가 "제품화·설치 문서"인 점을 고려하면 누락이다 | `README.md:23-46` 열람 | `README.md` |
| D6 | LOW | 기록 부정확. PROGRESS M4-06의 테스트 열이 존재하지 않는 `docs/milestones/M4-pilots.md`를 가리킨다. M4-e2e 파일럿 4 행(VERIFIED)은 수정(16a10bd) 전 코드로 얻은 결과이고, 수정 후 다시 실행하지 않았다. 구현자 c1 실행은 Full인데 §14.1의 Full ship ○에 해당하는 ship 이벤트가 없다(종료 기준 서술에서 이 점을 언급하지 않음) | `ls docs/milestones`, `evidence/m4/c1-events.jsonl` | `docs/PROGRESS.md:89`, `docs/milestones/M4-e2e.md` |
| D7 | LOW | `ship.md`의 "Not verified / risks"가 "- 없음"과 "- shortcut 표식 1개"를 함께 출력한다(데모 C). 헤드라인 "READY"는 판정만 반영하므로, 미커밋 상태이고 main 브랜치여도 READY로 나온다. 체크리스트에는 정확히 표시된다 | 데모 C `ship.md` | `scripts/lib/ship.mjs` (Not verified 절, ready 정의) |

### 검증 프롬프트 6항 질문에 대한 답
- **통과로 표시됐지만 실제로 실행되지 않은 것이 있는가?** 있다. 두 가지다.
  - M4-e2e 파일럿 4 행의 VERIFIED는 수정(16a10bd) 전 코드의 결과다. 현재 코드로는 다시 실행되지 않았다.
  - M4-e2e와 PROGRESS M4-05는 c1을 "Full 경로 E2E"로 기록했지만, Full에서 항상 실행돼야 하는 ship 단계(§14.1)는 그 실행에서 돌지 않았다(이벤트 없음).
- **M4 §2 행 중 테스트가 없는 것이 있는가?** 없다. 데모 C는 수동 E2E 로그와 `evals.test.mjs` 셋업 테스트를 함께 갖는다.
- **스텁·skip·빈 구현이 있는가?** 없다(5절).

## 9. 미검증 항목
- 실제 플러그인 설치 경로 (NH-5).
- iOS `.xcodeproj` + 시뮬레이터 `xcodebuild test` 실제 성공 경로. 실제 Xcode 프로젝트를 만들 도구가 없었다.
- 대화형 확인 창 (NH-1). 모든 승인은 운영자가 터미널에서 대신했다.
- 파일럿 1·2·3·5·7·8은 다시 실행하지 않았다(지시에 따라 4·6만 실행).
- Full 모드 데모 C. 이번 실행은 모델이 standard를 골랐다. Full 경로(product-review, ship 자동 실행)는 이번에 실행되지 않았다.
- 모델에게 "push and open a PR"을 선택시켜 guard가 실제로 ask하는 경로. 헤드리스에서는 ask가 거부로 끝나므로, 직접 입력으로만 확인했다.

## 10. 남은 위험
- **모드 선택은 모델 판단이다.** UI 기능을 Quick으로 낮추면 qa 요구가 사라진다(D3의 근본). ADR-009에 따라 사용자가 바꿀 수 있지만, 헤드리스나 무인 실행에서는 아무도 보지 않는다.
- **셸 스크립트·확장자 없는 Python 스크립트 CLI는 qa 표면으로 탐지되지 않는다.** 대상은 `package.json bin`과 `pyproject [project.scripts]`뿐이다(pilot-6·pilot-1).
- **`mis init --write`는 run 시작 전에 실행되므로 guard 범위 밖이다**(§7 "진행 중인 실행이 있을 때만"). 헤드리스에서 "Proceed without asking"을 붙이면 모델이 탐지된 설정을 확인 없이 쓴다. Spec §9-1 해석과 일치하며, 모델이 최종 메시지에서 이를 알렸다.
- **guard가 임시 디렉터리 정리 `rm -rf $w`(mktemp)를 ask한다.** 헤드리스에서는 거부되고 모델이 우회한다. Spec 행 그대로이지만 정상 흐름에서 마찰이 생긴다.
- **qa 스크립트의 품질은 모델 몫이다.** 데모 C의 1차 스모크(36개)는 reset 범위, 기본 경로, 시간대 같은 요구사항 일부를 확인하지 않았다. `/make-it-ship:qa` 재실행에서 73개로 보강됐다. 첫 run의 VERIFIED는 그만큼 좁은 범위의 증거였다.

## 2차 검증 (round 2)

검증 대상: `develop` @ `39e65e5` ("M4-fix"). 1차 결함 D1~D7을 원래 재현 방법으로 다시 확인했고, 새 clone으로 종료 기준도 다시 확인했다. 커밋 메시지와 M4-e2e 추가 기록은 참고만 했다. 모든 결과는 직접 실행해서 얻었다.

**ROUND2: DEFECTS FOUND**

- **주요 결함은 모두 고쳐졌다.** D2·D3·D4는 실측으로 해결을 확인했다. D1도 핵심 흐름은 해결됐다. 문서·체인지로그 수정이 검증 전에 일어나고, 보고 뒤에는 초안 작성과 커밋만 한다.
- **종료 기준은 계속 PASS다.**
- **남은 결함은 LOW 3건이다.** R2-1, R2-2, R2-3(아래). 거짓 VERIFIED나 승인 우회는 없다.

### R2.1 실행한 명령과 결과

| 명령 | 결과 |
|---|---|
| `npm test` (저장소) | tests 294 / pass 294 / fail 0 / skipped 0 / todo 0 |
| `claude plugin validate .` | ✔ Validation passed |
| `git clone -b develop` → `npm test` → validate (scratchpad/r2/clone, 39e65e5) | 294/294, ✔ |
| 스텁 검사 (VERIFIER_PROMPT 3항 grep) | 8건 모두 task 상태값 `'TODO'` 또는 `next TODO task` 문구(`commands.mjs:503`). 스텁·skip·only·미구현 없음 |
| 헤드리스 실행 (모두 새 clone을 `--plugin-dir`로, stream-json, `--max-turns 120`) | 데모 C(Standard) 2회(승인 정지 → 운영자 승인 → resume), 데모 C 변형(CHANGELOG·README 보유, Full) 2회, pilot-4(Quick) + `/make-it-ship:ship`, pilot-6 |
| 합성 SwiftPM iOS 패키지에서 `mis qa detect` → `mis check qa-ios` | 아래 D4 |

### R2.2 1차 결함 재검증

| ID | 판정 | 증거 |
|---|---|---|
| D1 ship 순서 | **해결 (핵심 흐름)**. 잔여분은 R2-1 | 수정 내용: `skills/run/SKILL.md` 6c "ship, part A"가 verify 앞에 있고, part B는 보고 뒤에 "no file edits"로 제한된다. `phases/ship.md`는 Part A/B로 나뉘고, 보고 뒤 변경은 follow-up run으로 안내한다. 실측 결과는 다음과 같다.<br>• **데모 C (Standard, "prepare it for shipping")**: 이벤트 순서가 T6(Docs: README·CHANGELOG) done 07:08:51 → `check unit` E5 / `qa-cli` E6 PASS → spec·quality 0/0 → VERIFIED → report → ship(ready:true)였다. transcript에서 `mis report` 호출(인덱스 24) 이후의 main 도구 호출 4개는 `mis ship`과 `git switch -c`/`git add`/`git commit`뿐이다. Write·Edit·리다이렉트는 없다.<br>• **데모 C 변형 (Full, 기존 CHANGELOG)**: T5(Docs) done → quality MAJOR 1 수정 → E7/E8 PASS → VERIFIED → report → ship. 보고 이후 호출 6개도 mis와 git(브랜치·커밋, 미푸시 로컬 브랜치에서 `reset --soft` 후 재커밋)뿐이다. `CHANGELOG.md`의 `[Unreleased]`에 `### Added` 항목이 기존 형식대로 추가됐다.<br>• 두 경우 모두 `mis verdict`의 treeHash가 마지막 VERIFIED 이벤트와 같다(c: `b97308…`, c-cl: `5b9d60…`). bare 원격 ref도 그대로다(`5183e16`, `a3465bc`).<br>• 1차의 "Full에서 ship ○ 미입증"(NEEDS_HUMAN)도 해소됐다. c-cl Full 실행에 `ship` 이벤트가 있다 |
| D2 6절 사유 누락 | **해결** | `render.mjs:73`이 `required check `로 시작하는 사유만 거른다. pilot-6을 요청 그대로 다시 실행했다(quick, 설정 없음, PARTIAL). report.md 6절은 "no required checks defined: nothing was machine-verified"와 "no .make-it-ship.json: no required checks are defined"이고, 8절 "6절의 항목을 먼저 해결"과 모순이 없다. 테스트 `mis-report.test.mjs` "section 6 keeps non-check-specific reasons"는 실제 6절 본문을 검사한다 |
| D3 Quick에서 web 표면 미표시 | **해결** | pilot-4를 "Use quick mode"로 실행했다. 판정은 VERIFIED(§14.1 Quick qa "—"이므로 정당)이고, report.md 6절은 "web 표면(browser UI): 실사용 QA(qa-web) 미실행 — Quick 모드라 판정에는 필수가 아님"이다. 이어서 `/make-it-ship:ship`을 실행했다(8턴, 거부 0). ship.md "Not verified / risks"는 "web 표면: 실사용 QA 미실행 (Quick 모드에서는 필수 아님)"이었고, 모델의 최종 메시지도 이를 밝혔다. 모델은 run이 REPORTED임을 인식하고 Part B만 수행했다("I didn't edit any files") |
| D4 SwiftPM iOS | **해결** | 합성 패키지(`platforms: [.iOS(.v16)]`, XCTest 1개, `.xcodeproj` 없음)에서 Xcode 26.0.1로 실행했다. `mis qa detect`는 `xcodebuild test -scheme Pkg -destination 'platform=iOS Simulator,name=iPhone 17 Pro'`를 제안했다. 이를 `qa-ios`로 등록하고 `mis check qa-ios`를 실행했다.<br>• E1 **FAIL**(exit 65): 테스트 코드의 `add`가 `XCTestCase.add`와 충돌했다. mis가 그대로 FAIL로 기록했다.<br>• 테스트 코드를 고친 뒤 E2 **PASS**(exit 0): "Executed 1 test, with 0 failures", "** TEST SUCCEEDED **".<br>단위 테스트 `schemesFromList`는 project·workspace 두 형태를 모두 검사한다 |
| D5 README | **부분 해결** → R2-2 | 직접 호출 명령 목록과 `mis` CLI 목록은 갱신됐다. "What happens" 1~7단계에는 여전히 qa와 ship 단계가 없다(`README.md:31-38`) |
| D6 기록 | **해결** | PROGRESS M4-06이 `docs/milestones/M4-e2e.md` §2를 가리키고, 그 절이 존재한다(`M4-e2e.md:30`). M4-e2e에는 "파일럿 4 VERIFIED는 approve config 도입 전 결과"와 "c1 Full 실행은 ship 미실행"이 명시됐다. iOS 실측 기록은 이번 D4 재현과 일치한다(같은 이름 충돌 FAIL → PASS) |
| D7 ship.md | **해결 ("없음" 병기)**. headline 절반은 설계로 수용 | c-cl ship.md "Not verified / risks"는 "- shortcut 표식 1개 (보고서 10절)"만 출력하고 "없음"이 함께 나오지 않는다. c는 "- 없음"만 출력한다. 1차 D7의 다른 절반(미커밋·main 브랜치여도 headline READY)은 바뀌지 않았다(`ship.mjs` `ready = verdict === 'VERIFIED'`). headline이 "아래 체크리스트의 수동 항목과 사용자 승인 후"라고 조건을 달고, 체크리스트가 `[ ] 작업 트리 커밋됨`·`[ ] 기본 브랜치가 아님 (main)`을 정확히 표시하므로 설계로 수용한다. 결함으로 세지 않는다 |

### R2.3 종료 기준 (새 clone + 데모 C 헤드리스)

| 항목 | 판정 | 증거 |
|---|---|---|
| 새 환경 설치 → 소형 프로젝트 완료 (`--plugin-dir` 경로) | **PASS** | 1. 새 clone(39e65e5)에서 npm test 294/294, validate 통과.<br>2. 데모 C 1차 실행(Standard, 모델 선택, 사유 "user-facing surface; ship prep requested"): plan-critic 3회 → 0/0. `mis approve plan`이 거부되자 AWAITING_APPROVAL에서 정직하게 정지했다.<br>3. 운영자가 터미널에서 `mis approve plan`을 실행했다(→ EXECUTING).<br>4. resume: T1~T6 완료, unit E5·qa-cli E6 PASS, spec·quality 0/0 → **VERIFIED**, ship READY. 모델은 `feat/tally-cli` 로컬 브랜치에 커밋했고 push하지 않았다. 브랜치 마무리 4지선다를 제시하고 정지했다 |
| 결과물 직접 확인 | PASS | 내가 직접 실행한 결과:<br>• `npm test` pass 15 / fail 0, `node qa/cli-smoke.mjs` exit 0.<br>• `today` → `nothing yet`, `add water`×2 → `water: 1`/`water: 2`, `week water` 7줄(마지막 오늘=2), `add "a b"` → exit 2와 메시지, `reset water` → `reset water`, 인자 없음 → 사용법 출력과 exit 2.<br>• README.md·CHANGELOG.md가 생성됐다 |
| 망가뜨리기 | PASS | `src/*.js`에 한 줄을 추가하자 `mis verdict` PARTIAL(unit·qa-cli STALE, 리뷰 없음), `mis ship` `"ready": false`. 원복하자 VERIFIED, ready true로 돌아왔다 |
| guard (판정 기준: Standard stream-json) | PASS | 데모 C 1차·resume의 `permission_denials`는 `mis approve plan` 1건뿐이다(기대된 승인 정지). c-cl(Full) 1차는 같은 `approve plan` 2건, resume 0건. pilot-4 run·ship 0건. pilot-6은 `rm -rf "$d"`(mktemp 임시 디렉터리 정리) 2건이 ask→거부됐다. §7 "저장소 밖 rm -rf → ask" 행 그대로이고, 1차 남은 위험에 이미 기록된 사례라 결함이 아니다 |
| 실제 플러그인 설치(마켓플레이스·`plugin install`) | NEEDS_HUMAN (NH-5 유지) | 사용자 설정을 바꾸므로 실행하지 않았다 |

### R2.4 결함 목록 (round 2)

| ID | 심각도 | 내용 | 재현 | 위치 |
|---|---|---|---|---|
| R2-1 | LOW | **D1의 잔여분**: 보고 뒤 안내 문구가 실행할 수 없는 동작을 지시한다.<br>(a) `mis ship`이 생성하는 ship.md 체크리스트(Part B, 보고 뒤에 읽힘)가 여전히 "CHANGELOG.md 갱신 (위 초안 반영 후 check·판정 재실행)"이라고 적는다. 보고 뒤 `mis check`는 거부되고, 새 `phases/ship.md`의 "no more file edits; follow-up run" 규칙과도 모순된다. 데모 C와 c-cl ship.md 모두에 출력됐다.<br>(b) 1차 D1의 `approve config` 절반은 그대로다. 보고 뒤 설정을 바꾸면 `mis verdict` 사유가 "(ask the user: mis approve config)"를 안내하지만, `mis approve config`는 "run is REPORTED"로 거부되고(exit 1) `mis check`도 거부된다. 이 경로(qa-web 등록 등)에서 follow-up run을 안내하는 문구는 `skills/run/phases/ship.md`와 `skills/ship/SKILL.md`에만 있고, `phases/qa.md`나 verdict 사유에는 없다. 거짓 VERIFIED는 없다(PARTIAL로 남음) | (a) 데모 C 실행 후 `docs/make-it-ship/*/ship.md` 릴리스 체크리스트. (b) REPORTED인 pilot-4 사본에서 `.make-it-ship.json`에 `qa-web`을 추가 → `mis approve config` → "mis approve: run is REPORTED" → `mis verdict` 사유에 "ask the user: mis approve config" | (a) `scripts/lib/ship.mjs:35`. (b) `scripts/lib/commands.mjs` (configChangedUnapproved 사유 문구, REPORTED 거부), `skills/run/phases/qa.md:10` |
| R2-2 | LOW | **D5의 잔여분**: README "What happens"가 1 Setup ~ 7 Report만 설명한다. M4에서 추가된 qa 단계(실사용 검증, Standard/Full에서 `qa-*` 필수)와 ship 단계(검증 전 문서·체인지로그, 보고 뒤 초안·커밋, push/PR은 승인 필요)가 없다. 1차 D5가 명시한 항목인데 수정 diff는 명령 목록 두 줄만 바꿨다 | `README.md:31-38` 열람 | `README.md` |
| R2-3 | LOW (신규) | ship.md의 CHANGELOG 초안이 기능 추가를 "Fixed"로 분류한다. `isFix` 정규식이 goal에 `error`라는 단어만 있어도 참이 된다. pilot-4의 goal("…invalid input shows an inline error…")은 새 설정 패널 추가인데, 초안이 `### Fixed`로 나왔다. 모델이 최종 메시지에서 "should be under Added"라고 직접 지적했다. 이 경로에는 테스트가 없다 | pilot-4 (Quick) → `/make-it-ship:ship` → `awk '/## CHANGELOG/,/## 릴리스/' docs/make-it-ship/*/ship.md` | `scripts/lib/ship.mjs:14` (`/\b(fix\|bug\|regression\|broken\|error)\b/`) |

### R2.5 검증 프롬프트 6항 질문 (round 2)
- **통과로 표시됐지만 실행되지 않은 것이 있는가?** 없다.
  - M4-e2e의 iOS 기록은 이번 재현과 일치한다.
  - 파일럿 4의 "approve config 도입 전" 결과는 이제 그렇게 명시돼 있다.
- **§2 M4 행 중 테스트가 없는 것이 있는가?** 없다. 데모 C는 수동 E2E 로그와 `evals.test.mjs`를 함께 갖는다.
  - 새 수정 각각에도 테스트가 있다: D1 `plugin-files.test.mjs`, D2·D3 `mis-report.test.mjs`, D4 `mis-qa.test.mjs`, D7 `mis-ship.test.mjs`.
  - D1 테스트는 지시문의 순서만 검사한다. 실제 동작은 이번 dogfood로 확인했다.
- **스텁·skip·빈 구현이 있는가?** 없다.

### R2.6 미검증 항목·남은 위험
- **미검증 항목**
  - 실제 플러그인 설치 경로(NH-5).
  - 대화형 확인 창(NH-1). 승인은 운영자가 터미널에서 대신했다.
  - `.xcodeproj` 기반 iOS 앱의 시뮬레이터 실행(이번에는 SwiftPM 패키지만 실행).
  - 파일럿 1·2·3·5·7·8은 다시 실행하지 않았다.
- **남은 위험**
  - **Quick 표시의 위치**: Quick에서 web 표면이 "미검증"으로 표시되지만 판정은 여전히 VERIFIED이고, 보고서 headline은 "배포 준비 완료 (정의된 검증 범위 안에서)"다. 6절을 읽지 않으면 놓칠 수 있다. 모드 선택은 여전히 모델 판단이다.
  - **보고 뒤 커밋 정리**: 보고 뒤 Part B에서 모델이 로컬 미푸시 브랜치의 커밋을 `commit --amend`나 `reset --soft`로 다시 만들었다(pilot-4, c-cl). ship.md가 금지하는 것은 "shared history" 재작성이므로 규칙 위반은 아니다. 다만 pilot-4의 ship.md "Commits" 절이 amend 전 해시(`5a624b5`)를 담고 있어 실제 HEAD(`db7baff`)와 다르다.
  - **임시 디렉터리 정리 마찰**: guard의 `rm -rf` 임시 디렉터리 ask가 헤드리스 실행에서 계속 마찰을 만든다(1차와 같음).
