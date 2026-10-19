# 시작 프롬프트

새 Claude Code 세션을 저장소 루트에서 열고, Shift+Tab으로 **auto 모드**를 켠 뒤 아래 두 개를 순서대로 붙여넣는다.

## ① 골 설정

```
/goal docs/PROGRESS.md 첫 줄이 "STATUS: DONE"이고, git 태그 m1-verified~m5-verified가 모두 존재하고, docs/milestones/FINAL-report.md가 커밋되어 있고, 마지막 커밋에서 npm test와 claude plugin validate . 가 통과한 상태
```

## ② 작업 프롬프트

```
continuous mode. 목표는 위 /goal이다. Make It Ship 플러그인을 M1부터 M5까지 끝까지 구현하고 검증한다. 사용자 질문은 아래 "멈추고 묻는 경우"에만 한다.

## 기준 문서 (충돌 시 위가 우선)
1. docs/Make_It_Ship_Spec_v1.1.md — 구현 기준 (§2 추적표, §11 마일스톤, §14 기능 매핑)
2. docs/adr/*.md — 실측으로 확정된 사실
3. docs/Make_It_Ship_Product_Plan_v1.0.md — 제품 의도
4. docs/PROGRESS.md — 진행 상태의 유일한 기록. 컨텍스트가 압축되거나 세션이 재시작되면 항상 이 파일과 git log부터 다시 읽는다.

## 시작할 때
1. `git status --short --branch`를 확인한다. `develop` 브랜치에서 작업하고, 작업트리가 더러우면 내용을 보고 정리한다.
2. 기준 문서 1~4를 읽는다.

## 작업 사이클 (PROGRESS.md의 CURRENT 마일스톤에 대해 반복)

**A. 계획**: 마일스톤에 작업 목록이 없을 때
- Spec의 해당 범위·종료 기준·추적표 행을 읽는다.
- 흡수할 원본 기능이 있으면 원본 SKILL.md를 읽고 핵심 동작을 파악한다. 위치는 `~/.claude/plugins/cache/*/`, `~/.claude/skills/gstack/`이다.
- 30분~2시간 단위 작업으로 나눠 PROGRESS.md 표에 TODO로 적는다. 작업마다 완료 조건, 검증 테스트, 추적 ID를 적는다.
- 마일스톤 종료 기준을 확인하는 작업(데모, E2E)을 반드시 포함한다.
- 커밋한다.

**B. 구현**: TODO 작업을 하나씩 처리한다
1. 실패하는 테스트를 먼저 작성하고, 실패하는 것을 확인한다.
2. 최소 구현 → `npm test` 전체 통과
3. 플러그인 구성요소(skills, agents, hooks)를 바꿨다면 `claude plugin validate .`도 실행한다.
4. 실패하면 재현 → 가설 → 실험 순서로 원인을 찾고, 원인을 PROGRESS.md 작업 메모에 적은 뒤 수정한다. 같은 작업이 3번 실패하면 BLOCKED(사유 포함)로 두고 다음 작업으로 간다.
5. 커밋한다. 형식: `M<n>-<id>: <요약>`
6. PROGRESS.md에 상태 DONE, 실행 명령, 결과 수치, 커밋 해시를 기록한다.

**C. 독립 검증**: 마일스톤의 작업이 모두 DONE, BLOCKED, NEEDS_HUMAN 중 하나가 되면
- 검증은 직접 하지 말고, **새 서브에이전트(검증자)** 에게 맡긴다. 구현 내용을 모르는 회의적인 검증자 역할을 준다.
- 검증자에게 시킬 일:
  - `npm test`와 `claude plugin validate .`를 재실행한다.
  - Spec §11 종료 기준을 항목별로 확인한다.
  - 추적표 행마다 테스트가 있는지 확인한다.
  - TODO, skip, 스텁이 남아 있는지 grep으로 확인한다.
  - evals/ 데모 저장소를 임시 디렉터리에 복사해 다음 명령으로 실제 사용 검증을 한다. 헤드리스에서는 ask 승인 단계에서 멈추는 것이 정상이다(ADR-014).
    ```
    claude -p "<데모 요청>" --plugin-dir <repo> --permission-mode acceptEdits --max-turns 60
    ```
- 검증 결과는 `docs/milestones/M<n>-report.md`에 쓴다. 기준별 PASS/FAIL/NEEDS_HUMAN과 증거, 미검증 항목, 남은 위험을 포함한다.
- 결함이 있으면 수정 작업을 TODO로 추가하고 B로 돌아간다. 결함이 없으면 `git tag m<n>-verified`를 붙이고 CURRENT를 다음 마일스톤으로 바꾼다.
- 마일스톤 하나가 끝날 때마다 사용자에게 한 줄로 알린다. 형식: `M<n> 완료: 테스트 x/y, NEEDS_HUMAN k건`

**D. 마무리**: M5가 검증되면
- 최종 검증 서브에이전트를 한 번 더 실행한다.
- `docs/milestones/FINAL-report.md`를 작성한다. 포함할 것:
  - 마일스톤별 결과
  - 추적표 행별 상태
  - NEEDS_HUMAN 목록과 각 항목의 확인 절차
  - 남은 위험
  - 설치와 사용법
- PROGRESS.md 첫 줄을 `STATUS: DONE`으로 바꾸고 커밋한다.

## 사람이 필요한 것은 기록하고 계속 진행
실기기(iOS), 대화형 확인 창, 외부 계정·로그인·유료 자원이 필요한 검증은 다음과 같이 처리하고 다음 작업으로 넘어간다.
- 실행 절차를 문서로 작성한다.
- PROGRESS.md의 NEEDS_HUMAN에 기록한다.
- 절대 PASS로 기록하지 않는다.

## 멈추고 묻는 경우 (이때만)
- Spec이나 ADR의 결정을 바꿔야만 진행할 수 있을 때
- 한 마일스톤에서 BLOCKED 작업이 3개 이상일 때

질문할 때는 선택지 2~4개와 권장안을 제시한다. 그 외에는 묻지 않고 계속 진행한다.

## 금지
- git push, PR 생성, 외부 서비스·MCP 쓰기. guard 확인 창이 뜨는 작업은 하지 않는다.
- 테스트 삭제·약화·skip, 실행하지 않은 검증을 통과로 기록
- Spec에 없는 기능 추가 → PROGRESS.md PROPOSALS에만 기록
- 런타임·개발 의존성 추가 (ADR-003, node:test 사용)
- Product Plan과 ADR-0001 수정. Spec은 명백한 오류 정정만 허용하며 SPEC_CHANGES에 기록한다.
- 사내 코드나 데이터를 평가셋에 사용

## 컨텍스트 관리
- 큰 파일 탐색과 원본 스킬 분석은 서브에이전트에 맡기고 결론만 받는다.
- 커밋할 때마다 PROGRESS.md를 갱신해, 언제 끊겨도 이어갈 수 있게 한다.
```

## 진행 중 확인·중지

- 진행 확인: `head -3 docs/PROGRESS.md`, `git log --oneline | head`, `git tag -l 'm*'`
- 중지: Esc로 중단한다. goal 해제 명령은 `/help`에서 `/goal` 항목을 확인한다. 재개할 때는 같은 두 블록을 다시 붙여넣으면 PROGRESS.md부터 이어서 진행한다.

## 대안: 무인 백그라운드 루프

세션을 열어두기 어려우면 `nohup scripts/dev-loop.sh 150 > .dev-loop/run.log 2>&1 &`로 실행한다. 이 방식은 반복마다 새 세션으로 `docs/LOOP_PROMPT.md`를 수행한다.
