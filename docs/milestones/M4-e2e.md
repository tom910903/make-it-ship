# M4 E2E 기록 — 새 환경 설치, 데모 C, 파일럿 8종 (2026-10-19)

## 1. 새 환경 설치 → 소형 프로젝트 완료 (§11 M4 종료 기준)

**절차** (`evidence/m4/c1-install-log.txt`)
1. 플러그인 저장소를 새 디렉터리에 `git clone`했다. 의존성 설치 단계는 없다(ADR-003).
2. 그 디렉터리에서 `npm test`(282 통과)와 `claude plugin validate .`(통과)를 실행했다.
3. `node evals/setup-demo.mjs c <dir>`로 요구사항 문서만 있는 저장소를 만들었다.
4. 외부 플러그인이 없는 설정으로 실행했다: `claude -p ... --plugin-dir <clone> --setting-sources project --strict-mcp-config`.

**요청**: `/make-it-ship:run Build the app described in REQUIREMENTS.md. Use full mode. Proceed without asking me questions.`

**결과**
- 1차 실행 흐름은 다음과 같다.
  1. explorer, architect, critic, product-reviewer 에이전트를 호출했다(stream-json으로 확인).
  2. interview 8건을 기록했고 모두 MED/LOW라 기본값으로 해소했다.
  3. plan 4개 작업을 세웠다.
  4. plan-critic 리뷰와 product 리뷰를 기록했다.
  5. 승인 단계에서 정지했다(헤드리스, ADR-014).
- 운영자가 터미널에서 `mis approve plan`을 실행했다. 대화형 확인 창 자체는 NH-1로 남아 있다.
- 2차 실행 흐름은 다음과 같다.
  1. 작업 T1~T4를 테스트 우선으로 구현했다.
  2. `qa/cli-smoke.mjs`를 작성했다.
  3. `unit` PASS(E6), `qa-cli` PASS(E7).
  4. spec·quality 리뷰 0/0.
  5. **VERIFIED**.
- **운영자 직접 확인**: 결과물 `bin/tally.js`로 add, today, week, 잘못된 이름(exit 2), 사용법(exit 2)을 실행했다. 모두 요구사항대로 동작했다. 단위 테스트 27개 통과, smoke exit 0.
- 판정: 종료 기준 **PASS**. 승인 확인 창만 NEEDS_HUMAN(NH-1)이다.

## 2. 파일럿 과제 8종 (PRD 13.3, `evals/PILOTS.md`)

| # | 과제 | 모드 | 리뷰 | check 기록 | 원인 기록/재개/승인 | 최종 판정 | 기대와 일치 |
|---|---|---|---|---|---|---|---|
| 1 | Python CLI 기능 | quick | quality | unit PASS | – | VERIFIED | 예 |
| 2 | TS 버그 수정 | quick | quality | unit **FAIL → PASS** | rootcause 1 | VERIFIED | 예(재현 후 수정) |
| 3 | 권한 검증 | standard (auth 위험 플래그) | plan-critic, spec, quality, **security** | unit PASS | 승인 1(운영자 대리) | VERIFIED | 예 |
| 4 | UI 작은 화면 | standard | plan-critic, spec, quality | unit, **qa-web** PASS | 승인 1 | VERIFIED | **부분**(아래) |
| 5 | 3개 모듈 동시 변경 | standard | plan-critic ×3(재검토), spec, quality | unit PASS | 승인 1 | VERIFIED | 예 |
| 6 | 테스트 없는 프로젝트 | quick | quality | test **BLOCKED** | – | **PARTIAL**("no required checks defined") | 예(정직한 보고) |
| 7 | 실패 테스트 저장소 | quick | quality | unit FAIL → PASS | rootcause 1 | VERIFIED | 예 |
| 8 | 세션 강제 종료 후 재개 | quick | quality | unit FAIL → [kill] → PASS | rootcause 1, resume 1 | VERIFIED | 예 |

**파일럿 4에서 발견한 결함과 수정**
- 모델이 Node 내장 기능만으로 headless Chrome(CDP)을 구동하는 `qa/web-smoke.mjs`를 작성했고, 실제 브라우저 QA를 통과했다. 이것은 좋은 결과다.
- 그러나 run 도중 `.make-it-ship.json`에 `qa-web`을 **guard 확인 없이** 추가했다. 그 사실은 최종 보고에서 알렸다. guard는 Write/Edit와 일부 Bash 형태만 잡는다.
- 수정: `mis`가 run 시작 시점의 configHash와 현재 값을 비교한다. 다르고 `mis approve config`(guard가 확인 창을 띄움) 기록이 없으면 판정을 **PARTIAL**로 고정한다. 파일을 어떤 도구로 바꿨든 같다.
- 테스트: `tests/integration/mis-check.test.mjs` "config changed during the run".

**M4 독립 검증 재실행 결과 (M4-report D3·D6 반영)**
- 위 파일럿 4의 VERIFIED는 `mis approve config` 도입 **전** 코드의 결과다.
- 검증자 재실행에서 같은 요청은 모델이 Quick을 선택해, 브라우저 QA 없이 VERIFIED가 됐다. Quick은 qa가 필수가 아니다(§14.1).
- 이 경우 보고서 6절과 ship의 "Not verified"에 "web 표면: 실사용 QA 미실행"이 나와야 하는데 빠져 있었다. D3로 수정했다.
- Standard로 지정하면 BLOCKED로 정직하게 끝났다.

**데모 C의 ship 단계**: 위 c1 실행은 Full 모드였다. 다만 요청이 "through ... report"여서 ship 단계를 실행하지 않았다. ship은 검증자가 별도 run에서 `/make-it-ship:ship`으로 확인했다(READY / NOT READY 모두).

**iOS 시뮬레이터 QA (M4 D4 수정 후 실측)**
- 합성 SwiftPM iOS 패키지에서 `mis qa detect`가 `xcodebuild test -scheme Pkg -destination 'platform=iOS Simulator,name=iPhone 17 Pro'`를 제안했다.
- 이를 `qa-ios` check로 실행해 PASS를 얻었다(1 test, 0 failures).
- 첫 실행은 예제 테스트 코드의 오류(이름 충돌)로 FAIL이었고, mis가 그대로 FAIL로 기록했다.

**파일럿 6**: 탐지할 수 있는 check가 없는 셸 프로젝트다. 모델이 테스트 스크립트를 작성했지만, 설정에 넣으려면 승인이 필요해 실행할 수 없었다(BLOCKED). 판정은 PARTIAL이고, 사용자 결정 항목으로 보고했다. "검증하지 않은 것을 완료라 하지 않는다"가 지켜졌다.

## NEEDS_HUMAN
- NH-1(승인 확인 창)은 여전히 유효하다. 파일럿 3·4·5와 데모 C의 승인은 모두 운영자가 터미널에서 대리했다.
- NH-5: 실제 플러그인 설치 경로(마켓플레이스 등록 또는 `claude plugin install`)는 사용자 설정을 바꾸므로 확인하지 않았다. README의 설치 절차를 따라 사람이 확인해야 한다.
