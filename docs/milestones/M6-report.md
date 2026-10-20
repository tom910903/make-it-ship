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

## 2차 검증 (round 2)

- 검증일: 2026-10-20 · 브랜치 develop (HEAD 7dbe475) · Claude Code 2.1.292
- 검증자: 독립 verifier (구현에 참여하지 않음). 커밋 메시지의 수정 주장은 믿지 않고, 1차 재현 절차와 변형을 직접 다시 실행했다.
- 모든 실험은 저장소 밖 scratchpad에서 했고 `MIS_STATE_HOME`을 임시 디렉터리로 지정했다. 저장소에서 바꾼 것은 이 절 하나뿐이다.
- 주의: 검증자 자신이 Claude Code 세션 안에서 돌기 때문에 셸에 `CLAUDE_CODE_SESSION_ID`가 이미 있다. 세션 관련 시험에서는 이 값을 명시적으로 지정하거나 `env -u`로 지웠다.

### 판정

**DEFECTS FOUND** — 1차 결함 12건 중 FIXED 7 · PARTIAL 5. 남은 문제와 새 문제: HIGH 1 · MEDIUM 3 · LOW 4.

### 명령과 수치

| 명령 | 결과 |
|---|---|
| `npm test` | tests 360 · pass 360 · fail 0 · skipped 0 · todo 0 · exit 0 (1차 348 → 360) |
| `claude plugin validate .` | `✔ Validation passed` · exit 0 |
| 세션 ID 실측 (헤드리스 `claude -p`, 훅이 입력을 파일로 저장) | Bash의 `$CLAUDE_CODE_SESSION_ID` = `9cbffa3f-…` = Stop·SessionStart 훅 입력의 `session_id` = stream-json `session_id`. 호스트가 Bash에 값을 넘기고, 그 값은 훅의 값과 같다. |
| 헤드리스 dogfood (데모 d) | 15턴, $0.47, 80초. 아래 절 참조 |
| OMC 대조 | `keyword-detector.mjs` 4.15.6에 MIS가 loop로 판정한 문장 21개를 넣음. 양성 대조 2개(`ralph fix the auth bug`, `fix the auth bug with ralph`)는 RALPH로 트리거됨. 21개는 하나도 트리거되지 않음 |

### 1차 결함 재검증

| ID | 판정 | 증거 |
|---|---|---|
| D1 loop 세션 범위 | **PARTIAL** | 고쳐진 부분: 세션 A가 시작한 loop에서 같은 저장소의 다른 세션 B나 worktree가 보낸 Stop은 block되지 않는다. A는 worktree에서도 block된다. 저장소 밖 NR1에서 A가 시작하면 NR2의 세션 C는 block되지 않는다. statusline은 `/nonexistent`·세션 C에서 loop를 숨기고, A에서는 `loop 0/20`을 보인다.<br>남은 문제는 R2-1 (SessionStart 안내가 다른 세션에도 나감)과 R2-6 (터미널에서 시작한 loop를 아무 세션이나 가져감). |
| D2 ralph 오탐 | **PARTIAL (남은 문제 HIGH)** | 1차 문장 9개는 모두 고쳐졌다. 이름·따옴표·"keeps looping"은 `[]`이고, "stop the ralph loop"는 `cancel`이다.<br>하지만 같은 종류의 변형에서 여전히 loop가 시작된다. R2-2 참조. |
| D3 스타일 전역 저장 | FIXED | 세션 S1에서 `mis style lite`, 이어서 `mis style default ultra` 실행 → 새 세션 S2는 `level: ultra`, S1(compact·resume)은 `lite`, S1의 서브에이전트는 `lite`.<br>세션 밖에서 `mis style lite`를 실행하면 오류 메시지와 함께 exit 1 (default 사용을 안내함). |
| D4 산문 속 "normal mode" | FIXED | `"the router falls back to normal mode when wifi drops; fix it"` → 변경 없음, 레벨 ultra 유지. `normal mode`·`Normal mode.`·`please normal mode`·`스타일 꺼줘` → off. `go back to normal mode`·`normal mode, then fix the bug` → 변경 없음. S4에서 끄면 S4만 꺼지고 S5는 영향 없음. |
| D5 이전 run의 VERIFIED로 종료 | **PARTIAL (남은 문제 MEDIUM)** | 1차 재현(REPORTED·VERIFIED run 위에서 loop 시작 후 바로 Stop) → block. 메시지 "Run … was reported before this loop started, so it is not evidence for this task: start a new run". 고쳐졌다.<br>변형: 같은 옛 run에 `mis report`를 다시 실행하면(코드 변경도 새 run도 없음) 다음 Stop에서 `endReason: verified`로 끝난다. R2-3 참조. |
| D6 cancel 연동 | FIXED | `mis loop start x; mis start --input in.txt; mis cancel` → loop `active:false, endReason:"cancelled"`. 이후 Stop 출력 없음. `cancelomc`·`랄프 멈춰`는 cancel로 판정된다. |
| D7 `uw` | FIXED | `the UW campus map is broken`·`uw` → `[]`. `ulw …`·`ultrawork: …` → parallel. |
| D8 `git restore --staged .` | FIXED | `--staged .`, `-S .` → allow. `--staged --worktree .`, `-SW .`, `restore .`, `checkout .` → ask. |
| D9 일본어 | FIXED | `ラルフ 起動して直して` → loop. `コードレビューして` → review. `ウルトラワークで直して` → parallel. `セキュリティレビューして` → security-review. `オートパイロットで作って` → run. |
| D10 freeze 실경로 | **PARTIAL (LOW)** | 1차 재현: frozen `src/` 안의 `src/escape`(밖을 가리키는 링크)를 통한 Write → deny. 고쳐졌다.<br>심볼릭 링크 cwd(`Flink → F`)에서 내부 쓰기(새 깊은 디렉터리 포함)와 `/tmp` 별칭 경로 → allow. 외부 쓰기와 `src/../x.js` → deny. 오탐이 고쳐졌다.<br>남은 문제는 R2-7. |
| D11 statusLine (freeze 배지·체이닝만) | **PARTIAL (MEDIUM)** | 배지: 저장소 cwd에서 `frozen src`가 표시되고, 링크 cwd에서도 같다.<br>체이닝: 성공하면 첫 줄이 ` \| OTHER-LINE`으로 붙는다. `exit 3`, `echo partial; exit 1`, 없는 명령, 숫자, 배열 → 꼬리 없이 정상 출력, exit 0. `sleep 10` → 2.06초에 타임아웃되고 MIS 줄만 출력된다.<br>새 문제는 R2-4 (체인 자기 참조). 에이전트 수·todo는 PROGRESS에 따라 M9로 넘어갔으므로 보지 않았다. |
| D12 홈 쓰기 실패 | FIXED (LOW 메모) | `MIS_STATE_HOME`이 파일일 때: `style lite` 프롬프트 → exit 0. `ralph: fix the parser` → loop 맥락이 주입된다. PostToolUse·Stop·statusline → exit 0.<br>메모: 쓰기에 실패해도 "Style level is now lite"라고 알린다(R2-8). |

### 남은 문제와 새 문제

**R2-1 · MEDIUM · SessionStart의 loop 안내가 세션을 가리지 않는다 (D1의 잔여)**
- 위치: `scripts/hooks.mjs` SessionStart (`readLoop(cwd)`. `loopForSession`이나 `loop.session` 비교가 없음).
- 재현:
  1. 저장소 R에서 `CLAUDE_CODE_SESSION_ID=sessA mis loop start "A task"`.
  2. 같은 저장소(또는 worktree. git common dir를 공유한다)에서 SessionStart `{"session_id":"sessB"}`를 보낸다.
  3. 결과: `There is an active Make It Ship loop: "A task" … Keep working toward a REPORTED, VERIFIED run, or ask the user and run mis loop cancel.`
- 영향:
  - README는 loop가 "holds only the session that started it"이라고 한다. 그런데 무관한 세션 B가 시작하자마자 A의 작업을 계속하라는 지시를 받는다.
  - B가 `mis loop cancel`을 실행하면 A의 loop가 꺼진다. 세션 확인이 없다(실측 `endReason: cancelled`).

**R2-2 · HIGH · ralph 오탐: 끄기 요청·이름·불만이 여전히 loop를 시작한다 (D2의 잔여)**
- 위치: `scripts/lib/keywords.mjs` `invoked`.
  - `INVOKE_BEFORE`의 `^$` 분기 때문에 프롬프트 첫 단어가 ralph이면 거의 항상 성립한다.
  - `INVOKE_AFTER`의 `\s*$` 때문에 문장 끝의 ralph도 성립한다. `\s+(?:mode|loop)` 때문에 "ralph loop/mode"에 대한 불만도 성립한다.
- `mis test-prompt` → `["loop"]`. 아래 21개 문장을 모두 OMC 원본에 넣어 대조했고, OMC는 하나도 트리거되지 않았다.
  - 끄기 요청 (사용자 의도와 정반대): `turn off ralph`, `disable ralph`, `ralph stop`, `ralph off`, `ralph cancel`, `end ralph`, `no more ralph`, `ralph 그만`, `ralph 멈춰`, `랄프 꺼줘`, `랄프 꺼`, `ラルフ止めて`, `ラルフを止めて`
  - 불만: `the ralph loop is stuck again`, `the ralph mode is annoying, disable it`
  - 이름: `Ralph Smith reported a bug in login, fix it`, `Ralph Lauren product page is broken, fix it`, `Ralph, Mike and Sue need a login page`, `Thanks Ralph`, `I talked with Ralph`, `랄프 씨가 만든 모듈 고쳐줘`
- 영향:
  - README의 "`ralph` starts a loop only when clearly invoked …, not as a name or in a complaint"와 모순된다.
  - 특히 loop를 끄려는 문장이 "do not stop early" 지시를 주입하고 loop 스킬을 부른다. 1차 HIGH와 같은 종류이므로 HIGH를 유지한다.
- 양성 판정은 정상이다: `ralph: …`, `ralph fix …`, `use ralph …`, `/ralph …`, `랄프로 …`, `랄프 켜줘`, `ラルフで直して`, `fix … with ralph`, `ralph mode: …`.
- 놓치는 경우(참고): `please ralph this: …`, `can you ralph the auth fix`, `/make-it-ship:loop …`(스킬 직접 호출이므로 무관).

**R2-3 · MEDIUM · 옛 run에 `mis report`를 다시 쓰면 loop가 VERIFIED로 끝난다 (D5의 잔여)**
- 위치: `scripts/lib/loop.mjs` `loopDecision` (`fresh = reportedAt >= loop.startedAt`. loop가 runId나 시작 시점의 treeHash에 묶여 있지 않음).
- 재현: dogfood 저장소 사본(REPORTED·VERIFIED) → `CLAUDE_CODE_SESSION_ID=X mis loop start "add feature X: export CSV"` → Stop은 block(정상) → `mis report`(옛 run, 코드 변경 없음) → Stop → `{"systemMessage":"Make It Ship loop finished: run 20261020-1323-1ff2 is REPORTED with verdict VERIFIED."}`, `endReason: verified`.
- 영향:
  - "export CSV" 작업을 전혀 하지 않았는데도 loop가 증거 기반 완료로 끝난다.
  - 이 경우의 block 메시지는 "start a new run"을 안내한다. 하지만 모델이 그 안내를 무시하고 일반 명령인 `mis report`만 다시 실행해도 loop가 끝난다. 이를 막는 장치가 없다. 일반 진행 메시지의 "write the report with mis report once the verdict is VERIFIED"도 이런 행동을 부추긴다.
  - ADR-0003 "증거 없이 완료라고 하지 않는다"와 어긋난다.

**R2-4 · MEDIUM · `statusLine.chain`이 MIS statusline 자신을 가리키면 프로세스가 스스로 끝나지 않는다**
- 위치: `scripts/statusline.mjs` (체인 실행에 재귀 방지가 없음. 타임아웃은 직계 `sh`만 죽이고, 그 아래 node는 고아가 되어 계속 체인을 이어 간다).
- 재현: `config.json`에 `{"statusLine":{"chain":"MIS_STATE_HOME=… node …/scripts/statusline.mjs"}}`를 넣고 statusline을 **한 번만** 실행.
  - 결과: 2.07초에 출력하고 종료한다.
  - 고아가 된 프로세스들이 스스로 끝나지 않고, 자기 자신을 계속 이어서 실행한다.
  - `pgrep -f scripts/statusline.mjs` 수: 14 → 12 → 8 → 12 → 14 → 30. 약 40초 동안 8~30개 사이를 오갔다.
  - config를 지워야 0개로 사라졌다.
- 영향:
  - README는 "To keep a status line you already had, put its command in `statusLine.chain`"이라고 안내한다. 이전 statusLine이 MIS 자신(`mis init`의 `hud.statusLine`)이면 그대로 따라 하기 쉽다.
  - 호스트는 statusline을 자주 다시 그린다. 그때마다 끝나지 않는 체인이 하나씩 더해진다.

**R2-5 · LOW · style 스킬 문구가 세션 단위 변경과 맞지 않는다**
- 위치: `skills/style/SKILL.md:7`.
- 문구 "The rules apply from the next session start"는 이제 틀렸다. 새 세션은 default로 시작한다. 같은 세션의 compact·resume에서만 적용된다.

**R2-6 · LOW · 세션 없이(터미널에서) 저장소 밖에서 시작한 loop는 컴퓨터의 아무 세션이나 가져간다**
- 재현: NR1에서 `env -u CLAUDE_CODE_SESSION_ID mis loop start "terminal task"` → 무관한 NR2의 세션 sessC가 Stop → block, `session: "sessC"`로 묶인다.
- 저장소 안에서는 설계대로 동작함을 실측했다. R8에서 세션 없이 시작한 loop는 sessB가 Stop하면 block되면서 `session:"sessB"`로 묶인다. 이어서 sessC가 Stop하면 block되지 않는다.
- 저장소 밖은 전역 홈 하나를 쓰므로 범위가 컴퓨터 전체가 된다.

**R2-7 · LOW · freeze 잔여 (D10)**
- 끊어진 심볼릭 링크 `src/dang → 밖/notyet`에 Write → allow. 대상 파일이 frozen 경계 밖에 생긴다. gstack 원본(`pwd -P` 부모)과 같은 수준이다.
- 링크 cwd에서 `rm -rf node_modules` → 여전히 ask "outside the repository". careful 경로는 실경로화하지 않는다.
- freeze는 전역(사용자 홈)이다. 저장소 F의 `src`를 freeze하면 무관한 다른 저장소 R7의 Write도 deny된다(실측). 다른 세션이나 다른 저장소의 편집까지 막는 셈으로, D1과 같은 종류의 세션 간 영향이다.
- 저장소 밖 cwd에서도 Write가 deny된다. 그런데 그곳에서는 SessionStart 안내와 statusline 배지가 모두 나오지 않는다. 안내가 `loadRun` try 블록 안에 있고, 배지는 `repoRoot`가 실패하면 null이 되기 때문이다.

**R2-8 · LOW · 홈 쓰기 실패 시 스타일 변경 성공을 잘못 알린다**
- `hooks.mjs` UserPromptSubmit은 `setStyle` 예외를 삼킨 뒤에도 `style` 값을 그대로 맥락에 넣는다. 그래서 "Style level is now lite."라고 알리지만 레벨은 바뀌지 않았다.

### 헤드리스 dogfood (데모 d)

- 명령: `MIS_STATE_HOME=<tmp>/doghome claude -p "ralph: do the task in TASK.md (quick mode; I approve writing .make-it-ship.json with mis init --write)" --plugin-dir … --setting-sources project --strict-mcp-config --permission-mode bypassPermissions --output-format stream-json --verbose`
  - 상속된 `CLAUDE_CODE_SESSION_ID`는 `env -u`로 지웠다.
- init 플러그인: make-it-ship + builtin뿐 (ADR-0003 단독 설치).
- 모델의 진행: Skill `make-it-ship:loop` → `mis loop start` → Skill `make-it-ship:run` → `init --write` → `start` → `plan set` → root-cause 기록 → `Math.floor`를 `Math.round`로 수정 → `task T1 done` → quality-reviewer 서브에이전트 → `review add` → `mis report`.
  - 첫 `mis loop start`는 모델이 zsh에서 `$M` 변수에 명령을 담아 실행하는 바람에 실패했다(MIS 문제 아님). 두 번째 시도에서 성공했다.
- 결과: 15턴, $0.47, 80초. 마지막에 호스트 알림 "Stop says: Make It Ship loop finished: run 20261020-1323-1ff2 is REPORTED with verdict VERIFIED."
- 직접 확인한 상태:
  - `mis loop status`: `active:false`, `endReason:"verified"`, `iteration:0`, `session:"94e61870-bea2-4d9a-8476-fbbfa537c881"`. 이 값은 그 실행의 init·result `session_id`와 같다. 또 `mis loop start`의 출력에 처음부터 `"session": "94e61870-…"`이 찍혀 있었다. 즉 Stop 때 가져간 것이 아니라, 시작할 때 env로 묶였다.
  - `mis verdict`: VERIFIED (unit PASS, reasons 없음, state REPORTED).
  - `mis status`: 1/1 DONE, quality 0 blocking.
  - 데모 `npm test`: pass 3 / fail 0.
- 판정: PASS.
- 참고: 1차와 마찬가지로 iteration 0으로 끝났다. 이 실행에서 Stop block 경로는 일어나지 않았다.

### 기타 회귀 검사

- 이상한 `session_id` 값(`null`, `123`, 객체, `"../../etc"`, `""`) × 이벤트 5종 → 모두 exit 0.
  - `"A"`, `null`, `""`일 때만 A의 loop가 block된다. `null`과 `""`는 세션 없음으로 처리되는데, 호스트는 항상 값을 보내므로 무해하다.
  - 세션 파일 이름은 안전하게 치환된다(`_object_Object_.json`).
- 세션 ID 연동은 실측으로 확인했다: 호스트가 Bash에 `CLAUDE_CODE_SESSION_ID`를 넘기고, 그 값은 훅 입력의 `session_id`와 같다. dogfood에서도 loop의 `session`이 그 실행의 ID로 묶였다.
- 미검증:
  - 서브에이전트 안의 Bash에서 `CLAUDE_CODE_SESSION_ID` 값
  - `!` 셸 접두사로 실행할 때의 값
  - 대화형 resume 시 session_id 유지 여부
  - Linux 환경

ROUND2: DEFECTS FOUND

## 3차 검증 (round 3)

- 검증일: 2026-10-20 · 브랜치 develop (HEAD a2d5473) · Claude Code 2.1.292
- 검증자: 독립 verifier (구현에 참여하지 않음). 커밋 메시지의 수정 주장은 믿지 않았다. 2차 재현 절차와 새 변형을 직접 실행했다.
- 모든 실험은 저장소 밖 scratchpad에서 했고 `MIS_STATE_HOME`을 임시 디렉터리로 지정했다. 세션 관련 시험에서는 `CLAUDE_CODE_SESSION_ID`를 명시적으로 지정하거나 `env -u`로 지웠다. 저장소에서 바꾼 것은 이 절 하나뿐이다.
- 키워드 판정은 `detectKeywords`(훅과 같은 함수)와 OMC 4.15.6 `keyword-detector.mjs`(임시 HOME·cwd)에 같은 문장을 넣어 대조했다. 대표 문장은 실제 `hooks.mjs UserPromptSubmit` 경로로도 확인했다.

### 판정

**DEFECTS FOUND**
- 2차 결함 8건: FIXED 6 · PARTIAL 2 (R2-2, R2-7).
- 1차 결함 회귀: D9·D10이 다시 열렸다.
- 남은 문제와 새 문제: HIGH 1 · MEDIUM 3 · LOW 2.

### 명령과 수치

| 명령 | 결과 |
|---|---|
| `npm test` | tests 367 · pass 367 · fail 0 · skipped 0 · todo 0 · exit 0 (2차 360 → 367) |
| `claude plugin validate .` | `✔ Validation passed` · exit 0 |
| 헤드리스 dogfood (데모 d) | 17턴, $0.51, 96초. 아래 절 참조 |
| 키워드 대조 | 2차 21문장 + 양성 9문장 + 새 변형 약 150문장 (끄기 EN 20 · KO 15 · JA 15, 부정형 15, 이름 30, 불만 19, 호칭 8, 명확한 호출 31, 산문 cancel 4) |

### 2차 결함 재검증

| ID | 판정 | 증거 |
|---|---|---|
| R2-1 SessionStart loop 안내 | FIXED | sessA가 저장소 R에서 시작한 loop: SessionStart sessB → 안내 없음, sessA → 안내 있음. worktree에서도 sessB 0건, sessA 1건.<br>`mis loop cancel`을 sessB에서 실행 → exit 1 "the active loop belongs to another session (sessA)". loop는 active로 남는다. 세션이 없는 터미널에서 cancel하면 끝난다(설계대로).<br>참고: sessB가 `mis cancel`(run 취소)을 실행하면 A의 loop도 `endReason: cancelled`로 끝난다. run은 저장소 공용이므로 남은 위험으로만 기록한다. |
| R2-2 ralph 오탐 | **PARTIAL (남은 문제 HIGH)** | 2차 21문장 모두 loop 아님. 끄기 13문장은 `cancel`, 불만·이름 8문장은 `[]`. 양성 9문장은 모두 loop.<br>하지만 새 변형에서 같은 종류의 오탐과, 이번 수정이 만든 미탐이 나온다. R3-1, R3-2, R3-3 참조. |
| R2-3 옛 run 재보고로 종료 | FIXED | dogfood 사본(REPORTED·VERIFIED)에서 `loop start "add feature X: export CSV"` → Stop은 block. `mis report` 재실행 후 Stop도 block ("a report alone does not count"). `mis check unit`은 REPORTED run에서 거부된다("run is REPORTED"). 그래서 그 뒤 report를 해도 block이고, 3/20까지 active로 남는다. |
| R2-4 chain 자기 참조 | FIXED | `statusLine.chain`을 MIS statusline 자신으로 설정하고 한 번 실행 → 0.59초에 `MIS … \| MIS …`를 출력하고 exit 0. 이후 10초 동안 2초마다 `pgrep -f scripts/statusline.mjs` → 계속 0개. |
| R2-5 style 스킬 문구 | FIXED | `skills/style/SKILL.md`: "It applies to this session only (new subagents included) … New sessions start at the default level." |
| R2-6 터미널 loop의 전역 포획 | FIXED | 저장소 밖 NR1에서 세션 없이 `loop start` → exit 1 "outside a git repository a loop must be started from a Claude Code session". 세션 sessX로 시작하면 NR2의 sessC Stop은 출력 없음, sessX는 block. statusline도 sessX에만 `loop 1/20`을 보인다. SessionStart sessC는 0건. |
| R2-7 freeze 잔여 | **PARTIAL** | 고쳐진 것:<br>- 끊어진 링크 `src/dang`과 `src/dang/a.js`에 Write → deny.<br>- 링크 cwd(`Flink`)에서 `rm -rf node_modules` → allow.<br>- 저장소 F에서 freeze해도 다른 저장소 R7의 Write는 allow이고, R7의 SessionStart·statusline에도 안내가 나오지 않는다.<br>- 저장소 밖에서 freeze하면 statusline에 `frozen <절대경로>` 배지가 나온다.<br>남은 것:<br>- 저장소 밖에서 freeze했을 때 SessionStart 안내가 여전히 0건이다 (LOW, R3-6).<br>- 이번 수정 때문에 D10이 다시 열렸다 (R3-4). |
| R2-8 쓰기 실패 시 거짓 알림 | FIXED | `MIS_STATE_HOME`이 파일일 때 `style lite`·`normal mode` → 출력 없음, exit 0. `ralph: fix the parser` → loop 맥락은 그대로 주입된다. 쓸 수 있는 홈에서는 `Style level is now lite`가 정상으로 나온다. |

### 1차 결함 회귀 검사 (D1–D12)

| ID | 결과 |
|---|---|
| D1 | 유지. sA의 loop에서 other-B의 Stop(저장소·worktree) → 출력 없음. sA의 worktree Stop → block. `/nonexistent` statusline에 loop 없음. |
| D2 | 유지. 1차 8문장 모두 loop 아님. `stop the ralph loop` → cancel. |
| D3 | 유지. S1 `style lite` + `style default ultra` → 새 세션 S2는 ultra, S1은 lite. |
| D4 | 유지. 산문 속 "normal mode" → 변경 없음. 단독 `normal mode` → off. |
| D5 | 유지. R2-3의 1단계와 같다. |
| D6 | 유지. `loop start; start; mis cancel` → loop `cancelled`, 이후 Stop 출력 없음. |
| D7 | 유지. `the UW campus map is broken` → `[]`, `ulw fix the tests` → parallel. |
| D8 | 유지. `git restore --staged .` → allow, `git restore .`·`git checkout .` → ask. |
| **D9** | **다시 열림.** 1차 재현 `ラルフ 起動して直して` → MIS `[]` (2차에서는 loop였다). OMC는 RALPH로 트리거된다. `ラルフモードで直して`도 `[]`. `コードレビューして` → review, `ウルトラワークで直して` → parallel은 유지. R3-3에 포함한다. |
| **D10** | **다시 열림.** frozen `src/` 안의 `src/escape`(밖 OUT을 가리키는 링크)를 통한 Write `src/escape/p.js` → **allow**. 7dbe475의 guard(`git archive`로 꺼냄)에 같은 입력을 넣으면 deny. R3-4 참조. |
| D11 | 유지. freeze 배지 `frozen src` (저장소·링크 cwd), 체인 꼬리 정상. |
| D12 | 유지. 홈이 파일일 때 Stop·statusline exit 0. |

### 남은 문제와 새 문제

**R3-1 · HIGH · 첫 단어 "Ralph/ralph + 동사" 문장이 loop를 시작한다 (R2-2의 잔여: 이름·불만)**
- 위치: `scripts/lib/keywords.mjs` `invoked`.
  - 첫 단어 ralph 뒤의 `START_AFTER` 분기 `\s+(?!(?:loop|mode|is|was|keeps?)\b)[a-z]`가 소문자로 시작하는 단어면 무엇이든 받는다.
  - `NAME_AFTER`의 동사 목록(from, said, asked, wrote, reported …)에 없는 동사는 모두 통과한다. 대문자 `Ralph` 예외는 문장 중간에만 적용된다.
- 재현 (`mis test-prompt` → `["loop"]`, 훅 경로에서도 loop 맥락 주입. OMC는 16문장 모두 트리거되지 않음):
  - 이름: `Ralph reviewed the PR yesterday`, `Ralph fixed the bug already, just verify`, `Ralph pushed a broken commit, revert it`, `Ralph needs help with the parser`, `Ralph left the company, take over his module`, `Ralph approved the PR, merge it`, `Ralph mentioned the cache is stale`, `Ralph updated the schema, regenerate types`, `Ralph found a race condition in the queue`, `Ralph owns this module`
  - 불만: `ralph broke my repo`, `ralph broke the build`, `ralph ruined my branch`, `ralph deleted my tests`, `ralph wasted an hour`, `ralph made a mess, clean it up`
- 영향:
  - README의 "not as a name or in a complaint"와 모순된다. OMC 원본보다 나쁘다.
  - 특히 불만 문장은 loop가 이미 피해를 준 상황인데, 다시 "do not stop early" 지시와 loop 스킬을 부른다.
  - 2차 R2-2와 같은 종류이므로 HIGH를 유지한다.

**R3-2 · MEDIUM · 부정형 끄기 요청이 loop를 시작한다 (R2-2의 잔여: 끄기 요청)**
- 위치: `keywords.mjs` `VERB_BEFORE` (`use|start|run …` 바로 뒤면 성립. 앞의 부정어를 보지 않는다), `PARTICLE_AFTER` (`로`·`で` 뒤의 부정을 보지 않는다).
- 재현 → `["loop"]`:
  - `don't use ralph anymore`, `don't use ralph for this`, `do not use ralph`, `never use ralph again`, `no need to use ralph here`, `please don't start ralph`, `I didn't ask you to use ralph`. 이 7문장은 OMC도 RALPH로 트리거된다(원본과 같음).
  - `랄프로 하지 말고 그냥 고쳐줘`, `ラルフで直さないで`. 이 2문장은 OMC가 트리거되지 않는다(원본보다 나쁨).
- 영향: 과제 기준의 "명확한 끄기 요청이 loop를 시작함"에 해당한다. 영어는 원본과 같은 수준이고 한·일은 회귀이므로 MEDIUM으로 둔다.
- 참고 (결함 아님. loop가 시작되지 않으므로 무해한 cancel 미탐): `exit/quit/abort/deactivate ralph`, `ralph, stop`, `ralph please stop`, `pause ralph for now`, `stop using ralph`, `랄프 끝내/종료/해제`, `랄프 모드 꺼줘`, `랄프 이제 그만`, `ラルフを停止して`, `ラルフ終了`, `ラルフ停止`, `ラルフをキャンセル` → `[]`.

**R3-3 · MEDIUM · 명확한 호출이 loop를 시작하지 않는다 (2차 수정의 부작용, D9 재발 포함)**
- 위치: `keywords.mjs` `invoked`.
  - `OFF_NEAR`가 ralph 앞뒤 20자 안에서 `stop|off|cancel|disable|kill|halt|end|pause|turn|꺼|끄|멈 …`을 찾으면 그 일치를 버린다. 과제 본문에 흔히 나오는 단어들이다.
  - 첫 단어 ralph 뒤는 `START_AFTER`가 라틴 소문자만 받는다. `PARTICLE_AFTER`의 일본어 분기는 `で`뿐이다.
  - `NAME_AFTER`의 `and` 때문에 `start ralph and …`도 이름으로 처리된다.
- 재현 → `[]` (영어 12문장은 OMC가 모두 RALPH로 트리거한다):
  - `ralph: fix the end-to-end tests` (훅 경로에서도 출력 없음), `ralph: stop the server from crashing on startup`, `ralph: make the pause button work`, `ralph: turn the sidebar into a drawer`, `ralph fix the cancel flow`, `ralph: add a front end for the API`, `ralph: off-by-one error in pagination, fix it`, `ralph: implement the kill switch feature`, `ralph: halt condition in scheduler is wrong`, `ralph: fix the end date picker`, `use ralph to fix the stop button`, `start ralph and fix the parser`
  - 한국어: `랄프로 데이터 꺼내는 함수 고쳐줘`, `랄프로 앱 끄면 저장 안 되는 버그 고쳐줘`
  - 일본어: `ラルフ 起動して直して` (1차 D9 재현, OMC RALPH), `ラルフモードで直して`
  - 반대 방향: `ralph stop the server from crashing on startup` → `cancel`. 호출이 취소로 바뀐다.
- 영향:
  - README의 "`ralph` starts a loop only when clearly invoked ("ralph: …" …)"와 모순된다. `ralph: <과제>` 형식이 과제 내용에 따라 조용히 무시된다.
  - 사용자는 loop가 걸렸다고 믿지만 모델은 한 번만 작업하고 멈춘다. 오류도 알림도 없다.
  - 데이터 손실은 없으므로 MEDIUM으로 둔다.

**R3-4 · MEDIUM · freeze가 저장소 밖 경로를 막지 않는다 (D10 재발, 2차 수정의 회귀)**
- 위치: `scripts/guard.mjs` (`const ctx = context(at)`. `at`은 cwd가 아니라 **대상 파일**의 가장 가까운 기존 디렉터리다. 그 디렉터리의 저장소 루트를 `freeze.json`의 `root`와 비교하고, 다르면 freeze를 적용하지 않는다).
- 재현: 저장소 F에서 `mis freeze src` (`root: F`). cwd F에서 Write·Edit:
  - `F/src/escape/p.js` (`src/escape` → 밖 OUT 링크) → **allow**. 2차(7dbe475) guard → deny.
  - `NR1/a.js` (저장소 밖 디렉터리) → **allow**. 2차 → deny.
  - `R7/a.js` (다른 저장소), `../R7/b.js` (상대 경로) → **allow**. 2차 → deny.
  - `OUT/cfg.json` Edit → **allow**.
  - 대조: `F/other.js`, `F/src/../x.js`, 링크 cwd의 `Flink/other.js` → deny (정상).
- 영향:
  - freeze는 "한 디렉터리 밖의 편집을 막는다"는 기능이다. 그런데 frozen 저장소 밖으로 나가는 편집이 전부 허용된다. README의 "symlinks are followed"와도 모순된다.
  - 1차 D10은 결함으로 셌고 2차에서 FIXED로 판정했다. 같은 재현이 다시 통과하므로 회귀 결함으로 센다(난독화가 아니라 일반 경로이므로 "guard 범위 밖 우회"가 아니다).
  - 의도는 "다른 저장소의 세션에는 영향을 주지 않는다"였을 것이다. 그렇다면 비교 기준은 대상 파일이 아니라 세션 cwd의 저장소여야 한다.

**R3-5 · LOW · 코딩 산문 속 "stop/end/cancel the loop"가 cancel로 판정되고 다른 키워드를 지운다**
- 위치: `keywords.mjs` cancel 정규식 `\b(stop|cancel|kill|halt|disable|end|turn\s+off|no\s+more)\s+(the\s+)?(ralph|loop|ultrawork)\b` (2차에서 end·disable·turn off·no more가 추가됨), 그리고 cancel이 있으면 나머지 키워드를 모두 버리는 87행.
- 재현 → `["cancel"]` (OMC는 모두 트리거되지 않음):
  - `fix the worker so it can stop the loop when the queue is empty`
  - `the retry code should end the loop after 3 tries`
  - `add a button to cancel the loop in the UI`
- 영향: loop가 활성인 세션에서 이런 과제를 말하면 모델이 "run `mis loop cancel`" 지시를 받는다. loop가 없으면 무해하다(`mis loop cancel`은 아무것도 하지 않음).

**R3-6 · LOW · 저장소 밖에서 건 freeze는 SessionStart 안내가 없다 (R2-7의 잔여)**
- 재현: NR3에서 `mis freeze keep` (`root: null`) → NR3의 Write `x.js` → deny, statusline `frozen <절대경로>`. 그러나 SessionStart의 `frozen` 안내는 0건이다.
- 위치: `hooks.mjs` SessionStart (freeze 안내가 `repoRoot(cwd)`를 부르는 try 블록 안에 있다).

### 헤드리스 dogfood (데모 d)

- 명령: `env -u CLAUDE_CODE_SESSION_ID MIS_STATE_HOME=<tmp>/doghome claude -p "ralph: do the task in TASK.md (quick mode; I approve writing .make-it-ship.json with mis init --write)" --plugin-dir … --setting-sources project --strict-mcp-config --permission-mode bypassPermissions --output-format stream-json --verbose`
- init 플러그인: make-it-ship + builtin뿐 (ADR-0003 단독 설치).
- 모델의 진행: Skill `make-it-ship:loop` → `mis loop start --max 20 …` → Skill `make-it-ship:run` → `doctor`·`init` → `init --write`·`start` → `plan set` → `task T1 start`·`check unit`·root-cause 기록 → 수정 → `task T1 done` → quality-reviewer 서브에이전트 → `review add quality` → `mis report`.
  - 이번에도 첫 Bash에서 모델이 `$M` 변수에 명령을 담아 실행해 실패했다(MIS 문제 아님). 다음 시도에서 바로 고쳤다.
- 결과: 17턴, $0.51, 96초. 마지막에 호스트 알림 "Stop says: Make It Ship loop finished: run 20261020-1339-b13d is REPORTED with verdict VERIFIED."
- 직접 확인한 상태:
  - `mis loop status`: `active:false`, `endReason:"verified"`, `iteration:0`, `session:"6025a00c-b1a5-43fc-b413-9967e9fc9467"`.
  - 이 값은 init·result의 `session_id`와 같다. `mis loop start`의 tool_result(같은 출력에 `startedAt`이 있음)에도 이미 같은 session이 찍혀 있었다. 즉 Stop 때 가져간 것이 아니라 시작할 때 묶였다.
  - `mis verdict`: VERIFIED (unit PASS, reasons 없음, state REPORTED).
  - `mis status`: 1/1 DONE, quality 0 blocking / 0 major.
  - 데모 `npm test`: pass 3 / fail 0.
- 판정: PASS. 1·2차와 마찬가지로 iteration 0으로 끝났다. 이번 실행에서도 Stop block 경로는 일어나지 않았다.

### 남은 위험 (결함으로 세지 않음)

- 다른 세션의 `mis cancel`(run 취소)은 소유 세션의 loop도 끝낸다. run이 저장소 공용이라 자연스러운 결과지만, "loop는 소유 세션만 끝낸다"는 R2-1 수정의 범위 밖이다.
- loop는 runId나 과제에 묶여 있지 않다. loop 시작 시점에 이미 진행 중이던 다른 run에서 새 check와 report가 나오면, 그 run의 VERIFIED로 loop가 끝난다. 새 증거가 있기는 하므로 결함으로 세지 않았다.
- 호칭형(`Ralph, can you fix the login bug`, `ralph, fix this`)은 `[]`, `Ralph: fix the parser`·`Ralph fix the parser`는 loop다. 애매한 경우이므로 판단하지 않았다. OMC도 같은 결과다.
- 미검증: 대화형 세션의 키워드 판정, Linux 환경, 서브에이전트 Bash의 `CLAUDE_CODE_SESSION_ID`.

ROUND3: DEFECTS FOUND

## 4차 검증 (round 4)

- 검증일: 2026-10-20 · 브랜치 develop (HEAD daa7794)
- 검증자: 독립 verifier (구현에 참여하지 않음). 판정 기준은 OMC가 아니다. PROGRESS.md SPEC_CHANGES의 사용자 결정(ralph 명시형만 loop, 나머지 언급은 `loop-hint`, 명확한 끄기 요청은 cancel)을 기준으로 삼았다.
- 실험은 모두 저장소 밖 scratchpad에서 했다. `MIS_STATE_HOME`은 임시 디렉터리로 지정했다. 저장소에서 바꾼 것은 이 절 하나뿐이다.
- 키워드 판정은 `detectKeywords`(훅과 같은 함수)로 했다. 대표 문장은 실제 `hooks.mjs UserPromptSubmit` 경로로도 확인했다.

### 명령과 수치

| 명령 | 결과 |
|---|---|
| `npm test` ×3 | 3회 모두 tests 369 · pass 369 · fail 0 · skipped 0 · todo 0 (안정) |
| `claude plugin validate .` | `✔ Validation passed` |
| 키워드 대조 | 3차 재현 49문장 + 새 문장 71문장 (EN/KO/JA; 표 65 + 질문 섞인 명시형 6) |

### 3차 결함 재검증

| ID | 판정 | 증거 |
|---|---|---|
| R3-1 이름·불만 → loop | FIXED | 3차 16문장 모두 `loop-hint`. loop 0건. |
| R3-2 부정형 끄기 → loop | **PARTIAL** | 3차 9문장 중 7문장은 `loop-hint`.<br>남은 2문장은 여전히 `loop`: `no need to use ralph here`, `I didn't ask you to use ralph`.<br>원인: `LOOP_EXPLICIT`의 부정 lookbehind가 동사 **바로 앞** 단어만 본다 (`to use`의 `to`는 부정어가 아님). 아래 R4-1. |
| R3-3 명시형 미탐 | FIXED | 3차 16문장(`ralph: fix the end-to-end tests`, `ralph: stop the server …`, `use ralph to fix the stop button`, `start ralph and fix the parser`, `랄프로 … 꺼내는/끄면`, `ラルフ 起動して直して`, `ラルフモードで直して` 등) 모두 `loop`.<br>`ralph stop the server …`(콜론 없음)는 이제 `loop-hint`다. 명시형이 아니므로 계약상 허용. |
| R3-4 freeze 범위 (D10) | FIXED | 저장소 F에서 `freeze src`, cwd F(또는 F/src):<br>- deny: `F/other.js`, `F/src/escape/p.js`(밖 링크), `F/src/r7link/src/z.js`(다른 저장소 링크), `NR1/a.js`(저장소 밖), `R7/a.js`·`R7/src/a.js`(다른 저장소, 같은 이름 `src` 포함), `../R7/b.js`, `../../R7/src/b.js`(cwd F/src), `Edit OUT/cfg.json`, `F/src/../x.js`, 상대 `other.js`, 링크 cwd `Flink/other.js`.<br>- allow: `F/src/a.js`, 상대 `src/rel.js`, cwd F/src의 `x.js`·`./sub/new/deep.js`, `Flink/src/ok.js`.<br>- 다른 세션: cwd R7의 `R7/a.js`, cwd NR1의 `NR1/a.js` → allow (영향 없음). |
| R3-5 코딩 산문 cancel | FIXED | 3차 3문장 + 새 7문장(`stop the loop if the socket closes`, `halt the loop on SIGINT`, `turn off the polling loop …`, `queue가 비면 루프를 멈추게 고쳐줘`, `ループを止める条件を修正して` 등) 모두 `none`. `stop ralph`, `stop the ralph loop`, `랄프 멈춰`, `ラルフを止めて`는 cancel 유지. |
| R3-6 저장소 밖 freeze 안내 | FIXED | NR3에서 `freeze keep` (`root: null`). SessionStart cwd NR3·NR1 → `Edits are frozen to …/NR3/keep` 안내 있음. cwd R7(저장소) → 안내 없음. 저장소 F freeze: cwd F → 안내, cwd R7 → 없음. guard: NR3 `x.js` deny, `keep/y.js` allow, R7 allow. |

### 새 문장 대조 (계약 기준)

결함 정의: 명시형이 loop가 아님 / 비명시 언급이 loop / 끄기 요청이 loop / 코딩 문장이 cancel.

| 분류 | 문장 | 결과 | 판정 |
|---|---|---|---|
| 명시형 EN | `ralph: make the login form validate emails`, `/ralph fix flaky tests`, `Ralph mode: migrate the config loader to ESM`, `please use ralph to finish the CSV export`, `run ralph on the failing integration tests`, `enable ralph and keep going until the tests pass`, `activate ralph for this refactor`, `Use the ralph loop to stop the memory leak`, `ralph: end the session cleanly when the token expires`, `ralph: turn off the debug logging in prod builds`, `ralph: don't change the public API, just fix the bug` | loop (11/11) | 정상 |
| 명시형 KO | `랄프로 결제 모듈 버그 고쳐줘`, `랄프 모드로 회원가입 기능 끝까지 만들어줘`, `랄프 켜고 테스트 다 통과할 때까지 해줘`, `랄프 시작해서 로그인 버그 잡아줘` | loop (4/4) | 정상 |
| 명시형 JA | `ラルフでログイン画面を直して`, `ラルフモードで決済のバグを修正して`, `ラルフ起動してテストを全部通して`, `ラルフ開始、APIのエラーを直して` | loop (4/4) | 정상 |
| 이름·불만 | `Ralph from QA says capitalize breaks on empty strings; fix it`, `Ask Ralph whether the API is stable`, `ralph is so slow today`, `I hate how ralph keeps looping`, `Merge Ralph's PR after the tests pass`, `랄프가 만든 PR 리뷰해줘`, `ラルフさんのレビューコメントを反映して` | loop-hint (7/7) | 정상 |
| 이름 (명시형과 글자가 겹침) | `Use Ralph's patch for the date parser`, `Run Ralph's migration script before deploy` | **loop** | 결함 R4-3 |
| 이름·브랜드·조사 KO/JA | `랄프로렌 셔츠 이미지를 상품 페이지에 넣어줘`, `랄프로부터 받은 패치 적용해줘`, `랄프로 인해 빌드가 깨졌어, 고쳐줘`, `ラルフでしたっけ、このモジュールの担当` | **loop** | 결함 R4-2 |
| 부정 요청 (정상 처리) | `Do not use ralph.`, `not now, don't run ralph`, `no ralph please, just fix it`, `랄프 쓰지 마`, `ラルフは使わないで` | loop-hint | 정상 |
| 부정 요청 EN | `stop using ralph, just fix the bug`, `I don't want to use ralph for this`, `don't ever use ralph again`, `please avoid using ralph here`, `fix it without using ralph`, `we stopped using ralph last week, just fix it normally` | **loop** (6/6) | 결함 R4-1 |
| 부정 요청 KO | `랄프로 하지마`, `랄프로 돌리지 마, 그냥 고쳐`, `랄프 켜지 마`, `랄프 시작하지 말고 바로 고쳐줘` | **loop** (4/4) | 결함 R4-1 |
| 부정 요청 JA | `ラルフではなく手で直して`, `ラルフで直すのはやめて`, `ラルフ起動しないで` | **loop** (3/3) | 결함 R4-1 |
| 끄기 | `turn off ralph`, `cancel ralph now`, `disable ralph please`, `랄프 꺼줘`, `랄프 그만`, `ラルフをやめて` | cancel (6/6) | 정상 |
| 코딩 산문 | 위 R3-5 칸의 7문장 | none | 정상 |
| 질문 | `what is ralph mode?`, `how do I use ralph?` | none | 정상 |

- 합계 65문장: 정상 46 · 결함 19 (R4-1 13, R4-2 4, R4-3 2). 여기에 R3-2 잔여 2문장(R4-1에 포함)이 따로 있다.
- 훅 경로 확인: `stop using ralph, just fix the bug`, `랄프로 하지마`, `ラルフではなく手で直して` → `[MAKE IT SHIP: loop] … do not stop early.` 주입. `Ralph from QA says …` → `loop-hint` 주입.

### 힌트 문구

- `loop-hint` 본문: "The prompt mentions "ralph". Only if the user is asking you to keep working until the result is verified, invoke /make-it-ship:loop. If it is a name, a complaint, or a request not to use or to stop it, ignore this note."
- 판단을 모델에 맡긴다. 명령형("invoke") 앞에 조건("Only if …")이 붙어 있고, 이름·불만·사용 거부 세 경우를 무시하라고 적었다. "do not stop early" 같은 loop 지시는 들어 있지 않다. 계약과 맞다.
- `loop`가 잡히면 `loop-hint`·`run`은 빠지고, `cancel`이 잡히면 나머지가 모두 빠진다 (`detectKeywords` 마지막 두 줄). 확인했다.

### 헤드리스 실행 (데모 a, 이름 문장)

- 명령: `env -u CLAUDE_CODE_SESSION_ID MIS_STATE_HOME=<tmp>/dhome claude -p "Ralph from QA says capitalize breaks on empty strings; fix it" --plugin-dir … --setting-sources project --strict-mcp-config --permission-mode bypassPermissions --output-format stream-json --verbose` (cwd = `setup-demo.mjs a` 사본)
- init 플러그인: make-it-ship + builtin뿐.
- 모델 첫 발화: "Ralph is a person here, not a request for the loop mode, so this is a bug fix. I'll use the debug skill." 그다음 Skill `make-it-ship:debug`로 재현을 시도했다. 데모 코드는 이미 빈 문자열을 처리하므로 재현에 실패했고, 코드를 바꾸지 않고 그렇게 보고했다.
- 5턴, $0.15, 35초. `make-it-ship:loop` Skill 호출 0건 (stream에서 이 문자열은 init의 스킬 목록에만 있다). `mis loop status` → `{"active": false}`. 데모 저장소 `git status` 깨끗함.
- 판정: PASS. 모델이 힌트를 받고 이름으로 판단해 loop를 시작하지 않았다.
- 힌트 주입 증거: stream-json에는 UserPromptSubmit 출력이 나오지 않는다. 그래서 세션 기록 `~/.claude/projects/…-r4-demo/ec14d733-….jsonl`을 확인했다. `[MAKE IT SHIP: loop-hint] The prompt mentions …`가 들어 있다. 즉 모델은 힌트를 받았고, 이름으로 판단했다.

### bench 테스트 (daa7794)

- `bench()`의 판정식이 순수 함수 `benchStatus(medianMs, baseMs, failed)`로 빠졌다. 식은 그대로다 (`>50` REGRESSION, `>20` WARN, 기준 없음 BASELINE, 실패 FAILED). `bench()`가 이 함수를 그대로 부른다 (commands.mjs 662행).
- 새 테스트는 고정 숫자로 경계를 검사한다: 115·120 → OK, 121 → WARN, 151 → REGRESSION, 80 → OK(-20), 기준 없음 → BASELINE, 실패 → FAILED.
- end-to-end 테스트에서 빠진 것은 "같은 명령 재측정 → OK" 단언 하나뿐이다. BASELINE(3회 측정, median ≥30ms)과 `slow` 파일 → REGRESSION(deltaPct > 50) → 보고서의 "성능 회귀: perf" 단언은 그대로 돈다. 약해지지 않았다.
- 사소: 경계값 정확히 50(→ WARN)은 시험하지 않는다. `bench`의 JSDoc이 `benchStatus` 위에 겹쳐 붙었다(주석 위치만 어긋남). 결함으로 세지 않는다.

### 새 결함

**R4-1 · MEDIUM · 부정형 사용 거부가 loop를 시작한다 (R3-2 잔여)**
- 위치: `scripts/lib/keywords.mjs` `LOOP_EXPLICIT`.
  - 영어: `(?<!\b(?:don'?t|do\s+not|never|not|no)\s+)\b(?:use|using|run|start|enable|activate)\s+(?:the\s+)?ralph\b`. 부정어가 동사 **바로 앞**일 때만 막는다. `don't ever use`, `want to use`, `ask you to use`, `stop/avoid/without using`은 통과한다.
  - 한국어: `랄프\s?(?:로|모드로)(?!.{0,12}(?:하지\s?말|말고))`는 `하지마`(띄어쓰기 없음), `하지 마`, `돌리지 마`를 못 막는다. `랄프\s?(?:켜|시작)`에는 부정 검사가 아예 없다 (`켜지 마`, `시작하지 말고`).
  - 일본어: `ラルフ\s?(?:で|モードで)`는 `ではなく`의 `で`에 걸린다. 부정 검사는 `ないで|ずに`뿐이라 `やめて`를 못 막는다. `ラルフ\s?(?:起動|開始)`에는 부정 검사가 없다 (`起動しないで`).
- 재현 → `loop` (훅 경로에서도 "do not stop early" 주입):
  - EN: `no need to use ralph here`, `I didn't ask you to use ralph`, `stop using ralph, just fix the bug`, `I don't want to use ralph for this`, `don't ever use ralph again`, `please avoid using ralph here`, `fix it without using ralph`, `we stopped using ralph last week, just fix it normally`
  - KO: `랄프로 하지마`, `랄프로 돌리지 마, 그냥 고쳐`, `랄프 켜지 마`, `랄프 시작하지 말고 바로 고쳐줘`
  - JA: `ラルフではなく手で直して`, `ラルフで直すのはやめて`, `ラルフ起動しないで`
- 영향: 과제 기준의 "끄기 요청이 loop를 시작함"에 그대로 해당한다. 사용자가 loop를 원하지 않는다고 말했는데 loop 스킬과 "do not stop early"가 주입된다. 데이터 손실은 없고, 사용자가 다시 끌 수 있으므로 MEDIUM으로 둔다.
- 위반 규칙별 구분:
  - 계약이 명시한 부정 조건을 어긴 것: EN 8문장 전부(`use/run … not preceded by a negation`), `랄프로 하지마`·`랄프로 돌리지 마`(`랄프로 … not followed by a negation`), `ラルフではなく`·`ラルフで直すのはやめて`(`ラルフで without negation`).
  - 계약 목록에 부정 조건이 없는 형태: `랄프 켜지 마`, `랄프 시작하지 말고`, `ラルフ起動しないで`. 이 3문장은 "끄기 요청이 loop를 시작함" 기준으로만 결함이다.
- 참고: 계약 문구 "not preceded by a negation"을 "바로 앞 단어"로만 구현했다. 계약을 바꾸지 않는 방법은 같은 절에 부정어가 있으면 hint로 내리는 것이다.

**R4-2 · LOW · 명시형 패턴이 이름·브랜드·조사와 겹친다 (KO/JA)**
- 위치: 같은 `LOOP_EXPLICIT`. `mentionsRalph`는 `랄프(?!로렌)`·`ラルフ(?!・?ローレン)`로 브랜드를 빼지만 `LOOP_EXPLICIT`에는 그 예외가 없다. `로`는 `로부터`·`로 인해`의 일부이기도 하다. `で`는 `でした`의 일부이기도 하다.
- 재현 → `loop`: `랄프로렌 셔츠 이미지를 상품 페이지에 넣어줘`, `랄프로부터 받은 패치 적용해줘`, `랄프로 인해 빌드가 깨졌어, 고쳐줘`(불만), `ラルフでしたっけ、このモジュールの担当`
- 영향: 비명시 언급이 loop를 시작한다. 글자상 `랄프로`·`ラルフで`와 겹치므로 계약 문구에 걸린다고 볼 여지도 있다. 그러나 `랄프로렌`은 구현이 스스로 브랜드로 제외한 단어이므로 일관성 결함이다. 빈도가 낮아 LOW.

**R4-3 · LOW · 소유격 이름 `Ralph's`가 `use/run ralph`로 잡힌다**
- 재현 → `loop`: `Use Ralph's patch for the date parser`, `Run Ralph's migration script before deploy`. (`Merge Ralph's PR …`은 `loop-hint`로 정상.)
- 원인: `ralph\b`의 `\b`가 아포스트로피 앞에서 성립한다.
- 영향: 글자상 "use ralph"이지만 사람 이름이다. 빈도가 낮아 LOW.
- R4-2·R4-3은 글자상 계약 형태(`랄프로`, `ラルフで`, `use ralph`)를 포함한다. 그래서 최종 판정은 이 두 건에 의존하지 않는다. 다만 `랄프로렌`은 구현 안의 불일치(`mentionsRalph`와 다름)이므로 기록한다.

**R4-4 · MEDIUM · 명시형 안에 질문이 있으면 loop가 사라진다 (도움말 조기 반환)**
- 위치: `detectKeywords` 첫 줄. `HELP_QUERY`(why, what's, explain, 왜 …) + `?` + `!DIRECTIVE`면 키워드 검사 전에 `[]`를 돌려준다. `DIRECTIVE`는 fix/implement/build/add/refactor/해줘/하자/부탁/돌려뿐이다. 명시형 검사보다 앞에 있다.
- 재현 → `none`:
  - `ralph: why does login fail on Safari? make the e2e suite pass`
  - `use ralph — why do the uploads time out? keep going until green`
  - `랄프 모드로 진행: 로그인이 왜 깨져? 테스트 통과할 때까지`
  - 대조: `/ralph what's breaking the nightly build? sort it out` → loop. 과제 문장의 `build`가 우연히 `DIRECTIVE`에 걸렸기 때문이다. `ラルフで、なぜ保存が失敗する？直るまで続けて` → loop (일본어 질문어는 `HELP_QUERY`에 없음). 즉 결과가 과제 본문의 단어에 따라 갈린다.
- 영향: 과제 기준의 "명시형이 loop를 만들지 않음"에 해당한다. 사용자는 loop를 걸었다고 믿지만 아무것도 주입되지 않는다. 3차 R3-3과 같은 종류이므로 MEDIUM.

**참고 (결함으로 세지 않음):** `ralph: make stop ralph also clear the statusline` → `cancel`. 명시형 과제 안에 `stop ralph`라는 끄기 문구가 그대로 들어 있어 애매하다. cancel이 다른 모든 키워드를 지우므로 loop가 사라진다는 점만 기록한다.

### 판정

**DEFECTS FOUND**
- 3차 결함 6건: FIXED 5 (R3-1, R3-3, R3-4, R3-5, R3-6) · PARTIAL 1 (R3-2 → R4-1).
- 새 결함: MEDIUM 2 (R4-1, R4-4) · LOW 2 (R4-2, R4-3). 판정은 R4-1(영어 부정 문장)과 R4-4만으로도 성립한다.
- 테스트 3회 안정, validate 통과, 헤드리스 이름 문장 PASS, bench 테스트 약화 없음.
- 미검증: 대화형 세션, Linux, R4-1 문장으로 실제 모델이 loop를 시작하는지 (훅 주입까지만 확인).

ROUND4: DEFECTS FOUND

## 5차 검증 (round 5)

- 검증일: 2026-10-20 · 브랜치 develop (HEAD b48d6a6)
- 검증자: 독립 verifier (구현에 참여하지 않음). 기준은 PROGRESS.md SPEC_CHANGES의 사용자 결정이다. 명시형은 loop, 그 밖의 언급은 `loop-hint`, 명확한 끄기 요청은 cancel이다.
- 실험은 모두 저장소 밖 scratchpad에서 했고, `MIS_STATE_HOME`은 임시 디렉터리로 지정했다. 저장소에서 바꾼 것은 이 절 하나뿐이다.
- 키워드 판정은 `detectKeywords`로 했다. 대표 6문장은 실제 `hooks.mjs UserPromptSubmit` 경로로도 확인했고, 모두 같은 결과였다.

### 명령과 수치

| 명령 | 결과 |
|---|---|
| `npm test` ×3 | 3회 모두 tests 370 · pass 370 · fail 0 · skipped 0 · todo 0 (안정) |
| `claude plugin validate .` | `✔ Validation passed` |
| 키워드 대조 | 4차 문장 73개 + 새 문장 125개 + 추가 탐색 45개 |

### 4차 결함 재검증

| ID | 판정 | 증거 |
|---|---|---|
| R4-1 부정형 → loop | **PARTIAL** | 4차 재현 15문장 중 14문장은 `loop-hint`다.<br>4차 재현 문장 `we stopped using ralph last week, just fix it normally`는 **여전히 `loop`**다. `REFUSAL`에는 `stop\s+using`만 있고 `stopped using`은 없다. 단위 테스트에도 이 문장이 없다.<br>새 변형에서도 loop가 나온다. 아래 R5-2. |
| R4-2 KO/JA 조사·브랜드 | PARTIAL | 4차 4문장은 모두 고쳐졌다 (`랄프로렌`은 `[]`, 나머지 3문장은 hint).<br>같은 종류의 새 변형은 loop다: `랄프로선 할 만큼 했어`, `랄프로는 안 될 것 같아`(불만), `ラルフでさえ解けなかったバグ`. 아래 R5-5. |
| R4-3 소유격 | PARTIAL | `Use Ralph's patch …`와 `Run Ralph's …`(곧은 따옴표)는 hint다.<br>둥근 따옴표 `Ralph’s`는 여전히 loop다. 영어 브랜드·이름도 loop다. 아래 R5-5. |
| R4-4 명시형 안의 질문 | FIXED (회귀 있음) | 4차 5문장과 새 접두형 질문 15문장 모두 `loop`다.<br>그러나 이 수정 때문에 도움말 질문이 loop가 된다. 아래 R5-1. |

### 새 문장 대조 (계약 기준)

| 분류 | 문장 수 | 결함 | 내용 |
|---|---|---|---|
| 4차 부정 요청 (재실행) | 20 | 1 | `we stopped using ralph last week …` → loop |
| 4차 이름·불만 (재실행) | 13 | 0 | |
| 4차 명시형 (재실행) | 24 | 0 | |
| 4차 끄기 (재실행) | 10 | 0 | 모두 cancel |
| 4차 코딩 산문 (재실행) | 6 | 0 | |
| 새 부정형, 같은 절 (EN/KO/JA) | 30 | 3 | `we won't use ralph for hotfixes`, `you shouldn't run ralph on this repo`, `랄프 시작 안 해도 돼` → loop |
| 새 부정형, 다른 문장 | 10 | 8 | `Use ralph? No thanks.`, `Use ralph? No. Just fix it.`, `Run ralph. Actually no, don't.`, `Start ralph. Wait, never mind, do not do that.`, `Enable ralph? Nope, not today.`, `use ralph. just kidding, don't.`, `Should I run ralph? Please do not, just fix it.`, `랄프로 할까? 아니, 하지 마.` → loop. (`랄프 켤까? 아니 켜지 마.`와 `ラルフで？いや、やめて。`는 hint. 문장부호 `。`가 절 경계가 아니라서 같은 절로 읽혔다.) |
| 접두형 안의 질문 | 15 | 0 | 모두 loop |
| 접두형 + 과제 속 부정어 | 19 | 3 | `ralph: don't break …`, `ralph: never log secrets …`, `/ralph don't use any new deps`, `랄프 모드로 진행: … 바꾸지 말고 …` 등 16문장은 loop다.<br>`ralph: don't stop ralph until tests pass`, `ralph: do not cancel ralph if a test flakes`, `ralph: never disable ralph mid-run` → **cancel**. 아래 R5-4. |
| 조사·브랜드·소유격 | 30 | 13 | 아래 R5-5 |
| 코딩 산문 (stop/cancel/kill/end/disable/멈춰/취소/キャンセル) | 13 | 1 | `stop mis-labelling the axes` → cancel. 아래 R5-6 |

추가 탐색에서 나온 문장:
- 질문 속 동사형 → **loop**: `how do I use ralph?`, `why use ralph?`, `what happens if I run ralph?`, `explain how to use ralph?`, `what does enable ralph do?`, `should I use ralph?`, `can I run ralph on this branch?`, `does it make sense to use ralph here?`, `who told you to run ralph?`, `why did you start ralph?`, `랄프로 해도 될까?`, `랄프로 하면 뭐가 달라?`, `랄프 켜면 뭐가 좋아?`, `ラルフで大丈夫かな？`, `ラルフで何ができる？`
- 접두형으로 쓴 끄기 요청 → **loop**: `/ralph off`, `/ralph stop`, `/ralph cancel`, `ralph: off`, `ralph: stop`, `ralph mode: off`, `랄프 모드로 진행: 그만`. 같은 뜻의 `ralph off`와 `ralph stop`은 cancel이다.
- 부정형 → **loop**: `we can't use ralph here`, `I wouldn't run ralph on this`, `they won't let us use ralph`, `랄프로 못 해`, `랄프 시작 못 하게 해줘`, `랄프로 안 돌려도 돼`, `ラルフ起動禁止`

훅 경로로 확인한 문장: `how do I use ralph?`, `we stopped using ralph last week, just fix it normally`, `/ralph off`, `Use ralph? No thanks.`, `Use the Ralph Lauren logo on the banner`
- 이 5문장 모두 `[MAKE IT SHIP: loop] … do not stop early.`가 주입됐다.
- `ralph: don't stop ralph until tests pass`에는 `[MAKE IT SHIP: cancel]`이 주입됐다.

### 새 결함

**R5-1 · MEDIUM · 도움말 질문이 loop를 시작한다 (R4-4 수정이 만든 회귀)**
- 위치: `scripts/lib/keywords.mjs` `detectKeywords` 첫 줄의 `!explicitLoop(text)`. `explicitLoop`는 접두형뿐 아니라 동사형도 참으로 돌려준다. 그래서 `how do I use ralph?`처럼 동사형이 들어간 질문은 도움말 조기 반환을 건너뛰고 loop가 된다.
- 회귀 증거: daa7794의 `keywords.mjs`로 같은 문장을 돌렸다. `how do I use ralph?`, `why use ralph?`, `why did you start ralph?`, `why does ralph stop early when I run ralph?`는 그때 `[]`였다. 지금은 loop다. 4차 보고서 표의 "질문 `how do I use ralph?` → none, 정상"이 깨졌다. 단위 테스트에는 `what is ralph?`만 있고 이 문장은 없다.
- 다음 질문들은 이전부터 loop였다. 이것도 비명시 언급이 loop가 된 경우다: `should I use ralph?`, `can I run ralph on this branch?`, `랄프로 해도 될까?`, `ラルフで大丈夫かな？`. 동사형이 의문문 안에 있어도 명시형으로 친다.
- 영향: 기능 사용법을 물은 사용자에게 loop 스킬과 "do not stop early"가 주입된다. `why did you start ralph?`(불만)도 loop를 다시 시작한다.
- 고칠 방향: 도움말 예외 조건을 접두형(`LOOP_PREFIX`)으로만 좁힌다. 동사형이 있는 절이 `?`로 끝나면 hint로 내린다.

**R5-2 · MEDIUM · 부정 요청이 여전히 loop를 시작한다 (R4-1 잔여)**
- 위치: `REFUSAL`과 `clauseOf`.
  - `REFUSAL`에 빠진 형태:
    - 영어: `stopped using`, `won't`, `shouldn't`, `can't`, `wouldn't`
    - 한국어: `안`, `못`
    - 일본어: `禁止`
  - `clauseOf`는 동사형이 들어 있는 절만 본다. 그래서 바로 다음 문장의 거부는 보지 않는다.
- 재현 → loop:
  - 4차 재현 문장 그대로: `we stopped using ralph last week, just fix it normally`
  - 같은 절의 부정형: `we won't use ralph for hotfixes`, `you shouldn't run ralph on this repo`, `we can't use ralph here`, `랄프 시작 안 해도 돼`, `랄프로 안 돌려도 돼`, `랄프로 못 해`, `ラルフ起動禁止`
  - 다음 문장의 거부: `Use ralph? No thanks.`, `Run ralph. Actually no, don't.`, `use ralph. just kidding, don't.`, `랄프로 할까? 아니, 하지 마.`
- 영향: 과제의 결함 정의 "거부·끄기 요청이 loop를 만든다"에 해당한다.
  - 다음 문장의 거부는 "같은 절" 규칙대로 동작한 결과다. 그래도 사람이 읽으면 거부가 분명하므로 결함으로 센다.
  - 판정은 4차 재현 문장과 같은 절의 부정형만으로도 성립한다.

**R5-3 · MEDIUM · 접두형으로 쓴 끄기 요청이 loop를 시작한다**
- 재현 → loop: `ralph: stop`, `ralph: off`, `ralph mode: off`, `/ralph off`, `/ralph stop`, `/ralph cancel`, `랄프 모드로 진행: 그만`.
- 대조: `ralph off`와 `ralph stop`은 cancel이다.
- 원인: cancel 정규식의 `^\s*ralph\s+(stop|off|cancel)…$`는 콜론과 슬래시를 받지 않는다. 그 뒤 접두형 규칙이 무조건 loop로 판정한다.
- 영향: 사용자는 끄려고 했는데 loop와 "do not stop early"가 주입된다.
- 미검증: 대화형 세션에서 `/ralph …`가 알 수 없는 슬래시 명령으로 처리되어 훅까지 오지 않을 수도 있다. `ralph: stop`은 훅까지 온다.

**R5-4 · LOW · 접두형 과제에 "don't stop/cancel/disable ralph"가 있으면 cancel이 된다**
- 재현 → cancel: `ralph: don't stop ralph until tests pass`, `ralph: do not cancel ralph if a test flakes`, `ralph: never disable ralph mid-run`.
- 원인: cancel 정규식 `\b(stop|cancel|…|disable)\s+(the\s+)?ralph\b`가 앞의 부정어를 보지 않는다. cancel은 다른 모든 키워드를 지운다.
- 영향: 명시형이 loop를 만들지 않는다. 오히려 실행 중인 loop를 끄라는 지시가 주입된다. 4차 참고(`ralph: make stop ralph also clear the statusline`)는 애매한 문장이었지만, 이 세 문장은 뜻이 분명하다. 빈도가 낮아 LOW.

**R5-5 · LOW · 이름·브랜드·조사·소유격이 아직 loop를 시작한다 (R4-2·R4-3 잔여)**
- 영어 → loop:
  - 둥근 따옴표 소유격: `Use Ralph’s patch for the parser`, `Run Ralph’s script`, `start Ralph’s review`, `use Ralph’s fixture`
  - 브랜드·이름: `Use the Ralph Lauren logo on the banner`, `start Ralph Lauren campaign page`, `run Ralph Wiggum quotes generator`, `enable Ralph, our bot user, in the ACL`
  - 파일명: `use ralph-lauren.png as hero image`, `use ralph.config.js values`
  - 원인: `(?!'s)`가 곧은 따옴표만 거른다. `Lauren` 예외가 없다.
- 한국어·일본어 → loop: `랄프로선 할 만큼 했어`, `랄프로는 안 될 것 같아`(불만), `ラルフでさえ解けなかったバグ`.
  - 원인: `로(?!…서)`가 `선`·`는`을 거르지 않는다. `で(?!し|す|は)`가 `さえ`·`も`를 거르지 않는다 (`ラルフでも`는 우연히 hint다).
- 빈도가 낮아 LOW. 다만 macOS 입력기는 따옴표를 자동으로 둥글게 바꿀 수 있다.

**R5-6 · LOW · 코딩 문장 `stop mis-…`가 cancel이 된다 (이전부터 있던 문제)**
- 재현: `stop mis-labelling the axes` → cancel. `stop-mis`도 cancel이다.
- 원인: `\bstop[\s-]?mis\b`에서 `mis` 뒤 하이픈 앞에 단어 경계가 생긴다.
- 영향: 과제의 결함 정의 "코딩 문장이 cancel이 된다"에 해당한다. 아주 드물다.

**참고 (결함으로 세지 않음)**
- 동사형 과제 안의 부정어는 hint가 된다. 계약대로다. 다만 결과가 고르지 않다:
  - `랄프로 로그인이 안 되는 버그 고쳐줘` → loop
  - `랄프로 저장이 되지 않는 버그 고쳐줘` → hint
  - `use ralph to fix the button that does not work` → hint
  - `ラルフで動かない画面を直して` → hint
- 일본어 `。`·`！`·`？`는 절 경계가 아니다. 그래서 `ラルフで直して。テストは触らないで。`는 hint다. 안전한 쪽으로 틀린다.
- `explicitLoop`는 정규식마다 첫 번째 일치만 본다. 그래서 `I said don't use ralph earlier. Now use ralph to fix it.`는 hint다. 두 번째 절에는 거부가 없는데도 그렇다. 안전한 쪽으로 틀린다.
- 저장소 밖 cwd에서 `mis freeze`나 SessionStart를 실행하면 stderr에 `fatal: not a git repository`가 찍힌다. exit 0이고 판정에는 영향이 없다. 표시 문제다.

### 이전 결함 수동 확인 (자동 테스트와 별도로 7건)

| ID | 결과 |
|---|---|
| D1 loop 세션 묶기 | 저장소 F에서 세션 A로 `loop start`했다.<br>Stop A → block. Stop B(같은 저장소) → 출력 없음. 다른 저장소 R7의 세션 C → 출력 없음. 유지 |
| R3-4 freeze 범위 | F에서 `freeze src`, cwd F:<br>- `F/src/a.js` allow<br>- `F/other.js`·`R7/a.js`·`NR1/a.js` deny<br>cwd R7의 `R7/a.js` → allow. 유지 |
| R3-6 저장소 밖 freeze 안내 | NR3에서 `freeze keep`.<br>SessionStart cwd NR3 → `Edits are frozen to …/NR3/keep` 안내 있음. cwd R7 → 안내 없음. 유지 |
| R2-4 statusline 체인 재귀 | `statusLine.chain`이 MIS statusline 자신을 가리킨 상태로 1회 실행했다.<br>1초 안에 `MIS ▸ idle … \| MIS ▸ idle …`을 한 번 출력하고 끝났다. 2초, 4초, 6초 뒤 `pgrep` 0개. 유지 |
| D4 산문 속 "normal mode" | `the router falls back to normal mode when wifi drops; fix it` → 주입 없음. 유지 |
| D7·D9 | `the UW campus map is broken` → `[]`. `ラルフ 起動して直して` → loop. `コードレビューして` → review. 유지 |

### 판정

**DEFECTS FOUND**
- 4차 결함 4건 중 FIXED 1건(R4-4, 회귀 있음), PARTIAL 3건(R4-1, R4-2, R4-3)이다.
- 새 결함은 MEDIUM 3건(R5-1, R5-2, R5-3)과 LOW 3건(R5-4, R5-5, R5-6)이다.
- 판정을 정하는 근거:
  - R5-1 회귀: `how do I use ralph?`가 loop가 된다.
  - R5-2: 4차 재현 문장 `we stopped using ralph …`가 여전히 loop다.
- 테스트 3회 안정, validate 통과, 이전 결함 수동 확인 7건 모두 유지.
- 미검증:
  - 대화형 세션과 Linux
  - 실제 모델이 위 loop 주입을 받고 loop를 시작하는지 (훅 주입까지만 확인)
  - 슬래시로 시작하는 `/ralph …`가 훅까지 오는지

ROUND5: DEFECTS FOUND

## 6차 검증 (round 6)

- 검증일: 2026-10-20 · 브랜치 develop (HEAD c8947d7)
- 검증자: 독립 verifier (구현에 참여하지 않음).
- 기준: PROGRESS.md SPEC_CHANGES의 최신 사용자 결정.
  - 접두형(`ralph:`, `/ralph`, `ralph mode:`, `랄프:`·`랄프 모드로 진행:`, `ラルフ:`)만 loop를 시작한다.
  - 그 밖의 언급은 모두 `loop-hint`다.
  - 명확한 끄기 요청은 cancel이다 (접두형으로 쓴 끄기 요청도 포함).
- 결함 정의:
  - 접두형이 loop가 아니다 (접두형 뒤에 끄기 말만 있으면 cancel이 맞다).
  - 비접두형 언급이 loop가 된다.
  - 끄기 요청이 loop가 된다.
  - 코딩 문장이나 부정된 끄기(`don't stop ralph`)가 cancel이 된다.
- 실험은 모두 저장소 밖 scratchpad에서 했다. `MIS_STATE_HOME`은 임시 디렉터리로 지정했다. 저장소에서 바꾼 것은 이 절 하나뿐이다.
- 키워드 판정은 `detectKeywords`로 했다. 대표 10문장은 실제 `hooks.mjs UserPromptSubmit` 경로로도 확인했고, 모두 같은 결과였다.

### 명령과 수치

| 명령 | 결과 |
|---|---|
| `npm test` ×3 | 3회 모두 tests 369 · pass 369 · fail 0 · skipped 0 · todo 0 (안정) |
| `claude plugin validate .` | `✔ Validation passed` |
| 키워드 대조 | 5차 문장 30개 재실행 + 새 문장 85개 (분류 71개, sanitize 탐색 10개, R5-4 추가 확인 4개) |

- 테스트 수가 5차의 370에서 369로 줄었다. `keywords.test.mjs`에서 R3·R4 테스트 2개가 R5 테스트 1개로 합쳐졌기 때문이다. 삭제된 검사는 없다.

### 5차 결함 재검증

| ID | 판정 | 증거 |
|---|---|---|
| R5-1 도움말 질문 → loop | FIXED | `how do I use ralph?`, `why use ralph?`, `why did you start ralph?` → `[]`.<br>`should I use ralph?`, `랄프로 해도 될까?`, `ラルフで大丈夫かな？` → hint. |
| R5-2 부정 요청 → loop | FIXED | `we stopped using ralph …`, `we won't use ralph …`, `you shouldn't run ralph …`, `랄프 시작 안 해도 돼`, `ラルフ起動禁止`, `Use ralph? No thanks.`, `Run ralph. Actually no, don't.`, `랄프로 할까? 아니, 하지 마.` → 모두 hint. 비접두형은 이제 loop가 될 수 없다. |
| R5-3 접두형 끄기 → loop | **PARTIAL** | 5차 7문장(`ralph: stop`, `/ralph off`, `랄프 모드로 진행: 그만` 등)은 모두 cancel이다.<br>같은 종류의 다른 형태는 loop다. 아래 R6-1. |
| R5-4 접두형 과제 속 "don't stop ralph" → cancel | **PARTIAL** | 5차 3문장은 loop다.<br>아래 4문장은 여전히 **cancel**이다:<br>- `ralph: don’t stop ralph until tests pass` (둥근 따옴표)<br>- `ralph: please don't ever stop ralph`<br>- `랄프: 끝날 때까지 랄프 그만두지 마`<br>- `ラルフ: ラルフを止めないで、テストが通るまで`<br>아래 R6-2. |
| R5-5 이름·브랜드·조사·소유격 → loop | FIXED (loop 기준) | `Use Ralph’s patch …`, `Use the Ralph Lauren logo …`, `랄프로선 할 만큼 했어`, `ラルフでさえ解けなかったバグ` → 모두 hint.<br>다만 이름이 들어간 문장이 cancel이 되는 경우가 있다 (R6-5). sanitize와 파일명을 거쳐 loop가 되는 경우도 있다 (R6-3, R6-4). |
| R5-6 `stop mis-…` → cancel | PARTIAL | `stop mis-labelling the axes` → `[]`. 고쳐졌다.<br>`cancel mis.json load when offline` → cancel. `(?![\w-])`가 `.`을 막지 않는다.<br>`stop-mis` 단독은 cancel 명령 형태이므로 결함으로 세지 않는다. |

### 새 문장 대조 (계약 기준)

| 분류 | 문장 수 | 결함 | 내용 |
|---|---|---|---|
| 접두형 + 과제 속 질문·부정어·끄기 단어 (`ralph: stop the server from crashing…`, `ralph: cancel button does nothing…`, `ralph: off-by-one…`, `랄프: 취소 버튼이…`, `ラルフ: 停止ボタンが…` 등) | 15 | 0 | 모두 loop |
| 접두형 끄기 요청 | 10 | 8 | 아래 R6-1 |
| 비접두형 호출 (`use ralph …`, `랄프로 고쳐줘`, `ラルフで直して`, `please use ralph: …`, `hey, /ralph fix it`, `ralph mode please` 등) | 10 | 0 | 모두 hint |
| 이름·브랜드·소유격 (둥근 따옴표 포함) | 12 | 6 | loop는 0건. cancel 6건: 아래 R6-5 |
| 거부·부정된 끄기 | 12 | 9 | 거부(`don't use ralph`, `랄프 쓰지 마`, `ラルフは使わないで`)는 hint다. 부정된 끄기 9건은 cancel이다. 아래 R6-2 |
| stop/cancel/mis가 들어간 코딩 문장 | 12 | 5 | 아래 R6-5 |
| sanitize 앞부분 제거 탐색 | 10 | 7 | 아래 R6-3·R6-4 (`Ralph: can you look …?` 1건은 계약상 접두형이므로 결함 아님) |

### 헤드리스 확인 (모델 판단)

- 준비: `node evals/setup-demo.mjs a <scratchpad>/demo1|demo2`, 실행마다 `MIS_STATE_HOME`을 따로 지정. 지정된 플래그 그대로 실행했고 둘 다 exit 0이었다.
- `mis test-prompt`는 두 프롬프트를 모두 `["loop-hint"]`로 분류한다.

| 프롬프트 | 결과 |
|---|---|
| `use ralph to fix capitalize for empty strings; keep going until the tests pass` | **모델이 loop를 시작했다** (계약상 어느 쪽이든 허용).<br>순서:<br>1. 첫 도구 호출이 `Skill make-it-ship:loop`<br>2. `mis loop start --max 20 …`<br>3. `Skill make-it-ship:run` → `mis start`<br>4. `mis block`<br>데모 a에서는 `capitalize('')`가 이미 `''`를 돌려주고 테스트도 통과한다. 그래서 모델은 고칠 것이 없다고 보고 run을 BLOCKED로 두었다.<br>`loop.json`: `active: true`, 세션 묶임, `iteration 1`. BLOCKED이라 일시정지 상태로 남는다. 설계대로다. 12턴. |
| `Ralph from QA says capitalize breaks on empty strings; fix it` | **loop를 시작하지 않았다** (통과). loop 스킬 호출이 없고 `loop.json`도 없다. 모델은 재현을 시도한 뒤 재현할 수 없다고 보고했다. 4턴. |

- 미검증: stream-json에는 UserPromptSubmit 주입문이 남지 않는다. 그래서 run1에서 모델이 `loop-hint` 문구를 보고 판단했는지, 스킬 설명만 보고 판단했는지 구분할 수 없다. Stop 훅이 실행된 것은 확인했다 (`iteration`과 `sig`가 기록됨).

### 새 결함

**R6-1 · MEDIUM · 접두형 끄기 요청이 loop를 시작한다 (R5-3 잔여, 일부는 회귀)**
- 재현 → **loop**:
  - 영어: `ralph: stop please`, `ralph: cancel the loop`, `ralph: turn off`
  - 한국어: `랄프: 꺼줘`, `랄프: 그만해`, `랄프: 중지`
  - 일본어: `ラルフ: やめて`, `ラルフ：停止`
- 회귀: `랄프: 꺼줘`와 `ラルフ: やめて`는 b48d6a6에서 `loop-hint`였는데, 이제는 `loop`다. 5차에서 `랄프:`·`ラルフ:` 접두형을 추가했지만 그에 맞는 끄기 분기를 두지 않았다.
- 원인 (`scripts/lib/keywords.mjs` cancel 정규식):
  - 영어 분기는 끄기 단어 하나만 받는다: `^\s*\/?ralph(?:\s+mode)?\s*[:：]?\s*(stop|off|cancel)\s*[.!]?\s*$`
  - 한국어 분기는 `(그만|멈춰|취소|꺼)` 바로 뒤에 `\s*$`가 온다. 그래서 `꺼줘`·`그만해`가 빠지고 `중지`는 목록에 없다.
  - 일본어에는 접두형 끄기 분기가 없다. `ラルフを?(止め|やめ)`는 콜론이 끼면 일치하지 않는다.
- 영향: 끄려는 사용자에게 loop와 "do not stop early"가 주입된다. 과제의 결함 정의 "끄기 요청이 loop를 만든다"에 해당한다.
- 고칠 방향: 접두형 뒤에 "끄기 말만 있는" 닫힌 목록을 둔다. 예: `stop|off|cancel|turn off|quit` + `please`/`the loop`/`now`, `그만(해|하자)?|멈춰|취소|꺼(줘)?|중지`, `やめて|止めて|停止|キャンセル`. 느슨하게 맞추면 `ralph: stop the server from crashing`이 cancel이 되므로 안 된다 (지금은 loop이고 이것이 맞다).

**R6-2 · MEDIUM · 부정된 끄기가 cancel이 된다 (R5-4 잔여, 이전부터 있던 문제)**
- 재현 → **cancel**:
  - 영어:
    - `don’t stop ralph` (과제가 든 예시 그대로, 둥근 따옴표만 다르다. macOS가 자동으로 바꿀 수 있다)
    - `please don't ever stop ralph`, `do not ever cancel ralph`
    - `I didn't stop ralph, it stopped by itself`
  - 한국어: `랄프 그만두지 마`, `랄프 취소하지 마세요`, `랄프 중지하지 마`
  - 일본어: `ラルフを止めないで`, `ラルフをやめないで`
  - 접두형 안: 위 R5-4 4문장
- 원인:
  - 영어 lookbehind `(?<!\b(?:don'?t|do\s+not|never|not)\s+)`의 한계:
    - 곧은 따옴표만 받는다.
    - 부정어와 동사 사이에 다른 단어(`ever`)가 오면 놓친다.
    - `didn't`가 없다.
  - 한국어 `(ralph|랄프)\s?(…그만|취소|중지…)`와 일본어 `ラルフを?(止め|やめ)`에는 부정 검사가 없다. 그래서 `그만두지 마`, `취소하지 마`, `止めないで`가 그대로 cancel이 된다.
- c8947d7 커밋 메시지는 "negated cancels … do not"이라고 말하지만, 위 형태들에서는 성립하지 않는다.
- b48d6a6에서도 결과가 같았다. 회귀가 아니라 5차에서 시험하지 않은 형태다.
- 영향: cancel은 다른 키워드를 모두 지운다. 그리고 실행 중인 loop를 끄라는 지시(`mis loop cancel`)를 주입한다. 계속하라는 사용자의 loop가 꺼진다.

**R6-3 · LOW-MEDIUM · sanitize가 앞부분을 지우면 비접두형 언급이 loop가 된다**
- 재현 → **loop**:
  - `https://ci.example.com/job/42 ralph: why is this red?`
  - `` `npm test` ralph: flaky ``
  - `"the bug" ralph: says it is fixed`
  - `> fix this` 다음 줄에 `ralph: from QA here, it still breaks`
  - `src/lib/ ralph: owner of this folder`
  - `<note>x</note> ralph: hi`
- 대조: `see above.\n\nralph: fix it` → hint.
- 원인: `explicitLoop`를 `sanitize`한 텍스트에 적용한다. URL·코드·따옴표·경로·태그·인용줄이 지워지면 `ralph:`가 문장 맨 앞이 된다.
- 영향: 사용자가 쓴 문장 맨 앞이 접두형이 아닌데 loop가 된다. 과제의 결함 정의 "비접두형 언급이 loop가 된다"에 해당한다.
- 고칠 방향: 접두형 검사는 원문(trim한 prompt)에 대해 한다.

**R6-4 · LOW · `/ralph-…` 파일명이 loop를 시작한다**
- 재현: `/ralph-lauren.png is broken, replace it` → loop.
- 원인: `^\s*\/ralph\b`에서 `-` 앞에 단어 경계가 생긴다. sanitize는 디렉터리 구분자가 두 개 이상인 경로만 지운다.
- 대조: `/ralphs-notes.md: update it` → `[]`.

**R6-5 · LOW · 코딩 문장과 이름 문장이 cancel이 된다 (이전부터 있던 문제)**
- 재현 → **cancel**:
  - 이 기능을 개발하는 문장:
    - `add a button to stop ralph`
    - `write a test that checks stop ralph clears state`
    - `랄프 취소 버튼 만들어줘`
    - `ラルフを止めるボタンを追加して`
  - 사람 이름 Ralph:
    - `disable Ralph’s account in the admin panel` (곧은 따옴표도 같다)
    - `kill Ralph’s stale process on the build box`
    - `end Ralph’s session when the token expires`
    - `In the end Ralph fixed it himself`
  - 기타: `there is no more ralph in the codebase after the rename`, `cancel mis.json load when offline`
- 원인:
  - `\b(stop|cancel|kill|halt|disable|end|turn\s+off|no\s+more)\s+(the\s+)?ralph\b`가 소유격(`’s`)도 문장 속 위치(`In the end`)도 보지 않는다.
  - 한국어·일본어 분기는 뒤따르는 명사(`버튼`, `ボタン`)를 보지 않는다.
- b48d6a6에서도 결과가 같았다. 회귀가 아니다.
- 영향: 코딩 요청이 다른 키워드를 잃는다. loop가 실행 중이면 끄라는 지시가 주입된다. 이 기능 자체를 개발하는 문장은 애매하다. 그래서 LOW로 둔다. 다만 이름 문장 4건은 분명한 오탐이다.

**참고 (결함으로 세지 않음)**
- `Ralph: can you look at the login bug? (Ralph from QA)` → loop. 사람 Ralph를 부르는 문장도 접두형이면 loop가 된다. 계약의 결과이므로 결함이 아니다. 접두형만 자동으로 정한 결정에 남는 위험으로 기록한다.
- 저장소 밖 cwd에서 `mis test-prompt`나 UserPromptSubmit를 실행하면 stderr에 `fatal: not a git repository`가 찍힌다 (5차 참고와 같다). exit 0이고 판정에는 영향이 없다.

### 이전 결함 수동 확인 (자동 테스트와 별도로 5건)

| ID | 결과 |
|---|---|
| D1 loop 세션 묶기 | 저장소 F에서 세션 A로 `loop start`했다.<br>- Stop A → block<br>- Stop B(같은 저장소) → 출력 없음<br>- 다른 저장소 R7의 세션 C → 출력 없음<br>- 세션 B의 `mis loop cancel` → "belongs to another session (A)" 오류<br>유지 |
| 새 증거로만 종료 | `loopDecision`:<br>- REPORTED+VERIFIED, `fresh=false` → iterate (끝나지 않음)<br>- `fresh=true` → `end: verified`<br>`freshEvidence`:<br>- loop 시작 전 check + 시작 후 report → false<br>- 시작 후 check + report → true<br>유지 |
| R3-4 freeze 범위 | F에서 `freeze src`, cwd F:<br>- `F/src/a.js` allow<br>- `F/other.js`, `R7/a.js`, 저장소 밖 `NR1/a.js` → deny<br>cwd R7의 `R7/a.js` → allow<br>유지 |
| R2-4 statusline 체인 재귀 | `statusLine.chain`이 MIS statusline 자신을 가리킨 상태로 1회 실행했다. 1초 안에 `MIS ▸ idle … \| MIS ▸ idle …`을 한 번만 출력했다. 2초 뒤 `pgrep` 0개. 유지 |
| 세션별 스타일 | 세션 X에 `ponytail lite` 프롬프트 → "Style level is now lite".<br>`currentStyle('X')` = lite, `currentStyle('Y')` = full<br>유지 |

### 판정

**DEFECTS FOUND**
- 5차 결함 6건:
  - FIXED 3건: R5-1, R5-2, R5-5 (loop 기준)
  - PARTIAL 3건: R5-3, R5-4, R5-6
- 새 결함:
  - MEDIUM 2건: R6-1, R6-2
  - LOW-MEDIUM 1건: R6-3
  - LOW 2건: R6-4, R6-5
- 판정을 정하는 근거 (과제가 결함으로 명시한 종류다):
  - R6-1: 접두형 끄기 요청 `랄프: 꺼줘`, `ラルフ: やめて`가 loop가 된다. 5차까지는 hint였으므로 회귀다.
  - R6-2: 부정된 끄기 `don’t stop ralph`, `랄프 그만두지 마`, `ラルフを止めないで`가 cancel이 된다.
- 나머지 결과:
  - 비접두형 호출은 모두 hint다. 계약의 핵심은 성립한다. R6-3·R6-4는 예외다.
  - 헤드리스: 호출형 프롬프트에서는 모델이 loop를 시작했다. 이름 프롬프트에서는 시작하지 않았다.
  - 테스트 3회 안정, validate 통과, 이전 결함 수동 확인 5건 모두 유지.
- 미검증:
  - 대화형 세션과 Linux
  - `/ralph …`가 슬래시 명령 처리 전에 훅까지 오는지
  - 헤드리스 run1에서 모델이 hint 문구를 보고 판단했는지

ROUND6: DEFECTS FOUND
