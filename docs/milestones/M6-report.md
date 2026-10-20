# M6 독립 검증 보고서 (상시 계층)

- 검증일: 2026-10-20 · 브랜치 develop (HEAD 89e9ac4) · Claude Code 2.1.292 · Node v22.20.0
- 검증자: 독립 verifier (구현에 참여하지 않음). PROGRESS·커밋 메시지는 믿지 않고 모두 직접 다시 실행했다.
- 실험은 모두 저장소 밖 임시 디렉터리에서 했고, `MIS_STATE_HOME`도 임시 디렉터리로 지정했다. 검증이 끝난 뒤 `~/.make-it-ship`이 없음을 확인했고, 저장소에서 바뀐 것은 이 보고서 하나뿐이다.

## 요약 판정

**DEFECTS FOUND** (HIGH 3 · MEDIUM 3 · LOW 6)

잘 동작하는 부분:
- `npm test` 348/348, `claude plugin validate` 모두 통과했다.
- fail-open 훅 48건 모두 exit 0이었고, 의도하지 않은 block은 0건이었다.
- guard는 내부 오류 때 ask로 처리한다(fail-closed).
- 실사용에서 다음이 실제로 모델까지 전달되었다.
  - SessionStart·UserPromptSubmit·SubagentStart 맥락
  - Stop 훅의 block
  - VERIFIED로 끝나는 loop
  - statusLine 렌더링

M6 종료를 막는 결함:
1. **loop가 세션에 묶여 있지 않다.** 다른 세션·worktree에서 멈추려 해도 block되고, 저장소 밖 cwd에서는 전역으로 막힌다.
2. **loop가 이전 run의 VERIFIED를 근거로 끝난다.** 새 작업을 했다는 증거 없이 "finished … VERIFIED"를 선언한다.
3. **ralph/랄프 키워드 오탐이 심하다.** 사람 이름, 따옴표 속 언급, "stop the ralph loop" 같은 불만 문장도 loop를 시작시킨다.

## 실행한 명령과 결과 수치

| 명령 | 결과 |
|---|---|
| `npm test` | tests 348 · pass 348 · fail 0 · skipped 0 · todo 0 · 약 20.2초 · exit 0 |
| `claude plugin validate .` | `✔ Validation passed` · exit 0 |
| 스텁 grep (아래 절) | 8건, 모두 작업 상태 값 `'TODO'` (스텁 아님) |
| fail-open 매트릭스 | 이벤트 6개 × 입력 8종 = 48건: exit 0 48건, block 0건 |
| guard 깨진 입력 (`''`, `{garbage`, `null`) | 모두 `permissionDecision: ask` (fail-closed). `[]`는 도구 이름이 없어 allow |
| 키워드 오탐 시험 | MIS `mis test-prompt` 약 35문장. 그중 13문장은 OMC `keyword-detector.mjs` 원본에도 같은 문장을 넣어 비교 |
| 헤드리스 실사용 | 5회, 총 비용 약 $0.95 |
| tmux 대화형 실사용 | 1회 |

## 항목별 표

| ID / 범위 | 판정 | 증거 |
|---|---|---|
| M6-01 전역 상태 `MIS_STATE_HOME`, 스타일 off/lite/full/ultra, `mis style [lvl]`, `mis style default` | **FAIL** | 레벨·규칙 생성은 동작한다(`style.test.mjs`, 직접 실행으로 확인).<br>하지만 **"세션 레벨"이 실제로는 전역에 영구 저장된다.** 재현: `mis style lite` → `mis style default ultra` → 새 SessionStart를 열면 `level: lite`가 주입된다. default는 영원히 가려진다(D3).<br>테스트 `'sets the session level'`은 새 세션에서의 동작을 시험하지 않는다. |
| M6-02 SessionStart: 스킬 규율, TDD·검증·디버그 규율, 스타일, run·loop 안내, 코드베이스 지도 | PASS | `hooks-session.test.mjs`가 실제 출력의 내용을 검사한다(동어반복 아님).<br>실사용 a: 모델이 13개 스킬, `STYLE — level: full`, `src/: capitalize, truncate`를 그대로 보고했다.<br>2만 파일 합성 저장소에서 0.9초. |
| M6-03 SubagentStart 스타일 주입, `subagentMatcher` | PASS | 테스트는 matcher의 포함·제외와 잘못된 정규식을 다룬다.<br>실사용 e: general-purpose 서브에이전트가 `MAKE IT SHIP STYLE — level: full`을 그대로 인용했다. |
| M6-04 키워드 라우터 (§2.5, 한국어, 비활성 목록), 스타일 문구, 학습 스킬, `mis test-prompt` | **FAIL** | 영어·한국어 양성 판정, 충돌 해소, `disabled`, 학습 스킬, `test-prompt` 드라이런은 동작한다.<br>오탐 회귀가 있다(D2·D4·D7), 일본어 변형이 없다(D9).<br>README의 "따옴표 속 언급은 트리거되지 않음"은 거짓이다. 테스트의 "quotes"는 백틱과 `>` 인용만 시험한다. |
| M6-05 loop start/status/cancel, Stop 훅 (증거 기반 종료, 상한, 정체), 컨텍스트 경고 | **FAIL** | `loop.test.mjs` 7건은 실제 상태 전이를 검사한다.<br>실사용 b: `endReason: verified`. 실사용 c: block 2회 후 `endReason: limit`.<br>그러나 세션 범위(D1), 이전 run의 VERIFIED(D5), cancel 연동(D6)에 결함이 있다. |
| M6-06 statusLine (run 없이 스타일·모드·브랜치·모델·ctx 표시) | PASS (범위 일부 LOW) | 테스트와 tmux 실측 모두 통과: `MIS ▸ idle · style full · main · Opus 5.5` → 프롬프트 후 `style ULTRA · … · ctx 18%`.<br>이상한 입력 7종과 홈 경로가 파일인 경우 모두 exit 0이었다.<br>§6.2의 에이전트 수·todo 요소와 기존 statusLine 체이닝은 없다(D11). |
| M6-07 run 밖 careful (main force push deny, 파괴 명령 ask), freeze/unfreeze | **FAIL (LOW 여러 건)** | force push to main → deny, `reset --hard`·`clean -f`·`checkout .`·kubectl·docker·SQL DROP → ask, `checkout -b`·`rm -rf node_modules`(실경로) → allow.<br>`git restore --staged .` → ask(D8). freeze가 심볼릭 링크로 우회된다(D10).<br>guard 테스트에 심볼릭 링크 경우가 없다. |
| M6-08 PostToolUse 규칙 주입 (세션당 1회), 편집 8회 알림, 같은 실패 3회 시 근본 원인 안내 | PASS | 직접 실행: `.cursor/rules`의 globs·alwaysApply 규칙이 세션당 한 번만 주입된다. 8번째 Edit에서 알림, `npm test` 후 카운터 리셋, 3번째 실패에서 안내가 나온다.<br>`hooks-posttool.test.mjs`가 같은 내용을 검사한다. |
| M6-09 새 스킬 (loop·cancel·style), hooks.json, THIRD_PARTY_NOTICES, README | PASS (README 문구 1건은 D2에 포함) | NOTICES의 저작권 줄 4개가 원본 LICENSE와 정확히 일치한다(MIT, 4.15.6/6.1.1/5.2.0/1.58.5.0).<br>`plugin-files.test.mjs`가 hooks.json의 모든 이벤트 연결을 검사한다. |
| gap §7: SessionStart 모드 복원 안내 | PASS | 활성 run·loop 안내는 테스트와 코드로 확인했다. |
| gap §7: 한·일 변형 | **FAIL** | 일본어 없음 (D9). |
| gap §7: cancel 통합 | **FAIL** | D6 |
| gap §7: 규칙 주입·학습 스킬·검증 알림 | PASS | 위 M6-04·M6-08 참조 |
| gap §7: 전역 지시문 교체 제안 (§6.1) | NEEDS_HUMAN | §7 M6 행에는 포함되어 있다. 그러나 §6.1 본문은 "M9 setup"이라고 하고, PROGRESS M9 행에도 "CLAUDE.md 라우팅 작성"이 있다. 범위를 옮긴다는 ADR이 없어 사용자 확인이 필요하다. 구현은 없다. |
| §6.3 fail-open / guard fail-closed | PASS | 아래 절 참조 |
| ADR-0003 단독 설치 | PASS | 실사용 a의 init 플러그인 목록에는 make-it-ship과 builtin뿐이었다. 원본 4종 없이 맥락이 주입되었다. |
| 대화형 ask 확인 창 (guard ask 시 사용자 경험) | NEEDS_HUMAN | tmux에서 상태줄만 확인했다. 확인 창의 문구와 흐름은 사람이 판단해야 한다. |

## 원본 대비 비교 메모

**OMC keyword-detector**
- OMC 원본에는 다음 장치가 있다.
  - ralph: `hasExplicitRalphInvocationContext`로 명시적 호출일 때만 인정
  - 랄프: 뒤에 켜/실행/돌려 같은 동사가 있어야 인정
  - 따옴표 예외
  - 진단 의도 필터 ("keeps looping")
  - 잡담 필터
- MIS는 정규식 한 줄과 "질문(?) + 도움말 단어" 필터만 있다.
- 같은 문장 비교 (OMC → MIS):

| 문장 | OMC | MIS |
|---|---|---|
| `Ralph from QA reported a bug in login, fix it` | 없음 | loop |
| `랄프가 어제 회의에서 말한 버그 고쳐줘` | 없음 | loop |
| `랄프에게 이메일 보내는 기능 추가해줘` | 없음 | loop |
| `the UW campus map is broken` | 없음 | parallel |
| `ralph: fix the auth bug` | RALPH | loop |
| `랄프 켜줘` | RALPH | loop |
| `Please address this PR's code review comments` | code-review | review (둘 다 오탐) |
| `add end to end tests …` | AUTOPILOT | run (둘 다 오탐) |
| `I want a refund` | — | 없음 |
| `I want a dashboard …` | AUTOPILOT | run |
| `ラルフ 起動して直して`, `コードレビューして` | 트리거 | 없음 |

**OMC persistent-mode**
- 상태가 `session_id`로 묶여 있고, 다른 세션이면 건너뛴다. 컨텍스트 한도와 사용자 중단 때는 막지 않는다.
- MIS는 저장소 단위(git common dir)이거나, 저장소 밖에서는 전역 홈 하나에 저장한다.
- MIS가 나은 점: 종료 조건이 `mis verdict` 증거에 묶여 있다. OMC는 스스로 cancel을 부른다.

**Ponytail**
- 레벨 전환은 세션 단위이고, 새 세션은 기본 레벨로 시작한다. compact일 때만 현재 레벨을 유지한다.
- "normal mode"/"stop ponytail"은 프롬프트 전체가 그 문구와 같을 때만 끈다.
- MIS는 레벨을 전역에 영구 저장하고, 산문 중간의 문구로도 끈다.
- 서브에이전트 주입과 matcher, 코드베이스 지도는 동등하다. 지도는 테스트 파일과 node_modules를 제외한다.

**Superpowers using-superpowers**
- 원본은 전문을 `<EXTREMELY_IMPORTANT>`로 주입한다.
- MIS는 요약 규율과 자체 스킬 색인을 주입한다. 흡수로는 충분하다고 본다.

**gstack careful**
- 원본은 opt-in이고, `rm -r`은 빌드 산출물만 예외로 두고 모두 ask한다.
- MIS는 상시 동작하고, 저장소 밖 경로의 재귀 삭제만 ask한다. 저장소 안 `rm -rf src`는 allow다. 설계상 완화이며 남은 위험으로 둔다.
- `git restore --staged .`는 원본 정규식(`restore\s+\.`)에 걸리지 않지만 MIS는 ask한다.

**gstack freeze**
- 원본은 대상 파일의 부모 디렉터리를 `pwd -P`로 실경로화한다.
- MIS는 `path.resolve`만 쓴다. 그래서 frozen 디렉터리 안의 심볼릭 링크를 통해 밖에 쓸 수 있다.
- freeze 상태도 전역 영구 저장이다. 원본 문서는 "세션 종료 시 해제"라고 한다.

## 스텁·skip 검사

`grep -rnE "TODO|FIXME|\.skip|\.only|not implemented|todo\(" scripts skills agents hooks tests templates evals` 결과는 8건이다.
- 모두 plan task의 상태 값 `'TODO'`다: `commands.mjs:153,310,513,551` 및 테스트 4건.
- `.skip`·`.only`·미구현 표시는 없다.

## fail-open 검사

대상은 SessionStart, SubagentStart, UserPromptSubmit, Stop, PostToolUse, PostToolUseFailure다. 각 이벤트에 아래 입력 8종을 넣었다.
- 빈 입력
- `{{{garbage`
- `[1,2,3]`
- 모든 필드가 null인 입력
- 저장소 밖 cwd
- `MIS_STATE_HOME`이 파일 (저장소 밖 cwd와 저장소 cwd 각각)
- 존재하지 않는 cwd

결과:
- 48건 모두 exit 0, `"block"` 출력 0건.
- 저장소 밖 cwd에서는 stderr에 git 메시지 `fatal: not a git repository`(69B)가 나온다. 무해하다.
- 홈 경로가 파일인 상태에서 프롬프트에 스타일 문구가 있으면 `setStyle` 예외가 핸들러 전체를 중단시킨다. 그래서 같은 프롬프트의 키워드 맥락(예: ralph)도 주입되지 않는다. 막지는 않으므로 LOW 품질 문제다.
- `session_id: "../../etc"`는 안전하게 치환되었다.

guard: 빈 입력, 깨진 JSON, `null` → ask(fail-closed) 확인.

statusline: 빈 입력, `garbage`, `[]`, `null`, 없는 디렉터리, 숫자 모델명, `/etc/passwd`를 transcript로 지정, 홈 경로가 파일 → 모두 exit 0, 크래시 없음.

## 실사용 검증 기록

모든 실행에서 `MIS_STATE_HOME`을 scratchpad 아래로 지정했다.

**a. 헤드리스 맥락 전달** (데모 a, `--setting-sources project --strict-mcp-config`)
- 도구 없이 맥락을 보고하라고 지시했다.
- 모델이 보고한 내용: 13개 `/make-it-ship:` 스킬, `MAKE IT SHIP STYLE — level: full`, `src/: capitalize, truncate`, `[MAKE IT SHIP: parallel] …`(프롬프트의 "ulw" 때문).
- 비용 $0.096. 판정: PASS.

**b. 헤드리스 loop** (데모 d, 지정된 ralph 프롬프트)
- 모델의 진행: Skill `make-it-ship:loop` → `mis loop start` → `/make-it-ship:run` → `init --write` → root-cause 기록 → `Math.floor`를 `Math.round`로 수정 → quality-reviewer 서브에이전트 → `mis report`.
- 결과: 16턴, $0.45, 70초.
- 이후 직접 확인한 상태:
  - `mis loop status`: `active:false, endReason:"verified", iteration:0`
  - `mis status`: REPORTED, 1/1, unit PASS, Verdict VERIFIED
  - `mis verdict`: VERIFIED
  - 데모 `npm test`: pass 3 / fail 0
- 테스트를 깨뜨린 경우(`Math.round`를 `Math.floor`로 되돌림):
  - `npm test` fail 1
  - `mis verdict` → **PARTIAL** (unit STALE, 현재 코드에 대한 quality review 없음)
  - statusline `REPORTED · T1/1 · unit~ · PARTIAL`
  - 원래대로 복원하자 VERIFIED로 돌아왔다.
- 주의: 이번 실행은 iteration 0으로 끝났다. 즉 이 실행에서 Stop block이 실제로 일어나지는 않았다. block 경로는 c에서만 실증되었다.

**c. Stop block 전달**
- 데모 a에서 `mis loop start --max 2`를 실행한 뒤 "HELLO만 답하라"고 지시했다.
- Stop hook feedback `[MAKE IT SHIP LOOP 1/2]`, `2/2`가 모델에게 전달되었고, 그 뒤 `iteration limit` 시스템 메시지와 함께 `endReason: limit`으로 끝났다.
- 호스트가 `stop-hook-error` 알림을 띄운다. 플러그인 없이 단순히 block만 하는 Stop 훅으로 대조 실험을 했고, 같은 알림이 나왔다. 따라서 MIS 문제가 아닌 호스트 동작이다(참고).

**d. tmux 대화형** (`--setting-sources project,local`, 프로젝트 `settings.local.json`의 statusLine)
- 상태줄 `MIS ▸ idle · style full · main · Opus 5.5`가 렌더링되었다.
- "style ultra …" 프롬프트 후 `MIS ▸ idle · style ULTRA · main · Opus 5.5 · ctx 18%`로 바뀌었다.
- 판정: PASS.
- guard ask 확인 창은 확인하지 않았다(NEEDS_HUMAN).

**e. 서브에이전트, 심볼릭 링크 경로로 실행**
- `/var/...` 경로에서 실행해도 init cwd는 `/private/var/...`로 실경로화되었다. 그래서 D10의 경로 불일치 오탐은 빈도가 낮다.
- 서브에이전트가 스타일 첫 줄을 그대로 인용했다. 판정: PASS.

## 결함 목록

**D1 · HIGH · loop가 세션에 묶여 있지 않다**
- 위치: `scripts/lib/loop.mjs:9-13` (`stateRoot(cwd)`, 실패하면 `homeDir()`), `scripts/hooks.mjs` Stop 핸들러 (session_id 무시).
- 재현:
  1. 저장소 R에서 `mis loop start --max 5 "port parser"`.
  2. 다른 세션 `{"cwd":R,"session_id":"other-session-B"}`으로 Stop을 보내면 `decision: block`.
  3. 같은 저장소의 worktree에서 보내도 block.
  4. 저장소 밖 디렉터리 NR1에서 loop를 시작하면, 무관한 NR2의 Stop도 block된다. statusline의 `/nonexistent` 입력에서도 `loop 1/20`이 표시된다.
- 영향: 같은 저장소에서 질문만 하던 다른 세션이 "keep going … invoke /make-it-ship:run"을 받고 작업을 시작한다. OMC는 세션 단위로 분리한다.

**D2 · HIGH · ralph/랄프 오탐이 loop를 시작시킨다**
- 위치: `scripts/lib/keywords.mjs:12` (`/\bralph\b|랄프(?!로렌)/i`), `sanitize`에 따옴표 처리 없음.
- 재현: `mis test-prompt "<문장>"` → `["loop"]`. 해당 문장:
  - `Ralph from QA reported a bug in login, fix it`
  - `Our new intern Ralph wrote this module`
  - `Rename the ralph variable to worker`
  - `He said "ralph" was the codename`
  - `랄프가 어제 회의에서 말한 버그 고쳐줘`
  - `ralph keeps looping, make it stop`
  - `랄프가 계속 반복돼, 멈춰줘`
  - `stop the ralph loop` (cancel이 아니라 loop로 판정)
- OMC는 앞의 다섯 문장에서 트리거되지 않는다(직접 대조). 원본보다 나빠진 회귀다.
- README의 "Mentions inside … quotes … do not trigger"와도 모순된다.
- loop 스킬이 시작되면 Stop이 block되어 정상 흐름을 막는다.

**D3 · MEDIUM · 스타일 레벨이 세션 단위가 아니라 전역에 영구 저장된다**
- 위치: `scripts/lib/style.mjs` `currentStyle`·`setStyle` (`style.json`을 SessionStart에서 초기화하지 않음).
- 재현: `mis style lite; mis style default ultra` 후 새 SessionStart를 열면 `level: lite`.
- 영향:
  - 한 번이라도 레벨을 바꾸면 `default`가 영원히 무시된다.
  - 스킬 설명("store the level used when no session level is set")과 테스트 이름("sets the session level")에 모순된다.
  - Ponytail은 세션마다 기본값으로 되돌린다.

**D4 · MEDIUM · 산문 속 "normal mode"가 스타일을 영구히 끈다**
- 위치: `keywords.mjs` `styleSwitch` (`\bnormal\s+mode\b` 부분 일치).
- 재현: UserPromptSubmit `"the router falls back to normal mode when wifi drops; fix it"` → `Style level is now off`. 이후 SessionStart에 스타일 규칙이 없다(0건).
- Ponytail은 프롬프트 전체가 그 문구와 같을 때만 끈다. D3와 겹쳐 모든 이후 세션에 영향을 준다.

**D5 · HIGH · loop가 이전 run의 VERIFIED로 끝난다 (증거 없는 완료)**
- 위치: `loop.mjs` `loopDecision` (첫 줄의 REPORTED·VERIFIED 검사. loop에 runId나 시작 시각 연결이 없음).
- 재현:
  1. 실사용 b 데모(REPORTED, VERIFIED)에서 `mis loop start "add feature X: export CSV"`.
  2. 곧바로 Stop을 보낸다.
  3. 결과: `"Make It Ship loop finished: run 20261020-1304-636b is REPORTED with verdict VERIFIED."`, `endReason: verified`.
- 영향: 새 작업 전에 모델이 멈추면(질문 등) loop가 완료로 선언된다. ADR-0003 "증거 없이 완료라고 하지 않는다"를 위반한다.

**D6 · MEDIUM · cancel 연동 누락**
- 위치: `loop.mjs` (CANCELLED이면 "invoke /make-it-ship:run"), `mis cancel`이 loop를 종료하지 않음.
- 재현: `mis loop start x; mis start --input x; mis cancel` 후 Stop → block "There is no active run yet: invoke /make-it-ship:run". loop는 계속 active다.
- 영향: SessionStart 안내 문구("to drop it, run mis cancel")대로 하면, 사용자가 취소한 run을 loop가 다시 시작시킨다. cancel 스킬을 거치면 피할 수 있다.

**D7 · LOW · `uw` 단어 오탐**
- 재현: `the UW campus map is broken` → parallel. OMC는 트리거되지 않는다.

**D8 · LOW · `git restore --staged .`가 ask된다**
- 위치: `policy.mjs` `careful` (checkout·restore + `.`).
- 영향: 작업 트리를 건드리지 않는 unstage 명령인데 "discards all uncommitted changes"라고 묻는다. gstack 원본은 묻지 않는다.

**D9 · LOW · 일본어 변형 없음**
- gap §7 M6 행에는 "한·일 변형"이 명시되어 있다.
- 재현: `ラルフ 起動して直して` → MIS 없음, OMC RALPH. `コードレビューして`도 MIS 없음.

**D10 · LOW · freeze 경로를 실경로화하지 않음**
- 위치: `policy.mjs` `classify` (대상 경로에 realpath 없음), `commands-always.mjs` (freezeDir만 realpath).
- 재현:
  - frozen `src/` 안의 `src/escape`가 밖을 가리키는 링크일 때 `src/escape/pwn.js` Write → allow (우회).
  - `/var/...`(심볼릭 링크) 경로로 frozen 내부 파일을 지정하면 → deny (오탐).
- 같은 원인으로 저장소가 링크 경로로 지정되면 `rm -rf node_modules`도 "outside the repository"로 ask된다.
- 호스트가 cwd를 실경로화하므로(실사용 e) 오탐 빈도는 낮다.
- freeze가 전역 영구 저장이고 SessionStart나 statusline에서 안내하지 않는 점도 함께 기록한다.

**D11 · LOW · statusLine §6.2 요소 미완**
- 에이전트 수·todo 요소가 없다.
- 기존 statusLine을 보여 주거나 이어 붙이는(체이닝) 기능이 없다. `mis init` 출력의 `hud.statusLine`은 교체 안내만 한다.

**D12 · LOW · 홈 쓰기 실패 시 같은 프롬프트의 키워드 맥락까지 사라진다**
- 위치: `hooks.mjs` UserPromptSubmit (`setStyle` 예외를 따로 감싸지 않음).

## 미검증 항목

- 대화형 guard ask 확인 창의 문구와 흐름 (NEEDS_HUMAN).
- §6.1 전역 지시문 교체 제안의 마일스톤 귀속 (NEEDS_HUMAN, 범위 확인).
- 학습 스킬 주입의 실사용 (단위 테스트와 직접 함수 호출로만 확인).
- compact·resume·clear 소스별 SessionStart의 실사용 동작.
- Linux 환경.

## 남은 위험

- **원본과 같은 오탐**(결함으로 세지 않음): `"Please address this PR's code review comments"` → review, `"add end to end tests …"` → run. OMC도 똑같이 트리거된다. 상시 주입이므로 정상 흐름을 방해할 수 있다.
- **careful 완화**: 저장소 안의 `rm -rf <소스 디렉터리>`는 ask 없이 허용된다. 추적되지 않는 파일은 복구할 수 없다.
- **guard 범위 밖 우회**: Bash 리다이렉트(`echo > file`)는 freeze 대상이 아니다. 원본과 같다. 난독화 우회는 Spec §7 범위 밖이다.
- **loop 상한 신뢰**: `loop.json`을 손으로 고쳐 `max`를 문자열로 바꾸면 상한이 무력화되고 정체 감지만 남는다. 스킬은 직접 편집을 금지한다.
- **원본에 있는 loop 예외가 없다**: OMC에 있는 컨텍스트 한도·사용자 중단 예외가 loop에는 없다. 호스트가 이런 상황에서 Stop을 부르면 block될 수 있다.
- **호스트 알림**: Stop block마다 호스트가 "Stop hook error occurred" 알림을 띄운다. 사용자가 오류로 오해할 수 있다.
- **cwd 의존**: 저장소 밖 cwd에서 훅이 git stderr를 남긴다. verbose 모드에서만 보인다.
