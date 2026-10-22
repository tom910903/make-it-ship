# NH-1~NH-5 자동 확인 (tmux 대화형 세션) — 2026-10-20

사람이 아니라 Claude가 tmux 안의 **대화형** `claude`(v2.1.292)를 키 입력으로 조작해 확인했다. 확인 창이 실제 TUI에 뜨는지, 승인·거절 결과가 기대대로인지는 확인했다. 그래도 **사람이 확인한 PASS는 아니다.** 그래서 `NEEDS_HUMAN.md` 결과 칸에는 "AUTO(tmux)"로 적고, 사람 확인란은 비워 둔다.

공통 환경:
- 데모 저장소는 `evals/setup-demo.mjs`로 만들었다(합성 코드).
- 실행 명령: `claude --plugin-dir <repo> --setting-sources project,local --strict-mcp-config`
- 권한 모드는 기본값인 **auto mode**다. `.claude/settings.local.json`에서 Bash·Write·Edit 등을 allow했다. 즉 guard가 ask를 내지 않으면 확인 창 없이 실행되는 조건이다.
- 사용자 전역 설정(`~/.claude/settings.json`)은 바꾸지 않았다.

## NH-1 `mis approve plan` 확인 창 — AUTO PASS

데모 a, `/make-it-ship:run Implement docs/feature-request.md. Use standard mode.`

진행: 인터뷰 질문 1건 → critic ACCEPT → 모델이 `mis.mjs approve plan`을 실행하려 함

1. 확인 창이 떴다.
   ```
   Hook PreToolUse:Bash requires confirmation for this command:
   make-it-ship: approval is recorded only when you confirm this command
   Do you want to proceed?  ❯ 1. Yes  2. No
   ```
2. **거절**한 결과:
   - `mis status`: `AWAITING_APPROVAL`, Verdict now PARTIAL
   - `git status`: `.make-it-ship.json`만 생김. 코드 변경은 없다.
3. 다시 요청한 뒤 **승인**한 결과:
   - 상태가 EXECUTING으로 바뀌었다.
   - 이어서 TDD → check → spec/quality 리뷰 → 보고서까지 진행됐다.
   - `mis verdict`: `VERIFIED`, `unit: PASS`. `npm test`는 3/3 통과했다.
4. `events.jsonl`에 `approve` 이벤트가 정확히 1건 있다. 승인한 시점의 것이다.

## NH-2 상한 BLOCKED 후 `mis approve continue` 확인 창 — AUTO PASS (시간 상한 경로)

데모 d, `.make-it-ship.json`의 `limits`는 `{maxAttemptsPerTask: 1, maxRuntimeMinutes: 1}`이다.

1. 첫 Quick 실행은 52초에 끝나 상한에 걸리지 않았다(VERIFIED). 그래서 수정을 되돌리고 Standard로 다시 실행했다.
   - 모델이 이전 run을 감지하고 "취소 후 새로 시작"할지 물었다.
2. 계획 승인 후 `task start`에서 BLOCKED가 됐다. 사유: `runtime limit exceeded … ask the user: mis approve continue`
3. 모델이 `mis.mjs approve continue`를 실행하려 하자, NH-1과 같은 사유의 확인 창이 떴다.
4. **거절**한 결과: `mis status`가 BLOCKED이고 코드 변경은 없다.
5. `/make-it-ship:resume`으로 다시 요청한 결과:
   - 모델은 상황을 설명하고 세 가지 선택지(계속 / 상한 상향 후 `mis approve config` / 중단)를 제시했다.
   - "계속"을 고르고 **승인**하자 EXECUTING으로 바뀌었고, 최종 `VERIFIED`가 됐다.
6. 이벤트 로그 순서: `approve plan` → `block(limit)` → `approve continue`

**미확인:** 재시도 상한(`maxAttemptsPerTask`) 경로는 모델이 첫 시도에 통과해서 실화면에서 재현하지 못했다. 같은 `limitBlock` 코드와 같은 확인 창을 쓰고, 자동 테스트로 확인돼 있다.

## NH-3 HUD 상태 줄 — AUTO PASS

`statusLine`은 NH-1 저장소의 `.claude/settings.local.json`(project 범위)에 넣었다. 새 세션의 화면은 다음과 같다.

```
MIS ▸ REPORTED · T1/1 · unit✓ · VERIFIED · $0.00
```

- 같은 저장소 `mis status`의 "Verdict now"도 `VERIFIED`로 일치한다.
- 비용 `$0.00`은 새 세션이라 0이다.

## NH-4 병렬 실행 중 소유 범위 밖 편집 확인 창 — AUTO PASS (충돌 경로는 미발생)

데모 p. `REQUEST.md`에 "Also re-export kebab from src/math.js."를 추가했다.

1. critic이 이 줄을 MAJOR로 짚었고, 모델이 포함 여부를 물었다. "Drop it"을 선택했다.
2. 계획 승인(확인 창) 후 T1·T2 worktree와 implementer 2개가 병렬로 실행됐다.
3. 이어서 "T1 worktree에서 `src/math.js`(T2 소유)에 주석 한 줄 추가"를 요청했다.
   - 모델은 먼저 계획 위반, 병합 충돌, 에이전트 경합 위험을 설명하고 선택지를 제시했다.
   - "계획 수정 없이 T1 worktree에서 직접 편집"을 지시했다.
4. `Edit(.worktrees/…-T1/src/math.js)`에서 확인 창 `Do you want to make this edit to math.js?`가 떴다.
   - Edit 확인 창은 hook 사유를 표시하지 않는다.
   - 그래서 같은 입력을 `scripts/guard.mjs`에 넣어 확인했다. 결과는 `ask`, 사유 `… src/math.js is outside the approved plan's files; editing it widens the scope`였다.
   - auto mode에서 Edit가 allow된 조건이므로, 확인 창은 guard의 ask에서 나온 것이다.
5. **거절**한 결과: 파일은 변경되지 않았다.
6. 다시 요청해 **승인**한 결과:
   - 편집이 적용됐다.
   - T1·T2 병합은 **충돌 없이** 끝났다. 주석은 1행, `mean`은 파일 끝이라 git이 자동 병합했다.
   - 최종 결과는 `VERIFIED`다.

**미확인:** 승인 후 충돌이 나는 경로(병합 중단, 충돌 파일 보고, PARTIAL 유지)는 이번에 발생하지 않았다. 자동 테스트 `tests/integration/mis-worktree.test.mjs`의 "conflict: … the merge is aborted, the run stays PARTIAL"이 이 경로를 확인한다.

**발견(LOW, 안전 쪽):**
- 메인 세션이 main 저장소를 cwd로 두고 worktree 안의 파일을 편집하면, guard는 경로를 `.worktrees/<run>-T1/src/text.js`처럼 상대 경로로 본다.
- 그래서 T1 **소유 파일도** 범위 밖으로 판정해 ask를 낸다.
- worktree 안에서 실행되는 implementer(cwd가 worktree)는 정상이다. `src/text.js`는 허용되고 `src/math.js`는 ask다.
- 허용해야 할 편집을 묻는 것뿐이고 막아야 할 편집을 통과시키지는 않는다. → 같은 날 수정함: 파일 편집은 파일이 있는 worktree 기준으로 범위를 판정한다(`scripts/guard.mjs`, 회귀 테스트 추가).

## NH-5 마켓플레이스 설치 경로 — AUTO PASS (2026-10-21, 사용자 승인 후 진행)

`NEEDS_HUMAN.md` NH-5 절차대로 진행했다. 경로만 `/tmp` 대신 세션 scratchpad를 썼다. 권한 모드는 **manual**로 바꿔서 확인했다.

1. 로컬 마켓플레이스 `mis-local`을 만들었다. 커밋 `8052bd1`을 clone했다.
2. 데모 b에서 `marketplace add --scope project`와 `install --scope project`를 실행했다.
   - `claude plugin list`: `make-it-ship@mis-local`, Scope project, **enabled**, Read from = 마켓플레이스 경로
3. 대화형 `claude`(`--plugin-dir` 없음)에서 `/make-it-ship:run Fix the bug described in ISSUE.md`를 실행했다.
   - 스킬이 마켓플레이스 설치 경로에서 로드됐다.
   - Quick 모드로 진행됐다: init(설정 쓰기 확인) → TDD → check → quality 리뷰.
   - 리뷰의 MAJOR 지적은 테스트를 먼저 쓰고 수정했다. 재리뷰 후 보고서를 생성했다.
   - 보고서와 events의 판정: **VERIFIED**. 데모 테스트 7/7 통과.
4. guard 확인: `git push origin HEAD` 실행을 요청했다.
   - Bash가 allow 목록에 있는데도 확인 창이 떴다: `Hook PreToolUse:Bash requires confirmation … make-it-ship: remote write (git push) needs your approval`
   - **거절**했고, 실행되지 않았다.
5. 정리:
   - `uninstall --scope project`와 `marketplace remove`를 실행했다.
   - 다음 세 파일은 설치 전 백업과 diff가 없다(`lastUpdated` 제외).
     - `~/.claude/settings.json`
     - `~/.claude/plugins/known_marketplaces.json`
     - `~/.claude/plugins/installed_plugins.json`
   - uninstall 뒤에도 `~/.claude/plugins/cache/mis-local`(1.4MB)이 남아 있어서 직접 지웠다.
   - 참고: 설치 중에는 `known_marketplaces.json`에 `mis-local`이 잠시 추가된다. `--scope project`여도 마찬가지다.
   - 참고: 이 확인은 `8052bd1`에서 했다. 이후 `9aaf3b1`의 guard 수정은 `file_path`가 있는 편집 경로만 바꿨다. 여기서 확인한 `git push`(Bash) 경로는 그 수정과 무관하다.
   - 참고: uninstall이 데모의 `.claude/settings.json`을 바꾸므로, 이후 `mis verdict`는 STALE(PARTIAL)로 바뀐다. 검증 후 저장소가 바뀌면 STALE이 되는 것은 의도된 동작이다.

## NH-5 보충: GitHub 저장소 마켓플레이스 — AUTO PASS (2026-10-21, 사용자 승인 후 진행)

저장소에 `.claude-plugin/marketplace.json`(플러그인 `source: "."`)을 추가하고 `0726914`로 push했다. 그다음 README Option A 명령을 그대로 실행했다(user 범위).
1. `claude plugin marketplace add tom910903/make-it-ship` → `claude plugin install make-it-ship@make-it-ship`
   - `claude plugin list`: enabled
   - `installed_plugins.json`의 `gitCommitSha`: `0726914`(push한 커밋)
2. 데모 b에서 `claude -p "/make-it-ship:status"`를 실행했다.
   - 설치 경로의 스킬이 실행됐다.
   - 출력: `mis status: no active run`
   - guard 확인 창은 NH-5 본 절(로컬 마켓플레이스)에서 확인했으므로 여기서는 반복하지 않았다.
3. README의 제거 명령을 실행했다(`uninstall`, `marketplace remove`).
   - 다음 세 파일은 백업과 diff가 없다(`lastUpdated` 제외).
     - `~/.claude/settings.json`
     - `known_marketplaces.json`
     - `installed_plugins.json`
   - `~/.claude/plugins/cache/make-it-ship`(1.5MB)이 남아 있어 지웠다. README 제거 절차에 이 줄을 넣었다.

### 업데이트 경로 — AUTO PASS (2026-10-21)

원격에 임시 브랜치 `update-test`를 만들어 `tom910903/make-it-ship#update-test`로 설치했다. 확인이 끝난 뒤 브랜치는 지웠다.

| 단계 | 실행 | 결과 |
|---|---|---|
| 설치 | `marketplace add` + `install` | 0.1.0, `77abfb3` |
| version 그대로 커밋(`35a2726`) push | `marketplace update` → `plugin update` | 마켓플레이스 사본은 `35a2726`을 받음. 플러그인은 "already at the latest version (0.1.0)"으로 `77abfb3`에 머묾 |
| version 0.1.1 커밋(`7753ad6`) push | `marketplace update` → `plugin update` | "updated from 0.1.0 to 0.1.1 … Restart to apply changes". 설치 경로가 `cache/…/0.1.1`, sha `7753ad6`로 바뀜 |
| version 0.1.2 커밋(`8210872`) push | `plugin update`만 | "already at the latest version (0.1.1)". 마켓플레이스를 먼저 update해야 한다 |
| 정리 | `uninstall`, `marketplace remove`, cache 삭제, 원격 브랜치 삭제 | 전역 파일 3개와 플러그인 디렉터리 목록이 백업과 같음 |

## 재확인 — 2026-10-22, `3d8d799` (M8·M9·M10·layout 병합 후)

지난 AUTO 확인 이후 M8·M9·layout 변경이 들어와서 같은 방법으로 다시 확인했다. Claude Code v2.1.307을 썼고, 데모는 `evals/setup-demo.mjs`로 만들었다. 사람이 확인한 PASS는 아니다.

| 항목 | 결과 | 근거 |
|---|---|---|
| NH-1 | AUTO PASS | 데모 a, standard. `approve plan` 확인 창(hook 사유 표시) → 거절: `AWAITING_APPROVAL`, 코드 변경 없음(`.make-it-ship.json`, `.claude/`만 생김) → 다시 요청해 승인 → `VERIFIED`. `approve` 이벤트는 1건 |
| NH-2 | AUTO PASS, **재시도 상한 경로 포함** | 데모 d, `maxAttemptsPerTask: 1`. 첫 run은 한 번에 통과했다(VERIFIED). 그래서 수정을 되돌리고 quick run에서 일부러 틀린 첫 시도(Math.trunc)를 지시했다. 이벤트 순서: `task start` → `task fail` → `block`(`task T1 hit the retry limit (1 attempts, max 1)`) → `approve continue` → `task retry`(attempt 2) → `task done`. `/make-it-ship:resume`에서 `approve continue` 확인 창 → 거절: BLOCKED 유지 → 승인: 진행, `VERIFIED` |
| NH-3 | AUTO PASS | NH-1 저장소 `.claude/settings.local.json`에 `statusLine`을 넣고 새 세션을 열었다. 표시: `MIS ▸ REPORTED · T2/2 · unit~ · PARTIAL · $0.00 · style full · …`. `mis status`의 Verdict now(PARTIAL)와 일치했다. PARTIAL과 `unit~`는 설정 파일을 고쳐 검증 이후 트리가 바뀐 STALE이다(의도된 동작) |
| NH-4 | AUTO PASS, **충돌 경로 포함** | 데모 p. 첫 run은 재편집을 요청하기 전에 끝났다(병렬 2개, 충돌 없음, VERIFIED). 그래서 두 번째 run을 "worktree를 만든 뒤 멈추라"는 지시로 시작했다. T1 worktree의 `src/math.js`(T2 소유) 편집에 `Do you want to make this edit to math.js?` 확인 창이 떴다. 같은 입력을 `guard.mjs`에 넣으면 `ask`, 사유 `src/math.js is outside the approved plan's files`이다. T1 소유 `src/text.js`는 allow다. 거절: 파일 변경 없음. 승인: TAU 줄이 커밋됐다. 병합할 때 `worktree-conflict`(`conflicts: ["src/math.js"]`)가 기록되고 병합이 중단됐다. 모델은 T2를 rebase해서 다시 병합했다. unit 6/6 통과, 최종 `VERIFIED` |
| NH-5 | AUTO PASS | 현재 HEAD를 clone해 로컬 마켓플레이스 `mis-local`을 만들고 project 범위로 설치했다(0.2.0, enabled). `/mcp`: `plugin:make-it-ship:mis` 54개 도구 연결. manual 모드에서 데모 b `/make-it-ship:run Fix the bug described in ISSUE.md` → `VERIFIED`(8/8). `git push origin HEAD`에 확인 창(`remote write (git push) needs your approval [secret scan: clean, …]`) → 거절, 실행 안 됨. 정리 후 전역 파일 3개는 백업과 같다(`lastUpdated` 제외). 남은 `cache/mis-local`은 지웠다 |
| NH-6 | AUTO(시뮬레이터) PASS · **실기기 미확인** | 아래 절 |

관찰(결함 아님):
- NH-5: 데모 b(Python)에서 `__pycache__/`가 `.gitignore`에 없어서 테스트를 돌릴 때마다 트리가 바뀌었다. 그래서 check 결과가 두 번 STALE이 되어 다시 실행했다. 생성물이 추적 범위에 있으면 증거가 STALE이 되는 것은 의도된 동작이고, 모델이 보고서에 이 사실을 적었다.
- NH-4: T2 implementer가 실제로 없는 커밋 해시를 보고했다. 조정자(메인 세션)가 실제 해시로 바로잡아 보고했다.

## NH-6 iOS 디버그 브리지 — AUTO(시뮬레이터) PASS, 실기기 미확인 (2026-10-22)

실기기(iPhone 13 mini)는 `devicectl`에서 `unavailable`(연결 안 됨)이었다. 그래서 같은 절차를 부팅된 **iOS 26.4 시뮬레이터**(iPhone 17 Pro)에서 진행했다. `skills/ios/SKILL.md`대로 시뮬레이터 결과는 기기 검증으로 세지 않는다. 시뮬레이터는 Mac의 루프백을 함께 쓰므로 4번의 "기기 터널"은 확인하지 않은 셈이다.

1. 테스트용 SwiftUI 앱(합성 코드)에 `templates/ios-debug-bridge`를 `Packages/DebugBridge`로 복사하고 README의 `#if DEBUG` 연결을 넣었다. Xcode 프로젝트 없이 `swiftc`(`arm64-apple-ios17.0-simulator`)로 DebugBridge 정적 라이브러리와 앱을 빌드하고, `simctl install/launch`로 실행했다.
2. `127.0.0.1:8765`: `/healthz` → `ok`, `/state` → `{"count":3,"screen":"home"}`, `/screenshot` → 200 `image/png`(1206×2622, 앱 화면 확인).
3. `mis ios daemon start --target http://127.0.0.1:8765` → 중계 포트 9099에서 같은 세 엔드포인트가 응답했다. `mis ios sync`는 `Up to date.`였다.
4. `mis ios bridge-scan`: 앱 소스, 패키지, 빌드 스크립트 4개를 나열했다(`clean: false`, `.gitignore`의 `build/`는 제외). quick run(check `unit` = 실제 빌드)에서 `mis ship` → `ready: false`, `PARTIAL`, 사유 `iOS debug bridge code remains in …`.
5. README 절차로 제거했다(import/start 블록 삭제, 빌드에서 의존성 제거, 폴더 삭제). 결과:
   - `bridge-scan` → `clean: true`
   - Release 빌드 성공
   - `nm -j <app> | grep -ci debugbridge` → 0(제거 전 DEBUG 바이너리는 60)
6. 같은 run의 `mis ship`은 PARTIAL이었다. 사유는 run 도중 `.make-it-ship.json`(check 명령)을 바꾼 것과 `Package.swift` 삭제(의존성 매니페스트 변경)다. 둘 다 의도된 게이트다. 그래서 그 run을 취소하고 새 run을 VERIFIED까지 진행했다 → `mis ship` `ready: true`, `VERIFIED`.

남은 것(사람·실기기): 개발자 모드 iPhone USB 연결, `mis ios devices`의 `connected: true`, 기기 설치(서명), 기기 루프백으로 가는 터널 연결.

## NH-7 second opinion 실제 호출 — AUTO PASS (2026-10-22, codex)

사용자 결정(2026-10-22): 개인 프로젝트라서 외부 모델 호출을 허용했다. 사용한 CLI는 codex-cli 0.155.1(ChatGPT 로그인)이다. gemini는 설치돼 있지 않아 확인하지 않았다. 데모 a, `/make-it-ship:run Implement docs/feature-request.md. Use full mode and get a second opinion.`

1. `mis second-opinion detect` → `available: codex`.
2. 계획 단계에서 모델이 `mis ask codex "Challenge mode: …" --file <plan>`을 실행하려 했다. 확인 창이 떴다: `mis ask sends your prompt and repository content to another model service … [to: the codex CLI] — data leaves this machine; needs your approval`.
3. **거절**: 이벤트에 second-opinion 기록이 없고, `codex exec` 프로세스도 없었다.
4. 다시 요청해 **승인**: codex가 실행됐다. `mis note second-opinion`이 기록됐다(계획 1회, 최종 diff 1회). diff 단계의 호출도 매번 확인 창이 떴다.
5. 보고서 5절에 `second opinion (다른 모델, 판정에 미반영): Codex …` 두 줄이 나온다. 모델은 codex의 P2 지적 하나를 요구사항 근거로 반박해 기록했다.
6. 판정: `verdict.mjs`는 second-opinion 기록을 입력으로 쓰지 않는다. 마지막 PARTIAL에서 VERIFIED로 바뀐 것은 같은 tree에서 새 check(E3)가 PASS해서다. 최종은 `VERIFIED`, `mis ship` READY.

관찰(LOW, 설계상): `mis ask` 결과가 저장소 안 `.make-it-ship/ask/*.md`(추적 안 됨)에 쓰인다. 그래서 그 전의 check 증거가 STALE이 되고 check를 다시 해야 한다. 보고서의 변경 파일 목록에도 나온다. 모델은 check를 다시 실행해 처리했다.

## NH-8 Codex 어댑터 실사용 — AUTO PASS (2026-10-22)

데모 a에 `adapters/codex/AGENTS.md`를 `AGENTS.md`로 복사하고 커밋했다. `MIS_HOME`을 지정하고 대화형 `codex --sandbox workspace-write --ask-for-approval on-request`(gpt-5.6-sol)에서 "Implement docs/feature-request.md following AGENTS.md"를 입력했다.

- Codex 샌드박스는 `mis` 상태 쓰기마다 권한 상승을 물었다(Codex 자체 확인, guard와 무관). 이 중 `mis approve`가 **들어 있지 않은** 명령만 자동으로 승인했다. 확인 스크립트는 `approve`가 든 명령이 나오면 멈추도록 했고, 한 번도 멈추지 않았다.
- `.make-it-ship.json` 쓰기 전에 사용자 확인을 요청했다.
- 흐름: `start → interview(MED 1건, 기본값으로 resolve) → mode → plan → review:plan-critic → approve:plan → (task start → check unit PASS → task done)×3 → review:spec → review:quality → verdict → report`.
- 승인 단계: Codex는 "Please run this in the repository terminal: `mis approve plan`"이라고 요청하고 멈췄다. `approve` 이벤트는 1건이고, 시각(03:23:42Z)은 사용자 역할로 터미널에서 직접 실행한 시점이다.
- 최종: Codex 보고 "Make It Ship verdict: VERIFIED"는 `mis verdict` 출력(`VERIFIED`, unit PASS)과 일치한다. `npm test` 5/5 통과.
- 참고: 리뷰어가 만든 `.omc/` 실행 디렉터리를 Codex가 스스로 지웠다고 보고했다(사용자 환경의 OMC 훅이 만든 것).
