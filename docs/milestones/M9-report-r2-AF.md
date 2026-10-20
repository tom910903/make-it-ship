ROUND2-AF: FAIL

# M9 독립 검증 2차 — A·B·C·F 묶음

- 검증 대상: 워크트리 `make-it-ship-m9`, 브랜치 `m9-wip`, HEAD `354fc7d`. 수정 커밋은 `m9-fix2`의 `dd328a5`, `b9df3ad`다.
- 검증자: 독립 검증자. 이 코드를 쓰지 않았다.
- 일시: 2026-10-21
- 격리 환경:
  - 모든 실행에서 `HOME`과 `MIS_STATE_HOME`을 scratch 경로로 지정했다. 실제 `~/.claude`와 `~/.make-it-ship`은 건드리지 않았다.
  - 실제 모델 CLI는 호출하지 않았다. 외부 네트워크도 사용하지 않았다.
  - 고정 포트와 공유 임시 이름은 쓰지 않았다. TMPDIR은 내 전용 경로를 썼다.
- 적용한 결정:
  - r1 D6은 그대로 수용한다.
  - `node -e`·`python -c` 스크립트 내부는 위협 모델 밖이다(RISKS).
  - `mis tty keys`가 `echo … > file`을 만들 때는 직접 실행할 때와 같은 판정을 받는다(저장소 안이면 allow). 이것만으로는 결함이 아니다.
- 판정 근거:
  - r1 결함 D1~D5, D7~D13과 계획 범위 메모는 보고된 재현 그대로는 모두 고쳐졌다.
  - 그러나 새 MEDIUM 결함 D1이 있다. shell 파서가 따옴표 안의 `'>'`를 리다이렉트로 취급한다. 그래서 guard가 바로 뒤의 단어를 인자로 보지 못한다.
  - 그 결과 `mis uninstall '>' --yes`가 ask 없이 실행되어 상태 홈을 지웠다. 같은 방식으로 `setup routing '>' --write`는 CLAUDE.md를 썼다.
  - 이 방식은 r1 D1/D2/D10 수정과 M9-A의 "저장소 밖 변경은 항상 ask" 규칙을 모두 무력화한다.
  - 그래서 FAIL로 판정한다.

## 실행한 명령과 결과

| # | 명령 / 시나리오 | 결과 |
|---|---|---|
| 1 | `npm test` 1회차 (HOME·MIS_STATE_HOME·**CLAUDE_CONFIG_DIR**·TMPDIR 모두 scratch) | 705개 중 703 pass, **2 fail**: 201 doctor duplicate-plugin, 615 M9 fix1 D6. 둘 다 환경 때문이다 (D7 참고) |
| 2 | `npm test` 2회차 (1회차와 같은 환경, D/E 검증자와 동시 실행) | 705개 중 702 pass, **3 fail**: 201, 615, 247 (`mis-pair.test.mjs:53`, `fetch failed`). 247은 D/E 범위이고 부하 상태에서 실패했다 |
| 3 | `npm test` 3회차 (`CLAUDE_CONFIG_DIR` 해제, TMPDIR을 짧은 전용 경로 `/private/tmp/claude-501/m9v2af-dr3E`로) | **705/705 pass**, fail 0, skip 0, todo 0 (186 s) |
| 4 | `npm test` 4회차 (3회차와 같은 환경) | **705/705 pass**, fail 0, skip 0, todo 0 (201 s) |
| 5 | `claude plugin validate .` | ✔ Validation passed |
| 6 | r1 D1 재현: `config set statusLine.chain`, `update.source`, `telemetry.endpoint`, 그리고 `skill add/edit --scope user`, `skill trust`, `claude mcp add`, `claude mcp add-json`, `claude plugin uninstall`, `claude plugin marketplace add`, `telemetry endpoint` | 모두 **ask**다. 키 표기를 바꿔도(따옴표, 대소문자, `--`, 변수) ask다. `env`·`bash -c`·절대경로 claude 형태도 ask다 (고침) |
| 7 | r1 D2 재현: `tty keys sh 'rm -rf ~' Enter`, `tty keys sh 'node …/mis.mjs uninstall --yes' Enter` | 둘 다 **ask**다. 글자를 나눠 입력하거나 `C-m`·`C-j`·`KPEnter`·`M-Enter`를 쓰거나 Enter를 빼도 ask다. `-l` 같은 옵션 단어도 ask다 (고침). 예외는 D1이다 |
| 8 | r1 D3 재현: PermissionRequest 명령 75종 | `cat ~/.ssh/id_rsa`, `cat .env`는 결정하지 않는다. 다음 경로도 모두 결정하지 않는다: 심볼릭 링크(`innocent.txt`→id_rsa, `keys/`→~/.ssh), `..`, 글롭(`.e*`·`.en?`·`[.]env`), `.ENV`, `$HOME`, `~root`, `git show HEAD:.env`, `git diff --no-index`, `git -C ~`, `grep -f .env`, `find ~`. 저장소 안의 일반 읽기(`cat src/a.js`, `git status/diff/log`, `ls`)는 allow다 (고침) |
| 9 | r1 D4 재현: `config set simplifier.enabled true`, `proactive false`, `simplifier.maxFiles 3` | exit 0이다. `config get`에 키별 설명이 있다. 끝까지 따라가 확인했다: 켜면 Edit 뒤 Stop이 1회 block하고, 재진입 Stop은 통과하고, 끄면 block하지 않는다. `proactive false`이면 SessionStart의 `Next step:` 줄이 사라진다 (고침) |
| 10 | r1 D5 재현: `{"cwd":123}` SubagentStop 실행, 그리고 trace에 `cwd:5`·`[1]`·`null` 줄을 넣은 뒤 `mis doctor session` | exit 0이고 `malformedTraceEntries: 3`이 나온다 (고침) |
| 11 | r1 D7 재현: `/tmp`에서 SessionStart·UserPromptSubmit·PostToolUse(Read /etc/hosts)·Stop·SubagentStart·PreCompact·SessionEnd·PermissionRequest·guard·statusline | 모두 stderr가 0바이트다 (고침) |
| 12 | r1 D8 재현 (Write와 Bash): `~/.claude/settings.json`, `settings.local.json`, `CLAUDE.md`, `~/.claude.json`, MIS `config.json`·`skills/`·`trusted-repos.json`, 다른 저장소의 `CLAUDE.md`·`.claude/settings.local.json` | 모두 **ask**다. `~`·`$HOME`·`${HOME}`·절대경로 형태, `..`, 저장소 안 심볼릭 링크, `bash -c`·`sh -c`·`eval`·`env`·`xargs`, 함수, `cd` 뒤 상대경로, `tee`·`sed -i`·`perl -i`·`dd of=`·`truncate`·`install`·`ln`·`rsync`·`cp -t` 형태도 ask다 (고침). 빠진 형태는 D2 |
| 13 | r1 D9 재현: `nodejs`, `bun`, `bun run`, `deno run -A`, `deno`, `/opt/homebrew/bin/bun`, `xargs node`, `xargs -n9 nodejs`, `time`·`nice`·`nohup`·`command`·`exec`·`timeout`·`sudo` 래퍼 | 모두 ask다 (고침) |
| 14 | r1 D10 재현: `launch --dangerously-skip-permissions`, `--permission-mode bypassPermissions`, `=bypassPermissions`, `-- --dangerously-skip-permissions` | ask다 (고침). 빠진 형태는 D3 |
| 15 | r1 D11 재현: `mis diagram design/f.mmd` 다음 `mis design-board design` | variants는 `v1.html`, `v2.html`이다. `f.html`은 들어가지 않는다 (고침) |
| 16 | r1 D12 재현: `MIS_BLOCK`의 CLI 줄 | 절대경로 `…/make-it-ship-m9/scripts/mis.mjs`다 (고침) |
| 17 | r1 D13 재현: project와 user에 같은 이름 스킬, 믿지 않는 저장소 스킬, `skill trust`/`--remove`, 심볼릭 링크 경로로 trust | 1건만 주입된다. trust 전에는 `repository skill … untrusted`로, trust 후에는 `learned skill … follow it`으로 주입된다. 설명의 줄바꿈 주입은 한 줄로 평탄화된다. 심볼릭 링크 경로로 trust해도 실제 경로에 적용된다 (고침). MCP 경로의 빈틈은 D5 |
| 18 | r1 참고 사항(계획 범위): EXECUTING run에 task `files`만 있는 계획을 두고 `src/other.js`와 `src/a.js`를 Write | `other.js`는 ask("outside the approved plan's files"), `a.js`는 allow다 (고침) |
| 19 | MCP 쓰기 도구: `mcp__filesystem__write_file/edit_file/move_file(destination)`, `desktop-commander`, `filePath` 키, 저장소 안 심볼릭 링크 | 모두 ask다. read와 무관한 Confluence update는 allow다. 빠진 형태는 D4 |
| 20 | 따옴표 `'>'` 공격 (D1): guard 판정, 그리고 scratch HOME에서 실제 실행 | guard는 allow였다. 실제로 `uninstall '>' --yes`는 상태 홈 `st2`를 삭제했다. `setup routing '>' --write`는 CLAUDE.md를 썼다(`"written"`) |
| 21 | 회귀 검사: run이 없을 때와 EXECUTING run에서 각각 54종 | 다음은 모두 ask 없이 **allow**다 (과차단 없음): 저장소 안 Edit/Write, `npm test`, `npm run test`, `node --test`, `git status/diff/add/commit/log/checkout -b/stash`, `cat/grep/ls/rg`, `mis config get`, 민감하지 않은 `config set` 4종, `mis status/doctor/check/verdict/report/task done/review add/interview add/test-prompt/skill list/skill add(project)/skill trust --remove/tty send/launch --resume`, `~/.claude` 읽기, `claude mcp list/get`, `claude plugin list`, `claude -p` |
| 22 | 회귀 검사: statusline, 훅 | chain을 설정해도 `MIS ▸ EXECUTING · T0/1 · … \| CHAINED`가 나온다. SessionStart·UserPromptSubmit·Stop은 exit 0이고 stderr가 없다. PermissionRequest `git status`는 allow다 |
| 23 | gap-matrix ABSORBED 표본 15행 + D4로 재분류된 4행 | 아래 표에 정리했다. 모두 주장대로다 |

## 결함

### D1 (MEDIUM) 따옴표 안의 `'>'` 단어를 리다이렉트로 파싱한다. 그래서 guard가 바로 다음 인자를 보지 못한다
- 원인:
  - `scripts/lib/shell.mjs:129`는 리다이렉트 연산자 자리에 `'>'` 자리표시자를 argv에 넣는다.
  - `:144`는 argv에서 `'>'`인 단어를 모두 자리표시자로 보고, 그 다음 단어를 `redirects`로 옮긴다.
  - 따옴표로 감싼 리터럴 `'>'`나 `">"`도 같은 문자열이 되므로 구분할 수 없다.
- 확인:
  ```
  commandsOf("echo '>' f")  →  argv ["echo"], redirects ["f"]
  ```
- 재현 (scratch HOME/MIS_STATE_HOME):
  ```
  node scripts/mis.mjs uninstall '>' --yes
  ```
  - guard 판정은 **allow**다.
  - 실제로 실행하면 `"dryRun": false`가 나오고, 상태 홈 디렉터리가 삭제됐다.
  - 원인은 `commands-setup.mjs:322`가 `args.includes('--yes')`만 검사하기 때문이다.
- 같은 방식으로 guard가 allow하는 명령. 직접 형태는 모두 ask다.
  - 실제로 실행한 것: `setup routing '>' --write`. CLAUDE.md를 썼다.
  - guard 판정만 확인한 것:
    - `upgrade '>' --yes`
    - `mcp-setup add github '>' --write`
    - `doctor '>' --fix`
    - `launch '>' --dangerously-skip-permissions`
    - `skill add f.md '>' --scope=user` (실제로는 project 범위로 저장됐다. 실행 결과로 우회되지는 않는다)
    - `tty keys sh echo Space x Space '>' Space '~/.claude/settings.json' Enter`
  - 마지막 tty 형태는 이렇게 동작한다. 입력되는 텍스트 `echo x > ~/.claude/settings.json`을 직접 실행하면 ask다. 그런데 바깥 파서가 `'>'`와 그 다음 단어를 먼저 떼어 내기 때문에 allow가 된다. 그래서 "tty keys는 직접 실행과 같은 판정"이라는 수정 의도에 어긋난다.
- 우회로 주장하지 않는 것: `git push '>' --force`와 `rm '>' -rf ~`. 여기서는 `>`가 원격 이름 또는 피연산자가 되어 위험한 플래그가 효과를 내지 못한다.
- 과차단 영향은 작다. `grep '>' ~/.claude/CLAUDE.md`는 ask다. `cut -d '>' -f1 …`·`grep -c '>' src/a.js`는 allow다.
- 근본 원인은 M1-fix3(`2e1acbd`, shell 토크나이저)부터 있었다. 하지만 이번 수정이 추가한 ask(r1 D1·D2·D10)와 M9-A의 "저장소 밖 변경은 항상 ask" 규칙을 모두 우회한다.
- MEDIUM으로 판단한 이유: 위협 모델이 제외하는 "난독화"(스크립트 내부, 인코딩)가 아니라 토크나이저의 정확성 버그다. 따옴표는 표준 셸 문법이다.
- 기대: 따옴표로 감싼 `>`는 일반 단어다. 자리표시자는 단어와 겹치지 않는 값(예: Symbol이나 별도 플래그 배열)이어야 한다.
- 실제: 다음 단어가 argv에서 사라진다.
- 위치: `scripts/lib/shell.mjs:120-130`, `:140-146`

### D2 (LOW, bypassPermissions 모드에서는 MEDIUM; r1 D8과 같은 척도) r1 D8 수정이 빠뜨린 쓰기 형태와 경로
조건은 모두 run이 없고 cwd가 scratch 저장소인 경우다. 직접 형태(`echo x > ~/.claude/settings.json`)는 ask인데, 다음은 **allow**다.
- **디렉터리로 복사/이동:** `cp settings.json ~/.claude/`, `cp settings.json ~/.claude`, `mv CLAUDE.md ~/.claude`
  - `shellTargets`가 마지막 인자(디렉터리)만 대상으로 본다. `policy.mjs:399-410` (`-t`일 때만 basename을 붙인다)
- **대소문자 변형 (macOS 기본 APFS는 대소문자 무시):** `echo x > ~/.claude/Settings.json`, `~/.Claude/settings.json`, Write `~/.claude/CLAUDE.MD`
  - scratch에서 `~/.Claude/Settings.json`에 쓰면 실제 `~/.claude/settings.json` 내용이 바뀌는 것을 확인했다.
  - `realish`는 `realpathSync`(JS 구현이라 대소문자를 정규화하지 않는다)를 쓴다. `realpathSync.native`는 정규 경로를 돌려준다. `policy.mjs:29`
- **~/.claude 아래 다른 항목:** `~/.claude/skills/x/SKILL.md`, `agents/x.md`, `commands/x.md`, `rules/x.md`, `hooks/x.sh`
  - skills·agents·commands·rules는 모든 세션의 지시문이다. hooks 스크립트는 settings의 훅이 참조하면 매 세션 실행된다.
  - `protectedFile`은 `settings*.json`과 `CLAUDE.md`만 본다. `policy.mjs:385-397`
- **파서가 대상을 잃는 리다이렉트:** `echo x &> ~/.claude/settings.json`, `echo x >| …`, `exec 3> …`
  - `&>`에서는 `&`가 명령을 끝낸다. `>|`에서는 `|`가 파이프가 된다. `shell.mjs:120-133`
- **쓰기 명령 목록에 없음:** `curl -o ~/.claude/settings.json URL`, `wget -O …`, `patch ~/.claude/settings.json < p`
- **그 밖의 경우:**
  - 다른 저장소의 `CLAUDE.local.md`
  - `CLAUDE_CONFIG_DIR`가 설정됐을 때 `$CLAUDE_CONFIG_DIR/.claude.json`
  - 세션 cwd가 저장소가 아니면 cwd 하위 전체를 "자기 저장소"로 본다. 예: cwd `$S`에서 `$S/other/CLAUDE.md` Write는 allow다.
- 범위 밖이라 결함으로 세지 않은 것: `~/.zshrc` 등 셸 설정(수정 범위에 없다), `touch`(내용 변경 없음).
- 위치: `scripts/lib/policy.mjs:385-410`, `scripts/lib/shell.mjs:120-133`

### D3 (LOW) claude CLI 설정 변경과 권한 우회 플래그의 다른 표기
- `claude --debug mcp add x -- y`는 allow다. 전역 플래그가 하위 명령 앞에 오면 `ws[1]`이 `--debug`가 되기 때문이다. `policy.mjs:424`
- `npx @anthropic-ai/claude-code mcp add x -- y`는 allow다.
- `mis launch --dangerously-skip-permissions=true`는 allow다. `BYPASS`가 정확히 일치하는 표기만 본다. `policy.mjs:379`
- `mis launch --settings '{"permissions":{"defaultMode":"bypassPermissions"}}'`는 allow다.
- 실제 claude가 `=true` 표기와 `--settings` 형태를 받아들이는지는 실제 CLI를 실행하지 않아 확인하지 못했다(NEEDS_HUMAN 3). 참고로 직접 `claude --dangerously-skip-permissions`는 r1처럼 여전히 allow다.

### D4 (LOW) MCP 쓰기 도구 판별의 빈틈
- 다음 형태로 `~/.claude/settings.json`·`CLAUDE.md`를 가리키면 allow다.
  - 도구 이름에 다음 동사가 있을 때: `patch_file`, `insert_text`, `set_contents`
  - 경로가 `uri` 키에 있을 때: `uri: file://…`
  - 경로가 중첩 배열에 있을 때: `files: [{path}]`
- 원인:
  - 동사 정규식에 patch·insert·set이 없다.
  - 경로 키 정규식(`path|file|dest|target`)에 uri가 없다.
  - 1단계 값만 본다.
- 위치: `scripts/lib/policy.mjs:507-510`

### D5 (LOW) MCP `load_skills_local`·`list_skills`가 저장소 스킬을 신뢰 표시 없이 돌려준다
- UserPromptSubmit 주입은 r1 D13 수정대로 untrusted로 표시된다.
- 그런데 같은 저장소 스킬 본문을 MCP 도구 `load_skills_local`은 아무 표시 없이 반환한다.
- 결과는 도구 출력(데이터)이고, 이 도구를 쓰라고 지시하는 스킬은 없다. 그래서 LOW로 본다.
- 관찰: 이름이 같으면 저장소 스킬이 사용자 스킬을 가린다("project wins"). 신뢰하지 않는 저장소가 사용자의 신뢰된 스킬을 끌 수 있다(이때 untrusted로 표시되기는 한다).
- 위치:
  - `scripts/mcp/tools/skills.mjs:9`, `:24-27`
  - `scripts/lib/keywords.mjs` `learnedSkills`

### D6 (LOW) 작은 과차단
- `mis tty keys repl -1 Enter`처럼 REPL에 음수를 입력해도 ask다. `-`로 시작하는 단어를 모두 tmux 옵션으로 보기 때문이다. `policy.mjs:352`
- 흔한 작업 흐름에서는 과차단을 찾지 못했다(표 21).

### D7 (LOW) 테스트 두 개가 환경에 민감하다
- `tests/integration/mis-init-doctor.test.mjs:37`
  - 테스트는 `HOME`만 바꾼다. 개발자 셸에 `CLAUDE_CONFIG_DIR`가 있으면 `claudeDir()`가 그쪽을 읽어 `plugins` 검사가 `ok`가 되고, 테스트가 실패한다.
- `tests/unit/policy.test.mjs:479`
  - 경로 목록 항목을 160자에서 자른다(`policy.mjs:49`). TMPDIR이 길면 `wiki/w.md`가 잘려 match에 실패한다.
- 1·2회차 실패 원인은 둘 다 이것이다. 두 변수를 정상 값으로 둔 3회차에서는 둘 다 통과했다.
- 제품 결함은 아니다. 테스트 격리 문제다.

## gap-matrix 표본 (A/B/C/F, ABSORBED 주장)

| 행 | 대상 | 방법 | 결과 |
|---|---|---|---|
| 96 | OMC deepinit | 실행 + 읽기 | `test-prompt deepinit`이 `["deepinit"]`로 라우팅된다. `phases/discover.md:23` 단계를 확인했다. ABSORBED |
| 111 | OMC release | 읽기 | `phases/ship.md:18-23` Release details(release-rules.md 캐시, tag ask). ABSORBED |
| 120 | OMC ultragoal | 실행 | `goal add/list/handoff`가 동작하고 `/goal G1: …` 인계문이 나온다. 키워드는 `["ultragoal"]`다. ABSORBED |
| 141 | OMC document-specialist | 읽기 | 프런트매터 `tools: Read, Grep, Glob, Bash, WebFetch, WebSearch`(Write/Edit 없음). ABSORBED |
| 149 | OMC test-engineer | 읽기 | 프런트매터 `tools: Read, Write, Edit, Grep, Glob, Bash`. ABSORBED |
| 168 | OMC setup-maintenance | 실행 | mtime 2020의 REPORTED run이 새 상태 홈의 SessionStart 뒤 삭제됐다. ABSORBED |
| 176 | OMC verify-deliverables | 실행 | 없는 파일을 보고하면 block하고 이유가 붙는다. `stop_hook_active`이면 통과한다. ABSORBED |
| 292 | omc version | 실행 | `mis version`에 version, node, commit, install이 나온다. ABSORBED |
| 304 | omc ralphthon | 실행 + 읽기 | `test-prompt "ralphthon this"`가 loop의 ralphthon 순서로 간다. `skills/loop/SKILL.md:12`. ABSORBED |
| 322 | Superpowers SDD | 읽기 | `phases/implement.md:22-26`(task brief, spec→quality 2단계 리뷰, review package). ABSORBED |
| 350 | ponytail-debt | 실행 | `mis debt`가 `src/d.js:1` shortcut 1건을 찾는다. ABSORBED |
| 385 | gstack context-save | 실행 | `context save wip` 후 다른 브랜치에서 `restore`하면 브랜치 불일치 경고가 나온다. ABSORBED |
| 487 | gstack-global-discover | 실행 | `mis context sessions`가 fixture 프로젝트 `/x/proj`를 나열한다. ABSORBED |
| 500 | gstack-pr-title-rewrite | 실행 (함수) | `prTitle('v0.1 add x','1.2.3')`는 `v1.2.3 add x`이고, 버전이 없으면 원제목이다. ABSORBED |
| 506 / 515 | gstack-repo-mode / taste-update | 실행 | `repo-mode`는 `solo`다. `taste approve v1.html --tags dense,serif`를 하면 `prefer`에 반영된다. ABSORBED |
| 183, 286, 440, 468 | code-simplifier, omc config, proactive, gstack-config (r1에서 PARTIAL로 지적) | 실행 | 표 9의 끝까지 확인한 결과로 ABSORBED가 맞다. 이후 추가되는 설정 키는 `policy-m9af.test.mjs:32`가 `NON_SENSITIVE_CONFIG`와 스키마의 비민감 키가 같은지 검사한다 |
| 170 | OMC permission-handler | 실행 | 표 8에 따라 r1의 "ABSORBED + 결함"은 해소됐다 |

읽기로만 확인한 행(111, 141, 149, 322)은 문서와 프런트매터가 주장과 일치하는지만 대조했다. 모델로 실행하지는 않았다.

## NEEDS_HUMAN
1. **D1 실제 영향:** 실제 Claude Code 세션에서 모델이 `'>'` 형태를 쓸 때 Claude Code 자체 권한 확인이 뜨는지 확인한다. 기본 모드에서는 Bash 확인 창이 남아 있을 수 있다. bypassPermissions 모드에서는 guard가 유일한 장치다.
2. **D2 대소문자:** 실제 사용자 홈이 대소문자를 구분하는 볼륨인지 확인한다(기본 APFS는 구분하지 않는다).
3. **D3:** 실제 `claude`가 `--dangerously-skip-permissions=true`와 `--settings '{"permissions":{"defaultMode":"bypassPermissions"}}'`를 받아들이는지 확인한다.
4. **r1 NEEDS_HUMAN 1~8은 그대로 남는다.** PermissionRequest 실제 효과, SubagentStop block, 상태줄 UI, 전역 CLAUDE.md 블록, 실제 `mis launch`, `mcp-setup --write`·`upgrade --yes`, ask 창, `skill test`가 해당한다.
5. **테스트 247** (`mis-pair.test.mjs:53`, `fetch failed`): 2회차에서 D/E 검증자와 동시에 돌 때만 실패했고, 3·4회차에서는 통과했다. 부하에 따른 flake일 가능성이 높다. D/E 담당이 판단한다.
