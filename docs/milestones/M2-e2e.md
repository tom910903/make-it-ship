# M2 E2E 기록 — 데모 D (2026-10-19)

## 환경
M1과 동일: `claude -p ... --plugin-dir <repo> --setting-sources project --strict-mcp-config --permission-mode bypassPermissions --max-turns 80`. 데모는 `node evals/setup-demo.mjs d <dir>`로 생성했다. 데모 D는 의존성이 없는 JS 저장소이고, 기준선에서 테스트 1개가 실패한다(`cartTotal ... rounds the discount half up`).

강제 종료 방법: 첫 실행을 백그라운드로 띄우고 `.git/make-it-ship/runs/*/events.jsonl`에 `check` 이벤트가 나타나는 즉시 claude 프로세스 트리를 `SIGKILL`했다. 그 뒤 새 프로세스로 `/make-it-ship:resume The previous session was killed. Resume the run and finish it.`를 실행했다.

## 결과

| # | 종료 시점 | 재개 결과 | 증거 |
|---|---|---|---|
| d1 | task T1 done 직후(수정은 끝남, 리뷰 전) | `mis resume` → 변경 0, stale 0 → 남은 quality 리뷰 수행 → **VERIFIED**. 다만 모델이 수정 전에 실패를 기록하지 않았다(기준선 FAIL 증거 없음) → 스킬 결함으로 보고 implement phase에 "버그는 먼저 `mis check`로 재현을 기록"을 추가 | `evidence/m2/d1-*` |
| d2 | 첫 `mis check unit` **FAIL**(E1) 직후, 코드 수정 전 | `mis resume` → T1 IN_PROGRESS, 기준선 FAIL 증거 유지 → 원인 분석 → `mis note rootcause`(첫 시도는 필수 항목 누락으로 **거부됨**, 재작성 후 기록) → 수정 → E2 PASS → quality 리뷰 → **VERIFIED** | `evidence/m2/d2-*` |

d2 이벤트 순서(요약): `start → plan → mode(quick) → task start → check E1 FAIL → [kill] → resume → check E2 PASS → note rootcause → task done → review quality 0/0 → verdict VERIFIED → report`.

관찰 사항
- 재개 시 사용자에게 처음부터 다시 설명을 요구하지 않았다. 재개 보고에는 마지막 지점(T1 진행 중, E1 실패)과 현재 소스 상태(기준 커밋과 동일)가 포함됐다(PRD 5.5).
- d2에서 rootcause 노트가 수정 **이후**에 기록됐다(모델이 스스로 보고함). `task retry` 게이트는 task를 `fail`로 표시한 경우에만 걸리므로, 같은 task 안에서 수정하면 노트 순서를 강제하지 못한다. 잔여 위험으로 기록한다.
- 재시도 상한·실행 시간 상한·`approve continue`는 헤드리스 E2E로 일부러 일으키지 않았다. 통합 테스트(`mis-retry.test.mjs`)로만 검증했다.

## NEEDS_HUMAN
- NH-2: 대화형 세션에서 실행 시간 상한이나 재시도 상한으로 BLOCKED가 된 뒤, `mis approve continue`의 확인 창이 뜨는지 확인한다.
  절차: 데모 D에서 `.make-it-ship.json`의 `limits.maxAttemptsPerTask`를 1로 둔다. task를 fail로 만든 뒤 rootcause를 기록하고 retry하면 BLOCKED가 된다. 이어서 `/make-it-ship:resume`을 실행하고, 확인 창이 뜨는지와 승인·거절 시 결과를 기록한다.
- NH-3: HUD 확인. `mis init` 출력의 `hud.statusLine`을 `~/.claude/settings.json`에 등록하고 재시작한 뒤, 상태 줄에 `MIS ▸ <state> · T<n>/<m> · <checks> · <verdict>`가 나오는지 확인한다.
