# M1 E2E 기록 — 데모 A/B (2026-10-19)

## 환경
- Claude Code 2.1.292, Node v22.20.0, Python 3.9.6, macOS arm64
- 깨끗한 환경 실행: `claude -p "<요청>" --plugin-dir <repo> --setting-sources project --strict-mcp-config --permission-mode bypassPermissions --max-turns 80`
  - `--setting-sources project`: 사용자 설정의 플러그인(OMC·Superpowers·Ponytail)과 CLAUDE.md가 로드되지 않음. 사전 실측에서 외부 플러그인 스킬 0개, MCP 0개 확인(PROGRESS.md "M1 착수 전 추가 실측")
  - `bypassPermissions`: 일반 명령이 헤드리스에서 막히지 않게 하려는 설정. 이 모드에서도 guard의 `ask`는 실행되지 않음(ADR-0001 #3b)
- 데모 저장소: `node evals/setup-demo.mjs <a|b> <dir>`로 임시 디렉터리에 새로 생성. `.make-it-ship.json` 없이 시작(init 경로 포함)

## 결과

| # | 데모 | 요청 | 경로 | 결과 | 증거 |
|---|---|---|---|---|---|
| a1 | A (TypeScript 기능 추가) | `/make-it-ship:run Implement the feature described in docs/feature-request.md` | Quick (모델이 선택, 사유 기록) | REPORTED · **VERIFIED**. 테스트 먼저 작성해 실패 확인 → 구현 → `mis check unit` PASS(E2) → quality 리뷰 0/0 → 보고서 | `evidence/m1/a1-*` |
| b1 | B (Python 버그 수정) | `/make-it-ship:run Fix the bug described in ISSUE.md` | Quick | REPORTED · **VERIFIED**. 회귀 테스트 2개 추가, `unit` PASS(E1), quality 리뷰 0/0. 이슈의 규칙 밖 경계 사례(`"1,234,567"`)를 사용자 결정 사항으로 보고 | `evidence/m1/b1-*` |
| a2 | A, Standard 강제 | `... Use standard mode.` | Standard | interview 4건(MED/LOW, 기본값으로 해소) → plan → critic 리뷰 0/0 → `mis approve plan`이 **guard에 의해 실행되지 않음** → AWAITING_APPROVAL에서 정지, **코드 변경 없음**. 모델은 사용자에게 승인 방법을 안내 | `evidence/m1/a2-*` |
| a2b | a2 이어서 | 운영자가 터미널에서 `mis approve plan`을 직접 실행(훅 밖) 후 `... Continue the active run` | Standard | REPORTED · **VERIFIED**. spec·quality 리뷰 기록, 첫 리뷰 후 코드 수정 → check·리뷰 재실행(해시 바인딩 동작), 잘못된 리뷰 지적은 실행 근거로 반박 | `evidence/m1/a2b-final-message.txt`, `a2-report.md` |

관찰 사항
- 이 기록의 세 실행은 `.make-it-ship.json`을 탐지값으로 쓰고 그 사실을 알렸다. 그러나 독립 검증(M1-report L-1)의 재실행 3회는 모두 설정 확인을 기다리며 멈췄다. 모델 동작이 비결정적이다. 확인을 기다리는 쪽은 안전한 실패이고, 스킬 지시를 "비대화형이면 기다리지 말라"로 명확히 했으나, 2차 검증에서도 3/3 확인 대기로 멈췄다(개선되지 않음). 확인을 묻는 동작은 Spec §9-1(사용자 확인)에 부합하는 안전한 쪽이므로 결함이 아닌 **모델 동작 위험**으로 기록한다(PROGRESS RISKS). 무인 E2E는 요청에 "질문 없이 진행"을 명시하거나, 두 번째 호출로 답을 이어 붙여 진행한다. (3차 검증 P-4 반영: 스킬은 이제 `claude -p` 여부로 자동 기록하지 않고, 사용자가 요청에서 명시한 경우에만 확인으로 간주한다.)
- 판정 문구는 모두 `mis verdict` 출력을 인용했다.
- 보고서의 "사용자 결정" 절에 인터뷰에서 기본값으로 정한 가정이 빠져 있던 결함을 발견해 수정함(`render.mjs`, 테스트 `mis-report.test.mjs`).

## NEEDS_HUMAN — 대화형 승인 확인 창 (Standard 경로의 실제 승인)

헤드리스에서는 `ask`가 실행되지 않으므로, 사용자의 확인 창 승인 → 실행 재개 흐름은 사람이 확인해야 한다. a2b는 승인 기록 이후 흐름만 증명하며, **확인 창 자체는 검증하지 않았다.**

절차:
1. `node evals/setup-demo.mjs a /tmp/mis-a-human`
2. `cd /tmp/mis-a-human && claude --plugin-dir <make-it-ship 경로>`
3. 입력: `/make-it-ship:run Implement docs/feature-request.md. Use standard mode.`
4. 확인할 것:
   - 계획 제시 후 `mis.mjs approve plan` 실행 시 **권한 확인 창**이 뜨는가 (사유: "make-it-ship: approval is recorded only when you confirm this command")
   - 거절하면 승인이 기록되지 않고(`/make-it-ship:status` → AWAITING_APPROVAL), 코드가 바뀌지 않는가
   - 승인하면 EXECUTING으로 바뀌고 구현 → check → spec/quality 리뷰 → 보고서까지 진행되는가
   - `.make-it-ship.json` 생성 전에 사용자에게 확인을 묻는가
5. 결과를 `docs/PROGRESS.md` NEEDS_HUMAN 항목에 기록
