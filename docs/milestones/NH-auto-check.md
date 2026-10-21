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
   - 참고: uninstall이 데모의 `.claude/settings.json`을 바꾸므로, 이후 `mis verdict`는 STALE(PARTIAL)로 바뀐다. 검증 후 저장소가 바뀌면 STALE이 되는 것은 의도된 동작이다.
