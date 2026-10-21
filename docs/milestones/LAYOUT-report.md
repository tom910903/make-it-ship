# LAYOUT 검증 보고서 (구조 규칙 + README 재구성)

- 대상: `98f8fc0` (기준 `9b84e81`, `git log 9b84e81..98f8fc0` 커밋 10개)
- 검증자: 독립 verifier (작성자 아님). 날짜: 2026-10-22
- 환경: TMPDIR, MIS_STATE_HOME 모두 `/private/tmp/claude-501/vlayout-tmp` 아래. 외부 호출은 요청된 dogfood `claude -p` 1회뿐.

## 요약 판정: DEFECTS FOUND

기능은 요구사항대로 동작한다. 테스트 781개가 모두 통과했고 매니페스트도 유효하다. dogfood에서도 en+ko 문서 쌍을 만들었고 layout 밖 파일은 0개였다.
다만 결함이 있다. 경로 탈출(`..`)이 1건이고, 계획 검사의 빈틈(glob, 설정 오류 시 fail-open)이 2건이다. 문서와 메시지의 사소한 문제도 몇 건 있다. 차단급(HIGH) 결함은 없다.

## 명령·수치

| 항목 | 결과 | 명령 |
|---|---|---|
| 테스트 | tests 781, pass 781, fail 0, skipped 0, todo 0, cancelled 0 (103s) | `npm test` |
| plugin.json | Validation passed | `claude plugin validate .claude-plugin/plugin.json` |
| marketplace.json | Validation passed | `claude plugin validate .` |
| 명령 수 | `Commands (mis <command>, 90)`, core에 `layout` 포함 | `mis help commands` |
| 스킬 33개, 에이전트 21개 | README 표에 있는 33개 스킬 디렉터리가 모두 있음. `agents/*.md`는 21개 | `ls skills agents` |
| stub/skip | 변경 파일의 diff에 TODO, FIXME, `.skip`, `.only`가 없음. 매칭된 것은 run 상태 문자열 "TODO"뿐 | `git diff 9b84e81..HEAD \| grep` |
| dogfood | exit 0, result success, 턴 2(최상위 기준), $0.88, 판정 VERIFIED, 상태 REPORTED, quick 모드 | 아래 4절 |

## 요구사항별 판정

| # | 요구사항 | 판정 | 근거 |
|---|---|---|---|
| 1 | 설정 검증 | VERIFIED | 다음 입력을 모두 정확한 메시지로 거부했다: `layout:"x"`, `paths:[]`, `paths:"src/**"`, unknown key `layout.foo`와 `layout.docs.x`, purposes에 paths 밖의 glob 또는 빈 문자열, `docs.human:"docs/"`, `"do*cs"`, `"/abs"`, `languages:["ko"]`(en 없음), `["EN"]`, `"en"`. **예외: `"../up"`은 통과한다 → D1** |
| 2 | `mis init` 제안, `--write`일 때만 기록 | VERIFIED | demo a에서 `docs/**, package.json, src/**, test/**, .ai/**, .make-it-ship.json, .make-it-ship/**, CLAUDE.md, AGENTS.md`와 docs `{docs,.ai,[en,ko]}`를 제안했다. 이때 파일은 생기지 않았고 `--write` 뒤에만 기록됐다. 설정이 이미 있으면 제안은 나오지만 `--write`가 "already exists"로 거부한다 → D6 |
| 3 | plan set, start --plan, plan check 거부 | VERIFIED | plan set: `lib/x.ts`는 거부, exit 1, plannedFiles와 tasks[0].files 위반을 각각 나열하고 "move it under an allowed path"를 안내했다. `**`와 `*`는 "narrow the glob"로 거부했다. `docs/guide/x.md`만 있으면 `x.ko.md`가 필요하다고 거부했고, `x.ko.md`만 있어도 `x.md`가 필요하다고 거부했다. 쌍이 plannedFiles와 task files로 나뉘어 있어도 통과했다. `.ai/modules/src.md`, `.ai/tech.md`, `docs/make-it-ship/plans/p.md`, `docs/img.png`는 통과했다. start --plan과 plan check는 통합 테스트(`mis-layout.test.mjs`)가 통과한 것으로 확인했다. **빈틈: glob `docs/**`는 쌍 검사 없이 통과한다 → D2. 설정이 잘못되면 검사를 건너뛴다 → D3** |
| 4 | layout이 없으면 기존 동작 그대로 | VERIFIED | 통합 테스트 "without a layout nothing is checked"와 `mis layout`이 "layout rules are off"를 출력하는 것으로 확인했다. guard는 run 밖에서 layout 밖 경로에 대한 Write를 허용했다(출력 없음) |
| 5 | `mis layout` / `--json` | VERIFIED | tracked 파일과 untracked `.make-it-ship.json`, `scratch/a.txt`, `.gitignore`가 포함됐다. `.gitignore`에 있는 `build/out.js`는 제외됐다. 번역 누락 항목은 `docs/feature-request.md → docs/feature-request.ko.md`로 나왔다 |
| 6 | `mis layout write`가 멱등 | VERIFIED | 두 번째 실행은 `written: []`이었고, `.ai/*`, AGENTS.md, CLAUDE.md의 shasum이 같았다 |
| 7 | 기존 `.ai` 파일과 마커 밖 내용은 덮어쓰지 않음, CLAUDE.md가 없으면 생성 | VERIFIED | 직접 만든 저장소로 확인했다. `.ai/index.md`의 "MY INDEX"는 유지됐다. `structure.md`는 마커 안만 바뀌었고 앞뒤 텍스트가 남았다. CLAUDE.md의 "# My rules"와 AGENTS.md의 기존 텍스트도 유지됐다. demo a에는 CLAUDE.md가 없었는데, 마커와 `@AGENTS.md`만 담은 CLAUDE.md가 생성됐다 |
| 8 | guard가 `mis layout write`는 묻고 `mis layout`은 묻지 않음 | VERIFIED | run이 있을 때와 없을 때 모두 `layout write`는 ask, `layout`과 `layout --json`은 출력 없음(허용) |
| 9 | run 중 설정을 바꾸면 `mis approve config` 필요 | VERIFIED | `.make-it-ship.json`을 Edit하면 guard가 ask를 냈다. layout을 바꾼 뒤 verdict는 PARTIAL이었고 사유는 "changed during the run without approval"이었다. `approve config` 뒤 그 사유가 사라졌다. 참고: plan set은 승인 전에도 새 layout을 바로 적용한다. 보호 장치는 guard ask와 PARTIAL 판정이다 |
| 10 | 스킬과 에이전트 문서의 일관성 | PARTIAL | discover, plan, review, writer, setup 문서는 코드와 일치한다. deepinit에서 루트 디렉터리를 `.ai/index.md`에 쓰는 부분은 지도 파일과 충돌한다 → D4. 숨김 폴더 제외(`scanDirs`)는 코드로 확인했다(`.ai`가 숨김 폴더일 때만 해당) |
| 11 | dogfood에서 en+ko 쌍을 만들고 layout 안에만 쓰는지 | VERIFIED (관찰) | 4절 참조 |
| 12 | README 사실 대조 | VERIFIED (LOW 차이 있음) | 5절 참조 |
| 13 | README에 출처 표기가 없음 | VERIFIED | inspired, based on, 외부 github URL 없음. FAQ의 OMC 등은 비교 대상일 뿐 출처 표기가 아니다 |

## 4. dogfood 관찰 (demo a, layout과 `mis layout write` 결과를 커밋한 상태)

- 명령은 요청된 그대로 실행했고 `--output-format stream-json`만 추가했다. exit 0, 판정 VERIFIED.
- 계획은 explicit 파일만 썼고 glob은 없었다: `src/text.ts`, `test/text.test.ts`, `docs/guide/slugify.md`, `docs/guide/slugify.ko.md`. 거부된 적은 없다("does not follow" 0회).
- 결과: `docs/guide/slugify.md`와 `slugify.ko.md` 쌍을 만들었고, 한국어 본문은 자연스럽다. `mis layout --json` 기준 outside는 0개다. 남은 번역 누락은 원래 있던 `docs/feature-request.md` 하나다.
- 모델이 최종 보고에서 직접 밝힌 두 가지: (a) `feature-request.md`에 번역이 없어 규칙 위반이지만 범위 밖이라 그대로 뒀다. (b) `.ai/decisions.md`에 결정을 기록해야 하지만 계획의 파일 목록에 없어서 기록하지 않았다. 결과적으로 `.ai/` 문서 갱신 규칙은 계획에 `.ai/` 파일을 넣지 않으면 지켜질 수 없다(관찰).

## 5. README 사실 대조

| 주장 | 판정 | 근거 |
|---|---|---|
| 명령 90개 | 일치 | `mis help commands` |
| 서브에이전트 21개와 목록 | 일치 | `agents/` |
| 슬래시 스킬 표의 33개 | 일치 | `skills/` 33개 디렉터리 |
| MCP 도구(notepad_*, project_memory_*, state_*, wiki_*, session_search, trace_timeline, lsp_*, ast_grep_*, python_repl) | 일치 | `mis help mcp` (54개) |
| 판정 규칙 순서 BLOCKED → FAILED → PARTIAL → VERIFIED | 일치 | `scripts/lib/verdict.mjs:44-71` |
| "See it work"의 treeHash `13ab940…` | 재현됨 | 새 demo a에서 `init --write`(layout 포함), `start`, `check unit`을 실행해 같은 treeHash가 나왔다 |
| 보고서 10개 절 | 일치 | `templates/report.md` (1~10절과 정직성 표기) |
| M10 54회, 54회 통과, 54회 정직 | 일치 | `evals/m10/summary.json` cells 합계 |
| MIS 비용 4.1~6.1배, 턴 2.2~2.6배 | 일치 | 실측 4.06/4.15/6.14배, 턴 2.20/2.20/2.57배 |
| gstack 7.5~8.2배 | 일치 | 7.47/8.05/8.18배 |
| OMC, superpowers, ponytail 1.1~1.8배 | 일치 | 1.08~1.79배 |
| OMC 발동 1/9, superpowers 발동 6/9 | 일치 | activated 1+0+0, 3+3+0 |
| 키워드 `코드 리뷰`, `보안 리뷰`, `랄프:` | 일치 | `scripts/lib/keywords.mjs:13,45,47` |
| guard 목록(kubectl delete, TRUNCATE 등) | 일치 | `scripts/lib/policy.mjs:175,222` |
| README의 설정 예시 | 유효 | `validateConfig` 결과 오류 0개 |
| 링크한 파일(HANDOFF, PROGRESS, Spec, adr, m10/report.html, adapters/codex/AGENTS.md, templates/ios-debug-bridge, NH-auto-check.md, evals/m10/run.mjs, report.mjs, gap-matrix.mjs) | 모두 있음 | `test -e` |
| 언어 전환 줄 | 정상 | README.md, README.ko.md, reference.md, reference.ko.md 모두 첫 줄에 있음 |
| reference.md와 reference.ko.md가 같은 쌍인지 | 일치 | 백틱 토큰 집합이 같고 135줄로 같다. reference.md 7-135줄은 옛 README 125-254줄과 같고, 바뀐 곳은 M10 "smoke run only" 문구 삭제 1곳뿐이다(사실을 바로잡은 것) |
| 한국어 자연스러움과 맞춤법 | 양호 | 번역투나 띄어쓰기 오류는 찾지 못했다 |

옛 README(9b84e81)와 비교해 빠진 내용:
- 판정 표 PARTIAL의 "unmerged task worktrees"와 "no required checks defined": README와 reference 어디에도 없다. 코드에는 있다(`verdict.mjs:55,63`) → D7 (LOW, 안전 관련 정보)
- "Declining stops there"(승인을 거절하면 멈춤), review의 "Nothing is fixed unless you ask", 설치 확인용 `claude plugin list`, `mis browse status`의 localOnly 설명(reference에는 있음): LOW
- 전체 명령 나열(`cancel --all --run`, `uninstall --purge-runs` 등)은 `mis help commands`로 대체됐다. 문서 유도는 README에 남아 있다
- EN과 KO의 차이: KO 208줄의 "`limits`를 넘으면 BLOCKED…, 사용자 승인 필요"가 EN에는 없다. EN 60줄의 "보고서 템플릿은 한국어" 안내는 KO에 없다(LOW)

## 결함 목록

| ID | 심각도 | 내용 | 재현 | 위치 |
|---|---|---|---|---|
| D1 | MEDIUM | `layout.docs.ai`와 `docs.human`이 `..`를 허용해 `mis layout write`가 저장소 밖에 파일을 만든다. 이미 있는 `structure.md`라면 마커 블록을 삽입한다. guard의 질문 문구는 ".ai/ doc skeletons"라서 사용자는 실제 경로를 알 수 없다 | `docs.ai:"../escaped-ai"`로 두고 `mis layout write`를 실행하면 written에 `../escaped-ai/index.md` 등 6개가 나오고, 실제로 저장소 밖에 생성된다 | `scripts/lib/config.mjs` validateLayout 정규식 `/^[^/*?]+(\/[^/*?]+)*$/`, `scripts/lib/layout.mjs:128-145` |
| D2 | MEDIUM | 계획 항목이 glob이면 번역 쌍 검사를 건너뛴다. 계획 이후에는 실제로 쓴 파일을 기계적으로 검사하지 않는다. 그래서 `plannedFiles:["docs/**"]` 계획으로 영어 문서만 써도 막히지 않고, review 단계의 모델 판단에만 의존하게 된다 | demo a에서 `plannedFiles:["docs/**"]`가 PLANNING으로 저장됐다 | `scripts/lib/layout.mjs:31` (`isGlob(file)`이면 `[]`) |
| D3 | LOW-MED | layout 검사가 fail-open이다. run 도중 설정이 잘못되면(`config:null`) plan set이 layout 검사 없이 통과한다. 같은 설정으로 `start`는 거부하므로 동작이 서로 다르다 | run을 시작한 뒤 `languages:["ko"]`로 바꾸고 `zzz/x.ts` 계획을 plan set하면 PLANNING으로 저장된다 | `scripts/lib/commands.mjs` `layoutErrors` (`loadConfig(...).config?.layout`) |
| D4 | LOW | deepinit 문서는 루트 디렉터리를 `.ai/index.md`에 쓰라고 하는데, 이 파일은 지도 뼈대다(writer.md, `mis layout write`). 지도를 모듈 문서로 덮어쓸 수 있다. `keywords.mjs:26`의 deepinit 안내는 여전히 "AGENTS.md만"이라고 한다 | 문서를 읽어 확인 | `skills/run/phases/discover.md` deepinit 항목, `scripts/lib/keywords.mjs:26` |
| D5 | LOW | languages에 없는 언어 접미사가 붙으면 메시지가 잘못 나온다. `docs/guide/x.ja.md`에 대해 `x.ja.ko.md`가 필요하다고 한다 | plannedFiles에 `docs/guide/x.ja.md`를 넣는다 | `scripts/lib/layout.mjs:33-35` |
| D6 | LOW | 설정이 이미 있는 저장소에서 `mis init`은 layout을 제안하면서 "`mis init --write`로 쓰라"고 안내하지만, `--write`는 "already exists"로 거부한다. 기존 프로젝트는 손으로 편집해야 한다 | demo r에서 기존 설정이 있는 상태로 `mis init`을 실행한다 | `scripts/lib/commands.mjs` init, `skills/setup/SKILL.md` 4번 |
| D7 | LOW | README와 reference에서 PARTIAL 사유 두 가지(병합되지 않은 task worktree, required checks 없음)가 빠졌다 | 옛 README 120줄과 비교 | `README.md:85`, `README.ko.md:85` |

참고(결함 아님): 직접 쓴 layout에 `AGENTS.md`, `CLAUDE.md`, `.make-it-ship.json`이 없으면, `mis layout write`가 만든 파일이 곧바로 `mis layout`의 outside에 잡힌다. `mis init`의 제안에는 이 파일들이 들어 있다.

## 남은 위험

- `.make-it-ship.json`이 신뢰할 수 없는 클론에서 오면 D1과 결합된다. guard가 묻기는 하지만 질문 문구에 실제 경로가 나오지 않는다.
- 구조 규칙은 계획 단계에서만 기계 검사한다(요구사항대로). 실제로 쓴 파일이 계획과 layout에 맞는지는 기존의 plannedFiles guard와 review에 맡긴다.
- `@AGENTS.md`를 HTML 주석 마커로 감싼 형태가 import되는지는 별도 probe로 확인하지 않았다. dogfood 로그에 `.ai/*` 경로가 여러 번 나오고 모델이 `.ai/decisions.md` 규칙을 언급했으므로, 간접적으로는 로드된 것으로 보인다.
- dogfood는 quick 모드로 1회만 실행했다. Standard, Full 모드와 deepinit 경로는 실행하지 않았다.
