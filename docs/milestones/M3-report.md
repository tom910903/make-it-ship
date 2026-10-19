# M3 독립 검증 보고서 — 선택형 협업

- 검증 일시: 2026-10-19 · 브랜치 `develop` (HEAD `b3faa9f`) · 검증자: 독립 검증 에이전트(구현에 참여하지 않음)
- 범위: Spec §11 M3 행 — 독립 task 병렬(worktree), 파일 소유권, product-review·design·design-explore(Full 모드, UI 프로젝트), 필요 시 SQLite 재검토. 종료 기준은 "충돌 재현 테스트"다. 여기에 §14.1 강제 지점 두 가지를 더했다: Full은 product 리뷰가 없으면 승인 거부, Full UI는 디자인 선택 기록이 없으면 승인 거부.
- M1·M2는 검증 완료 상태(`m1-verified`, `m2-verified`)이므로 다시 판정하지 않았다.
- §2 추적표에는 MS=M3인 행이 없다. §14.3 직접 명령 중 M3에 제공되는 것도 없다.

## 요약 판정

**DEFECTS FOUND** — LOW 2건. HIGH·MEDIUM은 0건이다.

M3 기능(병렬 wave 계산, worktree 격리·병합, 충돌 시 병합 중단과 PARTIAL 판정, lock 대기, product·design 승인 게이트)은 자동 테스트와 실사용에서 모두 의도대로 동작했다. 결함 두 건은 지시문과 문서에 관한 것이다(아래 결함 목록 참고).

## 실행한 명령과 결과 수치

| 명령 | 결과 |
|---|---|
| `npm test` | **271 / 271 pass**, fail 0, skipped 0, todo 0 (15.4초) |
| `claude plugin validate .` | **✔ Validation passed** |
| 스텁 검사 `grep -rnE "TODO\|FIXME\|\.skip\|\.only\|not implemented\|todo\(" scripts skills agents hooks tests templates evals` | 걸린 것은 모두 task 상태값 문자열 `'TODO'`이다(commands.mjs:146,291,481,519 / 테스트 fixture). 스텁, skip, only는 0건 |
| 헤드리스 실사용 | p1(quick 병렬), s1→s1b(standard 병렬, 운영자 승인 후 재개), full1(Full·UI, 승인에서 정지) |
| 직접 재현 | 충돌 재현과 해결 경로, Standard 미승인 상태의 worktree add, 헤더 없는 리뷰, Full UI 승인 게이트 순서 |

## 종료 기준·범위 항목별 표

| 항목 | 판정 | 증거 |
|---|---|---|
| **충돌 재현 테스트 (§11 M3 종료 기준)** | **PASS** | 자동: `tests/integration/mis-worktree.test.mjs` "conflict"는 실제 git 병합 충돌을 만든 뒤 다음을 확인한다: `merged:false`, `conflicts:['shared.txt']`, main `status --porcelain`이 비어 있음, T1 내용 유지, 충돌 worktree 보존, verdict PARTIAL("T2 … not merged"). 직접 재현(데모 p 사본): T2가 소유 밖 `src/text.js`를 수정하게 한 뒤 merge T1 → merge T2 → `merged:false, conflicts:["src/text.js"]`. main은 깨끗했고 `MERGE_HEAD`는 없었다. worktree T2는 남아 있었고, check PASS + quality 0/0 상태에서도 verdict는 **PARTIAL**("task T2 worktree not merged (conflicts: src/text.js)"), 이벤트에는 `worktree-conflict`가 남았다. 해결 경로: worktree에서 `git rebase main` → 충돌 해소 → 다시 merge → `merged:true`. 직후 verdict는 PARTIAL(unit stale, quality 없음)이었고, `check` 재실행과 리뷰 기록 후 VERIFIED가 됐다 |
| 독립 task 병렬 (worktree) | **PASS** | 구현: `commands.mjs:492-551` (`parallel plan`, `worktree add/merge`, task worktree 안에서의 실행 거부). 자동: `mis-worktree.test.mjs` 4건. 실사용: p1과 s1b에서 implementer 2개가 **같은 assistant 메시지**(p1 `msg_011CgAv9crYF7ayQDbBrXak5`, s1b `msg_011CgAw3yFq4Mc4E4nRK4jte`)로 디스패치됐다. message.id 기준으로 묶어 확인했다. 두 실행 모두 `--no-ff` 병합 커밋 2개가 생겼고, 병합 후 worktree는 정리됐다 |
| 병합 뒤 check 재실행 | **PASS** | p1: worktree-merge T1, T2 다음에 E3 unit PASS가 기록됐다. E3의 treeHash `69dc1770`이 최종 verdict의 treeHash와 같다. worktree에서 만든 증거 E1·E2는 STALE이다. s1b: 병합 뒤 E5 PASS(`42b11994`)가 verdict treeHash와 같고, E1~E4(worktree 해시)는 무효다. treeHash 비교 덕분에 worktree 증거로는 병합된 코드를 VERIFIED로 만들 수 없다 |
| 파일 소유권 | **PASS** | `parallel.mjs` `overlaps`/`planWaves`와 `parallel.test.mjs` 3건(glob 겹침, 의존성 wave, files 없는 task는 단독, 순환·미지 의존성은 오류). 직접 확인: T1·T2가 같은 `src/text.js`를 소유하면 `waves [[T1],[T2]]`. guard는 task 브랜치(`mis/<run>/<task>`)에서 그 task의 files만 범위로 삼는다(`scripts/guard.mjs:18-23`). 자동 테스트 `mis-worktree.test.mjs` "guard in a task worktree"는 a.txt allow, b.txt ask |
| lock 대기 / SQLite 재검토 (ADR-004 → ADR-0002) | **PASS** | `docs/adr/0002-parallel-state.md`(JSON + 짧은 lock + 대기 채택). `state.mjs:94` `withLock`(대기, 죽은 PID 회수). `check`는 3단계(예약 → lock 밖 실행 → 기록). `mis-concurrency.test.mjs`: 8개 동시 writer에서 손실 0, id 유일. 3초 check가 도는 동안 다른 check가 2.5초 안에 끝났다. 실사용 s1b: E2·E3 `check-start`가 같은 초(04:04:29)에 겹쳐 실행됐고 둘 다 정상 기록됐다 |
| product-review (§14.1, Full 승인 게이트) | **PASS** | `commands.mjs:99-102`: 현재 planHash의 product 리뷰가 없거나 blocking>0이면 거부. 자동: `mis-plan.test.mjs:126-140`. 실사용 full1: product-reviewer가 critic과 같은 메시지로 병렬 디스패치됐고, 1차 리뷰(0/3)가 이전 planHash에 기록됐다. 운영자 사본에서 `mis approve plan`을 실행하자 "product review of the **current** plan is missing"으로 거부됐다. 계획 해시에 묶여 있음을 실제로 확인한 것이다 |
| design-explore (§14.1, Full UI 게이트) | **PASS** | `commands.mjs:103` + `note design`(빈 노트 거부, :437-441). 자동: `mis-plan.test.mjs:136-139`. 실사용 full1: plan `ui:true`, `DESIGN.md`와 시안 3개(`design/variant-{a,b,c}-*.html`)를 만들고 375/768/1440px 스크린샷으로 확인했다. 모델은 **사용자 대신 선택하지 않았다**(notes 0건, design 이벤트 없음). 운영자 사본: product 기록 후 approve → "full mode UI project: record the chosen design first"로 거부. 빈 design 노트는 거부. 노트를 기록한 뒤에는 HIGH Q1 때문에 거부됐고, Q1을 해소하자 EXECUTING이 됐다 |
| design (architect, ADR 초안) | **PASS** | `agents/architect.md`(읽기 전용 도구), `phases/design.md`. full1에서 architect가 디스패치됐다(`msg_011CgAvGfmc69CknB4Gb8WQa`). §14.1에서 design의 강제 지점은 "—"이므로 게이트는 없다 |
| implementer 에이전트 (SPEC_CHANGES) | **PASS** | `agents/implementer.md` tools = `Read, Write, Edit, Grep, Glob, Bash`(Agent·MCP 없음). 이 정확한 문자열을 `plugin-files.test.mjs:108-113`이 검사한다. §4의 "agents/는 모두 읽기 전용"에서 벗어나는 점은 PROGRESS SPEC_CHANGES에 해석으로 기록돼 있다. 실사용에서 implementer는 자기 worktree에서만 커밋했고 push는 없었다 |
| Standard 미승인 상태에서 병렬 시작 | **PASS** | 직접 확인: standard에서 승인 전 `mis worktree add T1` → "plan approval required before execution"(exit 1), worktree 생성 0 |

## 추적표 행별 표

Spec §2에 MS=M3인 행은 없다. M3 관련 Spec 항목은 위 표가 다룬다: §11 M3, §14.1의 product-review·design-explore, §14.2의 parallel·design-explore, ADR-004·006의 "M3에서 재검토/병렬 분업". 해당하는 자동 테스트를 하나씩 읽어 본 결과, 상수끼리 비교하는 식의 동어반복 테스트는 없었다. 모두 실제 `mis` 프로세스와 실제 git 저장소를 구동한다(`plugin-files.test.mjs`의 문자열 검사만 예외).

| 항목 | 자동 테스트 | 판정 |
|---|---|---|
| 병렬 wave·소유권 | `tests/unit/parallel.test.mjs` | PASS |
| worktree 격리·병합·충돌·guard 범위 | `tests/integration/mis-worktree.test.mjs` | PASS |
| 동시 쓰기·장시간 check | `tests/integration/mis-concurrency.test.mjs` | PASS |
| Full product / UI design 게이트 | `tests/integration/mis-plan.test.mjs:126-149` | PASS (단, product 리뷰가 plan 변경으로 무효가 되는 경우는 자동 테스트가 없고, 실사용 full1로만 확인했다) |
| implementer·architect·product-reviewer·phase 파일 | `tests/unit/plugin-files.test.mjs` | PASS (문자열·frontmatter 검사) |

## 스텁·skip 검사

해당 없음. `.skip`/`.only`/`not implemented`/`FIXME`는 0건이다. `TODO`는 모두 task 상태값 리터럴이다.

## 실사용 검증 기록

모든 실행 옵션: `--plugin-dir <repo> --setting-sources project --strict-mcp-config --permission-mode bypassPermissions --max-turns 80 --output-format stream-json --verbose`. 데모는 `node evals/setup-demo.mjs p <scratch>`로 만들었다.

| 실행 | 요청 | 결과 | 직접 대조 |
|---|---|---|---|
| **p1** (quick 병렬) | `/make-it-ship:run Implement REQUEST.md. Use quick mode and do the two tasks in parallel worktrees with implementer agents. You may make local commits. Proceed without asking me questions.` | plan → mode → worktree-add T1, T2 → (implementer×2 **같은 메시지**) task start, check E1/E2, done → worktree-merge T1, T2 → **E3 unit PASS(병합된 트리)** → quality 0/0 → **VERIFIED** → report. permission_denials 0, tool 오류 0 | `npm test` pass 4 / fail 0. `test/text.test.js`를 고치면 `mis verdict`가 PARTIAL(unit stale, quality 없음), HUD는 `Verdict now: PARTIAL`. 원복하면 VERIFIED |
| **s1** (standard 병렬) | 위와 같고 mode만 standard | interview(MED 2건, 기본값으로 해소) → plan → critic(1차 수정 후 0/0) → `mis approve plan && mis parallel plan`에서 **guard ask로 정지**. **permission_denials는 이 1건뿐**이었다 | AWAITING_APPROVAL, 코드 변경 0 |
| **s1b** (운영자 승인 후 재개) | 검증자가 터미널에서 `mis approve plan`(→ EXECUTING) 실행 후 `claude -p --resume <session>` | 설정 커밋 → worktree-add ×2 → implementer×2 **같은 메시지** → E1~E4 PASS(worktree) → merge T1, T2 → **E5 PASS(병합된 트리)** → spec·quality 리뷰(동일 메시지, 각 0 blocking) → **VERIFIED**. **denials 0.** 오류 1건은 모델이 task done 전에 merge를 시도해 `mis`가 거부한 것("task T1 is IN_PROGRESS; finish it…")이고, 게이트가 정상 동작한 것이다 | `npm test` pass 4 / fail 0, git 그래프에 `--no-ff` 병합 2개, worktree 정리됨 |
| **full1** (Full·UI) | `/make-it-ship:run Implement UI-REQUEST.md. Use full mode; this is a UI (web) project. Proceed without asking me questions; anything that needs my decision or approval, stop there and list it.` (데모 p 사본에 웹 페이지 요청 파일 추가) | explorer → interview(HIGH Q1 미해결) → architect → design-explore(`DESIGN.md`, 시안 3개, 스크린샷) → plan(`ui:true`) → critic + product-reviewer **병렬** → 1차 product 0/3 기록 → 계획 수정 → 2차 critic 0/0 기록 → **2차 product 리뷰 기록과 `mis approve plan`을 한 Bash 명령으로 묶어 실행 → guard ask(denied)** → report PARTIAL. permission_denials는 이 1건뿐이었다 | state: AWAITING_APPROVAL, ui true, product 리뷰는 **이전** planHash에만 있고 design 노트 0, Q1 HIGH open. 운영자 사본에서 게이트 순서를 확인했다(위 표). 결함 D-2 참고 |
| 직접 충돌 재현 | CLI(모델 없음) | 위 종료 기준 행 참고 | — |

guard: 세 실행 transcript(p1, s1/s1b, full1)에서 ask/deny는 **approve가 포함된 명령 2건뿐**이었다. 모두 §7상 올바른 ask다. implementer의 worktree 안 편집, `git commit`, `mis` 호출, design 시안 작성(Bash heredoc), Chrome headless 스크린샷은 모두 allow였다. 판정 기준 (b)에 해당하는 오탐은 없었다.

대화형 확인 창(approve plan)은 헤드리스에서 ask가 거부로 처리되는 것까지만 확인했다. 실제 창은 **NEEDS_HUMAN**이다.

## 결함 목록

| ID | 심각도 | 내용 | 재현 | 위치 |
|---|---|---|---|---|
| D-1 | LOW | 지시문 결함. run 스킬과 product-review·plan-critique phase에는 `mis approve plan`을 **단독 명령으로** 실행하라는 지시가 없다. full1에서 모델은 2차 product 리뷰 기록과 `mis approve plan`을 한 Bash 명령으로 묶었다. guard가 명령 전체에 ask를 걸었으므로(올바른 판정) 리뷰 기록까지 함께 실행되지 않았다. 그런데도 최종 메시지는 "The final round found no blocking or major issues in either the plan review or the product review"라고 보고했다. 실제 state에는 현재 계획에 대한 product 리뷰가 없다. 사용자가 그대로 승인하면 `mis`가 "product review of the current plan is missing"으로 거부하므로 안전 문제는 아니다. 하지만 보고 내용이 상태와 다르고, 재작업이 필요하다. M2 2차 std 실행(M2-report.md:179)에서도 같은 형태(`review add plan-critic … ; mis approve plan`)가 관찰됐지만, 당시 검증자는 결함으로 분류하지 않았다. 이번에 결함으로 올리는 이유는 full1에서 실제 손실(기록 누락, 그리고 상태에 없는 product 리뷰를 최종 메시지가 주장)이 생겼기 때문이다 | full1 요청 그대로 실행 → 마지막 result의 `permission_denials[0]`와 `mis status --json`의 reviews 비교 | `skills/run/SKILL.md` 5단계, `skills/run/phases/product-review.md` 2단계 |
| D-2 | LOW (문서) | `docs/PROGRESS.md` 70행의 M3-04 행: 작업명이 `mis worktree add`에서 잘리고, 상태 칸이 DONE/TODO 두 칸으로 나뉘어 이후 열이 한 칸씩 밀렸다. 기능 판정에는 영향이 없다 | `grep -n "^\| M3-04" docs/PROGRESS.md` | `docs/PROGRESS.md` M3 표 |

## 미검증 항목 (NEEDS_HUMAN)

- **NH-1**(M1에서 이어짐): 대화형 `approve plan` 확인 창. 이번에도 헤드리스 ask → 거부까지만 확인했다.
- **NH-4**(M3-e2e): 대화형 병렬 실행 중 implementer가 소유 밖 파일 편집을 요청할 때 확인 창이 뜨는지, 그리고 승인 후 생긴 충돌이 merge에서 중단·보고되는지. 충돌 처리 자체는 직접 재현으로 확인했다. 확인 창은 대화형이어서 확인하지 못했다.
- full1을 승인 이후까지 진행하는 실행(Full UI 구현과 qa 단계의 DESIGN.md 대조)은 하지 않았다. qa 단계는 M4 범위다.

## 남은 위험

- **R-1 소유권 강제의 범위**: task worktree의 범위 검사는 guard의 Write/Edit에만 걸린다. Bash(`sed -i`, heredoc)로 소유 밖 파일을 고치면 ask가 뜨지 않는다(M2 R-1과 같은 성격으로 이미 수용됨). 이런 편집이 다른 task와 겹치면 merge 충돌 → PARTIAL로 드러나지만, **겹치지 않으면 소유 밖 편집이 조용히 병합된다.** 남는 방어선은 spec·quality 리뷰뿐이다.
- **R-2 design 노트가 planHash에 묶이지 않는다**: product·critic 리뷰는 현재 planHash에 묶이지만, `mis note design`은 run에 한 번 기록되면 계획을 바꿔도 유효하다. Spec은 바인딩을 요구하지 않으므로 결함이 아니다. UI 범위가 크게 바뀐 계획도 이전 디자인 선택으로 승인될 수 있다.
- **R-3 product 리뷰 무효화에 자동 테스트가 없다**: plan 변경 후 이전 product 리뷰로 승인되지 않는다는 점은 코드(`planHash` 비교)와 실사용 full1로 확인했지만, `mis-plan.test.mjs`에는 critic에 대해서만 해당 테스트가 있다.
- **R-4 `mis worktree merge` 충돌 시 exit 0**: 결과 JSON의 `merged:false`, 이벤트, verdict PARTIAL로 드러나므로 판정에는 영향이 없다. 다만 `&&`로 이어 붙인 스크립트는 다음 명령을 계속 실행한다.
- **R-5 run 스킬의 단계 순서 표기**: 2b(product-review)가 3(plan)보다 앞에 적혀 있지만, product-review phase는 "after `mis plan set`"을 요구한다. full1에서 모델은 architect·design-explore를 plan 전에, product 리뷰를 plan 후에 올바르게 실행했다. 다른 실행에서는 순서 혼동이 생길 수 있다.
- **R-6 보고서에 병렬 정보가 없다**: `report.md`에 worktree·병합 커밋 정보가 나오지 않는다. 미병합은 verdict 사유로만 드러난다.
- **R-7** full1에서 모델이 `mis status --json`의 plan을 그대로 `plan set`에 넣었다가 `status/attempts` 키 때문에 거부됐고, 스스로 고쳤다. 사소한 마찰이다.
- 검증은 데모 p(의존성 없는 JS, 독립 모듈 2개) 위주로 했다. task가 3개 이상인 wave나 다단계 wave의 실사용은 확인하지 않았다(단위 테스트만 있음).

## 질문별 답

- **실행되지 않았는데 통과로 표시된 것이 있는가?** M3-e2e의 주장(p1 VERIFIED, implementer×2 같은 메시지, 병합 뒤 check 재실행, guard 0건)은 이번 재실행(p1, s1b)에서 같은 결과로 재현됐다. 충돌을 헤드리스로 만들지 않고 통합 테스트와 NH-4로 둔 것도 문서에 그대로 적혀 있어 사실과 맞다. 다만 PROGRESS의 M3-04 행은 형식이 깨져 있다(D-2).
- **테스트가 없는 M3 항목이 있는가?** 없다. product 리뷰 무효화의 전용 테스트만 빠져 있다(R-3).
- **스텁·skip·빈 구현이 있는가?** 없다.
