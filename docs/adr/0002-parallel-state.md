# ADR-0002: 병렬 실행 도입 시 상태 저장 재검토 (ADR-004 후속)

- 일시: 2026-10-19 · 상태: 채택 · 관련: Spec ADR-004("M3 병렬 도입 시 재검토"), §11 M3

## 맥락
M3에서는 독립 task를 git worktree에서 병렬로 실행한다. 이때 여러 프로세스가 같은 run 상태(`<git-common-dir>/make-it-ship/runs/<id>/state.json`)를 동시에 갱신한다. M1의 lock은 경합 시 바로 실패했다. 또 `mis check`가 명령이 끝날 때까지(최대 수십 분) lock을 쥐고 있어서, 병렬 작업자끼리 서로를 막았다.

## 선택지
1. **SQLite**: 동시 쓰기와 트랜잭션을 지원한다. 그러나 런타임 의존성 0(ADR-003)과 충돌한다. Node 22의 `node:sqlite`는 실험 기능이어서 경고가 나오고 버전 의존성이 생긴다.
2. **JSON + 짧은 lock + 대기**:
   - lock은 읽기-수정-쓰기 구간에만 잡는다.
   - 경합하면 최대 `MIS_LOCK_WAIT_MS`(기본 30초)까지 기다린다.
   - 죽은 PID의 lock은 회수한다.
   - 오래 걸리는 check는 lock 밖에서 실행한다. 순서는 "id 예약 → 실행 → 기록" 3단계다.
   - 실행 중인 check는 `running/<pid>.json` 표식을 남기고, `mis resume`이 이것으로 중단을 감지한다.
3. **작업자별 상태 파일 분리 후 병합**: 충돌 해결 규칙이 새로 필요하고 판정 로직이 복잡해진다.

## 결정
2번을 택한다. 상태 쓰기는 작고 드물다(명령당 한 번, 수 ms). 동시 작업자 수도 MVP 범위에서 적다(수 개).

## 근거 (실측·테스트)
- `tests/integration/mis-concurrency.test.mjs`: 프로세스 8개가 동시에 `interview add`를 실행해도 갱신이 하나도 사라지지 않았고, id도 모두 유일했다.
- 같은 테스트에서 3초짜리 check가 실행되는 동안 다른 `mis check`가 기다리지 않고 바로 완료됐다.
- `tests/integration/mis-resume.test.mjs`: check 도중 SIGKILL한 경우 `mis resume`이 중단된 check를 보고하고 표식을 정리했다.

## 결과
- 동시 작업자가 수십 개로 늘거나 상태 크기가 MB 단위가 되면 재검토한다(다시 SQLite 검토).
- lock 대기 시간 초과는 오류로 보고된다. 판정에는 영향이 없다.
