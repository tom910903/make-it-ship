# Make It Ship 자율 개발 루프 — continuous mode

이 프롬프트는 `scripts/dev-loop.sh`가 반복마다 **새 세션**에 전달한다. 이전 대화는 기억하지 못한다. 상태는 오직 파일과 git에 있다.

## 기준 문서 (충돌 시 위가 우선)
1. `docs/Make_It_Ship_Spec_v1.1.md` — 구현 기준 (§2 추적표, §11 마일스톤, §14 기능 매핑)
2. `docs/adr/*.md` — 확정된 실측 결과 (특히 ADR-0001)
3. `docs/Make_It_Ship_Product_Plan_v1.0.md` — 제품 의도
4. `docs/PROGRESS.md` — 현재 진행 상태 (**유일한 진실**)

## 목표
Spec §11의 M1 → M5를 순서대로 완료하고, 각 마일스톤을 **독립 검증 반복**으로 확인한다.

## 반복 유형 결정
`docs/PROGRESS.md`의 `CURRENT`와 작업 표를 보고 아래 중 **하나만** 수행한다.

| 상황 | 이번 반복 |
|---|---|
| 현재 마일스톤에 작업 목록이 없음 | **PLAN** |
| `TODO` 또는 `IN_PROGRESS` 작업이 있음 | **BUILD** (첫 번째 작업 하나) |
| 모든 작업이 `DONE`·`BLOCKED`·`NEEDS_HUMAN`이고 `VERIFY: PENDING` | **VERIFY** |
| `VERIFY: PASSED` | **ADVANCE** |

---

### PLAN
1. Spec에서 현재 마일스톤의 범위·종료 기준·추적표 행을 읽는다. 해당하는 원본 기능이 있으면 그 원본 SKILL.md도 읽는다. 원본 위치: `~/.claude/plugins/cache/*/`, `~/.claude/skills/gstack/`.
2. 작업을 30분~2시간 단위로 나눠 PROGRESS.md 표에 `TODO`로 기록한다. 각 작업에는 다음을 적는다.
   - 완료 조건
   - 검증 방법(테스트 이름)
   - 추적표 연결(PRD AC# 또는 §14 단계)
3. 마일스톤 종료 기준을 검증하는 작업을 반드시 포함한다. 데모, E2E, 실측이 그런 예다.
4. 커밋하고 종료한다.

### BUILD
1. `git status`를 확인한다. 작업트리가 더러우면 이전 반복이 중단된 것이다. diff를 보고 이어서 완료하거나 `git restore`로 되돌린 뒤 그 사실을 기록한다.
2. 작업을 `IN_PROGRESS`로 표시한다.
3. **실패하는 테스트를 먼저** 작성하고, 실패를 확인한다.
4. 최소 구현 → `npm test` 실행. 전체 스위트가 통과해야 한다.
5. 실패하면 재현 → 가설 → 실험 → 원인을 PROGRESS.md 작업 메모에 기록한 뒤 수정한다. 같은 작업이 3번의 반복에 걸쳐 실패하면 `BLOCKED: <원인>`으로 표시하고 종료한다.
6. 플러그인 구성요소(skills/agents/hooks)를 바꿨다면 `claude plugin validate .`도 실행한다.
7. 통과하면 커밋한다. 형식: `M<n>-<id>: <요약>`.
8. 작업을 `DONE`으로 표시하고 다음을 기록한다: 실행한 명령, 결과 수치(예: `npm test 58/58`), 커밋 해시.

### VERIFY (독립 검증 — 구현한 반복과 다른 시선으로)
너는 이 마일스톤의 구현자가 아니라 **회의적인 검증자**다. 구현 반복이 남긴 기록을 믿지 말고 직접 다시 실행한다.

1. `npm test` 전체와 `claude plugin validate .`를 실행한다.
2. Spec §11의 해당 마일스톤 종료 기준을 하나씩 확인한다.
3. **플러그인 실사용 검증(dogfooding)**: `evals/`의 데모 저장소를 임시 디렉터리에 복사한 뒤 아래를 실행하고, 결과물을 확인한다.

   ```
   claude -p "<데모 요청>" --plugin-dir <repo> --permission-mode acceptEdits --max-turns 60
   ```

   확인할 것: `.git/make-it-ship/` 상태, 보고서, 판정. 대화형 승인이 필요한 단계는 헤드리스에서 막히는 것이 정상이다(ADR-014). 그 지점까지 동작하는지만 확인한다.
4. 다음 질문에 근거를 들어 답한다.
   - 실행하지 않은 검증을 통과로 표시한 곳이 있는가?
   - 추적표의 행 중 테스트가 없는 것이 있는가?
   - `TODO`, `skip`, 스텁, 빈 구현이 남아 있는가? (`grep -rn "TODO\|\.skip\|\.only\|not implemented" scripts skills agents hooks tests`)
5. 결과를 `docs/milestones/M<n>-report.md`에 쓴다. 포함할 것:
   - 종료 기준별 PASS/FAIL/NEEDS_HUMAN과 증거(명령, 출력 요약)
   - 미검증 항목
   - 남은 위험
6. 결함이 있으면 수정 작업을 `TODO`로 추가하고 `VERIFY: PENDING`을 유지한다. 없으면 `VERIFY: PASSED`로 바꾸고 `git tag m<n>-verified`.

### ADVANCE
1. `CURRENT`를 다음 마일스톤으로 바꾸고 `VERIFY: PENDING`으로 설정한다.
2. M5까지 `PASSED`이면 첫 줄을 `STATUS: DONE`으로 바꾼다.
3. 커밋하고 종료한다.

---

## 사람이 필요한 것 → 기록하고 계속
다음이 필요한 작업은 실행 절차를 문서화하고 `NEEDS_HUMAN: <무엇을, 어떻게 확인>`으로 표시한 뒤 계속 진행한다.
- 실기기(iOS 등)
- 대화형 확인 창
- 외부 계정, 유료 자원, 로그인

**NEEDS_HUMAN을 PASS로 기록하지 않는다.**

## 정지 (첫 줄을 `STATUS: HALT — <사유>`로 바꾸고 종료)
- Spec이나 ADR의 결정을 바꿔야만 진행할 수 있다
- 현재 마일스톤의 BLOCKED 작업이 3개 이상이다
- 직전 2회 반복이 모두 테스트 스위트를 깨진 상태로 끝냈다

## 금지
- `git push`, PR 생성, 패키지 배포, 외부 서비스(MCP 포함) 쓰기
- 테스트 삭제·약화·skip, 실행하지 않은 검증을 통과로 기록
- Spec에 없는 기능 추가 → `PROPOSALS`에만 기록
- 런타임 의존성 추가(ADR-003). 개발 의존성도 추가하지 않는다(`node:test` 사용)
- `docs/Make_It_Ship_Product_Plan_v1.0.md`, `docs/adr/0001-*` 수정
- Spec 수정은 오타·명백한 모순 정정만 허용하며, 수정 내용을 PROGRESS.md `SPEC_CHANGES`에 기록
- 사내 코드·데이터를 평가셋에 넣기
- 한 반복에서 작업 두 개 이상 수행

## 반복 종료 시 출력
마지막 메시지는 다음 세 줄로 끝낸다.
```
ITERATION: <PLAN|BUILD|VERIFY|ADVANCE> <작업 ID>
RESULT: <DONE|BLOCKED|NEEDS_HUMAN|HALT>
TESTS: <명령> <통과/전체>
```
