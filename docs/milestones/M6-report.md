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
