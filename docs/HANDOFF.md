# 작업 인계 (HANDOFF) — 2026-10-21

새 세션은 이 문서부터 읽는다. 원본 기록은 `docs/PROGRESS.md`, 각 worktree의 `git log`, `docs/milestones/*-report*.md`다.
push는 사용자가 다시 요청할 때만 한다(마지막 push는 M1~M5 시점의 `feature/make-it-ship-m1-m5`).

## 1. 목표 (사용자 요청, 2026-10-20)

Make It Ship 하나만 설치하면 OMC·Superpowers·Ponytail·gstack의 모든 기능(상시 동작, 도구, 설정, 연구·자가 개선 루프, 배포 후 운영, PDF 등)을 쓸 수 있게 한다. 제외: BSP, 알림. 다 만든 뒤 원본 4종과 같은 데모로 실제 비교하고 **로컬 HTML**로 시각화한다(M10). 범위와 결정은 `docs/adr/0003-single-plugin-full-absorption.md`, 갭 목록은 `docs/research/gap-matrix.md`(392행, `node scripts/gap-matrix.mjs --write`로 재집계).

사용자 결정(요약): npm 의존성 허용 / 알림 제외 / 자격증명 포함·항상 확인 / 외부 전송 구현·항상 확인, 텔레메트리 기본 꺼짐 / ralph는 접두형만 자동, 나머지는 모델 힌트 / 계획·리뷰·디자인 기능은 run 흐름과 자연어에 녹임(단독 명령 남발 금지) / **브라우저 업로드는 "로컬 전용 브라우저 모드"(아래 M8)** / 항상 한국어로 보고.

## 2. 마일스톤 상태

| M | 내용 | 상태 | 브랜치·worktree |
|---|---|---|---|
| M1~M6 | 핵심 + 상시 동작 계층 | 검증 PASS, 태그 `m1`~`m6-verified` | `develop` |
| M7 | MCP 도구 서버(memory, wiki, LSP/REPL, trace, run lock) | **검증 PASS(6차)**, `m7-verified`, develop에 병합됨 (`3483577`) | `develop` |
| M8 | 내장 브라우저(CDP pipe), pdf, visual-verdict, team, companion | 3차 검증 FAIL → **수정 착수 전 중단** | `m8-wip` @ `152898f` (`../make-it-ship-m8`) |
| M9 | 나머지 기능 전부(A 설치·수명주기, B 흐름 통합, C 에이전트·스킬, D 연구·운영·배포, E 브라우저 고급, F 훅) | 구현 완료, 2차 검증 FAIL → **수정 도중 중단** | `m9-wip` @ `7fc6a80` (`../make-it-ship-m9`) |
| M10 | 원본 4종 vs MIS 실측 비교 + 로컬 HTML | 미착수 | — |

gap-matrix(m9-wip 기준): ABSORBED 341 / PARTIAL 23 / MISSING 8 / EXCLUDED 5 / N/A 15.

## 3. 다음에 할 일 (순서대로)

1. **M8 3차 결함 수정** (`../make-it-ship-m8`, 보고서 `docs/milestones/M8-report.md` "3차 검증")
   - R3-1/R3-2(업로드 파일 유출: Service/Shared Worker, 다른 로컬 문서로 이동, closetab의 pagehide beacon, WebRTC) → **사용자 결정: 로컬 전용 모드**.
     - `mis browse start --local-only`: Chrome을 `--proxy-server=http://127.0.0.1:<닫힌 포트>`(loopback 외 전부 차단), `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE [::1]"`, `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` 등으로 띄운다.
     - 확인 없는 `upload`는 이 모드에서만 허용. 다른 모드에서는 `--remote` 여부와 무관하게 upload는 항상 guard ask(문구: 페이지 스크립트가 파일을 어디로든 보낼 수 있음).
     - 모드는 데몬 상태 파일에 기록, guard가 읽음. 모드 전환은 데몬 재시작.
     - 각 유출 경로를 로컬 전용 모드에서 실제로 재시도해 0건임을 측정(가정 금지). 기존 목적지 검사·Fetch 차단은 보조 방어로 유지.
   - R3-3: guard가 `MIS_BROWSE_CHROME_ARGS`/`MIS_BROWSER`/`MIS_BROWSER_EXE`를 원문 정규식이 아니라 파서가 풀어낸 env 할당으로 판정. Chrome 플래그는 거부 목록 → **허용 목록(fail closed)**.
   - R3-4: visual-verdict 정렬 탐색 ±8px 정도로 확대, 정확한 값 단언.
   - 그다음 M8 4차 독립 검증 → PASS면 보고서 커밋, `develop` 병합, `m8-verified`.
2. **M9 2차 결함 수정 마무리** — 두 브랜치에 WIP가 있다(**테스트 미실행**):
   - `m9-fix3` @ `9e8f1c9` (`../make-it-ship-m9fix3`): D/E N1~N8(`docs/milestones/M9-report-r2-DE.md`). 중단 직전 "존재하지 않는 테스트 cwd 때문에 fail-closed 조건을 다듬는 중"이었다. N2는 고치기로 결정(평가기 등 저장 명령 실행에도 MIS_CLI 거부 환경 적용).
   - `m9-fix4` @ `99ceb8f` (`../make-it-ship-m9fix4`): A/F D1~D7(`M9-report-r2-AF.md`). 본 수정은 `c11e94e`에 커밋됨, 그 뒤 RISKS 메모만 WIP. 남은 일: 전체 `npm test` 2회 + validate.
   - 둘 다 끝나면 `m9-wip`에 병합(policy.mjs·shell.mjs 충돌 예상), 그다음 **최종 m8-wip도 m9-wip에 병합**한 뒤 M9 3차 검증(A/B/C/F, D/E 두 갈래). PASS면 `develop` 병합, `m9-verified`.
3. **M10**: 원본 4종 각각을 `--plugin-dir`와 프로젝트 전용 설정으로 격리해 같은 합성 데모(`evals/demos`)에서 실제 실행, 셀마다 N≥3, 원시 로그 보관, 추정치 금지. 지표: 판정 정직성·통과율, 턴, 토큰/비용, 시간, diff 크기, 리뷰 지적 수. 결과를 **로컬 HTML**로(외부 업로드 금지). 독립 검증 후 `m10-verified`.
4. HANDOFF·FINAL 보고서 갱신.

## 4. 운영 메모

- 독립 검증 에이전트는 보고서 파일만 쓰고(커밋은 조정자가), 소스는 건드리지 않는다. 수정은 별도 worktree에서 하고 조정자가 병합한다.
- 여러 에이전트가 같은 scratchpad를 쓰면 로그가 섞인다 → 에이전트마다 고유 TMPDIR·로그 이름을 지정한다.
- 고부하(load 20~40)에서 타이밍 테스트가 흔들렸다 → 테스트는 결정적으로 만든다.
- 테스트 env는 `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CONFIG_DIR`를 지우고 `HOME`·`MIS_STATE_HOME`을 임시 디렉터리로 둔다.
- 외부 모델 CLI(codex/gemini), ngrok, 실제 배포 서비스는 실제로 호출하지 않는다(사내 정책). 테스트는 stub과 localhost만.
- 정리 대상 worktree: `make-it-ship-m2`, `m5`, `m7`, `m7a~c`, `m8a~b`, `m9a~f`는 병합이 끝나 지워도 된다(사용자 확인 후).

## 5. 새 세션 시작 프롬프트 (예시)

```
docs/HANDOFF.md를 읽고 3장 "다음에 할 일"을 1번부터 이어서 진행해. 연속 모드, 한국어로 보고, push 금지.
```

## 5. 작업 규칙 (원래 /goal 지시에서)

- 우선순위: Spec v1.1(`docs/Make_It_Ship_Spec_v1.1.md` §2·§11·§14) > ADR(`docs/adr/`) > 기획서. **기획서와 ADR은 수정하지 않는다.** Spec과 다르게 가야 하면 PROGRESS.md `SPEC_CHANGES`에만 기록한다.
- 작업마다 TDD로 진행한다: 실패 테스트 → 최소 구현 → 전체 `npm test` → 커밋.
- **금지:**
  - 테스트 삭제·약화·skip
  - 실행하지 않은 검증을 통과로 기록하기
  - Spec에 없는 기능 추가(필요하면 PROGRESS.md 제안으로만)
  - (변경) npm 의존성은 ADR-0003에 따라 허용
  - 사내 코드·데이터를 테스트에 쓰기
  - 외부 모델 CLI(codex/gemini) 호출(사내 정책)
- 사람이 확인해야 하는 항목은 NEEDS_HUMAN으로 둔다. Claude가 대신 확인한 것은 "AUTO"로만 적는다.
- 멈추고 물어볼 때: Spec이나 ADR 결정을 바꿔야 할 때, 같은 문제로 3번 시도해도 진전이 없을 때.

## 6. 구조 요약

| 경로 | 내용 |
|---|---|
| `scripts/mis.mjs`, `scripts/lib/commands.mjs` | `mis` CLI(start/plan/approve/task/check/verdict/report/…) |
| `scripts/guard.mjs`, `scripts/lib/policy.mjs`, `scripts/lib/shell.mjs` | PreToolUse 훅. 셸 토크나이저 기반으로 ask/deny를 판정하고, 내부 오류 시 ask(fail-closed) |
| `scripts/lib/verdict.mjs`, `state.mjs`, `tree-hash.mjs` | 판정 규칙(§6), run 상태(`<git-common-dir>/make-it-ship/runs/`), 증거의 STALE 판정 |
| `skills/run/SKILL.md`, `skills/run/phases/*.md` | 전체 흐름. discover → plan → 승인 → implement → verify → review → qa → report → ship |
| `agents/*.md` | 읽기 전용 리뷰어 8종과 implementer(쓰기 가능) |
| `evals/setup-demo.mjs`, `evals/demos/` | 합성 데모 저장소(a, b, c, d, p, pilot-1..6) |
| `tests/` | `node:test` 단위·통합 테스트 |
| `docs/milestones/` | 마일스톤 보고서, 최종 보고서, NEEDS_HUMAN, NH 자동 확인 기록 |

## 7. 대화형 확인을 자동으로 돌리는 방법 (NH-1~4에서 쓴 방식)

```sh
node evals/setup-demo.mjs a /tmp/nh1 && cd /tmp/nh1
mkdir -p .claude && echo '{"permissions":{"allow":["Bash","Read","Write","Edit","Glob","Grep","Agent"]}}' > .claude/settings.local.json
tmux new-session -d -s nh1 -x 220 -y 60 "claude --plugin-dir <repo> --setting-sources project,local"
tmux send-keys -t nh1 -l "/make-it-ship:run Implement docs/feature-request.md. Use standard mode." && tmux send-keys -t nh1 Enter
tmux capture-pane -p -t nh1 | tail -30   # 확인 창 확인 후 Enter(승인) / Down+Enter(거절)
```

- `--strict-mcp-config`를 주면 플러그인 MCP 서버(M7 도구)가 로드되지 않는다(ADR-0003 실측).
- headless 모드(`claude -p`)에서는 ask 확인 창이 뜨지 않는다(ADR-014). 확인 창을 검증하려면 위처럼 대화형 세션을 써야 한다.
- 사용자 전역 설정(`~/.claude/settings.json`)은 건드리지 않는다. HUD는 데모 저장소의 `.claude/settings.local.json`에 `statusLine`을 넣어 확인한다.
