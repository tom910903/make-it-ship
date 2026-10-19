continuous mode. 이 세션의 역할은 Make It Ship 개발 루프의 **감독자**다. 질문은 아래 "사용자에게 묻는 경우"에만 한다.

## 목표
`docs/Make_It_Ship_Spec_v1.1.md`의 M1~M5를 모두 구현하고 검증한다.
- 각 마일스톤은 `docs/milestones/M<n>-report.md`와 git 태그 `m<n>-verified`로 완료를 증명한다.
- 최종 산출물은 `claude --plugin-dir .`로 설치해 `/make-it-ship:run`이 동작하는 플러그인이다.
- 실제로 실행하지 않은 검증은 통과로 기록하지 않는다.

## 준비 (한 번만)
1. 저장소 루트(`make-it-ship`)에서 `git status --short --branch`를 실행한다.
   - 현재 브랜치가 `develop`인지 확인한다. 아니면 `develop`으로 전환하거나 새로 만든다.
   - 작업트리가 깨끗한지 확인한다.
2. 다음 파일을 읽는다: `docs/LOOP_PROMPT.md`, `docs/PROGRESS.md`, `docs/adr/0001-host-smoke.md`.

## 실행
1. `scripts/dev-loop.sh 150`을 Bash `run_in_background`로 실행한다.
   - 이 스크립트는 반복마다 새 `claude -p` 세션을 띄워 `docs/LOOP_PROMPT.md`를 수행한다.
2. 루프가 도는 동안 이 세션은 코드를 직접 고치지 않는다. 짧은 간격으로 폴링하지 않고, 완료 알림을 기다린다.
3. 기다리는 동안 마일스톤 태그(`git tag -l 'm*-verified'`)가 새로 생기면 해당 보고서를 읽고 한 줄 요약을 남긴다.

## 루프가 끝났을 때 (`head -1 docs/PROGRESS.md`로 판단)

### `STATUS: DONE`
1. 최종 검증을 **직접 다시** 실행한다.
   - `npm test` 전체
   - `claude plugin validate .`
   - `evals/`의 데모 저장소 하나를 임시 디렉터리에 복사한 뒤 아래 명령을 실행하고, 판정과 보고서가 생성되는지 확인한다.
     ```
     claude -p "<데모 요청>" --plugin-dir <repo> --permission-mode acceptEdits --max-turns 60
     ```
2. M1~M5 보고서와 태그가 모두 있는지 확인한다.
3. `docs/milestones/FINAL-report.md`를 작성한다. 포함할 것:
   - 마일스톤별 결과
   - 추적표(Spec §2) 행별 구현·테스트 상태
   - NEEDS_HUMAN 목록과 각 항목의 확인 절차
   - 남은 위험
   - 설치 방법과 사용법
4. 커밋한 뒤 결과를 보고한다.

### `STATUS: HALT — <사유>`
1. 사유와 마지막 반복 로그(`.dev-loop/` 최신 파일 2~3개의 끝부분)를 읽고 원인을 분석한다.
2. Spec이나 ADR의 결정을 바꾸지 않고 해결할 수 있는 문제라면 다음 순서로 처리한 뒤 루프를 다시 실행한다.
   - 대상 예: 루프 스크립트·환경·권한 목록 문제, 잘못 쪼갠 작업
   - 최소 수정을 한다
   - `PROGRESS.md`의 `RISKS`에 기록한다
   - 첫 줄을 `STATUS: RUNNING`으로 되돌린다
   - 커밋한다
3. Spec 결정이 필요하면 아래 "사용자에게 묻는 경우"를 따른다.

### 여전히 `STATUS: RUNNING`인데 루프가 끝남 (반복 상한 도달 또는 비정상 종료)
1. 최근 로그를 확인한다.
2. 진전이 있었다면(커밋이 늘었다면) 루프를 다시 실행한다.
3. 같은 작업에서 진전 없이 재시작이 3번째라면 HALT와 같이 처리한다.

## 사용자에게 묻는 경우 (이때만 멈춘다)
- Spec이나 ADR의 결정을 바꿔야 할 때
- 같은 원인으로 루프를 3번 재시작해도 진전이 없을 때
- 비용이나 시간이 예상보다 크게 늘어 계속할지 판단이 필요할 때

질문할 때는 선택지 2~4개를 제시하고 권장안을 표시한다.

## 금지
- `git push`, PR 생성, 외부 서비스 쓰기 (최종 보고 후 사용자가 별도로 결정)
- 감독 세션이 기능 코드를 직접 구현하는 것 (루프 인프라 수정만 허용)
- 테스트 약화나 skip, NEEDS_HUMAN 항목을 통과로 기록하는 것
- `docs/Make_It_Ship_Product_Plan_v1.0.md`, `docs/adr/0001-host-smoke.md` 수정

## 최종 보고 형식
- 완료한 것: 마일스톤과 태그
- 확인한 증거: 명령과 결과 수치
- 실행하지 못한 검증과 그 이유
- 사용자가 해야 할 일: NEEDS_HUMAN 목록, push 여부 결정
- 남은 위험
