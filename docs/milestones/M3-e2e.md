# M3 E2E 기록 — 병렬 worktree (2026-10-19)

## 환경
M1과 동일한 깨끗한 환경으로 헤드리스 실행했다. `--output-format stream-json --verbose`를 켰다. 데모는 `node evals/setup-demo.mjs p <dir>`로 만들었다. 데모 p는 의존성이 없는 JS 저장소이고, 서로 독립인 모듈 2개(`src/text.js`, `src/math.js`)를 가진다.

요청: `/make-it-ship:run Implement REQUEST.md. Use quick mode and do the two tasks in parallel worktrees with implementer agents. You may make local commits. Proceed without asking me questions.`

## 결과 (p1)
- 이벤트 순서: `plan(T1: text.js, T2: math.js)` → `worktree-add T1, T2` → (구현자 2명이 각자 worktree에서 task start, check, commit, done) → `worktree-merge T1`, `worktree-merge T2` → **병합된 main에서 `check unit` 재실행(E3 PASS)** → quality 리뷰 0/0 → **VERIFIED**.
- stream-json으로 확인한 사항:
  - `make-it-ship:implementer` 2개가 **같은 assistant 메시지**에서 호출됐다. 즉 병렬로 디스패치됐다.
  - 그 뒤 `make-it-ship:quality-reviewer`가 호출됐다.
  - guard의 ask·deny는 0건이었다.
- git 그래프(`evidence/m3/p1-git-graph.txt`): task 브랜치마다 커밋 1개가 있고 `--no-ff` 병합 커밋이 2개 생겼다. 병합 후 worktree는 정리됐다(`git worktree list`에 main만 남음).
- 설정 파일은 모델이 "Add make-it-ship config"로 먼저 커밋했다. 사용자가 요청에서 로컬 커밋을 허락했기 때문이다. task worktree가 같은 HEAD에서 시작하려면 이 커밋이 필요하다.

## 충돌 시나리오
- 겹치는 편집이 실제로 생기면 다음을 기계적으로 검증한다(`tests/integration/mis-worktree.test.mjs` "conflict").
  - 병합 자동 중단, main은 깨끗하게 유지, 충돌 파일 보고, 해당 worktree 보존, 판정 PARTIAL("worktree not merged").
- 헤드리스 E2E로는 충돌을 만들지 않았다. 이유는 두 가지다.
  - 병렬 계획이 파일 소유권이 겹치는 작업을 같은 wave에 넣지 않는다(`parallel.test.mjs`).
  - 구현자가 자기 소유 밖 파일을 편집하면 guard가 ask를 걸고, 헤드리스에서는 실행되지 않는다(`mis-worktree.test.mjs` "guard in a task worktree").
- 결과적으로 모델 경로에서 충돌이 생길 길은 사용자가 범위 확대를 승인한 경우뿐이다. 이 경우는 대화형이라 NEEDS_HUMAN으로 둔다(NH-4).

## NEEDS_HUMAN
- NH-4: 대화형 세션에서 병렬 실행 중 구현자가 소유 밖 파일 편집을 요청할 때 확인 창이 뜨는지 확인한다. 승인했다면, 그 결과로 생긴 충돌이 `mis worktree merge`에서 중단·보고되는지 확인한다.
  - 절차: 데모 p에서 REQUEST.md에 "kebab도 src/math.js에서 re-export"를 추가한다. 병렬 실행 후 확인 창이 뜨면 승인하고, merge 결과를 기록한다.
