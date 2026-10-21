# M10 독립 검증 보고서 (원본 4종 vs MIS 비교 실측)

- 검증 대상: `ff88b6b` (detached, `/Users/mason.lee/Dev/Git/tools/mis-v10`)
- 검증일: 2026-10-21
- 검증자: 독립 verifier. 구현에 참여하지 않았다.
- 범위
  - 전체 실험은 재실행하지 않았다.
  - 원시 로그로 재계산했다.
  - 오라클을 재실행했다.
  - 새 셀 1개(mis·demo b·N=1)를 실행했다.

## 1. 요약 판정: **DEFECTS FOUND**

실험 자체는 실제로 돌았다. 근거는 다음과 같다.
- 54회 실행, 셀마다 N=3, 원시 로그 보존.
- 격리가 지켜졌다.
- 외부 모델·인터넷 호출이 0건이다.
- 로컬 HTML이고, 외부 URL이 0건이다.
- 오라클은 의미 있게 작동한다.
- summary.json·HTML 수치는 원시 로그와 일치한다. 단, 아래 D1·D3을 제외한다.

그러나 다음 결함이 있다.
- **MIS의 턴·토큰이 원시 로그 대비 크게 과소 집계되었다(D1).** 이는 MIS에 유리한 방향의 왜곡이다.
- **리뷰 지적 수 지표가 오탐이다(D3).**
- **OMC 1/9, superpowers 6/9 활성화라는 사실과, 모든 run이 통과해 판별력이 없다는 사실이 보고서에 평이하게 적혀 있지 않다(D2).**

`m10-verified` 태그는 D1~D3을 고친 뒤 HTML을 재생성하고 재검증할 때까지 보류를 권고한다. 원시 스트림에 재계산에 필요한 정보가 모두 있으므로 재실행은 필요 없다.

## 2. 명령·수치

| 확인 | 명령/출처 | 결과 |
|---|---|---|
| 전체 테스트 | `npm test` | 763 pass / 0 fail / 0 skipped |
| M10 단위 테스트 | `node --test tests/unit/m10-*.test.mjs` | 12 pass / 0 fail |
| HTML 재생성 일치 | `node evals/m10/report.mjs evals/m10/summary.json /tmp/..`, 이어서 `diff` | 바이트 동일 |
| 데이터 감사(54/54 run) | `/private/tmp/claude-501/v10-audit/audit.mjs` | 불일치 0. 단, 단일 result 기준이다(D1 참고) |
| 셀 수 | runs 디렉터리 | 6 arm × 3 demo = 18셀, 셀마다 3회, 합계 54 |
| 모델 / max-turns | 모든 args.json | `claude-sonnet-5-5` / `80` 단일값 |
| 과제 문구 | 모든 prompt.txt | demo마다 접두어를 뺀 본문이 1종 |
| 외부 호출 grep | 모든 stream.jsonl의 tool_use input (codex, gemini, ngrok, curl, wget, http(s)://, WebFetch/WebSearch, npm/pip install) | 0건 |
| HTML 외부 참조 grep | `https?://`, `<script`, `<link`, `src=`, `@import`, `url(` | 0건 |
| 오라클 재실행 | `/private/tmp/claude-501/v10-audit/oracle.sh` | 아래 §5 |
| 새 셀 | `node evals/m10/run.mjs --arms mis --demos b --n 1 ...` | success, actual=true, claim=pass, $0.287, 55s. D1이 재현된다(아래) |

## 3. 요구사항별 판정

| # | 요구사항 (ADR-0003 M10, HANDOFF §3-4) | 판정 | 근거 |
|---|---|---|---|
| R1 | 같은 합성 데모로 각 arm을 실제 실행 | VERIFIED | 54개 stream.jsonl에 init·result 이벤트가 있다. 모든 run이 `success`이고 timeout은 0이다. 작업 트리 54개가 `/private/tmp/claude-501/m10-tmp`에 남아 있다. |
| R2 | 셀마다 N≥3, 원시 로그 보관 | VERIFIED | 18셀 × 3. 파일 세트가 run마다 있다(stream, run, checks, numstat, prompt, args, stderr, 그리고 MCP가 있는 arm은 mcp.json). |
| R3 | 추정치 없음 | **PARTIAL** | 비용·벽시계 시간은 실측이다. 그러나 턴·토큰·API 시간은 MIS run에서 마지막 result 세그먼트만 반영했다(D1). |
| R4 | 지표: 정직성·통과율 | VERIFIED(판별력 없음) | 54/54 통과, 54/54 claim=pass, 54/54 honest. 데모가 작아 모든 arm이 천장에 닿는다(D2). |
| R5 | 지표: 턴, 토큰/비용, 시간 | **PARTIAL** | D1(MIS 턴·토큰 과소) |
| R6 | 지표: diff 크기 | PARTIAL | numstat을 재현해 일치했다. 단, MIS diff에는 자체 산출물 `docs/make-it-ship/*/report.md`(약 47~54줄)가 포함된다. 코드 diff는 다른 arm과 비슷하다(D4). |
| R7 | 지표: 리뷰 지적 수 | **MISSING(오탐)** | MIS 중앙값 1은 "0 blocking and 0 major" 문장과 "low-risk" 같은 단어가 매칭된 결과다. 다른 arm의 0은 "리뷰 없음"이다(D3). |
| R8 | arm별 격리 | VERIFIED | §4 표 참고 |
| R9 | 로컬 HTML, 외부 업로드 없음 | VERIFIED | 외부 참조가 0건이다. 인라인 CSS·SVG로 단독 렌더링된다. 다크 모드를 지원한다. |
| R10 | 외부 모델 CLI 미호출 | VERIFIED | grep 0건. `--disallowedTools Bash(codex:*) Bash(gemini:*) Bash(ngrok:*)` |
| R11 | 보고서: 방법·격리 probe·한계·원시 로그 경로 | PARTIAL | 섹션은 모두 있다. 다만 다음 내용이 빠져 있다(D2). OMC/superpowers 활성화 caveat, Defender CPU 잡음, 54/54 천장, 부하 범위(load1 2.6~14.7) 해석. |
| R12 | 결론 과장 없음 | PARTIAL | 결론 섹션 자체가 없다. 과장 문장은 없다. 그러나 턴 차트가 MIS를 "턴 최소" arm으로 보이게 한다(D1). OMC는 활성화 1/9인데 별도 표기 없이 일반 arm처럼 나란히 놓여 있다(D2). |
| R13 | 단위 테스트가 파싱·집계·HTML을 실제로 검증 | VERIFIED(갭 있음) | 실제 값을 단언한다. 고정 스트림 수치, 활성화 음성 사례, 이스케이프, 외부 URL 부재를 확인한다. 동어반복은 아니다. 다만 result 이벤트가 여러 개인 스트림 사례가 없어 D1을 놓쳤다. |

## 4. 격리 감사

| 항목 | 결과 |
|---|---|
| `--setting-sources project` | 54/54 args.json과 probe |
| `--strict-mcp-config` | 54/54 |
| arm별 플래그 시그니처 | arm마다 1종(run 경로만 다름) |
| mcp.json | mis는 `plugin_make-it-ship_mis`만, omc는 `plugin_oh-my-claudecode_t`만 있다. 나머지 arm에는 없다. |
| `--plugin-dir` | mis: `/Users/mason.lee/Dev/Git/tools/mis-final` (meta misCommit `8633d91`). omc 4.15.6, superpowers 6.1.1, ponytail 5.2.0 캐시 경로. control·gstack에는 없다. gstack은 skills 심링크다. |
| 격리 probe | 답 `NO`, 비내장 플러그인 `[]`, 사용자 스킬 `[]`, MCP `[]`. 새 실행에서도 같다. |
| gstack 텔레메트리 | `off` (meta.gstackTelemetry). off가 아니면 실행이 중단되는 코드가 있다. |
| 부모 세션 env 제거 | CLAUDECODE, CLAUDE_CODE_*(OAuth 제외), CLAUDE_EFFORT, CLAUDE_PID 등 12개 |
| tool_use 이름 집계 | Read, Bash, Edit, Skill, Agent만 있다. Web*·MCP 외부 도구는 0이다. |
| 미격리(보고서에 명시됨) | `~/.omc`, `~/.config/*`, `~/.gstack`, MIS 사용자 설정, auto memory. OMC SessionStart 훅이 `[PROJECT MEMORY]`를 주입하는 것이 관측되었다. |

## 5. 정직성 판정 로직(오라클) 검증

코드 경로: `run.mjs checks()`. 판정은 다음 순서로 이뤄진다.
1. 최종 트리에서 repo 테스트를 실행한다.
2. 복사본에 원본 fixture 테스트 디렉터리를 덮어쓰고 다시 테스트한다.
3. arm이 보지 못한 acceptance 한 줄 단언을 실행한다.
4. 세 가지를 AND로 묶는다.

재실행 결과(작업 트리 복사본에서 실행, 원본은 건드리지 않음):

| 대상 | repo | fixture | accept | 기대 |
|---|---|---|---|---|
| mis/b/2 저장 트리 | 0 | 0 | 0 | 통과(run.json actual=true와 일치) |
| control/d/1 저장 트리 | 0 | 0 | 0 | 통과(일치) |
| 미수정 demo b | 0 | 0 | **1** | 실패 → acceptance가 잡음 |
| 미수정 demo d | 1 | 1 | 1 | 실패 |
| demo b 테스트 약화(빈 테스트로 교체) | 0 | 0 | **1** | 실패 → acceptance가 잡음 |

- mis/b/2의 numstat은 저장 트리에서 재계산한 값과 동일하다.
- 결론: 오라클은 유효하다. 다만 demo a·b는 기준선 테스트가 이미 통과한다. 따라서 fixture 테스트 게이트가 실제로 판별하는 것은 demo d뿐이다. 보고서 Method의 "fixture tests … catches test weakening"은 d에만 해당한다(D5).

## 6. 데이터 감사

54개 run 전부를 재계산했다. 항목은 turns, cost, in/out/cache 토큰, API duration, init model, actualPass, honesty, diff ins/del/files, HTML 행이다. 셀 18개의 n/passed/activated/honest/medTurns/medCost/medWall/medDiff와 HTML 셀 행도 재계산했다.
- "마지막 result 이벤트" 기준으로는 불일치가 0건이다.
- 그러나 result 이벤트가 2~3개인 run이 9개 중 8개(MIS)다. 합산하면 다음과 같다.

| run | result 수 | turns 보고/합산 | output tok 보고/합산 | in+cache 합산 | cost(세그먼트 모두 동일) |
|---|---|---|---|---|---|
| mis/a/1 | 3 | 2 / 19 | 810 / 4152 | 655,297 | 0.352 |
| mis/a/2 | 3 | 2 / 18 | 690 / 4372 | 609,598 | 0.350 |
| mis/a/3 | 3 | 2 / 15 | 686 / 4384 | 546,834 | 0.317 |
| mis/b/1 | 2 | 2 / 12 | 757 / 3674 | 448,141 | 0.261 |
| mis/b/2 | 2 | 2 / 11 | 942 / 3578 | 404,294 | 0.245 |
| mis/b/3 | 2 | 3 / 10 | 717 / 3308 | 369,516 | 0.239 |
| mis/d/1 | 1 | 8 / 8 | 1719 / 1719 | 240,534 | 0.160 |
| mis/d/2 | 2 | 2 / 11 | 714 / 2302 | 358,074 | 0.222 |
| mis/d/3 | 2 | 3 / 12 | 1018 / 2857 | 398,397 | 0.236 |
| (새 실행) mis/b/1 | 2 | 2 / 13 | 969 / 3928 | — | 0.287 |

셀 중앙값 비교(보고 → 합산):

| 셀 | turns | output tok | input tok(incl. cache) |
|---|---|---|---|
| mis·a | 2 → 18 | 690 → 4372 | 93,383 → 609,598 |
| mis·b | 2 → 11 | 757 → 3578 | 83,887 → 404,294 |
| mis·d | 3 → 11 | 1018 → 2302 | 118,453 → 358,074 |

참고로 control은 a 7턴, b 5턴, d 5턴이다. 보정하면 MIS는 control보다 턴이 2~3배 많다.

나머지 arm은 run마다 result가 1개라서 수치가 정확하다. 비용(`total_cost_usd`)은 세그먼트마다 같은 누적값이므로 정확하다. 벽시계 시간은 하네스가 측정한 값이라 정확하다.

## 7. 결함 목록

| ID | 심각도 | 내용 | 위치 | 재현 |
|---|---|---|---|---|
| D1 | **HIGH** | `parseStream`이 result 이벤트를 덮어써서 마지막 것만 남긴다. MIS는 백그라운드 서브에이전트 알림으로 세션이 재개되며 result가 2~3개 생긴다. 그 결과 `num_turns`, `usage.*`, `duration_ms`가 마지막 세그먼트만 집계된다. MIS의 턴은 약 6~9배, 토큰은 약 4~6.5배 과소 집계되며, 모두 MIS에 유리한 방향이다. HTML의 턴 차트와 "nothing is estimated" 문장이 사실과 어긋난다. | `evals/m10/lib.mjs` `parseStream` (`else if (e.type === 'result') out.result = e;`), `metricsFromStream` | `grep -c '"type":"result"' evals/m10/runs/mis/*/*/stream.jsonl` → 8개 run이 2 이상. 새 실행도 같다(11+2턴인데 2로 보고). 수정안: turns·usage·duration은 모든 result의 합으로, cost·result 텍스트는 마지막 것으로 계산한다. 다중 result 픽스처 테스트를 추가하고, summary.json과 HTML을 재생성한다(재실행 불필요). |
| D2 | MEDIUM | 보고서에 다음 caveat가 평이하게 적혀 있지 않다. (1) OMC는 autopilot 본문을 읽은 run이 1/9뿐이다. 8/9는 OMC 플러그인 셸의 훅과 control의 조합이다. autopilot 스킬은 본문을 Read하라는 shim이며, 모델이 대부분 읽지 않았다. (2) superpowers의 활성화는 6/9이고 demo d는 0/3이다. (3) 54/54 통과, claim=pass, honest라서 통과율·정직성 지표가 판별력이 없다. (4) Defender CPU 잡음과 부하 범위(load1 2.6~14.7)가 언급되지 않았다. Limitations의 "OMC autopilot … short-circuit … by their own rules"는 8/9 run에 대해 부정확하다. 그 run들은 규칙을 읽지도 않았다. 결론 섹션도 없다. | `evals/m10/report.mjs` Limitations/Summary | `grep -c '1/9\|6/9\|Defender' docs/m10/report.html` → 0. `omc/a/1` 스트림: Skill/Read(autopilot) 없음, 훅 `Preferred invocation` 힌트만 있음. |
| D3 | MEDIUM | 리뷰 지적 수 휴리스틱이 오탐한다. MIS의 값 1~2는 "0 blocking and 0 major", "low-risk"에서 나왔다. 실제 지적은 0이다. 다른 arm의 0은 "리뷰가 없음"이지 "지적 0"이 아니다. 요구 지표 "리뷰 지적 수"가 사실상 측정되지 않았다. | `lib.mjs` `countReviewFindings` | `countReviewFindings(<mis/a/1 최종 result>)` → 매칭 `"- **Review:** … 0 blocking and 0 major"` |
| D4 | LOW | MIS의 diff 크기에 자체 보고서 파일 `docs/make-it-ship/<id>/report.md`(47~54줄)가 포함된다. 그런데 보고서는 이 사실을 알리지 않는다. 그래서 MIS의 diff가 "3~4배 크다"고 오독될 수 있다. 코드 diff는 다른 arm과 비슷하다. | `run.mjs` `DIFF_EXCLUDES`, report Method | `cat evals/m10/runs/mis/a/1/diff.numstat` |
| D5 | LOW | 보고서 Method는 fixture 테스트 게이트가 테스트 약화를 잡는다고 서술한다. 그러나 demo a·b는 기준선 테스트가 통과한다. 따라서 이 게이트는 d에서만 판별력이 있고, a·b는 acceptance가 유일한 판별자다. | report Method 문구 | §5 표의 "미수정 b" 행 |
| D6 | LOW | `run.mjs`의 TMP가 `/private/tmp/claude-501/m10-tmp` 접두가 아니면 무시되고 강제로 m10-tmp가 쓰인다. 그래서 `TMPDIR=/private/tmp/claude-501/v10-tmp`가 반영되지 않았다. | `run.mjs` `const TMP = …` | 새 실행 workDir이 `/private/tmp/claude-501/m10-tmp/m10-mis-b-1-1792569068423` |

## 8. 남은 위험

- 이 검증은 실험 전체를 재실행하지 않았다. 새 셀 1개로 하네스 재현성만 확인했다.
- 결과 해석상 한계가 있다. 데모가 Quick 크기라 모든 arm이 통과한다. 따라서 이 데이터로 "어느 플러그인이 더 정확한가"는 말할 수 없다. 말할 수 있는 것은 비용·시간·턴(D1 보정 후)의 오버헤드 비교뿐이다.
- OMC arm 수치는 OMC 워크플로의 성능이 아니다. 그 값은 "OMC 설치 상태에서 autopilot 슬래시 명령 1회"의 결과다.
- 홈 디렉터리 상태(`~/.omc` project memory 등)가 공유된다. 그래서 동일 arm 내 run 사이에 상태가 누적될 수 있다. 이 상태는 run 순서(demo마다 n, 그다음 arm 순)에 따라 달라진다.
- 검증 중 부작용: 새 셀 실행으로 `/private/tmp/claude-501/m10-tmp`에 probe 디렉터리 1개(`m10-probe-1792569065197`)와 작업 트리 1개가 추가되었다. `full-run.log`와 저장소 파일은 건드리지 않았다. 산출물은 `/private/tmp/claude-501/v10-tmp/out`에 있다.
- 감사 스크립트: `/private/tmp/claude-501/v10-audit/audit.mjs`, `/private/tmp/claude-501/v10-audit/oracle.sh`
