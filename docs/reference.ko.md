[English](reference.md) | 한국어

# Make It Ship 참조 문서

[README.ko.md](../README.ko.md)에서 줄여 쓴 내용의 상세판입니다. 기능 영역별로 무엇을 하는지, guard가 무엇을 묻는지 정리했습니다. 명령·스킬·에이전트·키워드·MCP 도구·훅 목록은 `mis help [topic]`이 코드에서 직접 읽어 출력합니다. 이 문서는 그 목록을 설명합니다.

## run이 하는 일
```
/make-it-ship:run Implement docs/feature-request.md
/make-it-ship:run Fix the bug described in ISSUE.md
/make-it-ship:status
```
단계 하나만 쓰는 명령(선택): `/make-it-ship:plan`(계획만 쓰고 구현은 나중에), `/make-it-ship:interview`, `/make-it-ship:brainstorm`(브레인스토밍만 따로; 설계를 `mis slides`로 발표 자료까지), `/make-it-ship:plan-review`, `/make-it-ship:review`, `/make-it-ship:debug`, `/make-it-ship:qa`, `/make-it-ship:ship`, `/make-it-ship:resume`, `/make-it-ship:retro`. 스킬 관리: `/make-it-ship:skill`, `/make-it-ship:skillify`, `/make-it-ship:writing-skills`.

진행 순서:
1. **설정.** `mis doctor`가 환경을 점검합니다. `mis init`은 `.make-it-ship.json`을 제안합니다. 이 파일에는 check 명령이 들어 있으며 `package.json`, Python 테스트, `Makefile`, Cargo, Go, SwiftPM에서 찾아냅니다. 파일은 사용자가 확인한 뒤에만 기록합니다.
2. **탐색과 인터뷰.** 먼저 저장소를 읽고, 영향이 큰 질문만 한 번에 하나씩 묻습니다.
3. **계획과 모드 선택.** 모드는 Quick, Standard, Full 중 하나이며 선택 이유를 함께 밝힙니다. 위험 플래그(인증, 결제, 개인정보, 마이그레이션, 보안)가 있으면 Standard 이상이 됩니다.
4. **계획 비평과 사용자 승인.** Standard와 Full에서 진행합니다. 위험 플래그가 없는 Quick 변경은 승인을 건너뜁니다.
5. **구현.** 테스트를 먼저 쓰고, 필요한 만큼만 바꿉니다.
6. **검증과 QA.** `mis check`가 check를 실행합니다. `mis qa detect`가 찾은 CLI, API, 웹 UI, iOS 시뮬레이터, Android 에뮬레이터 화면에 대한 실사용 QA check(`qa-*`)도 포함합니다. 읽기 전용 리뷰어 에이전트(spec과 quality, 위험한 변경이면 security 추가)가 변경을 검토합니다.
7. **보고.** 보고서는 `docs/make-it-ship/<run>/report.md`에 씁니다. 목표, 작업 상태, 변경 파일, 실제 check 결과, 검증하지 못한 부분과 이유, 무효가 된 증거, 사용자가 결정할 일, 결과 실행 방법을 담습니다.
8. **배포(요청 시, 또는 Full).** 문서와 변경 기록 수정은 검증 전에 합니다. 보고 뒤 `mis ship`이 PR 초안, 변경 기록 초안, 릴리스 체크리스트를 씁니다(VERIFIED가 아니면 `NOT READY`). push와 PR은 사용자가 승인한 뒤에만 합니다.

그 밖의 도구:
- `mis bench <check> --runs N`은 성능을 잽니다. +20%는 WARN, +50%는 REGRESSION으로 표시합니다.
- `mis retro`는 여러 run의 지표를 모읍니다.
- `mis learn add|list`는 프로젝트에서 배운 점을 기록합니다.
- 다른 모델의 의견(second opinion)이 필요하면 `mis second-opinion detect`가 codex/gemini CLI를 찾습니다. 호출하면 코드가 외부 서비스로 나가므로 사용자가 승인해야만 실행합니다.
- iOS 실기기 QA는 `templates/ios-debug-bridge/`의 DEBUG 전용 브리지를 씁니다. `mis ios devices`는 기기 목록을, `mis ios bridge-scan`은 남은 브리지 코드를 보여 줍니다. Android는 브리지가 필요 없습니다. `mis android`가 adb로 기기와 에뮬레이터를 다룹니다.
- Codex 사용자는 `adapters/codex/AGENTS.md`를 보세요. 흐름은 같지만 guard가 강제하지는 않습니다.

run 상태는 `.git/make-it-ship/`에 있으므로 커밋되지 않고 코드 해시에도 영향을 주지 않습니다.

## 흐름 안에서 쓰이는 계획·리뷰·디자인·문서·릴리스
따로 외울 명령이 아닙니다. `/make-it-ship:run`이 모드, UI 유무, 신규 작업인지 변경인지, 위험 플래그, 릴리스 요청 여부에 따라 알맞은 단계에서 꺼내 씁니다. 모든 조건은 run 스킬의 "Situational steps" 표에 있습니다. run 밖에서 말로 요청해도 기존 스킬이 같은 단계로 이어집니다.
- **계획과 스펙:** 목표 없는 "만들어 줘"는 먼저 인터뷰로 갑니다. 아이디어는 office hours(startup 또는 builder 모드), 열린 설계는 브레인스토밍을 거치고, 모호한 의도는 스펙이 됩니다. 세션을 넘겨 남겨야 할 계획은 `docs/make-it-ship/plans/<slug>.md`에 쓰고(`mis plan check`), 나중에 `mis start --plan`으로 실행합니다. 목표가 여럿이면 원장에 넣습니다(`mis goal add|done`, `/goal` 인계 문구 출력). 인터뷰는 사용자의 답하는 방식을 기억합니다(`mis question log`, `mis profile`). `mis question pref set <id> skip`으로 지겨운 질문을 건너뛸 수 있지만 영향이 HIGH인 질문은 건너뛰지 않습니다.
- **계획 리뷰:** Full 모드는 CEO, 디자인(UI), DX(개발자 대상), 엔지니어링 관점을 돌리고, 요청하면 autoplan도 돌립니다. 자동 결정은 결정 기록에 남습니다(`mis decision add|search|supersede`).
- **디자인:** `mis taste show`가 시안 방향을 잡고, `mis design-board design`은 `mis companion`으로 클릭해 볼 수 있는 비교 보드를 만들며, `mis diagram x.mmd`는 flowchart(`subgraph` 포함, `.excalidraw`도), `sequenceDiagram`, `classDiagram`, `erDiagram`, `stateDiagram-v2`를 `.svg`와 `.html`로 씁니다(`mis browse`로 PNG도).
- **시각 자료:** `mis chart <csv|json|mmd> [--type bar|hbar|line|pie] [--x col] [--y a,b] [--title t] [--out dir]`는 막대, 선, 파이, 가로 막대 차트를 그립니다(mermaid `pie`/`xychart-beta`도). `mis doc <file.md> [--pdf] [-o out.html] [--allow-network]`는 ```mermaid 블록이 든 마크다운을 언어 쌍마다 독립 HTML(과 PDF)로 만들고 `visuals`, `errors`, `missingTranslations`를 보고합니다. `mis slides <deck.md> [-o deck.html] [--pdf]`는 Marp 형식 마크다운으로 16:9 덱을 만듭니다(front matter `title`, `paginate`, `header`, `footer`, 주석은 발표자 노트, 화살표 키). 입력과 출력은 저장소 안이어야 하고(심볼릭 링크인 출력은 거부), doc, slides, pdf의 HTML에는 문서 안의 스크립트, 프레임, 폼, 원격 로드를 막는 CSP가 들어가며 이동을 일으키는 원시 태그는 글자로 보이고 저장소 안 이미지만 들어갑니다. doc과 slides는 그릴 수 없는 mermaid 블록이 있으면 종료 코드 1로 끝납니다.
- **구현과 디버깅:** 작업이 3개 이상이면 작업마다 새 서브에이전트가 맡고, 각 작업은 spec 리뷰 뒤 quality 리뷰를 받습니다. 경쟁 가설은 병렬 tracer가 맡고, 버그가 사실 요구사항 누락이면 trace 파일이 인터뷰로 넘어갑니다.
- **감사와 상태 점검(보고만):** "audit the whole repo" / `cso` / devex 리뷰, `mis redact scan --history`(작업 트리와 git 기록의 비밀값, 값은 표시하지 않음. `--pii --legal`은 이메일, 전화번호, 주민등록번호, Luhn 검사를 통과한 카드 번호 같은 개인정보와 기밀 표식을 더함. `mis redact file <path> --apply`는 파일 하나에서 치환하며 guard가 물음), `mis debt`, `mis health`(가중 check 점수와 추세).
- **릴리스:** `mis diff-scope`, `mis repo-mode`, `mis next-version`, `mis version-bump patch|minor|major`(VERSION, package.json, CHANGELOG). PR 제목은 `v<version>`으로 시작합니다. `git push` 전마다 guard가 push되지 않은 커밋에서 비밀값을 찾아 그 결과를 질문에 넣습니다. 태그 생성도 묻습니다. 브랜치 마무리는 run 없이도 됩니다.
- **기억:** `mis retro --git --since 7d`(핫스팟, 작성자별 활동, 리뷰어 적중률), `mis learn search|distill`(`--yes`가 없으면 제안만), `mis jsonl-merge install`(공유 원장용 합집합 병합), run 밖의 `mis context save|restore|sessions`.

## 상시 동작 (run 안에서만이 아니라 모든 대화에서)
플러그인만 설치하면 됩니다. 따로 설치할 것은 없습니다.
- **세션 시작:** 스킬 목록과 작업 원칙(불분명하면 만들기 전에 묻기, 테스트 먼저, 수정 전에 근본 원인, 끝났다고 하기 전에 검증, 질문은 한 줄 재진술 + 추천 + 선택지 2~4개, 다음 스킬 한 줄 제안. 제안은 `mis config set proactive false`로 끔), 현재 수준의 코딩 스타일, 진행 중인 run 알림, 코드베이스 최상위 함수의 짧은 지도를 넣습니다.
- **코딩 스타일:** `/make-it-ship:style off|lite|full|ultra`는 현재 세션의 수준을 정합니다(세션 안에서는 `mis style <level>`). `mis style default <level>`은 새 세션의 시작 수준을 정합니다. 규칙은 서브에이전트에도 전달됩니다. 대상을 줄이려면 `~/.make-it-ship/config.json`에 `subagentMatcher`를 설정하세요. 프롬프트가 "normal mode" 한마디뿐이면 그 세션에서 끕니다.
- **프롬프트 키워드:** `ralph`(지속 루프), `autopilot` / "build me an app…"(전체 run), `ulw`(병렬), `ralplan`(critic이 받아들일 때까지 계획), `deep interview`, `deslop`, `tdd`, `code review`, `security review`, `ultrathink`, `deepsearch`, `deep-analyze`, `ccg`(다른 모델, 먼저 물음), `ultragoal`(목표 원장), `ralphthon`(인터뷰 → 루프 → 다듬기), `deepinit`, `autoplan`, `office hours`, `cso` / `ponytail-audit` / "audit the whole repo"(보고만 하는 감사), `cancelomc`. 목표 없이 "build it" / "그냥 만들어줘"만 있으면 먼저 인터뷰합니다. 한국어와 일본어 표현도 됩니다(랄프, 울트라워크, 코드 리뷰, ラルフ, コードレビュー 등). 코드, 인용, URL, 경로 안의 언급이나 키워드에 관한 질문은 발동하지 않습니다. `ralph`는 접두어("ralph: …", "/ralph …", "ralph mode: …", "랄프: …", "ラルフ: …")로 쓰였고 그 작업에 중지어가 없을 때만 루프를 시작합니다. ralph, 군말, 정해진 중지어로만 된 짧은 프롬프트("turn off ralph", "ralph: please stop", "랄프 모드를 꺼줘", "ラルフを止めてください")는 루프를 취소합니다. 그 밖에 ralph를 언급하면 모델이 판단하라는 메모만 붙습니다(시작, `mis loop cancel`로 취소, 무시). 키워드는 `~/.make-it-ship/config.json`의 `keywords.disabled`로 끌 수 있고, `mis test-prompt "<text>"`로 프롬프트를 시험할 수 있습니다.
- **지속 루프:** `/make-it-ship:loop`(`mis loop start|status|cancel`). 루프를 시작한 세션만 붙잡습니다. 그 세션은 루프 시작 뒤 보고된 run의 판정이 VERIFIED이거나, run이 BLOCKED이거나 승인을 기다리거나, 반복 상한에 닿거나, 계속을 세 번 해도 진척이 없을 때까지 멈출 수 없습니다. `mis cancel`로도 끝납니다.
- **동결:** `mis freeze <dir>`은 현재 저장소에서 한 디렉터리 밖의 수정을 막습니다(다른 저장소는 영향 없음, 심볼릭 링크는 따라감). `mis unfreeze`로 풉니다.
- **도구 호출 뒤:** 해당하는 `.cursor/rules`와 `.github/instructions` 파일을 세션당 한 번 보여 주고(`.claude/rules`는 Claude Code가 이미 읽음), 수정이 많으면 테스트를 돌리라고 알리며, 같은 호출이 세 번 실패하면 근본 원인 힌트를 줍니다.
- **상태 표시줄:** `MIS ▸ idle · style full · frozen src · agents 2 (1 stale) · todo 1/3 · main · <model> · ctx ████░░░░░░ 42% · 5h ██░░░░░░░░ 24% (3h42m) · 7d ████░░░░░░ 41% (2d5h)`(agents는 이 세션에서 실행 중인 서브에이전트, 5분이 지나면 stale. todo는 할 일 목록에서. 5h/7d는 Pro/Max 요금제 사용량과 리셋까지 남은 시간으로, Claude Code가 값을 줄 때만 표시. 막대는 70%부터 노랑, 85%부터 빨강. `NO_COLOR`가 설정되면 색 없이 출력), run이 있으면 run 진행 상황을 보여 줍니다(`mis init`의 `hud.statusLine`으로 등록). 쓰던 상태 표시줄을 유지하려면 그 명령을 `~/.make-it-ship/config.json`의 `statusLine.chain`에 넣으세요. 그 첫 줄이 ` | ` 뒤에 붙습니다.
- **세션 간 기억:** 서브에이전트 결과나 마지막 답변의 `<remember>…</remember>`는 7일, `<remember priority>…</remember>`는 영구히 보관합니다. 우선 메모, 프로젝트 지시, 위키 색인은 세션 시작과 컴팩션 뒤에 다시 넣습니다.
- **서브에이전트:** 서브에이전트가 멈출 때 만들었다거나 썼다고 한 파일이 없으면, 한 번 더 이어서 파일을 만들거나 보고를 고치게 합니다. Agent 호출 전에는 기대하는 파일 이름을 밝히라고, 4개 이상 실행 중이면 기다리라고 알립니다. `git commit` 전에는 남은 할 일을 알립니다.
- **묻지 않는 읽기 전용 Bash:** 단순한 읽기 전용 명령 하나(`ls`, `cat`, `grep`, `rg`, `-exec`/`-delete` 없는 `find`, `git status|log|diff|show|branch` 등)는 권한 프롬프트에서 자동 허용됩니다. 단, guard가 허용하고, 사용자의 `permissions.ask` 규칙에 걸리지 않으며, 명령이 가리키는 모든 경로가 저장소 안에 있고(심볼릭 링크 해석 후), 비밀 파일처럼 보이는 것(`.env*`, `*.pem`, `*.key`, `id_*`, `.ssh`, `.aws`, `.netrc`, `credentials`, 키체인 등)이 없을 때만입니다. 파이프, 리다이렉트, `$`, heredoc, `;`/`&&`, 래퍼(`sudo`, `env`, `xargs`, `sh -c`)는 항상 일반 프롬프트를 거칩니다.
- **종료 전 점검:** run이 EXECUTING일 때 코드를 고친 세션은 멈추기 전에 `mis check`를 돌리라는 요청을 받습니다(최대 두 번). `mis config set simplifier.enabled true`로 켜면(`simplifier.maxFiles`, 기본 10) 수정한 파일 묶음마다 한 번 `code-simplifier` 패스를 권합니다. 활성 루프가 먼저 판단하고, 그다음 check 알림, 그다음 simplifier 순입니다.
- **디버그 범위:** `mis debug scope <file|dir…>`를 쓰면 가설에 해당하는 파일 밖을 고치기 전에 guard가 묻습니다(`--clear`로 해제). debug 단계는 근본 원인을 찾으면 이 범위를 설정합니다.
- **세션 기록:** 세션이 끝나면 요약(수정한 파일, 남은 할 일, run, 가장 많이 읽은 파일)을 `.git/make-it-ship/session-summaries/`에 쓰고, 많이 읽은 파일은 프로젝트 기억(`often read`)이 됩니다. 남은 할 일은 컴팩션 뒤에도 유지됩니다. 세션(종류: interactive, headless, team worker), 서브에이전트, 스킬은 프로젝트 타임라인에 남습니다: `mis timeline`, `mis timeline log <event> [k=v…]`, `trace_timeline` 도구. 오래 지킬 규칙처럼 들리는 프롬프트("항상 pnpm 써")는 프로젝트 지시로 제안하며, 사용자 없이 저장하지 않습니다.
- **관찰 기록:** Read, 편집, Bash, Agent, Skill 호출(그리고 실패한 모든 도구 호출)마다 규칙으로 만든 기록 하나(타입 change·read·test·commit·command·agent·skill·failure, 제목, 파일이나 명령 첫 줄. 파일 내용과 heredoc 본문은 저장하지 않고, 흔한 비밀값 형태는 가림. 완벽하지는 않음)를 `.git/make-it-ship/observations.jsonl`에 남깁니다. 2MB를 넘으면 오래된 절반을 지웁니다. 파일은 이 컴퓨터에만 있고, 요약이 켜져 있으면(다음 항목) 턴마다 새 기록을 한 번 더 가려서 요약기로 보냅니다. `mis memory [--last N]`으로 보고, `mis memory search <단어> [--type T] [--since 7d] [--limit N]`과 `memory_search` 도구로 찾습니다(BM25, 한국어·일본어·중국어도 됨). 끄려면 `mis config set memory.observe false`.
- **요약된 기억(claude-mem 방식):** 턴이 끝날 때마다 Stop 훅이 백그라운드에서 `claude -p`(기본 모델 `claude-haiku-4-5`, 도구·설정·MCP·세션 파일 없음)를 실행합니다. 이번 턴의 관찰 기록과, 가린 뒤 길이를 자른 마지막 요청과 답변을 넘겨서 타입(bugfix, feature, refactor, change, discovery, decision)·제목·부제·사실·서술·개념이 붙은 기록과 턴 요약(request, investigated, learned, completed, next steps)을 만들고, 관찰 기록 옆 `memories.jsonl`과 `summaries.jsonl`에 둡니다. 모델 토큰이 듭니다(턴당 수천 토큰). 파일만 읽은 턴, headless·team 세션, `mis config set memory.summarize false`일 때는 건너뜁니다(`memory.model`로 모델 선택). 처음 세션을 시작할 때 한 번 안내합니다. 새 세션(resume 제외)은 최근 기억 50개를 claude-mem 형식(Legend, 날짜별 `ID TIME TYPE TITLE` 행, 세션 행, 마지막 요약, 통계)으로 받으며 `memory.contextMaxChars`(6000) 안에 맞춥니다. 아직 요약된 것이 없으면 관찰 기록으로 대신합니다. `mis memory get <id…>`는 기록 전체를 보여 주고, 검색은 둘 다 찾습니다. 이 블록은 `memory.context false`로 끕니다. claude-mem도 설치돼 있으면 둘 중 하나를 끄세요. 그렇지 않으면 세션마다 기억 블록과 요약기가 두 벌 돕니다.
- **프로젝트 CLAUDE.md 라우팅:** `mis setup routing`은 쓸 `## Skill routing` 섹션을 보여 줍니다(기존 섹션, 예를 들어 gstack 것은 교체). `mis setup routing --write`는 guard가 물은 뒤 적용합니다.
- 사용자별 상태는 `~/.make-it-ship/`에 있습니다(`MIS_STATE_HOME`으로 바꿈). 이 훅들은 자기 오류 때문에 세션을 막지 않습니다. guard만 실패 시 닫힌 쪽으로 동작합니다.

## 설정과 유지보수
저장소 밖의 파일을 바꾸는 명령은 먼저 할 일을 출력합니다. 실행 플래그를 붙이면 guard가 묻습니다.
- `mis setup`은 `~/.claude/settings.json`(상태 표시줄. 쓰던 상태 표시줄은 `statusLine.chain`으로 유지)과 `~/.claude/CLAUDE.md`(Make It Ship 블록이 oh-my-claudecode 블록을 대체. 다른 내용은 그대로)의 diff를 보여 줍니다. CLAUDE.md와 `~/.claude/rules/`에서 대체된 플러그인을 아직 언급하는 줄도 나열하지만 고치지는 않습니다. `mis setup --write`는 diff를 적용하고 각 파일 옆에 백업을 남깁니다. `mis setup team [--write]`는 공유 저장소용 `.make-it-ship.json`과 `.gitignore` 초안을 만듭니다. 상태 표시줄이 설정되기 전까지 세션 시작 때 하루 한 번 알립니다.
- `mis doctor [--json]`은 플러그인, `hooks.json`, MCP 서버(`tools/list`), 상태 표시줄, 상태 디렉터리, PATH에 있는 코딩 에이전트를 점검합니다. `mis doctor --fix`는 옛 플러그인 경로를 가리키는 상태 표시줄, 오래된 run 잠금, 깨진 모드 상태 파일을 고칩니다. `mis doctor session`은 활성 run, 루프, 팀, 동결, merge-readiness 세션, 최근 훅 오류를 한곳에 보여 줍니다.
- `mis mcp-setup list`는 알려진 MCP 서버(context7, github, filesystem, exa)와 각각 등록된 위치를 보여 줍니다. `mis mcp-setup add <name>`은 `claude mcp add` 명령을 출력하고, `--write`를 붙이면 실행합니다.
- `mis config get [key]`와 `mis config set <key> <value>`는 `~/.make-it-ship/config.json`을 고칩니다. `mis config get`은 모든 키를 한 줄 설명과 함께 나열합니다. 모르는 키와 잘못된 값은 거부합니다. Make It Ship이 실행하거나 접속하는 값의 키(`statusLine.chain`, `update.source`, `telemetry.endpoint`)는 `sensitive`이며, `mis config set`으로 바꾸기 전에 guard가 묻습니다. guard는 저장소 밖의 다른 지속적 변경 전에도 묻습니다: 사용자 범위 스킬(`mis skill add|edit --scope user`), `mis skill trust`, `claude mcp add|remove`, `claude plugin install|uninstall|update|enable|disable|marketplace …`, 권한 프롬프트 없는 `mis launch`, 그리고 `~/.claude/settings*.json`, `~/.claude/CLAUDE.md`, `~/.claude.json`, 모든 `.claude/settings*.json`, 저장소 밖의 CLAUDE.md, `~/.make-it-ship/config.json`이나 `skills/`에 쓰는 일. `mis version`은 플러그인 버전, Node 버전, 커밋을 출력합니다.
- 업데이트: 새 버전이 있으면 세션 시작 때 한 줄로 알립니다. 결과는 24시간 캐시합니다. 오래된 캐시는 백그라운드에서 갱신하므로 세션 시작이 네트워크를 기다리지 않습니다. 확인은 플러그인 자신의 마켓플레이스 사본이나 git 원격만 읽고, 저장소 데이터는 보내지 않으며, 실패해도 조용합니다. `mis config set update.check false`로 끕니다. `mis update-check [--force]`는 바로 확인합니다. `mis upgrade`는 업데이트 명령을 출력하고, `mis upgrade --yes`는 실행합니다.
- 정리: 하루 한 번 세션 시작 때 `maintenance.retainDays`(기본 90, 0이면 끔)보다 오래된 끝난 run, 종료된 팀, 죽은 브라우저 상태를 지웁니다. 활성 run과 루프는 지우지 않습니다. `.make-it-ship.json`이 잘못되었으면 세션 시작 때 한 줄로 경고합니다.
- `mis cancel --all`은 루프, 팀, merge-readiness 세션을 끝냅니다. run은 `--run`을 붙여야만 취소합니다. `mis launch [claude args]`는 새 tmux 세션에서 Claude Code를 시작하고 접속 명령을 출력합니다.
- `mis uninstall`은 지울 것을 나열합니다: `~/.make-it-ship`, 상태 표시줄 항목, CLAUDE.md 블록, 실행 중인 브라우저와 팀 프로세스. `mis uninstall --yes`가 지웁니다. `.git/make-it-ship`의 run 기록은 `--purge-runs`가 있을 때만 지웁니다. 그다음 `claude plugin uninstall make-it-ship`을 실행하세요.
- `/make-it-ship:setup`은 설치, 점검, MCP, 업데이트, 제거 요청을 알맞은 명령으로 보냅니다.
- 도움말과 참조: `mis help [topic]`은 모든 `mis` 명령(그룹별), 스킬, 에이전트, 키워드(ralph 접두어 규칙 포함), 스타일 수준, MCP 도구, 훅을 나열합니다. topic은 `commands`, `skills`, `agents`, `keywords`, `styles`, `mcp`, `hooks`입니다. 목록은 코드에서 읽으므로 낡지 않습니다. `/make-it-ship:help`가 이를 보여 주고, `/make-it-ship:reference`는 위임이나 커밋 전에 읽는 에이전트·도구·키워드 참조입니다.
- `mis info`는 플러그인 버전, Node 버전, 커밋, 명령과 스킬 수, 에이전트, 도구 레지스트리 기준 MCP 도구 수, 훅 이벤트를 출력합니다.
- `mis capabilities`는 현재 명령, 스킬, 에이전트, MCP 도구, 훅 이벤트를 저장소의 `.make-it-ship/capabilities.lock.json`과 비교합니다. `mis capabilities --write`는 기록하고, `mis capabilities --check`는 달라졌을 때 추가·삭제된 것을 나열하고 1로 종료합니다. 이 저장소는 잠금 파일을 커밋하고 테스트가 이를 확인합니다. 이 네 명령이 쓰는 파일은 이 잠금 파일뿐입니다.
- `mis gain [--json]`은 이 저장소에서 잰 결과만 보여 줍니다: run 판정 수, check 통과율(전체와 check별), 나중에 고친 실패, 기준 대비 `mis bench` 중앙값, shortcut 부채. 절감 효과를 추정하지는 않습니다. `evals/benchmarks/*.json`에 결과가 없으면 원래 플러그인과의 비교는 `BLOCKED: no benchmark results`를 출력합니다. M10 비교 도구(`evals/m10/run.mjs`)는 결과를 `evals/m10/`에 따로 둡니다.

## 팀과 세션
- **팀 파이프라인:** `/make-it-ship:team [N[:claude|codex|gemini]] <task>`는 일반 run 위에서 plan → exec → verify → fix(최대 3회)를 돌립니다. 그래서 승인, `mis check`, `mis verdict`가 여전히 결정합니다. 명시적으로 요청할 때만 동작하며, 프롬프트에 "team"이라는 말이 있다고 발동하지 않습니다.
- **tmux 작업자:** `mis team start <N> "<task>" [--tasks <json|->] [--worker claude|codex|gemini]`는 N개 창이 있는 tmux 세션을 엽니다. 각 창은 자기 worktree와 브랜치(`mis/team/<id>/wN`)에서 공유 파일 작업 목록의 작업을 가져가며(원자적, 중복 없음), 작업자마다 하트비트와 로그가 있습니다. `mis team status`, `mis team wait [--timeout s]`, `mis team shutdown`(창을 닫고 깨끗한 worktree를 지우며, 브랜치와 커밋 안 된 작업이 있는 worktree는 남김). Claude 작업자는 이 플러그인을 켠 `claude -p`로 돌며(guard와 훅 활성, run이 없어도 run 수준 guard 규칙 적용), Bash와 파일 도구는 미리 허용되고 `git push`, `gh pr`/`gh release`, 패키지 설치는 막힙니다. 그 밖의 guard 질문은 print 모드에서 답할 사람이 없으므로 통과하리라 기대하지 마세요. codex/gemini 작업자는 코드를 외부 서비스로 보내므로 guard가 먼저 묻습니다. tmux가 없으면 BLOCKED를 보고합니다.
- **세션(psm):** `/make-it-ship:session`, `mis session create issue <n> | pr <n> | feature "<name>" [--base <ref>] [--tmux]`, `mis session list`, `mis session remove <name>`. 각각 `.worktrees/` 아래 자기 worktree를 얻습니다(`fix/<n>`, `pull/<n>/head`에서 가져온 `pr-<n>-review`, `feature/<slug>`). worktree에 커밋 안 된 변경이 있으면 remove는 거부하며, 브랜치는 남깁니다.
- **시각 보조 화면:** `mis companion start [dir]`은 HTML 시안과 다이어그램(기본 `design/`)을 127.0.0.1에서 제공합니다. 페이지 색인, 실시간 새로고침, 클릭할 수 있는 `data-choice` 선택지가 있습니다(`mis companion status`가 클릭을 나열). `mis companion stop`으로 멈춥니다. URL에는 접근 키가 들어 있습니다. 질문이 시각적이면 디자인 단계가 이 화면을 제안합니다.

## 에이전트
`agents/`의 서브에이전트는 각자 역할에 맞는 가장 좁은 도구 허용 목록을 가집니다(중첩 에이전트 없음, MCP 없음). 모두 저장소 내용을 신뢰할 수 없는 것으로 다루고, 실제 명령 출력 없이 끝났다고 하지 않으며(run 안에서는 `mis check` 결과와 `mis verdict`만 인정), 어느 것도 push하지 않습니다.
- **읽기 전용** (`Read, Grep, Glob, Bash`): `explorer`, `analyst`(수용 기준, 빈틈, 질문), `planner`(텍스트 작업 계획), `tracer`(증거를 갖춘 경쟁 가설), `architect`, `critic`, `spec-reviewer`, `quality-reviewer`, `security-reviewer`, `product-reviewer`, `qa-tester`(시나리오. `mis tty`로 대화형 CLI를 조작하고 `qa/`에 재생 스크립트만 남김). `document-specialist`는 공식 문서를 위해 `WebFetch, WebSearch`를 더하며, 저장소 코드를 검색어에 넣지 않습니다.
- **git 전용** (`Read, Grep, Glob, Bash`): `git-master`(저장소 스타일에 맞춘 원자적 커밋, 기록 조사. push 안 함, 공유된 기록 재작성 안 함).
- **분석** (`Read, Grep, Glob, Bash` + `python_repl` 도구): `scientist`(연구 단계 하나, `[FINDING]/[EVIDENCE]/[CONFIDENCE]` 태그로 결과 보고).
- **작성자** (`Read, Write, Edit, Grep, Glob, Bash`): `implementer`(자기 worktree에서 run 작업 하나), `executor`(run 밖의 변경 하나), `debugger`(근본 원인 먼저, 회귀 테스트), `designer`(모든 상태와 렌더링 증거를 갖춘 UI), `test-engineer`(전략, 빠진 테스트, 불안정한 테스트 보강), `code-simplifier`(같은 동작, 더 적은 코드, 전후 테스트), `writer`(명령을 실제로 실행해 본 문서).

## 대화형 CLI QA
`mis tty start <name> -- <command…>`는 프로그램을 tmux 세션에서 실행합니다(tmux가 없으면 BLOCKED). `mis tty send <name> <text>`, `mis tty keys <name> C-c`, `mis tty expect <name> <regex> [--timeout ms]`(마지막 입력 뒤의 출력만 셈), `mis tty capture <name>`, `mis tty stop <name>`. `mis tty save <name> qa/<file>.sh`는 성공한 단계를 재생 스크립트로 쓰며, 기대한 출력이 나오지 않으면 실패합니다. 이 스크립트를 `qa-*` check로 등록하세요.

## 스킬 작성
학습한 스킬은 `name`, `description`, 한 줄짜리 `triggers: [..]`를 가진 `SKILL.md` 파일입니다. 프롬프트에 트리거 문구가 있으면 프롬프트 라우터가 해당 스킬을 제안합니다. 프로젝트용(`.make-it-ship/skills/<name>/`) 또는 사용자 전체용(`~/.make-it-ship/skills/<name>/`)으로 둡니다. 플러그인 자체의 `skills/`에는 쓰지 않습니다. 같은 이름의 스킬은 한 번만 제안합니다(프로젝트 것이 우선). 프로젝트 스킬은 저장소에서 왔으므로, 그 저장소에서 `mis skill trust`를 실행하기 전까지(guard가 물음) 신뢰할 수 없는 저장소 내용으로 표시합니다. 사용자 스킬은 지시로 제안합니다.
- `/make-it-ship:skill` — `mis skill list | search <text> | add <file|-> [--scope project|user] | edit <name> [<file|->] | remove <name> | lint [<name>]`. `add`와 `edit`은 먼저 lint하고, 오류가 있으면 아무것도 쓰지 않습니다.
- `/make-it-ship:skillify`("learner"로도 호출) — 세션에서 반복되는 작업 흐름이나 어렵게 얻은 해결책을 스킬 초안으로 만들고 `mis skill add`로 저장합니다.
- `/make-it-ship:writing-skills` — 테스트 먼저 작성: `mis skill test <name> <scenarios.json>`은 각 시나리오를 새 서브에이전트에서 스킬 없이 한 번, 스킬과 함께 한 번 실행합니다(기본은 빈 디렉터리에서 `claude -p --safe-mode --tools Read,Grep,Glob`. `MIS_SKILL_TEST_CMD`로 교체). 모든 시나리오가 스킬 없이 실패하고 스킬과 함께 통과할 때만 GREEN을 보고합니다. `mis skill graphs <name>`은 ```dot 흐름도를 graphviz로 그립니다.

## 도구 (번들 MCP 서버 `mis`)
플러그인이 MCP 서버(`.mcp.json`)를 함께 제공하므로 이 도구들은 `mcp__plugin_make-it-ship_mis__<name>`으로 나타납니다.
- **기억:** `notepad_*`(priority / working 7일 / manual), `project_memory_*`(스택, 명령, 메모, 지시), `state_*`(모드 상태. run, 루프, 스타일, 동결은 실시간 읽기 전용으로 표시), `shared_memory_*`(에이전트용 TTL 있는 네임스페이스 키/값). `.git/make-it-ship/memory/`에 저장되며 커밋되지 않습니다.
- **지식:** `wiki_*`(`.make-it-ship/wiki/`의 페이지, 기본적으로 git에서 무시. 커밋하려면 그 `.gitignore`를 지우세요), `memory_search`(이 프로젝트의 관찰 기록, 아래 참고), `session_search`(이 프로젝트의 지난 Claude Code 세션, 읽기 전용), `trace_timeline` / `trace_summary`(run 이벤트와 훅 활동), `deepinit_manifest`, `merge_readiness_*`(병합 전 run의 증거로 이해도를 확인하는 세션).
- **코드:** `lsp_*`(hover, 정의, 참조, 심볼, 진단, 이름 바꾸기, 코드 액션. 이미 설치된 언어 서버 사용: typescript-language-server, pyright/pylsp, gopls, rust-analyzer, clangd, sourcekit-lsp), `ast_grep_search` / `ast_grep_replace`(`ast-grep` CLI 필요), `python_repl`(지속되는 `python3`. Bash에서 python을 실행하는 것과 권한 범위가 같은 일반 Python). 실행 파일이 없으면 결과 대신 설치 힌트를 돌려줍니다.
- **스킬:** `list_skills`, `load_skills_local`, `load_skills_global`(관리와 작성은 "스킬 작성" 참고).
- `ast_grep_replace`와 `lsp_rename`은 `apply: true`일 때만 파일을 바꿉니다. run이 활성일 때는 이들(과 `lsp_code_action_resolve`)이 파일을 다시 쓰기 전에 guard가 묻고, 동결도 적용됩니다.
- 참고: `--strict-mcp-config`로 시작하면 Claude Code가 플러그인의 MCP 서버를 불러오지 않습니다.

## 브라우저 (내장, Playwright 불필요)
`mis browse <command>`는 이미 설치된 Chrome, Chromium, Edge를 DevTools Protocol로 헤드리스 실행해 조작합니다. 설치하는 것은 없습니다. worktree마다 데몬이 하나 돌며, 상태는 `.git/make-it-ship/browse/`(저장소 밖이면 `~/.make-it-ship/browse/`)에 있습니다. 첫 명령에서 시작하고 30분 동안 쓰지 않으면 멈춥니다. 브라우저를 찾지 못하면 명령이 `BLOCKED`를 출력합니다.
- **명령:** `goto`, `snapshot -i`(`click`/`fill` 등에 쓰는 `@e` 참조. `-C`는 클릭 가능한 div용 `@c` 참조 추가, `-H`는 참조 색상 히트맵), `text`, `media`, `inspect`(CSS 캐스케이드와 박스 모델), `ux-audit`(페이지 구조 JSON), `console --errors`, `network`, `perf`, `memory`, `screenshot`, `prettyscreenshot`, `style`/`style --undo`, `cleanup`(광고, 쿠키 배너, 고정 바), `responsive`, `pdf`, `diff`, 탭과 프레임(`tab-each`는 모든 탭에서 명령 하나 실행), `chain`, `watch`, `handoff`/`resume`(CAPTCHA나 MFA용으로 창을 띄운 뒤 쿠키를 유지한 채 헤드리스로 복귀). 전체 목록은 `mis browse`로, 설명은 `skills/browse/SKILL.md`를 보세요.
- **guard:** `storage`, `js`, `eval`은 로컬 페이지(localhost, `file:`)에서는 자유롭게 실행합니다. 로컬 여부는 브라우저가 페이지에 준 출처로 판단합니다(실제 사이트가 만든 `blob:` 페이지나 팝업은 그 사이트로 취급, `about:blank`/`data:` 페이지는 로컬이 아님). 실제 사이트에서는 `--remote`가 필요하고 guard가 묻습니다. `MIS_BROWSE_CHROME_ARGS`는 화면, 언어, 렌더링 관련 허용 목록 플래그만 받습니다(이름을 루프백으로 매핑하거나 로컬이 아닌 이름을 매핑하는 `--host-resolver-rules` 포함). 그 밖의 것은 거부합니다. `mis browse` 명령에 이 변수나 `MIS_BROWSER`, `MIS_BROWSER_EXE`를 설정하면(따옴표, 이스케이프, export, `set -a` 포함) guard가 묻습니다. 원시 `mis browse cdp`는 항상 묻습니다. Chrome은 파이프로 조작하므로 다른 로컬 프로그램에 열린 DevTools 포트가 없습니다.
- **로컬 전용 브라우저와 업로드:** 페이지 스크립트는 첨부된 파일을 폼이 보내는 곳뿐 아니라 어디로든 보낼 수 있습니다(Service/Shared Worker, 다른 페이지, unload 비콘, WebSocket, WebRTC). 그래서 `--remote` 없는 `upload`는 로컬 전용 브라우저에서만 실행합니다. `mis browse start --local-only`는 이 기기(localhost, `*.localhost`, `127.0.0.1`, `[::1]`) 말고는 아무 곳에도 닿지 않도록 Chrome을 시작합니다. 다른 트래픽은 모두 버리는 프록시로 가고, 다른 이름은 해석되지 않으며, WebRTC는 UDP를 보낼 수 없습니다. 일반 브라우저에서 `upload`는 항상 묻고 `--remote`가 필요합니다(guard가 물음. 파일이 기기 밖으로 나갈 수 있음). 모드는 `mis browse status`(`localOnly`)에 나오며, 바꾸면 브라우저가 재시작합니다(`start` / `start --local-only`. `restart`는 모드 유지). 로컬 전용 모드에서는 `connect`를 쓸 수 없습니다. 두 번째 방어선으로, 실제 사이트로 전송하는 로컬 페이지의 폼은 거부되고, 페이지가 `--remote` 없이 첨부한 파일을 갖고 있는 동안 그 페이지의 비로컬 호스트 요청은 브라우저가 막습니다.
- **자격 증명은 항상 묻습니다**(run 유무와 상관없이, 셸 함수, `sh -c`, `mis tty`, 인라인 `chain`과 `tab-each`를 거쳐도): `cookies`, `cookie`, `cookie-import <file.json>`, `cookie-import-browser`, `header`, `useragent`, `connect`, `state save|load`, `download`, `scrape`, `archive`. guard가 볼 수 없으므로 데몬은 `chain` 파일, `tab-each`, 브라우저 스킬 안에서 이들을 거부하고, CLI는 `mis check` 스크립트 안에서 거부합니다. `--remote`로도 풀리지 않습니다.
  - `cookie-import-browser [chrome|chromium|edge|brave|arc] --domain <host>`는 사용자 자신의 브라우저 쿠키 저장소를 지정한 사이트에 한해 복호화합니다(macOS: "Chrome Safe Storage" 키체인 항목, macOS가 허용을 물음. Linux: 내장 키 또는 Secret Service). `--domain` 없이는 도메인만 나열하고 아무것도 복호화하지 않습니다. 값은 출력하지 않습니다. 저장소는 비공개 임시 디렉터리에 복사해 읽은 뒤 지웁니다. Windows는 지원하지 않습니다(Chrome 127+가 키를 Chrome 자체에 묶음).
  - `connect [--profile-dir d]`는 Make It Ship 사이드 패널(`extension/`: 에이전트에게 남기는 메모와 요소 선택기, `mis browse inbox`로 읽음)이 있는 영구 프로필(기본 `~/.make-it-ship/chrome-profile`)로 보이는 Chrome을 엽니다. 실행 중인 Chrome이나 기본 프로필에는 붙지 않습니다. Chrome 136+는 그곳에서 DevTools를 거부하고, 사용 중인 프로필은 거부합니다. `disconnect`는 헤드리스로 돌아가며, 프로필은 지우지 않습니다. `mis browse extension`은 수동 설치 방법을 설명합니다.
  - `state save|load <name>`은 쿠키와 열린 페이지를 worktree의 browse 상태 디렉터리에 보관합니다(권한 0600).
- **브라우저 스킬:** `mis browse skillify <name>`은 마지막으로 성공한 흐름(마지막 `goto`부터)을 `.make-it-ship/browser-skills/<name>/`로 저장합니다(lint를 통과한 SKILL.md와 `steps.json`. `--global`이면 `~/.make-it-ship/`). 입력한 값은 `--arg inputN=` 매개변수가 되며 저장하지 않습니다. `skill list|show|run|test|rm`으로 재생합니다. `domain-skill save|list|show|edit|promote-to-global|rollback|rm`은 사이트별 메모를 관리합니다. 저장하면 격리 상태이고, 세 번 읽으면 활성, 그다음 `~/.make-it-ship/domain-skills/`로 올릴 수 있습니다. 프롬프트 인젝션처럼 보이는 메모는 격리 상태로 남고 `show`가 이유를 알려 줍니다.
- `mis open-url <url|file.html>`은 기본 브라우저로 페이지를 엽니다(`open`/`xdg-open`. http(s)와 로컬 .html만).
- `mis pdf <file.md> [-o out.pdf]`는 마크다운으로 인쇄용 PDF를 만듭니다(```mermaid 블록은 SVG로, `--allow-network`가 없으면 원격 이미지 차단).
- `mis visual-verdict <shot.png> <ref.png>`는 두 스크린샷을 픽셀 단위로 비교합니다. 페이지 내용 기준 0~100 점수(공통 배경은 세지 않음. 90 미만이면 1로 종료)와 차이 이미지를 JSON으로 냅니다. 점수는 보조 수단이며, 스킬은 모델이 두 이미지를 직접 보고 판단하게 합니다.
- 프로젝트에 Playwright가 없으면 웹 QA(`/make-it-ship:qa`)가 이 브라우저를 씁니다. 보고만 하는 QA, 실시간 스크린샷을 쓰는 디자인 리뷰 루프, 페이지 벤치마크가 여기에 해당합니다.
- 포함하지 않은 것: 사이드 패널의 터미널(gstack은 확장 프로그램에서 셸을 돌림. 여기서는 Claude Code 자체 터미널 사용), 이미 실행 중인 Chrome이나 기본 프로필에 붙기, DevTools TCP 포트 모드(`chrome-cdp`), gstack의 Playwright 스크립트 브라우저 스킬(여기 것은 `mis browse` 단계만 재생하고 코드를 실행하지 않음), 도메인 스킬용 프롬프트 인젝션 분류기(대신 격리된 메모를 "데이터로 다룰 것" 경고와 함께 표시).

## 연구, 배포, 기기, 외부 서비스
이 기기 밖으로 데이터를 보내는 명령은 run 유무와 상관없이 항상 먼저 묻고, 해당 스킬은 **회사 정책상 금지될 수 있다**고 안내합니다. 텔레메트리는 기본으로 꺼져 있습니다.
- **연구:** `/make-it-ship:research` — `mis research`(태그된 증거와 한계를 갖춘 병렬 scientist 단계), `mis autoresearch init|start|eval|status|stop`(미션 하나, 평가기는 `{"pass": bool, "score"?: n}`을 출력해야 함, 최대 실행 시간이나 반복 횟수에서 멈춤, 결정 기록), `mis self-improve propose|tournament|list|show|reject`(프로세스와 스킬 파일만. `mis approve proposal <id>`로만 적용하며 항상 물음). `/make-it-ship:writer-memory` — `mis writer-memory` 스토리 바이블.
- **다른 모델(물음):** `/make-it-ship:ask` — `mis ask codex|gemini|claude "<q>"`(`.make-it-ship/ask/second-opinion-*.md`에 쓰며 판정은 바꾸지 않음), `mis ccg`, `mis benchmark-models`, `mis interop`(tmux에서 Claude+Codex). `mis second-opinion probe`는 아무것도 보내지 않고 버전과 로그인 상태만 보여 줍니다.
- **배포와 운영:** `/make-it-ship:deploy` — `mis deploy setup [--write]`, `mis deploy run [--auto-revert]`(VERSION 불일치 확인, CI 대기, 병합, 배포, 상태 확인, 선택적 롤백), `mis canary <url> [--discover]`(상태, 콘솔 오류, 기준 대비 로드 시간, 스크린샷)(모두 물음). `/make-it-ship:ops` — `mis mission-board`와 `mis landing-report`(읽기 전용 스냅숏), `mis wait detect|auto [--watch]`(사용량 한도에서 멈춘 tmux 창을 찾아 한도가 풀리면 재개. `mis detach` 아래의 `--watch`는 미리 걸어 둠) 또는 `mis wait --until <time> -- <resume cmd>`, `mis detach [--lock name] -- <cmd>`(SIGTERM에도 살아남음, 기기 전체 잠금, macOS에서 caffeinate, 로그에 EXIT 표식).
- **Android 기기와 에뮬레이터:** `/make-it-ship:android` — 연결된 폰이 없으면 실기기 QA는 BLOCKED(에뮬레이터 결과는 실기기 검증이 아님). `mis android avds|boot|ui|shot|tap|type|key|launch|install`, `mis android daemon start [--tailnet]`(고정 API의 루프백 중계. tailnet은 묻고 `mis android mint <agent>` 토큰이 필요).
- **iOS 기기:** `/make-it-ship:ios` — 연결된 기기가 없으면 BLOCKED. `mis ios sync [--apply]`(템플릿 diff, apply는 물음), `mis ios daemon start --target <bridge url> [--tailnet]`(루프백 중계. tailnet은 묻고 `mis ios mint <agent>` 토큰이 필요).
- **텔레메트리:** `/make-it-ship:telemetry` — `mis telemetry on|off|status|log`, `mis analytics`(로컬 JSONL만). `mis telemetry sync`와 `dashboard`는 사용자가 정한 엔드포인트로 보내며 묻습니다.
- **gbrain(물음):** `/make-it-ship:gbrain` — 사용자 자신의 `gbrain` CLI를 쓰는 핵심 흐름(없으면 BLOCKED): detect, init, policy, 비공개 산출물 저장소로 enqueue/sync, ingest `--probe`, query, restore, uninstall. Supabase 프로비저닝, 원격 MCP 점검, brain 캐시/소비자는 포함하지 않습니다.
- **디자인 이미지(물음):** `/make-it-ship:design-images` — 사용자의 OpenAI 키로 `mis design generate|variants|iterate|evolve`(없으면 BLOCKED), `compare`(정적 보드), `gallery`. 결과는 `design/variants/`에 둡니다.
- **페어 에이전트(물음):** `/make-it-ship:pair-agent` — `mis pair-agent start [--local]`은 다른 에이전트에게 내장 브라우저에 대한 토큰 접근을 줍니다(`--local`이 아니면 ngrok 터널). `stop`으로 닫습니다.
