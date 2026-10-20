# 작업 인계 (HANDOFF) — 2026-10-20

다른 장비나 세션에서 이어서 작업하려면 이 문서부터 읽는다. 진행 기록의 원본은 `docs/PROGRESS.md`와 `git log`다.

## 1. 현재 상태

- **M1~M5 구현 완료.** 마일스톤마다 독립 검증을 PASS했고, 최종 검증도 PASS다(`docs/milestones/FINAL-report.md`).
- **브랜치:** `feature/make-it-ship-m1-m5`
  - 원격: `github.com/tom910903/make-it-ship` (비공개)
  - 로컬 `develop`이 이 원격 브랜치를 추적한다.
- **태그:** `m1-verified` ~ `m5-verified`. 검증 당시의 커밋을 가리킨다.
- **테스트:** `npm test` 319/319, `claude plugin validate .` 통과.
- **최종 검증 이후 바뀐 것**(검증 보고서에는 반영되지 않음):
  1. `73e9260` — NH-1~4를 tmux 대화형 세션으로 자동 확인하고 기록했다(`docs/milestones/NH-auto-check.md`).
  2. `75f2fb8` — guard 수정. 파일 편집 범위를 세션 cwd가 아니라 **파일이 있는 worktree** 기준으로 판정한다.
  3. `a95fb61` — **BSP QA 프로파일 제거**(사용자 결정). NH-9는 해당 없음이다.

## 2. 다른 장비에서 시작하기

```sh
git clone git@github.com:tom910903/make-it-ship.git && cd make-it-ship
git checkout feature/make-it-ship-m1-m5
node --version              # 22 이상
npm test                    # 319/319 기대
claude plugin validate .    # 통과 기대
claude --plugin-dir "$PWD"  # 다른 저장소에서 /make-it-ship:run ... 으로 사용
```

외부 패키지 의존성은 없다. Node 내장 기능과 `node:test`만 쓴다.

## 3. 남은 일 (우선순위 순)

| # | 할 일 | 상태 / 필요한 것 | 참고 |
|---|---|---|---|
| 1 | **`mis-bench` 테스트를 결정적으로 만들기** | 실제 걸린 시간(`medianMs >= 30`)으로 판정한다. 그래서 고부하에서 가끔 실패한다. 이전 동시성 테스트처럼 release 파일 게이트 같은 방식으로 바꾼다. | `tests/integration/mis-bench.test.mjs`, 커밋 `555e4ef`(같은 유형 수정 사례) |
| 2 | **NH-5 마켓플레이스 설치 확인** | 배포 전에 필요하다. 사용자 전역 마켓플레이스 목록이 잠시 바뀌므로 사용자 승인 후 진행한다. | `docs/milestones/NEEDS_HUMAN.md` NH-5 |
| 3 | **NH-1~4 사람 확인** | Claude가 tmux로 확인한 것은 통과(AUTO)했다. 사람이 직접 누르는 확인은 아직이다. NH-1만 해도 5분 정도 걸린다. | `NH-auto-check.md`, `NEEDS_HUMAN.md` |
| 4 | **NH-6 iOS 실기기 브리지** | iPhone(개발자 모드, USB)이 연결되면 진행할 수 있다. 쓰지 않을 거면 "해당 없음"으로 닫거나 기능을 제거한다. | `NEEDS_HUMAN.md` NH-6, `templates/ios-debug-bridge/` |
| 5 | **NH-7 second opinion / NH-8 Codex 어댑터** | 코드가 외부 모델 서비스로 나가서 사내 정책상 막혀 있다. 쓸지 말지를 결정해야 한다. 안 쓰면 해당 없음 처리하거나 기능을 제거한다. | `NEEDS_HUMAN.md` NH-7·8 |
| 6 | **사후 변경 재검증(선택)** | 위 1장의 세 가지 변경은 최종 독립 검증 이후의 것이다. 필요하면 검증 에이전트를 다시 돌린다. | `docs/milestones/VERIFIER_PROMPT.md` |
| 7 | **main 브랜치 / PR** | 원격에는 이 feature 브랜치만 있다. main 생성과 PR은 사용자가 요청하면 진행한다. | — |
| 8 | **문서 업로드 정책 확인** | `docs/`의 기획서와 Spec이 개인 계정 GitHub에 올라가 있다. 회사 정책상 문제가 되면 히스토리에서 제외하고 다시 올린다. | — |

## 4. 열린 결정 (사용자에게 물어볼 것)

- NH-6~8 기능을 유지할지, "해당 없음"으로 닫을지, 제거할지
- NH-5를 Claude가 대신 진행해도 되는지
- 일반 위험 플래그 `hardware`를 유지할지(BSP 제거 후에도 지금은 남겨 둠)

## 5. 작업 규칙 (원래 /goal 지시에서)

- 우선순위: Spec v1.1(`docs/Make_It_Ship_Spec_v1.1.md` §2·§11·§14) > ADR(`docs/adr/`) > 기획서. **기획서와 ADR은 수정하지 않는다.** Spec과 다르게 가야 하면 PROGRESS.md `SPEC_CHANGES`에만 기록한다.
- 작업마다 TDD로 진행한다: 실패 테스트 → 최소 구현 → 전체 `npm test` → 커밋.
- **금지:**
  - 테스트 삭제·약화·skip
  - 실행하지 않은 검증을 통과로 기록하기
  - Spec에 없는 기능 추가(필요하면 PROGRESS.md 제안으로만)
  - 외부 패키지 추가
  - 사내 코드·데이터를 테스트에 쓰기
  - 외부 모델 CLI(codex/gemini) 호출(사내 정책)
- 사람이 확인해야 하는 항목은 NEEDS_HUMAN으로 둔다. Claude가 대신 확인한 것은 "AUTO"로만 적는다.
- 멈추고 물어볼 때: Spec이나 ADR 결정을 바꿔야 할 때, 같은 문제로 3번 시도해도 진전이 없을 때.

## 6. 구조 요약

| 경로 | 내용 |
|---|---|
| `scripts/mis.mjs`, `scripts/lib/commands.mjs` | `mis` CLI(start/plan/approve/task/check/verdict/report/…) |
| `scripts/guard.mjs`, `scripts/lib/policy.mjs`, `scripts/lib/shell.mjs` | PreToolUse 훅. 셸 토크나이저 기반으로 ask/deny를 판정하고, 내부 오류 시 ask(fail-closed) |
| `scripts/lib/verdict.mjs`, `state.mjs`, `tree-hash.mjs` | 판정 규칙(§6), run 상태(`<git-common-dir>/make-it-ship/runs/`), 증거의 STALE 판정 |
| `skills/run/SKILL.md`, `skills/run/phases/*.md` | 전체 흐름. discover → plan → 승인 → implement → verify → review → qa → report → ship |
| `agents/*.md` | 읽기 전용 리뷰어 8종과 implementer(쓰기 가능) |
| `evals/setup-demo.mjs`, `evals/demos/` | 합성 데모 저장소(a, b, c, d, p, pilot-1..6) |
| `tests/` | `node:test` 단위·통합 테스트 |
| `docs/milestones/` | 마일스톤 보고서, 최종 보고서, NEEDS_HUMAN, NH 자동 확인 기록 |

## 7. 대화형 확인을 자동으로 돌리는 방법 (NH-1~4에서 쓴 방식)

```sh
node evals/setup-demo.mjs a /tmp/nh1 && cd /tmp/nh1
mkdir -p .claude && echo '{"permissions":{"allow":["Bash","Read","Write","Edit","Glob","Grep","Agent"]}}' > .claude/settings.local.json
tmux new-session -d -s nh1 -x 220 -y 60 "claude --plugin-dir <repo> --setting-sources project,local --strict-mcp-config"
tmux send-keys -t nh1 -l "/make-it-ship:run Implement docs/feature-request.md. Use standard mode." && tmux send-keys -t nh1 Enter
tmux capture-pane -p -t nh1 | tail -30   # 확인 창 확인 후 Enter(승인) / Down+Enter(거절)
```

- headless 모드(`claude -p`)에서는 ask 확인 창이 뜨지 않는다(ADR-014). 확인 창을 검증하려면 위처럼 대화형 세션을 써야 한다.
- 사용자 전역 설정(`~/.claude/settings.json`)은 건드리지 않는다. HUD는 데모 저장소의 `.claude/settings.local.json`에 `statusLine`을 넣어 확인한다.
