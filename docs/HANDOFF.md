# 작업 인계 (HANDOFF) — 2026-10-21

새 세션은 이 문서부터 읽는다. 원본 기록은 `docs/PROGRESS.md`, `git log`, `docs/milestones/*-report*.md`다.

## 0. 통합 라인

- **개발은 `feature/make-it-ship-m1-m5` 한 라인에서 끝낸 뒤 master로 만든다**(사용자 결정, 2026-10-21).
  - 로컬에서는 worktree `orca/workspaces/make-it-ship/make-it-ship`의 `make-it-ship` 브랜치가 이 라인이다.
  - 원격: `github.com/tom910903/make-it-ship` (비공개). 이 브랜치가 원격 기본 브랜치이고, 마켓플레이스 설치도 이 브랜치에서 받는다.
- 2026-10-21에 `develop`(M6·M7 검증 PASS)을 이 라인으로 병합했다(3장 1번).
  - 그 전까지 develop은 별도 라인이었다.
  - M8·M9 WIP 브랜치는 아직 develop 기반이다. 이 라인으로 가져올 때 `scripts/guard.mjs`·`policy.mjs`·`shell.mjs`에서 충돌이 예상된다. D-1 회귀 테스트(`guard.test.mjs` ".git/ or in a nested repo")가 통과하는지 꼭 다시 확인한다.

## 1. 목표 (사용자 요청, 2026-10-20)

Make It Ship 하나만 설치하면 OMC·Superpowers·Ponytail·gstack의 기능을 모두 쓸 수 있게 한다. 여기에는 상시 동작, 도구, 설정, 연구·자가 개선 루프, 배포 후 운영, PDF 등이 포함된다.

- 제외: BSP, 알림
- 마지막 단계(M10): 다 만든 뒤 원본 4종과 같은 데모로 실제 비교하고, 결과를 **로컬 HTML**로 시각화한다.
- 범위와 결정: `docs/adr/0003-single-plugin-full-absorption.md`
- 갭 목록: `docs/research/gap-matrix.md`. `node scripts/gap-matrix.mjs --write`로 다시 집계한다.

사용자 결정 요약:
- npm 의존성 허용(아직 실제 의존성은 없음)
- 알림 제외
- 자격증명은 포함하되 항상 확인
- 외부 전송은 구현하되 항상 확인. 텔레메트리는 기본 꺼짐
- ralph는 접두형만 자동, 나머지는 모델 힌트
- 계획·리뷰·디자인 기능은 run 흐름과 자연어에 녹인다(단독 명령 남발 금지)
- 브라우저 업로드는 "로컬 전용 브라우저 모드"(3장 2번)
- `hardware` 위험 플래그 제거, 문서 업로드는 그대로 둔다(2026-10-21)
- 항상 한국어로 보고

## 2. 마일스톤 상태

| M | 내용 | 상태 | 위치 |
|---|---|---|---|
| M1~M5 | 핵심 | 검증 PASS(`FINAL-report.md`). 사후 변경도 재검증 PASS(`POST-FINAL-report.md`) | 이 라인 |
| M6 | 상시 동작 계층(훅, style, loop, freeze 등) | 검증 PASS, `m6-verified` | 이 라인(develop 병합) |
| M7 | MCP 도구 서버(memory, wiki, LSP/REPL, trace, run lock) | 검증 PASS(6차), `m7-verified` | 이 라인(develop 병합) |
| M8 | 내장 브라우저(CDP pipe), pdf, visual-verdict, team, companion | 3차 검증 FAIL. **수정 착수 전 중단** | `m8-wip` @ `152898f` (`~/Dev/Git/tools/make-it-ship-m8`) |
| M9 | 나머지 기능 전부(A 설치·수명주기, B 흐름 통합, C 에이전트·스킬, D 연구·운영·배포, E 브라우저 고급, F 훅) | 구현 완료, 2차 검증 FAIL. **수정 도중 중단** | `m9-wip` @ `7fc6a80` (`~/Dev/Git/tools/make-it-ship-m9`) |
| M10 | 원본 4종 vs MIS 실측 비교 + 로컬 HTML | 미착수 | — |

gap-matrix(m9-wip 기준): ABSORBED 341 / PARTIAL 23 / MISSING 8 / EXCLUDED 5 / N/A 15.

M1~M5 라인에서 2026-10-21에 바뀐 것(모두 이 라인에 있음):
- **guard D-1 수정**(`9aaf3b1`): run 중 `.git/` 내부와 중첩 저장소의 편집이 다시 ask가 된다.
- **`hardware` 플래그 제거**(`8052bd1`). Spec과 달라진 점은 SPEC_CHANGES에 기록했다.
- **테스트 결정화**: `mis-bench`, `mis-resume`, `mis-concurrency`. 고부하(load 170~280)에서 실패하던 테스트다.
- **저장소 자체 마켓플레이스**: `.claude-plugin/marketplace.json`, `source: "."`. 설치, `marketplace update`, `plugin update` 경로를 AUTO로 확인했다(`NH-auto-check.md`).
- **NH-5**: AUTO 통과. NH-6·7·8은 "추후 확인 필요"(사용자 결정).

## 3. 다음에 할 일 (순서대로)

1. **develop 병합 검증**
   - 병합 커밋을 만들었다(3장 이후 `git log` 참고). 충돌은 7개 파일에서 났고(PROGRESS.md는 자동 병합) 양쪽을 모두 살렸다.
     - `guard.mjs`: D-1 수정과 develop의 freeze·trace를 함께 둔다.
     - 테스트 4개: 양쪽 테스트를 모두 둔다. `mis-resume`은 이벤트 기반 대기를 쓴다.
     - README, PROGRESS, HANDOFF.
   - 남은 일: 독립 verifier로 병합 결과를 검증한다. **push는 사용자 확인 후에 한다.** push하면 마켓플레이스로 새로 설치하는 사람이 M6·M7(상시 훅, MCP 서버)을 받는다.
2. **M8 3차 결함 수정** (`~/Dev/Git/tools/make-it-ship-m8`, 보고서 `docs/milestones/M8-report.md` "3차 검증")
   - R3-1/R3-2: 업로드 파일 유출 경로(Service/Shared Worker, 다른 로컬 문서로 이동, closetab의 pagehide beacon, WebRTC). **사용자 결정: 로컬 전용 모드**로 막는다.
     - `mis browse start --local-only`: Chrome을 다음 옵션으로 띄운다.
       - `--proxy-server=http://127.0.0.1:<닫힌 포트>`: loopback 외 전부 차단
       - `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE [::1]"`
       - `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` 등
     - 확인 없는 `upload`는 이 모드에서만 허용한다. 다른 모드에서는 `--remote` 여부와 상관없이 upload가 항상 guard ask다. 문구: 페이지 스크립트가 파일을 어디로든 보낼 수 있음.
     - 모드는 데몬 상태 파일에 기록하고 guard가 읽는다. 모드를 바꾸려면 데몬을 재시작한다.
     - 유출 경로마다 로컬 전용 모드에서 실제로 다시 시도해, 유출이 0건인지 측정한다(가정 금지). 기존 목적지 검사와 Fetch 차단은 보조 방어로 남긴다.
   - R3-3: guard가 `MIS_BROWSE_CHROME_ARGS`/`MIS_BROWSER`/`MIS_BROWSER_EXE`를 원문 정규식이 아니라 파서가 풀어낸 env 할당으로 판정하게 한다. Chrome 플래그는 거부 목록에서 **허용 목록(fail closed)**으로 바꾼다.
   - R3-4: visual-verdict 정렬 탐색 범위를 ±8px 정도로 넓히고, 정확한 값을 단언한다.
   - 그다음 M8 4차 독립 검증을 한다. PASS면 보고서를 커밋하고 `m8-verified` 태그를 단다.
3. **M9 2차 결함 수정 마무리**: WIP가 두 브랜치에 있다(**테스트 미실행**).
   - `m9-fix3` @ `9e8f1c9` (`~/Dev/Git/tools/make-it-ship-m9fix3`): D/E N1~N8(`docs/milestones/M9-report-r2-DE.md`).
     - 중단 직전에는 "존재하지 않는 테스트 cwd 때문에 fail-closed 조건을 다듬는 중"이었다.
     - N2는 고치기로 결정했다. 평가기 등 저장 명령을 실행할 때도 MIS_CLI 거부 환경을 적용한다.
   - `m9-fix4` @ `99ceb8f` (`~/Dev/Git/tools/make-it-ship-m9fix4`): A/F D1~D7(`M9-report-r2-AF.md`).
     - 본 수정은 `c11e94e`에 커밋됐고, 그 뒤 RISKS 메모만 WIP다.
     - 남은 일: 전체 `npm test` 2회와 validate.
   - 둘 다 끝나면 `m9-wip`에 병합한다(policy.mjs·shell.mjs 충돌 예상). 그다음 m8-wip도 m9-wip에 병합하고, **이 라인으로 병합**한다(0장 주의 참고).
   - 그 뒤 M9 3차 검증을 두 갈래로 한다(A/B/C/F, D/E). PASS면 `m9-verified` 태그를 단다.
4. **M10**: 원본 4종을 각각 `--plugin-dir`와 프로젝트 전용 설정으로 격리해, 같은 합성 데모(`evals/demos`)에서 실제로 실행한다.
   - 셀마다 N≥3번 돌리고, 원시 로그를 보관한다. 추정치는 쓰지 않는다.
   - 지표: 판정 정직성·통과율, 턴, 토큰/비용, 시간, diff 크기, 리뷰 지적 수.
   - 결과는 **로컬 HTML**로 만든다(외부 업로드 금지).
   - 독립 검증 후 `m10-verified` 태그를 단다.
5. **사람 확인**(사용자가 나중에 직접): NH-1~5 확인 창 누르기. NH-6 iPhone 실기기, NH-7·8 외부 모델은 "추후 확인 필요"다. 절차는 `docs/milestones/NEEDS_HUMAN.md`.
6. **master 전환**(개발 완료 후)
   - master를 만든다. PR은 선택이다.
   - **GitHub 기본 브랜치를 master로 바꾼다.**
   - `plugin.json` version을 올린다(지금 0.1.0). version을 올리지 않으면 이미 설치한 사용자가 `plugin update`로 새 커밋을 받지 못한다(실측).
   - HANDOFF와 FINAL 보고서를 갱신한다.

## 4. 열린 결정

- version을 언제, 몇으로 올릴지(3장 6번)
- 병합 결과를 원격에 언제 push할지(3장 1번)
- NH-6~8: 실기기와 사내 정책이 준비되면 유지할지, 닫을지, 제거할지

## 4-1. 남은 위험 (LOW)

- guard에서 allow되는 경우(의도적 우회는 위협 모델 밖이라 결함이 아니라 위험으로 둔다):
  - worktree 안의 implementer가 main 트리의 다른 task 파일을 편집하는 경우
  - `file_path`가 실제 경로가 아닌 경우(예: `/private/tmp`가 아니라 `/tmp`로 준 경우). 계획 범위 검사를 건너뛴다.
- 문서 잔재:
  - `docs/milestones/M5-e2e.md`에 BSP 절차가 남아 있다. 역사 기록이라 그대로 둔다.
  - Spec §435 qa 행에 BSP가 남아 있다. Spec은 수정하지 않고 SPEC_CHANGES에 기록했다.
- 설치 확인 범위:
  - GitHub 마켓플레이스 설치는 user 범위로만 확인했다. `--scope project`는 확인하지 않았다.
  - develop 병합 후의 마켓플레이스 설치(MCP 서버 기동 포함)는 3장 1번에서 확인한다.

## 5. 운영 메모

- 독립 검증 에이전트는 보고서 파일만 쓰고, 소스는 건드리지 않는다. 커밋은 조정자가 한다. 수정은 별도 worktree에서 하고 조정자가 병합한다.
- 여러 에이전트가 같은 scratchpad를 쓰면 로그가 섞인다. 에이전트마다 고유 TMPDIR과 로그 이름을 지정한다.
- 고부하(load 20~280)에서 시간 상한에 기대는 테스트가 흔들렸다. 테스트는 이벤트나 파일 게이트로 결정적으로 만든다.
- 부하 테스트에 `yes`를 쓸 때는 bash 배열과 `trap … EXIT`로 반드시 종료한다. zsh에서 `kill $pids` 문자열로 넘기면 종료되지 않는다.
- 테스트 env는 `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CONFIG_DIR`를 지우고, `HOME`·`MIS_STATE_HOME`을 임시 디렉터리로 둔다.
- 외부 모델 CLI(codex/gemini), ngrok, 실제 배포 서비스는 실제로 호출하지 않는다(사내 정책). 테스트는 stub과 localhost만 쓴다.
- 플러그인 설치를 확인한 뒤 `~/.claude/plugins/cache/<marketplace>`가 남는다. 직접 지운다.
- 정리 대상 worktree: `make-it-ship-m2`, `m5`, `m7`, `m7a~c`, `m8a~b`, `m9a~f`. 병합이 끝나 지워도 된다(사용자 확인 후).

## 6. 다른 장비에서 시작하기

```sh
git clone git@github.com:tom910903/make-it-ship.git && cd make-it-ship
git checkout feature/make-it-ship-m1-m5
node --version              # 22 이상
npm test                    # 실패 0 기대
claude plugin validate .claude-plugin/plugin.json   # 통과 기대
claude plugin validate .                            # 마켓플레이스 매니페스트
claude --plugin-dir "$PWD"  # 다른 저장소에서 /make-it-ship:run ... 으로 사용
```
설치해서 쓰는 방법은 README Install에 있다: `claude plugin marketplace add tom910903/make-it-ship` 다음에 `claude plugin install make-it-ship@make-it-ship`.

새 세션 시작 프롬프트 예시:
```
docs/HANDOFF.md를 읽고 3장 "다음에 할 일"을 1번부터 이어서 진행해. 연속 모드, 한국어로 보고, push 금지.
```

## 7. 작업 규칙

- 우선순위: Spec v1.1(`docs/Make_It_Ship_Spec_v1.1.md` §2·§11·§14) > ADR(`docs/adr/`) > 기획서.
  - **기획서와 ADR은 수정하지 않는다.** Spec과 다르게 가야 하면 PROGRESS.md `SPEC_CHANGES`에만 기록한다.
  - ADR-0003(전부 흡수)의 사용자 결정은 M1~M5 때의 규칙보다 우선한다.
- 작업마다 TDD로 진행한다: 실패 테스트 → 최소 구현 → 전체 `npm test` → 커밋.
- **금지:**
  - 테스트 삭제·약화·skip
  - 실행하지 않은 검증을 통과로 기록하기
  - Spec과 ADR에 없는 기능 추가(필요하면 PROGRESS.md 제안으로만)
  - 사내 코드·데이터를 테스트에 쓰기
  - 외부 모델 CLI(codex/gemini) 호출(사내 정책)
- npm 의존성은 ADR-0003에 따라 허용한다. 다만 마켓플레이스 설치는 `npm install`을 하지 않으므로, 런타임 의존성을 넣으려면 배포 방식을 먼저 정해야 한다.
- 사람이 확인해야 하는 항목은 NEEDS_HUMAN으로 둔다. Claude가 대신 확인한 것은 "AUTO"로만 적는다.
- 멈추고 물어볼 때: Spec이나 ADR 결정을 바꿔야 할 때, 같은 문제로 3번 시도해도 진전이 없을 때.

## 8. 구조 요약

| 경로 | 내용 |
|---|---|
| `scripts/mis.mjs`, `scripts/lib/commands.mjs` | `mis` CLI(start/plan/approve/task/check/verdict/report/freeze/loop/…) |
| `scripts/guard.mjs`, `scripts/lib/policy.mjs`, `scripts/lib/shell.mjs` | PreToolUse 훅. 셸 토크나이저로 ask/deny를 판정하고, 내부 오류 시 ask(fail-closed) |
| `scripts/hooks.mjs`, `hooks/hooks.json` | 상시 동작 훅(SessionStart, UserPromptSubmit, Stop 등) |
| `.mcp.json`, MCP 서버 `mis` | memory, wiki, LSP/REPL, trace 등 도구 |
| `scripts/lib/verdict.mjs`, `state.mjs`, `tree-hash.mjs` | 판정 규칙(§6), run 상태(`<git-common-dir>/make-it-ship/runs/`), 증거의 STALE 판정 |
| `skills/`, `skills/run/phases/*.md` | 전체 흐름(discover → plan → 승인 → implement → verify → review → qa → report → ship)과 단독 스킬 |
| `agents/*.md` | 읽기 전용 리뷰어들과 implementer(쓰기 가능) |
| `.claude-plugin/plugin.json`, `marketplace.json` | 플러그인 매니페스트, 저장소 자체 마켓플레이스 |
| `evals/setup-demo.mjs`, `evals/demos/` | 합성 데모 저장소 |
| `tests/` | `node:test` 단위·통합 테스트 |
| `docs/milestones/` | 마일스톤 보고서, 최종·사후 보고서, NEEDS_HUMAN, NH 자동 확인 기록 |

## 9. 대화형 확인을 자동으로 돌리는 방법 (NH-1~5에서 쓴 방식)

```sh
node evals/setup-demo.mjs a /tmp/nh1 && cd /tmp/nh1
mkdir -p .claude && echo '{"permissions":{"allow":["Bash","Read","Write","Edit","Glob","Grep","Agent"]}}' > .claude/settings.local.json
tmux new-session -d -s nh1 -x 220 -y 60 "claude --plugin-dir <repo> --setting-sources project,local"
tmux send-keys -t nh1 -l "/make-it-ship:run Implement docs/feature-request.md. Use standard mode." && tmux send-keys -t nh1 Enter
tmux capture-pane -p -t nh1 | tail -30   # 확인 창 확인 후 Enter(승인) / Down+Enter(거절)
```

- 기본 권한 모드가 auto로 잡혀 있으면 shift+tab(`tmux send-keys BTab`)으로 manual로 바꾼 뒤 확인한다.
- `--strict-mcp-config`를 주면 플러그인 MCP 서버(M7 도구)가 로드되지 않는다(ADR-0003 실측).
- headless 모드(`claude -p`)에서는 ask 확인 창이 뜨지 않는다(ADR-014). 확인 창을 검증하려면 위처럼 대화형 세션을 쓴다.
- 사용자 전역 설정(`~/.claude/settings.json`)은 건드리지 않는다. HUD는 데모 저장소의 `.claude/settings.local.json`에 `statusLine`을 넣어 확인한다.
