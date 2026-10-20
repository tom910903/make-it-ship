# 사람이 확인할 항목 (NEEDS_HUMAN) — 단계별 절차

아래 항목은 대화형 확인 창, 실기기·보드, 외부 계정이나 서비스가 있어야 확인할 수 있다. 그래서 자동 검증에서 **통과로 기록하지 않았다**.

NH-1~4는 Claude가 tmux 대화형 세션으로 자동 확인했다(`NH-auto-check.md`). 이것은 사람 확인이 아니다. 사람이 확인하면 결과 칸을 PASS/FAIL로 바꾼다.

확인한 사람은 이 문서의 해당 행에 결과를 적는다(PASS/FAIL, 날짜, 메모). 확인 순서는 아래와 같다.
- NH-1이 가장 중요하다.
- NH-2와 NH-4는 NH-1과 같은 확인 창 메커니즘을 쓴다.
- NH-5는 실제 설치 경로다.

공통 준비:
- Node 22+, git, Claude Code(로그인됨)
- 이 저장소를 받아 둔 경로 `MIS=/path/to/make-it-ship`

| ID | 결과 | 날짜 | 확인자 메모 |
|---|---|---|---|
| NH-1 | AUTO(tmux) 통과 · 사람 미확인 | 2026-10-20 (Claude) | `NH-auto-check.md` |
| NH-2 | AUTO(tmux) 통과(시간 상한 경로) · 사람 미확인 | 2026-10-20 (Claude) | `NH-auto-check.md` |
| NH-3 | AUTO(tmux) 통과 · 사람 미확인 | 2026-10-20 (Claude) | `NH-auto-check.md` |
| NH-4 | AUTO(tmux) 통과(충돌 경로 미발생) · 사람 미확인 | 2026-10-20 (Claude) | `NH-auto-check.md` |
| NH-5 | | | |
| NH-6 | | | |
| NH-7 | | | |
| NH-8 | | | |
| NH-9 | 해당 없음 — 기능 제거 | 2026-10-20 | 사용자 결정으로 BSP QA 프로파일 삭제 |

## NH-1 대화형 승인 확인 창 (`mis approve plan`)

1. `node $MIS/evals/setup-demo.mjs a /tmp/nh1 && cd /tmp/nh1`
2. `claude --plugin-dir $MIS`(대화형)를 실행하고 다음을 입력한다: `/make-it-ship:run Implement docs/feature-request.md. Use standard mode.`
3. 모델이 계획을 보여 준 뒤 `mis.mjs approve plan`을 실행하려 할 때, 권한 확인 창이 다음 사유와 함께 뜨는지 본다: `make-it-ship: approval is recorded only when you confirm this command`.
4. **거절**한다. `/make-it-ship:status`가 `AWAITING_APPROVAL`을 보여야 하고, `git status`에 코드 변경이 없어야 한다.
5. 다시 승인을 요청해 **승인**한다. 상태가 `EXECUTING`으로 바뀌고, 이어서 구현 → check → 리뷰 → 보고서까지 진행되는지 본다. 최종 판정은 `mis verdict` 출력이어야 한다.

PASS 조건: 3·4·5가 모두 기대대로 동작한다.

## NH-2 상한 BLOCKED 후 `mis approve continue` 확인 창

1. `node $MIS/evals/setup-demo.mjs d /tmp/nh2 && cd /tmp/nh2`
2. `.make-it-ship.json`을 만들고 `"limits": {"maxAttemptsPerTask": 1, "maxRuntimeMinutes": 60}`를 넣는다. 예: `node $MIS/scripts/mis.mjs init --write`로 만든 뒤 limits를 수정한다.
3. `claude --plugin-dir $MIS`를 실행하고 다음을 입력한다: `/make-it-ship:run Do the task in TASK.md`.
4. 첫 시도가 실패해 재시도할 때 run이 BLOCKED(retry limit)되는지 본다. 바로 통과되면 테스트를 일부러 한 번 깨서 재현한다.
5. `/make-it-ship:resume`을 실행하고, 모델이 `mis.mjs approve continue`를 실행할 때 확인 창이 뜨는지 본다. 승인하면 이어서 진행되는지, 거절하면 BLOCKED로 남는지 확인한다.

PASS 조건: 4번에서 BLOCKED가 되고, 5번에서 확인 창이 뜬다. 승인하면 진행되고 거절하면 BLOCKED로 남는다.

## NH-3 HUD 상태 줄

1. 아무 저장소에서 `node $MIS/scripts/mis.mjs init`을 실행하고, 출력의 `hud.statusLine`을 `~/.claude/settings.json`의 `"statusLine"`에 넣는다.
2. Claude Code를 재시작하고, run이 있는 저장소(예: NH-1의 `/tmp/nh1`)에서 세션을 연다.
3. 상태 줄에 `MIS ▸ <state> · T<done>/<total> · <checks> · <verdict>`가 나오는지, 비용 정보가 있으면 ` · $x.xx`가 붙는지 확인한다.
4. 확인이 끝나면 `statusLine` 설정을 원래대로 되돌린다.

PASS 조건: 3번의 형식으로 상태 줄이 표시되고, 판정 값이 같은 저장소에서 실행한 `mis status`의 "Verdict now"와 일치한다.

## NH-4 병렬 실행 중 소유 범위 밖 편집 확인 창

1. `node $MIS/evals/setup-demo.mjs p /tmp/nh4 && cd /tmp/nh4`
2. `REQUEST.md` 끝에 "Also re-export kebab from src/math.js."를 추가하고 커밋한다(소유 범위 밖 편집을 유도하는 줄).
3. `claude --plugin-dir $MIS`를 실행하고 다음을 입력한다: `/make-it-ship:run Implement REQUEST.md with parallel worktrees and implementer agents. Local commits are fine.`
4. 구현 에이전트가 자기 task의 `files` 밖 파일을 Write/Edit하려 할 때 확인 창(`... is outside the approved plan's files`)이 뜨는지 본다.
5. 승인한 경우 `mis worktree merge` 단계에서 충돌이 나면 다음을 확인한다:
   - 병합이 중단되고 main이 깨끗한지
   - 충돌 파일이 보고되는지
   - 판정이 PARTIAL에 머무는지

PASS 조건: 4번에서 확인 창이 뜨고, 거절하면 편집되지 않는다. 승인 후 충돌이 나면 5번처럼 병합이 중단·보고되고 판정이 PARTIAL에 머문다.

## NH-5 실제 플러그인 설치 경로 (마켓플레이스)

`--plugin-dir` 경로는 자동 검증에서 확인했다(M4). 이 항목은 **마켓플레이스 설치**를 확인한다. 설치 범위는 project로 해서 사용자 전역 설정을 바꾸지 않는다.

1. 로컬 마켓플레이스를 만든다(저장소 밖):
   ```sh
   mkdir -p /tmp/mis-market/.claude-plugin /tmp/mis-market/plugins
   git clone $MIS /tmp/mis-market/plugins/make-it-ship
   cat > /tmp/mis-market/.claude-plugin/marketplace.json <<'EOF'
   {
     "name": "mis-local",
     "owner": { "name": "local test" },
     "plugins": [ { "name": "make-it-ship", "source": "./plugins/make-it-ship" } ]
   }
   EOF
   ```
2. 확인용 저장소를 만든다: `node $MIS/evals/setup-demo.mjs b /tmp/nh5 && cd /tmp/nh5`
3. 설치한다:
   ```sh
   claude plugin marketplace add /tmp/mis-market --scope project
   claude plugin install make-it-ship@mis-local --scope project
   claude plugin list
   ```
   `claude plugin list`에 `make-it-ship`이 활성 상태로 보여야 한다.
4. `claude`(대화형, `--plugin-dir` 없이)를 실행하고 다음을 입력한다: `/make-it-ship:run Fix the bug described in ISSUE.md`. 스킬이 로드되는지, guard 훅이 동작하는지 확인한다.
   - guard 확인 방법: 실행 중 `git push`를 요청하면 확인 창이 떠야 한다. 그 자리에서 거절한다.
   - 보고서까지 진행되는지도 확인한다.
5. 정리한다:
   ```sh
   claude plugin uninstall make-it-ship@mis-local --scope project
   claude plugin marketplace remove mis-local
   ```
   정리 후 `/tmp/nh5/.claude/` 설정이 원래대로인지 확인한다.

PASS 조건: 3번 `claude plugin list`에 활성 상태로 보이고, 4번에서 스킬과 guard가 동작한다. 5번 뒤에는 `~/.claude/settings.json`이 바뀌지 않았다(설치 전후 diff가 없음).

## NH-6 iOS 실기기 디버그 브리지

준비물: 개발자 모드가 켜진 iPhone(USB 연결), Xcode, 서명 가능한 팀 계정.

1. 테스트용 SwiftUI 앱을 만든다(새 Xcode 프로젝트, 사내 코드 사용 금지).
2. `$MIS/templates/ios-debug-bridge`를 앱 저장소의 `Packages/DebugBridge`로 복사한 뒤 로컬 패키지 의존성으로 추가하고, README대로 `#if DEBUG` 연결 코드를 넣는다.
3. `node $MIS/scripts/mis.mjs ios devices`를 실행해 기기가 `connected: true`로 보이는지 확인한다.
4. DEBUG 빌드를 기기에 설치·실행한다. 기기 루프백 `127.0.0.1:8765`로 터널(포트 포워딩)을 열고, 다음 세 가지를 확인한다:
   - `/healthz` → `ok`
   - `/state` → JSON
   - `/screenshot` → PNG
5. `mis ios bridge-scan`이 남은 파일을 나열하는지 보고, `mis ship`이 NOT READY(PARTIAL)를 내는지 확인한다.
6. README의 제거 절차를 수행한 뒤 확인한다:
   - `mis ios bridge-scan` → `clean: true`
   - Release 빌드 성공
   - 바이너리 심볼 검사 `nm -j <app binary> | grep -i debugbridge` → 0건
7. 다시 run을 VERIFIED까지 진행해 `mis ship`이 READY인지 확인한다.

PASS 조건: 4번 세 엔드포인트가 응답하고, 5번 NOT READY, 6번 세 확인, 7번 READY가 모두 기대대로다.

## NH-7 second opinion 실제 호출

주의: 저장소 내용이 외부 모델 서비스로 전송된다. **합성 데모 저장소에서만** 실행하고, 회사 데이터 정책을 먼저 확인한다.

1. codex 또는 gemini CLI를 설치하고 로그인한다.
2. `node $MIS/evals/setup-demo.mjs a /tmp/nh7 && cd /tmp/nh7`
3. `claude --plugin-dir $MIS`(대화형)를 실행하고 다음을 입력한다: `/make-it-ship:run Implement docs/feature-request.md. Use full mode and get a second opinion.`
4. `mis second-opinion detect`가 CLI를 찾는지, 외부 모델 CLI를 호출할 때 확인 창이 뜨는지 본다.
5. 승인한 경우 `mis note second-opinion`으로 기록되는지, 보고서 5절에 "판정에 미반영"으로 표시되는지 확인한다.

PASS 조건: 4번에서 확인 창이 뜬다. 거절하면 호출되지 않고, 승인하면 5번처럼 기록·표시된다. 판정 값은 second opinion 전후로 같다.

## NH-8 Codex 어댑터 실사용

주의: NH-7과 같은 데이터 정책 조건이 적용된다.

1. `node $MIS/evals/setup-demo.mjs a /tmp/nh8 && cd /tmp/nh8 && cp $MIS/adapters/codex/AGENTS.md ./AGENTS.md`를 실행하고, `export MIS_HOME=$MIS`로 경로를 지정한다.
2. Codex CLI로 "Implement docs/feature-request.md following AGENTS.md"를 실행한다.
3. 다음을 확인한다:
   - `mis` 명령으로 start, plan, check, review, verdict 순서가 진행되는지
   - 승인 단계에서 사용자에게 `mis approve plan`을 직접 실행하라고 요청하는지
   - 최종 판정이 `mis verdict` 출력과 일치하는지

PASS 조건: 3번의 세 항목이 모두 확인된다. Codex가 `mis approve plan`을 사용자 확인 없이 직접 실행하면 FAIL이다.

## NH-9 (삭제됨)

2026-10-20 사용자 결정으로 BSP QA 프로파일(M5-05) 제거. 확인할 기능이 없다.
