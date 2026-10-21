# M10 독립 검증 보고서 — 2라운드 (r1 결함 D1~D6 수정 재검증)

- 대상: `/Users/mason.lee/Dev/Git/tools/mis-v10` @ `215ffca` (detached), 작업 트리 clean
- 범위: 실험 재실행 없음. 저장된 원시 로그(`evals/m10/runs/**`)에서 독립 재계산, 보고서 문구 확인, rebuild 결정성, D6 dry 실행
- 검증자는 구현에 참여하지 않았다. 재계산은 `lib.mjs`를 쓰지 않는 별도 Python 스크립트로 했다.

## 1. 요약 판정: **PASS** (차단 결함 0, LOW 1건 비차단)

- r1 결함 D1~D6은 모두 해소됐다.
- 54개 run 전부와 18개 셀 중앙값을 원시 로그에서 다시 계산했다. `summary.json` 및 HTML Runs 표와 불일치가 0건이다.
- 비용은 누적값이 맞다. 증거로 확인했다(§4).
- 새 결함은 D7(LOW) 1건이다. 커밋된 `runs/**/run.json`에 r1 이전의 잘못된 파생 수치가 그대로 남아 있다.

## 2. 명령·수치

| 확인 | 명령/출처 | 결과 |
|---|---|---|
| 전체 테스트 (1차) | `npm test` (load1 약 25) | 768 중 750 pass / 18 fail / 0 skipped, 73분. 출력은 `tail`만 남아 실패 이름을 확인하지 못했다 |
| 전체 테스트 (2차) | `node --test --test-reporter=spec "tests/**/*.test.mjs"` (load1 25→51) | 768 중 767 pass / 1 fail / 0 skipped / 0 todo, 220초 |
| 2차 실패 분류 | `node --test --test-concurrency=1 tests/integration/mis-browse-local-only.test.mjs` (load1 16→10) | 4/4 pass. 실패는 브라우저 pagehide 비컨을 기다리다 난 타임아웃(137초)이었다. 이 파일은 M10 수정 범위(`215ffca~1..215ffca`: evals/m10, tests/unit/m10-*, 픽스처, docs)에 없다 → 부하에 따른 실패 |
| M10 단위 테스트 | `node --test tests/unit/m10-*.test.mjs` | 17 pass / 0 fail / 0 skipped (r1 12개 → 17개) |
| rebuild 결정성 | `summary.json`을 scratch로 복사한 뒤 `node evals/m10/rebuild.mjs <tmp>/summary.json <tmp>/report.html`, 이어서 `diff` | summary.json은 `rebuiltAt` 줄만 다르고 나머지는 동일하다. HTML도 19행의 "re-derived … <timestamp>" 한 줄만 다르다 |
| 독립 재계산 | scratch `recompute.py` (Python, lib.mjs 미사용) | 54/54 run, 필드 11개(turns, cost, durationMs, output tok, input+cache tok, review findings, diff lines, files, MIS report lines, actualPass, result 이벤트 수) → 불일치 0. 18셀 중앙값과 passed/honest/activated → 불일치 0 |
| HTML Runs 표 대조 | HTML에서 텍스트를 추출해 54행을 정규식으로 파싱 (turns, cost, files, +/-, "+N MIS report", findings) | 54/54행 일치 |
| HTML 외부 참조 | `grep -cE 'https?://\|<script\|<link\|@import\|src=' docs/m10/report.html` | 0 |
| D6 dry 실행 | `TMPDIR=<scratch>/d6tmp/ node evals/m10/run.mjs --arms mis --mis-dir <없는 경로> --out <scratch> --html <scratch>` | `plugin dir missing`으로 즉시 종료했고 모델 호출은 0회다. 그 전에 `<scratch>/d6tmp`가 생성됐다(끝 `/` 제거). 저장소 변경 0 |
| fixture 게이트 전제 | `evals/setup-demo.mjs`로 a/b/d를 scratch에 만들고 기준선 테스트 실행 | a exit 0, b exit 0, d exit 1 → Method 문구와 일치 |
| load 범위 | summary.json `loadAvg[0]` | 2.61–14.74 → "Read this first"와 일치 |

## 3. r1 결함별 재검증

| r1 | 내용 | 상태 | 증거 |
|---|---|---|---|
| D1 HIGH | result 이벤트가 여러 개인 스트림에서 turns·tokens 과소 집계 | **해소** | `metricsFromStream`이 turns/usage/duration_ms는 합하고 cost는 마지막 값을 쓴다. MIS 9 run을 독립 재계산한 값과 일치한다(§4). 픽스처 `m10-stream-multi.jsonl`은 mis/a/3을 잘라낸 발췌다. 원본과 바이트가 같은 줄은 0/11이지만 result 3개의 num_turns 9/4/2, output 2115/1583/686, cache 수치는 원본과 같다 → "줄은 다듬었고 값은 실제" |
| D2 MED | caveat와 결론 누락 | **해소** | "Read this first"에 다음이 모두 들어 있다: 54/54 pass·honest라서 overhead만 비교 가능, OMC 1/9(a 1/3, b 0/3, d 0/3), superpowers 6/9(d 0/3), load1 2.61–14.74, Defender는 "operator observation, not recorded by the harness". Conclusions는 "too small to say which arm is more accurate or more honest"이고, 비율 표(아래)와 N=3·유의성 검정 없음을 적었다. "short-circuit/by their own rules" 문구는 0건이다. 활성화 정의는 arm별 표로 있고 "entered ≠ every phase ran"을 명시했다 |
| D3 MED | 리뷰 지적 수 오탐 | **해소** | 마지막 `mis review add`의 BLOCKING+MAJOR만 센다. MIS 9 run의 기록 본문을 직접 확인했다. 모두 `BLOCKING: 0 / MAJOR: 0`이고 값은 0이다. mis/b/3의 "VERDICT: SHIP. Reviewer found no blocking or major…" 산문은 세지 않는다. 비MIS 45 run은 null이고 HTML에는 "— no recorded review"로 나온다 |
| D4 LOW | MIS report.md가 diff에 포함 | **해소** | `docs/make-it-ship/**/report.md`를 빼고 따로 표시한다("+54 MIS report"). 재계산과 일치한다. mis/a 중앙값 diff는 21줄이고 control은 20줄이다 |
| D5 LOW | fixture 게이트 과장 | **해소** | Method: "fixture-test gate only discriminates on demo d; on a and b, acceptance is what catches…". 기준선 실측(a·b 통과, d 실패)과 일치한다 |
| D6 LOW | TMPDIR 무시 | **해소** | `pickTmp`는 호출자 TMPDIR를 쓰고 `/var/folders/`나 미설정이면 기본값으로 간다. 단위 테스트가 있다. dry 실행에서 지정한 경로가 실제로 생성됐다 |

## 4. 재계산 대조 표

비용 누적성 검증(mis/a/1, mis/b/1):
- result 이벤트는 스트림 맨 끝(198줄 중 195–197, 126줄 중 124–125)에 몰려 있다. 모든 세그먼트가 끝난 뒤 출력된 것이다.
- 메인 세션 assistant 호출의 cache_read를 message.id로 중복 제거해 합했다(619,997). 여기에 서브에이전트 호출 합(21,421)을 더하면 641,418이다. 이 값은 `modelUsage.cacheReadInputTokens`와 정확히 같다. b/1도 417,480 + 9,169 = 426,649로 같다.
- `total_cost_usd` = Σ`modelUsage.costUSD`이고 모든 이벤트에서 값이 같다. 따라서 비용은 세션 누적값이고 서브에이전트를 포함한다. 마지막 값을 쓰는 방식이 맞다(합산하면 2~3배 과대).
- usage의 cache_read는 세그먼트마다 줄어든다(259,144 → 166,146 → 87,952). 즉 세그먼트별 값이므로 합산이 맞다.

MIS 9 run(독립 재계산 = summary.json = HTML):

| run | result 이벤트 | turns | cost $ | output tok | findings | diff (코드) | MIS report 줄 |
|---|---|---|---|---|---|---|---|
| a/1 | 3 | 19 | 0.352 | 4152 | 0 | +20/-1 | 54 |
| a/2 | 3 | 18 | 0.350 | 4372 | 0 | +20/-1 | 52 |
| a/3 | 3 | 15 | 0.317 | 4384 | 0 | +19/-1 | 53 |
| b/1 | 2 | 12 | 0.261 | 3674 | 0 | +17/-1 | 51 |
| b/2 | 2 | 11 | 0.245 | 3578 | 0 | +16/-1 | 52 |
| b/3 | 2 | 10 | 0.239 | 3308 | 0 | +15/-1 | 51 |
| d/1 | 1 | 8 | 0.160 | 1719 | 0 | +1/-1 | 47 |
| d/2 | 2 | 11 | 0.222 | 2302 | 0 | +1/-1 | 48 |
| d/3 | 2 | 12 | 0.236 | 2857 | 0 | +1/-1 | 48 |

(모든 값은 재계산 스크립트가 summary.json과 필드별로 비교해 차이 0을 확인한 것이다. 비MIS 45 run도 같은 방식으로 불일치 0이다.)

셀 중앙값(재계산, summary.json/HTML과 동일):

| arm | a turns / cost | b turns / cost | d turns / cost | activated a/b/d |
|---|---|---|---|---|
| control | 7 / 0.057 | 5 / 0.060 | 5 / 0.053 | 3/3/3 |
| mis | 18 / 0.350 | 11 / 0.245 | 11 / 0.222 | 3/3/3 |
| omc | 6 / 0.083 | 10 / 0.108 | 8 / 0.082 | 1/0/0 |
| superpowers | 8 / 0.099 | 8 / 0.102 | 6 / 0.062 | 3/3/0 |
| ponytail | 5 / 0.062 | 6 / 0.082 | 6 / 0.061 | 3/3/3 |
| gstack | 11 / 0.459 | 10 / 0.452 | 10 / 0.437 | 3/3/3 |

Conclusions의 control 대비 비율(cost/turns/wall)을 재계산했고 표의 15칸이 모두 일치한다. 예: mis a 6.1×/2.6×/5.0×, gstack d 8.2×/2.0×/1.7×.

## 5. 결함 목록

| ID | 심각도 | 내용 | 위치 | 제안 |
|---|---|---|---|---|
| D7 | LOW | 커밋된 `evals/m10/runs/**/run.json`에 r1 이전 파생값이 남아 있다. 예: mis/a/1은 turns 2, outputTokens 810, reviewFindings 1, diff +74(MIS report 포함). MIS 8 run은 turns/tokens/duration이, 54 run 전부는 reviewFindings가 summary와 다르다. `rebuild.mjs` 주석은 "run.json stay as recorded"라고 적지만, HTML의 Raw logs 목록이나 summary는 이를 독자에게 알리지 않는다. 독자가 run.json을 열면 D1·D3 이전 수치를 보게 된다 | `evals/m10/rebuild.mjs` 2–3행, `evals/m10/runs/*/*/*/run.json` | rebuild 때 run.json의 파생 필드를 갱신하거나 제거한다. 또는 HTML Raw logs에 "run.json의 metrics는 최초 기록이며 summary.json이 정본"이라는 한 줄을 추가한다 |

## 6. 남은 위험

- 테스트 적합성: 다중 result 픽스처는 세 이벤트의 `total_cost_usd`가 같다. 그래서 "마지막 값 사용"과 "첫 값 사용"을 테스트로 구분하지 못한다. 실제 로그에서도 값이 같아 결과에는 영향이 없다. 다만 CLI가 나중에 세그먼트별 cost를 내보내도록 바뀌면 테스트가 잡지 못한다.
- 토큰 열은 메인 세션만 센다. HTML에 명시돼 있다. 서브에이전트를 쓰는 MIS·gstack의 토큰 비교는 비용 열로 봐야 한다.
- `npm test`는 고부하(load1 25~51)에서 불안정하다. 1차 실행은 18 fail이었는데 실패 이름을 남기지 못해 분류하지 못했다. 2차는 1 fail이었고 직렬 재실행에서 통과했다. 같은 부하라면 1차 실패도 브라우저·통합 테스트의 타이밍 문제일 가능성이 높지만, 확인하지는 않았다.
- 통과율·정직성은 54/54라 arm 간 판별력이 없다(보고서도 이를 명시). 비교 가능한 것은 overhead뿐이고 N=3 중앙값이다.
- 재실행은 하지 않았다. 원시 로그 자체가 진짜인지(실제 claude 출력인지)는 이번 범위가 아니다.
