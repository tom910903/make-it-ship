# 최종 검증 이후 변경 검증 (POST-FINAL) — 2026-10-21

검증 범위: `ce23cbd..c0c11c2`(HEAD)의 7개 커밋.
- 처음 5개: 73e9260, 75f2fb8, a95fb61, 62df4ea, 27f86f3
- 검증 중 범위에 추가된 2개: 8052bd1, c0c11c2

수치는 두 곳에서 다시 냈다. 하나는 `git archive 27f86f3`로 만든 스크래치 사본이고, 다른 하나는 HEAD(c0c11c2) 작업 트리다.
`scripts/guard.mjs`와 `scripts/lib/policy.mjs`는 27f86f3 이후 바뀌지 않았다(8052bd1은 `scripts/` 중 `plan.mjs` 한 줄만 바꿈). 따라서 §4의 guard 결과는 HEAD에도 그대로 적용된다.

## 1. 요약 판정

**DEFECTS FOUND (1건, MEDIUM)**

- guard 수정(75f2fb8)이 `.git/` 내부 경로와 중첩 저장소 경로의 계획 범위 ask를 allow로 바꿨다. 실행 중인 run이 있어도 그렇다.
- 나머지 여섯 커밋은 PASS다. 문서에 오래된 사실(LOW)이 몇 개 남아 있다.

## 2. 실행한 명령과 수치

| 명령 | 결과 |
|---|---|
| `npm test` (27f86f3 사본) | tests 319, pass 319, fail 0, skipped 0, todo 0 |
| `npm test` (작업 트리, HEAD=c0c11c2) | tests 319, pass 319, fail 0, skipped 0, todo 0 (8052bd1은 기존 테스트에 단언만 추가해서 개수는 그대로) |
| `claude plugin validate .` (27f86f3 사본, HEAD) | ✔ Validation passed |
| `node --test mis-bench guard mis-qa` 5회 반복 | 매회 19 pass / 0 fail |
| 스텁 grep (`TODO\|FIXME\|\.skip\|\.only\|not implemented\|todo\(`) | 8건. 모두 task 상태값 `'TODO'`다(§5) |
| guard 재현 매트릭스: 이전 guard(`git archive ce23cbd scripts`)와 새 guard 비교, 32개 입력 | §4 표 |
| bench 변이 3종 (사본에서만) | §3 bench 행 |

## 3. 변경별 판정

| 커밋 | 판정 | 증거 |
|---|---|---|
| 73e9260 NH-auto-check | **PASS** | `docs/milestones/NH-auto-check.md:3`에 "사람이 확인한 PASS는 아니다"라고 적혀 있다. `NEEDS_HUMAN.md:18-21`에는 "AUTO(tmux) 통과 · 사람 미확인"으로 기록되어 있다. 인용한 문자열은 모두 저장소에 있다: `policy.mjs:89`(approve 사유), `commands.mjs:210`(runtime limit), `policy.mjs:164`(widens the scope), `statusline.mjs:15`(HUD 형식), `mis-worktree.test.mjs:45`(충돌 테스트명). 데모 a·d·p는 `evals/demos/`에 있다. 참고로 NH-4 확인 창은 수정 전 guard로 캡처한 것이다. 수정 후 guard도 T1 worktree 안의 T2 소유 파일에는 ask를 낸다(§4 #2). 그래서 AUTO 기록은 유효하다. |
| 75f2fb8 guard | **FAIL** | 의도한 수정은 동작한다(§4 #1·#2, `guard.test.mjs:96-111`). 다만 결함 D-1이 생겼다(§6). |
| a95fb61 BSP 제거 | **PASS** | `scripts/ skills/ agents/ hooks/ tests/ templates/ evals/ README.md`에 bsp·yocto·buildroot·bitbake·kbuild 참조가 없다. 남은 것은 제거를 확인하는 테스트(`mis-qa.test.mjs:54-58`, `plugin-files.test.mjs:147,150`)뿐이다. `qa.mjs:3`의 `readdirSync`는 `:52`에서 계속 쓰므로 import 정리 누락도 없다. 삭제된 테스트는 BSP 두 건뿐이다. 일반 qa-* 필수화 테스트(`mis-qa.test.mjs:42`)는 그대로 있다. `plugin-files.test.mjs`는 bsp 단언만 반대로 바꿨다. 나머지 단언은 유지됐다. SPEC_CHANGES 기록은 `PROGRESS.md:127`에 있다. 문서 잔재(LOW)는 §7에 적었다. |
| 62df4ea HANDOFF | **PASS (사실 오래됨 LOW)** | 확인한 사실: 원격 `origin/feature/make-it-ship-m1-m5`, 로컬 `develop`의 추적 관계, 태그 m1~m5-verified(모두 27f86f3의 조상), 319/319, `555e4ef`(동시성 테스트 결정화), `VERIFIER_PROMPT.md`, `shell.mjs`, 데모 a,b,c,d,p,pilot-1..6, 에이전트 9개(읽기 전용 8 + implementer), ADR-014(`Spec_v1.1.md:30`), 의존성 0(package.json). 오래된 내용: §1은 사후 변경을 3건만 적었고 27f86f3이 빠졌다. §3의 1번(bench 결정화)은 27f86f3에서 이미 끝났다. 원격 브랜치가 62df4ea에 있어서 §2의 clone 절차로는 bench 수정을 받지 못한다. |
| 27f86f3 bench 결정화 | **PASS (테스트 적합성 LOW 공백)** | 동어반복은 아니다. 분류를 뒤집는 변이(`deltaPct > 50` → `< -50`)를 넣으면 테스트가 실패한다(1 fail). 아래는 실제 실행에서 나온 값이다: BASELINE 상태, runs=3, medianMs≥30, `baselineMs===1e6`(저장된 노트를 읽음), 보고서의 "성능 회귀" 줄. 그러나 `notes.find` → `notes.findLast` 변이(최신 측정 기준)와 `write(slow)` 삭제 변이는 둘 다 **통과**한다. 즉 "첫 측정 기준"과 "실제 느려짐 감지"는 검증하지 않는다. 이전 테스트도 첫 측정과 최신 측정을 구분하지 못했으므로 이번에 새로 약해진 것은 아니다. WARN 구간(20~50%)도 예전부터 테스트가 없다. 보완 한 줄: 마지막 bench 뒤에 `assert.equal(slow.baselineMs, 1)`. |
| 8052bd1 hardware 위험 플래그 제거 | **PASS** | `plan.mjs:4` `RISK_FLAGS`에서 `hardware`가 빠졌다. 다음 위치의 목록에서도 모두 빠졌다: `skills/run/SKILL.md:56`, `phases/discover.md:12`, `phases/plan.md:31`, `agents/security-reviewer.md:18`, `agents/explorer.md:28`, README:39. `scripts skills agents hooks tests templates evals adapters README.md`에서 `hardware`를 grep한 결과, 남은 것은 의도된 것뿐이다: BLOCKED 사유(`SKILL.md:89`, `mis-report.test.mjs:72,79`의 `mis block 'needs hardware'`), iOS `hardwareProperties`(`ios.mjs:18`, `mis-ios.test.mjs:51-52`). `riskFlags` 사용처(`commands.mjs:78-167`, `verdict.mjs:25`, `render.mjs:12`)는 플래그 이름과 무관하다. 회귀 단언 `mis-plan.test.mjs:52`(`['hardware']` 거부)가 추가됐다. 삭제되거나 약해진 테스트는 없다. Spec 이탈은 `PROGRESS.md:128` SPEC_CHANGES에 기록되어 있다(Spec `:418` ADR-009, `:190` BLOCKED 사유는 유지). 남은 것: `HANDOFF.md:48` 열린 결정 "hardware를 유지할지"가 이미 결정되어 오래된 항목이 됐다(LOW). |
| c0c11c2 NH-5 AUTO, NH-6~8 보류 | **PASS** | `NEEDS_HUMAN.md` NH-5 행은 "AUTO(tmux) 통과 · 사람 미확인"이다. NH-6~8 행은 "추후 확인 필요"이며 PASS로 적지 않았다. `NH-auto-check.md` 머리말(사람 PASS 아님)이 NH-5 절에도 적용된다. 인용한 guard 사유 "remote write (git push) needs your approval"은 `policy.mjs:36`에 있다. 데모 b는 `evals/demos/b`에 있다. 사용자 전역 파일을 복구했다는 서술은 이 저장소에서 확인할 수 없다(외부 환경). |

## 4. guard 재현 매트릭스 (발췌)

설정: 스크래치 디렉터리에 저장소 D를 만들었다. run은 EXECUTING이고, 계획은 T1=`src/a.js`, T2=`src/b.js`이며, `mis worktree add T1`로 WT를 만들었다. 각 입력을 `node scripts/guard.mjs`에 hook JSON으로 넣었다(Edit).

| # | 세션 cwd → file_path | 이전 | 새 | 평가 |
|---|---|---|---|---|
| 1 | D → WT/src/a.js (T1 소유) | ask | allow | 의도한 수정 |
| 2 | D → WT/src/b.js (T2 소유) | ask | ask | 정상 |
| 3 | D → D/README.md (계획 밖) | ask | ask | 정상 |
| 4 | D → **D/.git/hooks/pre-commit** | ask | **allow** | **D-1** |
| 5 | D → **D/.git/config** | ask | **allow** | **D-1** |
| 6 | D → **D/.git/worktrees/<id>/HEAD** | ask | **allow** | **D-1** |
| 7 | D → **D/vendor/lib/x.js** (D 안의 독립 저장소) | ask | **allow** | **D-1** (같은 경로) |
| 8 | D → D/.git/make-it-ship/runs/x, current | deny | deny | 정상(STATE_PATH가 activeRun보다 먼저, `policy.mjs:158-159`) |
| 9 | D → D/linkout/o.js (저장소 밖을 가리키는 symlink) | ask | allow | 남은 위험 |
| 10 | D → D/srclink/b.js (저장소 안 symlink) | ask | ask | 정상 |
| 11 | D → WT/../../src/b.js, WT/src/../README.md (`..`) | allow / ask | allow / ask | 정상(resolve 정규화) |
| 12 | D → WT/.make-it-ship.json | ask | ask | 정상 |
| 13 | D → (저장소 밖)/.make-it-ship.json | ask | allow | 남은 위험(이 run의 설정이 아님) |
| 14 | D → D/newdir/deep/x.js (없는 경로) | ask | ask | 정상(가장 가까운 기존 상위 디렉터리로 판정) |
| 15 | D → /nonexistent/zz/y.js | allow | allow | 정상 |
| 16 | WT → D/src/b.js | allow | allow | 남은 위험(이번 변경과 무관) |
| 17 | git 아닌 cwd → D/README.md, WT/src/b.js | allow | ask | 개선 |
| 18 | D → WT (디렉터리 자체) | ask | ask | 사유의 `rel`이 빈 문자열(외형상 문제, LOW) |

## 5. 스텁·skip 검사

`grep -rnE "TODO|FIXME|\.skip|\.only|not implemented|todo\(" scripts skills agents hooks tests templates evals` → 8건:
- `commands.mjs:152,309,512,550`
- `parallel.test.mjs:5`, `statusline.test.mjs:11`, `verdict.test.mjs:28`, `mis-plan.test.mjs:59`

모두 task 상태값 `'TODO'`다. 스텁, skip, only는 없다. `npm test` 출력에서도 skipped 0, todo 0이다.

## 6. 결함 목록

### D-1 (MEDIUM) — 파일 위치 기준 컨텍스트가 `.git/` 내부와 중첩 저장소에서 "실행 없음"으로 떨어진다

- **위치**
  - `scripts/guard.mjs:38-42`: 새 상위 경로 탐색 → `context(at)`.
  - `scripts/guard.mjs:14`: `git rev-parse --show-toplevel`.
  - `scripts/guard.mjs:27-29`: catch → `activeRun:false`.
- **원인**
  - `at`이 `.git/` 안의 디렉터리이면 `--show-toplevel`이 실패한다(work tree 밖). 그러면 catch가 `activeRun:false`를 돌려준다. 그 결과 `policy.mjs:159`에서 즉시 allow가 된다.
  - `at`이 중첩 저장소나 서브모듈 안이면 그 저장소의 상태 루트를 읽는다. 거기에는 run이 없으므로 역시 allow가 된다.
  - 결과적으로 run이 진행 중인데도 Spec §7 "계획 범위 밖 편집 → ask" 행의 기본 형태(절대경로로 하는 Write/Edit)가 allow가 된다. 수정 전에는 ask였다(이 커밋에서 생긴 회귀).
  - 상태 위조 deny는 유지된다. `STATE_PATH` 검사가 `activeRun`보다 먼저 있기 때문이다.
- **재현**: §4의 #4~#7. 아래는 run이 EXECUTING인 저장소 D에서 실행한 것이다.
  ```
  echo '{"hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"'$D'/.git/hooks/pre-commit"},"cwd":"'$D'"}' | node scripts/guard.mjs
  # 출력 없음(allow). ce23cbd의 guard는 ask: ".git/hooks/pre-commit is outside the approved plan's files"
  ```
- **테스트 공백**
  - `guard.test.mjs:96-111`은 worktree 경로만 다룬다.
  - `policy.test.mjs`의 `.git` 단언은 손으로 만든 ctx를 쓴다. 그래서 guard.mjs의 컨텍스트 선택을 거치지 않는다.
- **수정 방향(구현하지 않음)**
  - 파일 기준 컨텍스트는 `--show-toplevel`이 성공하고, 그 `--git-common-dir`이 세션 cwd의 것과 같을 때만 쓴다.
  - 그 밖의 경우는 `context(cwd)`로 돌아간다.
  - `.git/hooks/x`와 중첩 저장소 파일에 대한 ask 회귀 테스트를 추가한다.
- **문서 영향**: `NH-auto-check.md:84`와 `PROGRESS.md` FIXES는 이 수정을 "LOW·안전 쪽"으로만 설명한다. 위 회귀가 있으므로 이 서술은 부정확하다.

## 7. 남은 위험

- **symlink**: 저장소 안의 symlink가 저장소 밖을 가리키면 그 경로로 하는 편집은 allow다(§4 #9). 실제로 쓰이는 파일이 저장소 밖에 있으므로 다른 저장소 밖 경로와 같게 다룬 것이다. LOW.
- **저장소 밖 `.make-it-ship.json`**: run이 진행 중이어도 allow다(§4 #13). 이 run의 설정 파일이 아니다. LOW.
- **worktree 안의 implementer가 main 트리의 다른 task 파일을 편집**: allow다(§4 #16). 이번 변경 전에도 같았다. LOW.
- **사유 문자열**: worktree 디렉터리 자체를 file_path로 넘기면 사유에 빈 경로가 나온다(§4 #18). 외형상 문제다.
- **bench 테스트**: "첫 측정 기준"과 실제 느려짐 감지를 검증하지 않는다(§3). WARN 구간은 테스트가 없다. LOW.
- **문서 잔재(LOW)**
  - `docs/milestones/M5-e2e.md:9,20`이 BSP check와 NH-9 절차를 여전히 현재 기능처럼 설명한다.
  - `Spec_v1.1.md:435`의 §14 qa 행에 BSP가 남아 있다. SPEC_CHANGES(`PROGRESS.md:127`)는 §11 M5만 언급한다.
  - `PROGRESS.md:105`의 M5-05 행 증거 칸이 "BSP 2건"이다.
  - `PROGRESS.md` FIXES의 "npm test 320/320"은 75f2fb8 시점 값이다. 현재는 319다.
  - HANDOFF가 오래된 부분은 §3에 적었다.
- **NH-5 절의 외부 환경 서술**: 전역 설정 diff가 없다는 것과 cache를 삭제했다는 것은 이 저장소에서 다시 확인할 수 없다. 기록은 AUTO로만 되어 있다.
- **D-1은 HEAD(c0c11c2)에도 그대로 있다**: guard 파일이 바뀌지 않았다.
