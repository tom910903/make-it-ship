# LAYOUT 검증 보고서 r2 (r1 결함 D1-D7 수정 재검증)

- 대상: `8493cb5` (r1 기준 `98f8fc0`, 수정 커밋 `2cded84`, `8493cb5`)
- 검증자: 독립 verifier (작성자 아님). 날짜: 2026-10-22
- 환경: TMPDIR, MIS_STATE_HOME 모두 `/private/tmp/claude-501/vlayout2-tmp` 아래. 외부 CLI 호출은 `claude plugin validate`뿐이다. dogfood는 하지 않았다(아래 "남은 위험" 참조).

## 요약 판정: DEFECTS FOUND (LOW만)

r1 결함 D1-D7은 모두 수정됐다. 우회를 시도했지만 D1(경로 탈출)과 D3(fail-open), D6(init)은 뚫지 못했다.
D2(glob 우회)는 주요 형태(`docs/**`, `docs/*/x.*`, `docs/guide/*.md` 등)를 막는다. 다만 `?`로 확장자를 가리는 glob(`docs/guide/x.m?`, `docs/guide/x.??`)은 여전히 통과한다. 이 glob은 guard에서도 `docs/guide/x.md` 쓰기를 허용한다 → N1 (LOW).
보고서 6절에 번역 누락 안내가 새로 들어가서 N1의 영향은 줄어든다. 새 결함은 모두 LOW이고 차단급은 없다.

## 명령·수치

| 항목 | 결과 | 명령 |
|---|---|---|
| 테스트 | tests 792, pass 792, fail 0, skipped 0, todo 0, cancelled 0 (157s). r1보다 11개 늘었다 | `npm test` |
| plugin.json | Validation passed | `claude plugin validate .claude-plugin/plugin.json` |
| marketplace.json | Validation passed | `claude plugin validate .` |
| 작업 트리 | 이 보고서 외 변경 없음 | `git status --short` |

## r1 결함별 재검증

| ID | 수정 내용 | 재현과 우회 시도 | 판정 |
|---|---|---|---|
| D1 | `validateLayout`가 `..`/`.` 세그먼트, 절대경로, `~`, `\`를 거부한다. `writeDocs`는 쓰기 전에 모든 대상을 realpath로 확인하고, 하나라도 저장소 밖이면 아무것도 쓰지 않는다. guard 문구에 실제 경로를 표시한다 | 거부된 값: `../escaped-ai`, `/abs`, `~/x`, `~`, `a\b`, `.`, `./ai`, `a/../b`, `a/..`. 허용된 값: `.ai`, `docs/.ai`, `..ai`, `...`, `a/~b`(모두 저장소 안 리터럴 경로). r1 재현(`docs.ai:"../escaped-ai"`)은 이제 `mis layout write`에서 "config invalid", exit 1이고 밖에 파일이 생기지 않는다. 심볼릭 링크: `.ai`가 밖을 가리키면 거부, `.ai/structure.md`가 밖의 파일을 가리키면 거부(대상 내용 그대로), dangling 링크면 거부, `AGENTS.md`가 밖을 가리키면 거부. 모두 exit 1이고 저장소에도 아무것도 쓰지 않았다(원자성 확인). `/tmp` 심볼릭 경로로 cwd에 들어가도 정상 동작했다(8개 기록, 재실행 시 `written: []`). guard 문구: `[files (...): .ai/index.md, ..., AGENTS.md, CLAUDE.md]` | VERIFIED |
| D2 | `coversHumanDocs`: languages가 2개 이상일 때, human docs를 덮을 수 있는 계획 glob을 거부한다(샘플 경로로 판정) | 거부됨: `docs/**`, `docs/*/x.*`, `docs/guide/*.md`, `docs/guide/**`, `docs/g*/x.md`, `docs/*`, `docs/guide/*d`, `docs/guide/x.*.md`, `docs/guide/*.ko.md`, `docs/??????/x.md`, `d*/**`, `**/*.md`(이 둘은 layout 밖이기도 함). `{docs,src}/**`는 brace가 지원되지 않아 리터럴로 취급되고 layout 밖으로 거부된다. `docs/guide/x.[m]d`는 통과하지만 `[`가 리터럴이라 guard가 `x.md` 쓰기를 ask로 막는다(우회 아님). **통과됨(우회): `docs/guide/x.m?`, `docs/guide/x?md`, `docs/guide/x.??` → N1** | PARTIAL |
| D3 | 설정이 잘못되면 `plan set`/`start --plan`/`plan check`가 fail-closed로 거부한다 | run 중 `languages:["ko"]`로 바꾸면 `zzz/x.ts`와 `src/a.js` 계획이 모두 exit 1로 거부되고, plan은 저장되지 않는다(`plan:false`). `plan check`는 `ok:false`에 메시지를 표시한다. JSON 문법 오류도 거부된다. 설정 파일을 삭제하면 layout 검사가 꺼진다(기능 off). 이 경우 guard가 `rm`과 Write 모두 ask를 내고, verdict는 "changed during the run without approval"로 PARTIAL이다. 결함 아님 | VERIFIED |
| D4 | discover.md의 deepinit 항목에 layout이 있으면 `.ai/modules/<dir>.md`와 `_root.md`에 쓰고 `.ai/index.md`는 덮어쓰지 않는다고 적었다. `keywords.mjs` 안내도 같다 | 문서 대조 | VERIFIED |
| D5 | 2글자 접미사가 languages에 없으면 "unknown language suffix"로 안내하고 두 가지 해법을 제시한다 | `x.ja.md`는 정확히 안내한다. `x.zh-cn.md`도 안내한다. `x.v2.md`는 숫자가 들어 있어 이름으로 보고 `x.v2.ko.md`를 요구한다(타당). `socket.io.md`는 "io"를 모르는 언어로 보지만 이름일 가능성도 함께 안내한다(타당). `x.ja.md`와 `x.ja.ko.md`를 함께 넣으면 통과한다. 사소한 점: `x.zh-CN.md`(대문자)와 `x.fil.md`(3글자)는 unknown 안내 없이 옛 메시지가 나온다. `x.en.md`에는 `x.en.ko.md`를 요구한다 → N3 | VERIFIED (N3 LOW) |
| D6 | 설정이 있으면 `mis init`이 `mis init --layout --write`를 안내하고, 이 명령은 layout만 추가한다 | layout이 없는 기존 설정: 메시지가 정확하고 `--layout --write`가 exit 0으로 layout만 추가한다. 다른 키는 그대로 유지됐다(JSON 비교 true). `--write`는 여전히 "already exists"로 거부한다. layout이 이미 있으면 메시지가 "already has a layout, edit it"이고 `--layout --write`는 exit 1이다. 설정이 없으면 exit 1이고 파일이 생기지 않는다. 결과 설정이 잘못될 경우(기존 설정이 invalid) exit 1이고 파일은 바뀌지 않는다. run 중에는 guard가 `init --layout --write`에 ask를 내고(`init`만이면 출력 없음), 실행 후 verdict 사유 "changed during the run without approval"가 생기며 `mis approve config` 뒤 사라진다 | VERIFIED |
| D7 | README의 EN/KO PARTIAL 표에 "unmerged task worktrees"와 "no required checks defined"를 복원했다. "declining stops the run", 템플릿이 한국어라는 안내, `limits` 문장을 EN/KO 양쪽에 맞췄다 | `README.md:85`, `README.ko.md:85`, `README.md:60,112` 대조. `readme-docs.test.mjs` 통과 | VERIFIED |

## 보고서 6절 번역 누락 안내 (새 기능)

layout이 있는 run에서 다음과 같이 바꾼 뒤 `mis report`를 실행했다. 새 `docs/guide/x.md`(번역 없음), 쌍이 있는 `docs/guide/y.md` 수정, 새 `docs/guide/z.ja.md`. 바꾸지 않은 `docs/old.md`도 번역이 없다.

결과(6절 "검증하지 못한 영역과 이유", report.md 32-33줄):
- `docs/guide/x.md` → `x.ko.md` 없음 (표시됨)
- `docs/guide/z.ja.md` → `z.ja.ko.md` 없음, "또는 ja가 languages에 없는 언어" (표시됨)
- `y.md`(쌍 있음)와 `old.md`(이번 run에서 안 바뀜)는 표시되지 않았다. 의도대로다.
- verdict는 이 안내로 바뀌지 않는다(PARTIAL 사유 목록에 없음). 문서에 적힌 대로다.
- layout이 없는 저장소에서는 이 안내가 0줄이다.

## 회귀

| 항목 | 결과 |
|---|---|
| layout이 없을 때 | `lib/x.ts`, `docs/**`, `zzz/a.ts` 계획이 exit 0으로 저장된다. `mis layout`은 "layout rules are off"를 출력하고, 보고서에 layout 안내가 없다 |
| `mis layout write` 멱등 | 두 번째 실행에서 `written: []` |
| 마커 | `.ai/index.md` "MY INDEX"가 유지됐다. structure.md의 TOP/BOTTOM이 유지되고 마커 안만 새 `lib/**`로 갱신됐다. CLAUDE.md "# My rules"와 AGENTS.md의 기존 텍스트도 유지됐다 |
| guard | run 밖에서 `layout write`는 ask, `layout`과 `layout --json`은 출력 없음(허용) |

## 결함 목록

| ID | 심각도 | 내용 | 재현 | 위치 |
|---|---|---|---|---|
| N1 | LOW | D2가 완전히 막히지 않았다. `coversHumanDocs`는 glob의 와일드카드를 `a`로 바꾼 샘플 경로로 판정한다. 그래서 `?`가 `.md`의 일부를 대신하는 glob은 샘플이 `.md`로 끝나지 않아 통과한다. guard는 같은 glob으로 `docs/guide/x.md` Write를 allow한다(확인함). 코드의 shortcut 주석이 이 한계를 인정한다. 고의적인 형태라 실제 모델이 쓸 가능성은 낮다. 보고서 6절 안내가 사후에 잡아낸다 | `plannedFiles:["src/a.js","docs/guide/x.m?"]` → exit 0. 같은 결과: `docs/guide/x?md`, `docs/guide/x.??` | `scripts/lib/layout.mjs` `coversHumanDocs` |
| N2 | LOW (r1부터 있던 문제) | 같은 파일이 `plannedFiles`와 `tasks[].files`에 모두 있으면(흔한 경우) 번역 오류 줄이 위치마다 두 번씩 나온다. 이번 D5 메시지에서는 `add x.ja.ko.md + x.ja.ko.md`처럼 한 줄 안에서도 중복된다 | `plan set`에서 plannedFiles와 files 둘 다 `docs/guide/x.v2.md` | `planLayoutErrors`: `all`의 중복 때문에 `missingTranslation`이 중복됨 |
| N3 | LOW | 언어 접미사 판정의 가장자리 경우. `x.en.md`에는 "en은 접미사 없이 쓴다"는 안내 없이 `x.en.ko.md`를 요구한다. `x.zh-CN.md`(대문자)와 3글자 코드(`x.fil.md`)는 unknown language 안내가 나오지 않는다. 동작은 거부로 안전하고, 메시지만 부정확하다 | plannedFiles에 `docs/guide/x.en.md` | `unknownLang` 정규식 `[a-z]{2}` |

참고(결함 아님):
- `docs.ai:".git"` 같은 값은 저장소 안이므로 허용된다. 이 경우 `.git/index.md` 등 고정 이름의 md 파일만 생기고 실행 파일은 생기지 않는다.
- 보고서 6절 안내는 삭제(D)를 제외한다. 따라서 이번 run에서 `x.ko.md`만 지우고 `x.md`를 그대로 두면 표시되지 않는다. `mis layout`에는 나온다.

## 남은 위험

- dogfood(`claude -p`, quick 모드)는 실행하지 않았다. 이번 지시의 "외부 CLI 사용 금지"와 충돌해서 보수적으로 생략했다. 그래서 모델이 이제 plannedFiles에 `.ai/` 문서를 넣는지는 관찰하지 못했다. discover.md의 deepinit 항목에만 "쓰는 `.ai/` 파일을 plan의 files에 넣어라"가 있고, plan.md에는 이 안내가 없다(r1의 `.ai/decisions.md` 누락 관찰은 아직 해소되지 않았을 수 있다).
- 번역 쌍은 여전히 계획 단계에서만 기계 검사한다. 실행 후에는 보고서 6절 안내뿐이고 verdict에는 반영되지 않는다(설계대로).
- realpath 검사와 실제 쓰기 사이의 경쟁 상태(TOCTOU)는 범위 밖으로 보고 확인하지 않았다.
