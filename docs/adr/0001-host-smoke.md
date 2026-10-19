# ADR-0001: M0 호스트 실증 결과

- 일시: 2026-10-19
- 환경: Claude Code 2.1.292, Node v22.20.0, macOS (Darwin 27.0.0, arm64), Xcode 26.0.1
- 대상: `evals/m0-smoke-plugin/` (최소 플러그인: skill 1, agent 1, PreToolUse 훅 1)
- 방법: `claude -p "<prompt>" --plugin-dir ./evals/m0-smoke-plugin ...` 헤드리스 실행. 훅은 모든 호출을 로그 파일에 기록함
- 참고: 공식 문서 조회 결과는 실측과 다른 항목이 있음. 그런 경우 **실측을 우선**함

## 결과 요약

| # | 항목 | 결과 | 근거 |
|---|---|---|---|
| 0 | `claude plugin validate` | ✅ 통과 (author 누락 경고만) | 실행 로그 |
| 1 | 스킬 네임스페이스 `/make-it-ship:smoke` | ✅ 노출됨, 실행 결과 `MIS_SKILL_LOADED` | 헤드리스 실행 |
| 2 | 훅 command의 `${CLAUDE_PLUGIN_ROOT}` | ✅ 인라인 치환됨 + 환경변수로도 전달됨 (절대경로) | 훅 로그 `argv1`, `envRoot` |
| 3a | PreToolUse `deny` | ✅ default, bypassPermissions **둘 다** 차단됨 | 훅 로그 + 실행 출력 |
| 3b | PreToolUse `ask` (헤드리스 `-p`) | ✅ default, acceptEdits, bypassPermissions 모두 **실행되지 않음**(사유만 반환) → 무인 루프에서 ask는 사실상 deny로 동작함 | 실행 출력 |
| 3c | PreToolUse `ask` (**대화형** auto 모드) | ✅ 사용자 확인 창이 뜸 → 훅 `ask`로 승인을 강제하는 설계 유지 (대안 승인 방식 불필요) | 사용자 수동 확인 (2026-10-19) |
| 4 | 플러그인 agent `disallowedTools` | ✅ Write가 목록에서 빠지고 파일도 생성되지 않음 | 에이전트 보고, 파일 부재 |
| 5 | 서브에이전트 중첩 | ⚠️ **가능** — 서브에이전트 도구 목록에 `Agent`가 있음. 공식 문서도 중첩 지원을 명시 | 에이전트 보고 |
| 6 | MCP matcher `mcp__.*` | ✅ `mcp__context7__resolve-library-id` 호출 시 훅 실행됨 | 훅 로그 |
| 7 | 활성 플러그인 목록 | ✅ `~/.claude/settings.json`의 `enabledPlugins` (`"<plugin>@<marketplace>": true`). project/local 설정 파일에도 있을 수 있음 | 파일 확인, 공식 문서 |
| 8 | 플러그인의 statusLine 등록 | ❌ 불가 — 플러그인 settings는 `agent`, `subagentStatusLine`만 적용됨. HUD는 사용자 설정 `statusLine`에 등록해야 함 | 공식 문서(plugins manifest reference) |

## 부수 발견

- **`claude -p` 인자 순서**: `--plugin-dir` 뒤에 오는 인자가 프롬프트로 잘못 해석된 사례가 있음. 프롬프트를 `-p` 바로 뒤에 두면 해결됨.
- **`--permission-mode auto`**: `-p`에서 지정해도 훅 입력의 `permission_mode`가 `default`로 들어옴. 이 환경에서는 헤드리스 auto 모드가 적용되지 않음.
- **사용자 환경의 다른 훅 개입**: 서브에이전트에 사용자 환경의 다른 플러그인 훅(Ponytail SubagentStart 등)이 주입됨. 깨끗한 테스트 환경이 필요하면 `--bare` 검토(훅·플러그인·MCP 자동탐색을 생략함).
- **서브에이전트의 MCP 도구 상속**: 서브에이전트가 사용자 MCP 쓰기 도구(Atlassian, M365, Polarion 등)를 그대로 상속함. `disallowedTools` 방식으로는 이를 막을 수 없음.

## Spec 반영 결정

1. **ADR-012 수정**
   - 서브에이전트 중첩은 *가능*하다. 다만 흐름 제어와 사용자 질문은 메인 세션이 맡는다는 결정은 유지한다. 근거는 단일 책임과 사용자 상호작용이다.
   - 리뷰 에이전트에는 `Agent`를 금지해 재귀 위임을 막는다.
2. **리뷰 에이전트 권한 방식 변경**
   - `disallowedTools` 대신 **`tools` 허용목록**(`Read, Grep, Glob, Bash`)을 쓴다.
   - 상속된 MCP 쓰기 도구와 Agent를 원천 차단하기 위해서다.
3. **무인 루프 정책**: 헤드리스 루프에서 guard의 `ask`는 실행되지 않으므로, push·패키지 설치 등은 자동으로 막힌다. 루프 설계는 이것을 전제로 한다.
4. **HUD**: `mis init`이 사용자 `statusLine` 등록 명령을 안내하고, 사용자가 승인하면 적용한다.
5. **3c가 실패할 경우**(auto 모드에서 ask가 자동 승인됨)
   - 승인 명령(`mis approve`)은 `deny`로 막는다.
   - 사용자가 `! node .../mis.mjs approve ...`를 직접 실행하는 방식으로 대체한다. `!` 명령은 훅을 거치지 않는 사용자 실행이다.

## 3c 수동 확인 절차

1. 새 터미널에서 실행: `cd <repo> && claude --plugin-dir ./evals/m0-smoke-plugin`
2. auto 모드로 전환(Shift+Tab)한 뒤 입력: `Run this exact bash command: echo MIS_ASK_TEST_INTERACTIVE`
3. 기록할 것: 확인 창이 떴는지 / 승인 없이 실행됐는지 / 차단됐는지
4. default 모드에서 2~3을 반복
