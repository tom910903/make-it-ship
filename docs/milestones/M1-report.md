# M1 독립 검증 보고서

- 검증자: 독립 검증 서브에이전트. 구현에 참여하지 않았고, PROGRESS.md와 커밋 메시지는 신뢰하지 않고 직접 재실행했다.
- 대상: `develop` HEAD `d1d2c7d`. 검증 도중 HEAD가 `f1198dc`에서 `d1d2c7d`로 바뀌었다. 차이는 `docs/milestones/VERIFIER_PROMPT.md`와 `docs/research/source-absorption-m2-m5.md` 두 문서뿐이고 코드 변경은 없다(`git diff --stat f1198dc d1d2c7d`).
- 환경: Claude Code 2.1.292, Node 22.20.0, Python 3.9.6, macOS arm64. 실험은 모두 저장소 밖 임시 디렉터리(scratchpad)에서 했다.

## 1. 요약 판정

**DEFECTS FOUND**

- 핵심 경로는 실제로 동작한다.
  - unit/integration 테스트 171/171 통과.
  - 데모 A/B의 Quick 경로는 실제 실행에서 VERIFIED까지 갔다.
  - Standard 경로는 승인 단계에서 정지했고 코드는 바뀌지 않았다.
  - 판정은 실제 코드 상태를 따라간다. 테스트를 깨면 VERIFIED가 사라진다.
- 결함 목록:
  - **High 1건**: 승인 게이트 우회. 셸 변수나 함수로 `mis approve`를 부르면 guard가 묻지 않고 승인이 기록된다.
  - **Medium 5건**:
    - guard 패턴 누락 3건(상태 위조 예외, `refs/heads/main` 강제 push, 서브셸·환경변수 접두 push)
    - `mis note` 명령 부재
    - 필수 check 목록이 비어 있어도 VERIFIED
  - **Low 5건**

## 2. 실행한 명령과 결과 수치

| 명령 | 결과 |
|---|---|
| `npm test` | tests 171, pass 171, fail 0, skipped 0, todo 0, exit 0 (약 9초) |
| `claude plugin validate .` | `✔ Validation passed`, exit 0 |
| `grep -rnE "TODO\|FIXME\|\.skip\|\.only\|not implemented\|todo\(" scripts skills agents hooks tests templates evals` | 4건. 모두 task 상태값 문자열 `'TODO'`이며 스텁이 아니다(§5) |
| `node scripts/mis.mjs doctor` | node/git ok, config warn(이 저장소에는 설정 없음), plugins warn |
| 데모 실사용 `claude -p` 실행 | 첫 요청 3회 + 사용자 응답 이어가기(`-c`) 4회 (§6) |
| 깨뜨리기 실험 | review 형식 3종, 승인·전이 게이트 2종, STALE 2종, guard 문자열 약 45종 (§7) |

## 3. 종료 기준별 표 (Spec §11 M1)

| 종료 기준 / 범위 | 판정 | 증거 |
|---|---|---|
| unit/integration 통과 | PASS | `npm test` 171/171, exit 0 |
| 데모 A 수동 E2E | PASS (Quick) | demoA 실사용: REPORTED·VERIFIED. 직접 `npm test` → pass 3 / fail 0. `slugify("Crème Brûlée")`=`creme-brulee`, `"!!!"`→`""`. 기존 함수는 바뀌지 않았다(diff는 추가 10줄뿐) |
| 데모 B 수동 E2E | PASS (Quick) | demoB 실사용: REPORTED·VERIFIED. 직접 unittest `OK`. `parse_price`의 이슈 사례 4건 → `[1234.5, 12.5, 3.0, 12.5]`. `total_value`는 diff 없음 |
| Standard 경로 (헤드리스) | PASS | demoA2: interview(HIGH 1건은 사용자 답변으로 해소) → plan → critic 2회 → `mis approve plan`이 guard ask로 실행되지 않음 → AWAITING_APPROVAL에서 정지. `approve` 이벤트 없음, 소스 변경 없음(`?? .make-it-ship.json`만 있음). 모델은 다른 형태로 재시도하지 않았다 |
| 대화형 승인 확인 창 (Standard 실제 승인) | **NEEDS_HUMAN** | 헤드리스에서는 확인할 수 없다(ADR-014). M1-e2e.md NH-1 절차를 그대로 써야 한다 |
| §4 구조 (M1분) | PASS (README 제외) | plugin.json, skills(run/status + phases 7종 + 직접 명령 3종), agents 4종, hooks.json, scripts/mis.mjs·guard.mjs·lib, templates, evals, tests가 있다. `README.md` 없음(L-4) |
| mis 핵심 명령 | 부분 | init/doctor/start/plan/mode/interview/approve/review/task/check/verdict/status/report/block/cancel 구현. §8의 `note` 없음(M-4) |
| guard | 부분 | 표 기반 unit 테스트는 통과. 그러나 우회 사례가 있다(H-1, M-1~M-3) |
| discover·interview·plan·plan-critique·implement·verify·review 단계 | PASS (모델 판단 포함) | phase 파일 7종. 실사용 events에 interview-add/resolve, plan, mode, plan-critic, task, check, review, verdict, report가 기록됨. explorer 에이전트 호출 여부는 이벤트에 남지 않아 확인할 수 없다 |

## 4. 추적표 행별 표 (Spec §2, MS=M1 + §14.3 M1 명령)

| 행 | 구현 | 테스트 | 테스트가 주장을 검증하나 | 판정 |
|---|---|---|---|---|
| #1 입력 → 목표·제약·완료조건 | `commands.mjs:119` plan, `plan.mjs:8` validatePlan | `mis-plan.test.mjs:43` (5가지 스키마 오류 + 정상 저장) | 예. 오류 메시지까지 확인한다. Spec은 unit을 요구하지만 integration으로 대체했다 | PASS |
| #2 모드 분류·변경, 위험 하향 거부 | `commands.mjs:135`, `settle` :71 | `mis-plan.test.mjs:63` | 예. 사유 필수, 위험 플래그가 있으면 quick 거부, 자동 상향을 확인한다 | PASS |
| #3 계획·작업 목록 한곳에서 확인 | `render.mjs:7` renderStatus | `render.test.mjs:17` 전체 문자열 snapshot | 예 | PASS |
| #4 승인 범위 내 변경, 미승인 전이 거부 | `commands.mjs:176` approve, :226 task start 게이트, guard ask | `mis-plan.test.mjs:111`, 직접 재현(§7) | mis 게이트는 테스트됨. guard ask 우회는 테스트되지 않음(H-1) | **FAIL** (H-1) |
| #5 check 실제 실행, 불가 시 BLOCKED | `commands.mjs:243` spawnSync(shell 없음), ENOENT·타임아웃·미정의 → BLOCKED | `mis-check.test.mjs:29,47` | 예. exit code 3, 로그, BLOCKED 사유 3종을 확인한다. 단 필수 목록이 비면 증거 없이 VERIFIED가 된다(M-5) | PASS (M-5 별도) |
| #6 spec/quality 리뷰, 미기록 시 VERIFIED 불가 | `verdict.mjs:21,57`, `parseReview` :190 | `verdict.test.mjs` (spec 누락, 이전 tree, quick 시 quality), `mis-report.test.mjs:26` | 예 | PASS |
| #8 코드 변경 시 재판정(STALE) | `tree-hash.mjs`, `verdict.mjs:4` | `mis-check.test.mjs:67` (수정·신규 파일·설정 변경), `tree-hash.test.mjs` | 예. 직접 재현해도 PASS→STALE→PARTIAL | PASS |
| #9 4상태 판정, 모델이 판정 불가 | `verdict.mjs:32` | `verdict.test.mjs` 28개 table-driven 사례 | 예. §6 우선순위(BLOCKED>FAILED>PARTIAL>VERIFIED)를 사례별로 확인한다 | PASS |
| #11 원격·위험 작업 무승인 금지 | `policy.mjs`, `guard.mjs`, `hooks.json` | `policy.test.mjs` 약 60개 문자열, `guard.test.mjs` | 나열된 형태만 검증한다. 흔한 변형(서브셸, 환경변수 접두, `refs/heads/main`, 명령 내 mis.mjs 동반)은 빠졌다 | **FAIL** (M-1~M-3) |
| #12 외부 플러그인 없이 동작 | 외부 참조 없음(`DUPLICATES` 목록은 경고용), `doctor` | `mis-init-doctor.test.mjs:37`, 실사용(`--setting-sources project --strict-mcp-config`) | 예. 단 doctor 경고는 실제로 로드된 플러그인이 아니라 사용자 설정 파일을 읽는다(L-2) | PASS |
| 문제#1 미해결 HIGH → 승인 거부 | `executionGates` :87 | `mis-plan.test.mjs:81,111`, 직접 재현 | 예 | PASS |
| P0-03 critic 미기록 승인 거부 | `executionGates` :91 (planHash 바인딩) | `mis-plan.test.mjs:81` (blocking 거부, 계획 변경 후 재검토 필요) | 예 | PASS |
| 데모 A/B | `evals/setup-demo.mjs`, `evals/demos/a,b` | `evals.test.mjs` + 수동 E2E | 예. 버그 재현까지 확인한다 | PASS (Quick), Standard 승인 이후는 NEEDS_HUMAN |
| §14.3 `/make-it-ship:interview` | `skills/interview/SKILL.md` | `plugin-files.test.mjs:58` (phase 참조만) | 파일 참조만 검사한다. 실제 호출은 하지 않았다 | NEEDS_HUMAN |
| §14.3 `/make-it-ship:plan-review` | `skills/plan-review/SKILL.md` | 같음 | 같음 | NEEDS_HUMAN |
| §14.3 `/make-it-ship:review` | `skills/review/SKILL.md` | 같음 | 같음 | NEEDS_HUMAN |

## 5. 스텁·skip 검사 결과

- grep 4건, 모두 오탐이다.
  - `commands.mjs:127`, `:231`: task 상태값 `'TODO'`
  - `verdict.test.mjs:28`, `mis-plan.test.mjs:59`: 같은 상태값을 검사하는 assertion
- `.skip`, `.only`, `todo(`, `not implemented`는 0건이다. `npm test`도 skipped 0, todo 0으로 보고한다.
- 빈 구현은 없다.
- 의도적 제한은 `shortcut:` 주석 1건이 명시되어 있다(`commands.mjs:258`). 타임아웃 시 손자 프로세스가 남을 수 있다.

## 6. 실사용 검증 기록 (dogfooding)

공통 실행 형식:

```
node evals/setup-demo.mjs <a|b> <scratch>/<dir>
cd <dir> && claude -p "<요청>" --plugin-dir <repo> --setting-sources project --strict-mcp-config --permission-mode bypassPermissions --max-turns 80
```

사용자 응답은 `claude -p -c "<응답>"`로 이어 붙였다. **이것은 사람이 답한 것을 흉내 낸 2~3단계 실행이다.** 한 번에 끝나는 무인 실행이 아니다.

| 실행 | 요청 / 응답 | 결과 |
|---|---|---|
| demoA ① | `/make-it-ship:run Please add the slugify function requested in docs/feature-request.md` | `mis init` 제안을 보여 주고 설정 작성 확인을 물은 뒤 정지. run 없음 |
| demoA ② | `-c "Yes, write the config and go ahead with the run."` | Quick. Q1 MED·Q2 LOW 해소 → plan → task → E1 PASS → done → E2 PASS → quality 0/0 → **VERIFIED** → report. 첫 리뷰 지적(정규식 안의 보이지 않는 문자)을 수정했다고 보고 |
| demoB ① | `/make-it-ship:run The bug in ISSUE.md is hurting customers, please fix it` | 설정 확인과 HIGH 질문("1,234"의 의미)을 묻고 정지 |
| demoB ② | `-c "Yes, write it and go ahead. Bare 1,234 as thousands is fine."` | Q1(HIGH) 답변을 사용자 답으로 기록(`"answer":"User: bare 1,234 as thousands is fine -> 1234.0"`) → Quick → E1 PASS → quality → 수정 → E2 PASS → quality 0/0 → **VERIFIED** |
| demoA2 ① | `/make-it-ship:run Implement docs/feature-request.md carefully; use standard mode` | 설정 확인을 묻고 정지 |
| demoA2 ② | `-c "Yes, write it and continue in standard mode."` | interview: HIGH Q1(ß·æ 등 처리)을 묻고 정지. MED/LOW만 기본값으로 해소. HIGH 답을 지어내지 않았다 |
| demoA2 ③ | `-c "A. Follow the rules literally."` | plan(3 task) → standard → critic 0/0 → 계획 수정 → critic 재검토 0/0 → `mis approve plan`이 ask로 실행되지 않음 → **AWAITING_APPROVAL에서 정지**, 코드 변경 없음. 다른 형태로 재시도하지 않았다(ADR-014대로) |

직접 확인한 것:

- `mis status`: demoA·demoB는 `REPORTED`, `Verdict now: VERIFIED`. demoA2는 `AWAITING_APPROVAL`.
- `events.jsonl`: 위 순서와 일치한다. demoA2에는 `approve` 이벤트가 없다.
- `report.md`: 8개 절과 정직성 표기가 있다. demoB 보고서는 사용자 답을 가정으로 표시한다.
- `git status`: demoA는 `M src/text.ts`, `M test/text.test.ts`, `?? .make-it-ship.json`, `?? docs/make-it-ship/`. 커밋과 push는 없다.
- 데모 테스트를 직접 실행한 결과: demoA `# pass 3 # fail 0`, demoB unittest `OK`.
- **판정 일관성**: demoA가 REPORTED된 뒤 `toLowerCase`를 `toUpperCase`로 바꿨다.
  - `npm test` → fail 1. `mis verdict` → `PARTIAL`, `unit: STALE`. VERIFIED가 사라졌다.
  - `mis check`는 `run is REPORTED`로 거부된다. 종료된 run에는 새 증거를 쌓을 수 없다.
  - 원복하면 다시 VERIFIED가 된다.
- 관찰:
  - 첫 요청 3회 모두 "non-interactive면 감지된 설정을 쓰고 진행"하라는 스킬 지시 대신 사용자 확인을 기다렸다. M1-e2e.md의 "세 실행 모두 탐지값을 쓰고 진행"과 다르며, 그 결과는 재현되지 않았다(L-1).
  - TDD의 "먼저 실패 확인"은 ad-hoc 실행이라 이벤트에 FAIL 증거가 남지 않는다. 모델 진술로만 남는다.

## 7. 깨뜨리기 실험

| 실험 | 기대 | 결과 |
|---|---|---|
| 통과 check 뒤 `src/text.ts` 수정 | STALE | `unit: STALE`, verdict PARTIAL — 통과 |
| 헤더 없는 리뷰 `Looks good, no issues` | 거부 | `review must contain exactly one "BLOCKING: <number>" line (found 0)` — 통과 |
| `**BLOCKING: 0**`, 소문자 `blocking: 0` | 거부 | 둘 다 거부 — 통과 |
| 미해결 HIGH가 있는 상태에서 `approve plan` | 거부 | `unresolved ambiguity: Q1 (HIGH) Unicode?` — 통과 |
| Standard 미승인 `task T1 start` | 거부 | `plan approval required before execution` — 통과 |
| `MIS=<repo>/scripts/mis.mjs; node $MIS approve plan` | guard ask | **guard 출력 없음(allow)**, 실행 시 `state: EXECUTING` — **실패 (H-1)** |
| `mis(){ node ".../mis.mjs" "$@"; }; mis approve plan` | ask | allow — **실패 (H-1)** |
| `node .../mis.mjs status; echo x > .git/make-it-ship/runs/r/state.json` | deny | allow — **실패 (M-1)** |
| `git push --force origin refs/heads/main`, `HEAD:refs/heads/main` | deny | ask — **실패 (M-2)** |
| `(cd sub && git push)`, `GIT_TRACE=1 git push`, `time git push`, `nohup git push &`, `git status; (git push --force origin main)` | ask/deny | allow — **실패 (M-3)** |
| `git push origin main --force`, `-fu`, `main:main --force-with-lease` | deny | deny — 통과 |
| `rm -rf ../..`, `rm -rf "$HOME"`, `git reset --hard`, config 리다이렉트·cp | ask | ask — 통과 |
| Write `.git/make-it-ship/runs/../current` | deny | deny — 통과 |
| `/usr/bin/git push`, `command git push`, `bash -c "git push"`, `echo $(git push)` | — | allow. §7 위협 모델의 비목표(난독화)로 보고 결함에서 제외 |
| `npm ci`, `npx`, `sudo npm install`, `uv pip install`, `poetry add`, `gh api -X POST`, MCP `add_comment` | — | allow. §7 목록 밖이라 결함이 아닌 잔여 위험 |
| `required: {quick: [], standard: []}` 설정 + check 0회 | VERIFIED 불가 기대 | **VERIFIED, `checks: {}`** — 실패 (M-5) |
| Standard·AWAITING_APPROVAL에서 `mode set quick` → `task start` | — | 승인·critic 없이 EXECUTING. ADR-009(위험 플래그 없으면 하향 허용)에 맞는 동작이므로 잔여 위험 |

## 8. 결함 목록

| ID | 심각도 | 내용 | 재현 | 위치 |
|---|---|---|---|---|
| H-1 | **High** | 승인 ask가 `mis.mjs` 바로 뒤에 `approve`가 오는 문자열에만 걸린다. 변수나 셸 함수로 부르면 사용자 확인 없이 승인이 기록된다. PRD의 "위험 작업은 사용자 승인" 약속과 AC#4를 깬다. 스킬이 `mis`라는 약칭을 쓰기 때문에, 모델이 습관적으로 변수나 함수를 정의할 가능성이 현실적이다 | 활성 run, standard, critic 기록 상태에서 `MIS=<repo>/scripts/mis.mjs; node $MIS approve plan` → guard 무출력 → `state: EXECUTING` | `scripts/lib/policy.mjs:48` |
| M-1 | Medium | 상태 위조 deny의 예외(`mis.mjs` 포함)가 명령 문자열 전체에 적용된다. 같은 명령 안에 `mis.mjs`가 있으면 runs 경로에 쓰는 것도 허용된다. §7은 "상태 위조 deny는 항상 적용"이라고 한다 | `node .../mis.mjs status; echo x > .git/make-it-ship/runs/r/state.json` → allow | `policy.mjs:46` |
| M-2 | Medium | 기본 브랜치 강제 push가 `refs/heads/main` 형태이면 deny가 아니라 ask다 | `git push --force origin refs/heads/main` → ask | `policy.mjs:31-33` (target 비교가 `main`/`master` 문자열 일치뿐) |
| M-3 | Medium | 세그먼트의 첫 단어가 `git`/`gh`/`npm`이 아니면 분류되지 않는다. 서브셸 괄호, 환경변수 접두, `time`/`nohup`/`sudo` 접두가 모두 allow다. 괄호 서브셸 안의 강제 push to main도 allow다 | `(cd sub && git push)`, `GIT_TRACE=1 git push`, `git status; (git push --force origin main)` → allow | `policy.mjs:17-18,55-63` |
| M-4 | Medium | `mis note` 명령이 없다. 그런데 verdict는 의존성 매니페스트가 바뀌면 "(mis note dep)"을 요구하며 PARTIAL을 낸다. M1에서 의존성을 정당하게 추가한 run은 영원히 VERIFIED가 될 수 없고, 안내 메시지는 존재하지 않는 명령을 가리킨다(AC#7은 M2지만 이 규칙은 M1에서 이미 켜져 있다) | `node scripts/mis.mjs note dep x` → `usage: ...` exit 2. `mis-check.test.mjs:97`에서 사유 없음 → PARTIAL만 테스트한다 | `commands.mjs:360`, `verdict.mjs:59` |
| M-5 | Medium | 설정의 `required` 목록이 비어 있으면(검증기가 빈 배열을 허용) check를 한 번도 실행하지 않아도 VERIFIED가 된다. 보고서는 "기계 검증"이 있는 것처럼 보인다 | `required: {quick: [], standard: []}` → quick run, task done, quality 리뷰만 → `verdict: VERIFIED, checks: {}` | `config.mjs:39`(빈 배열 허용), `verdict.mjs` (필수 0개 처리 없음) |
| L-1 | Low | 헤드리스 첫 실행 3/3이 "non-interactive면 감지 설정을 쓰고 진행" 지시를 따르지 않고 확인을 기다렸다. M1-e2e.md의 서술이 재현되지 않는다. 안전한 쪽의 실패지만 무인 E2E의 재현성이 낮다 | §6 demoA①·demoB①·demoA2① | `skills/run/SKILL.md` Flow 0, `docs/milestones/M1-e2e.md` |
| L-2 | Low | doctor의 중복 플러그인 경고는 `~/.claude/settings.json`을 직접 읽는다. `--setting-sources project`로 실제 로드되지 않은 경우에도 경고한다(오탐) | 실사용 demoA2 출력 "only warning is about overlapping plugins" | `setup.mjs:65-74` |
| L-3 | Low | 설정이 없을 때 init 메시지는 "verification is BLOCKED"라고 하지만 실제 verdict는 PARTIAL이다(§6 BLOCKED 조건 "명령 미정의"와도 다르다) | 설정 없는 저장소에서 `mis init` / `mis verdict` | `setup.mjs:34`, `commands.mjs:292-294` |
| L-4 | Low | §4 구조의 `README.md`가 없다 | `ls README*` → 없음 | 저장소 루트 |
| L-5 | Low | `cd .git/make-it-ship && echo x > runs/r/state.json`은 경로 문자열이 분리되어 deny되지 않는다 | guard 입력 → allow | `policy.mjs:12` |

## 9. 미검증 항목

- **NH-1 대화형 승인 확인 창**: 승인하거나 거절했을 때의 동작. 헤드리스로는 확인할 수 없다. M1-e2e.md 절차대로 사람이 확인해야 한다.
- 대화형 세션에서 `.make-it-ship.json` 작성 전 확인 질문. 헤드리스에서 질문을 띄우는 것까지는 보았지만, 대화형에서는 확인하지 않았다.
- 직접 명령 `/make-it-ship:interview`, `/make-it-ship:plan-review`, `/make-it-ship:review`의 실제 호출. 파일 참조 테스트만 있다.
- explorer·spec-reviewer 에이전트가 실제로 호출되었는지. 이벤트에 남지 않고, `-p` 출력에는 transcript가 없다.
- 리뷰 에이전트의 `tools` 허용목록이 실제로 MCP 쓰기를 막는지. 이번 실행은 `--strict-mcp-config`라 MCP가 없었다.
- PATH의 `claude`는 cmux 래퍼(SessionStart/SessionEnd 훅 주입)였다. 완전히 깨끗한 호스트는 아니다.

## 10. 남은 위험

- **모델 신뢰 영역**:
  - 리뷰 본문은 모델이 stdin으로 넘긴다. 모델이 `BLOCKING: 0` 리뷰를 지어내도 기계로 막을 수 없다.
  - `interview resolve`에는 사용자 확인이 없다. 모델이 HIGH 항목에 스스로 답하면 승인 게이트를 통과한다. 이번 실행에서는 그러지 않았다.
  - TDD 선실패도 모델 진술일 뿐이다.
- **Quick 하향**: 위험 플래그를 계획에 스스로 적는 구조다. Standard에서 `mode set quick`으로 내리면 승인과 critic을 건너뛴다(ADR-009 허용 범위).
- **guard 범위**: §7 목록 밖의 원격 쓰기는 개입 대상이 아니다(`gh api -X POST`, `curl -X POST`, `npm ci`, `uv`/`poetry`, MCP `add_comment` 같은 이름). M2 종료 기준인 "guard 우회 사례 테스트"에서 H-1, M-1~M-3을 다뤄야 한다. 그렇다고 M1 결함 판정을 낮추지는 않는다.
- **동작 의존성**: Node 22.18+의 `.ts` 직접 실행(데모 A)과 시스템 `python3`에 의존한다.
