# 작업 인계 (HANDOFF) — 2026-10-21 갱신

다른 장비나 세션에서 이어서 작업하려면 이 문서부터 읽는다. 진행 기록의 원본은 `docs/PROGRESS.md`와 `git log`다.

## 1. 현재 상태

- **이 문서는 M1~M5 라인(`feature/make-it-ship-m1-m5`)의 인계 문서다.** 기능 전부 흡수(M6~M10) 라인은 로컬 `develop` 브랜치와 그 브랜치의 `docs/HANDOFF.md`에 따로 있다. 2026-10-21 기준 상태: M7까지 PASS, M8·M9는 검증 FAIL 후 수정이 중단됨, M10은 착수 전. 아래 3장 9번 참고.
- **M1~M5 구현 완료.** 마일스톤마다 독립 검증을 PASS했고, 최종 검증도 PASS다(`docs/milestones/FINAL-report.md`).
- **브랜치:** `feature/make-it-ship-m1-m5`
  - 원격: `github.com/tom910903/make-it-ship` (비공개)
  - 로컬 `develop`이 이 원격 브랜치를 추적한다.
- **태그:** `m1-verified` ~ `m5-verified`. 검증 당시의 커밋을 가리킨다.
- **테스트:** `npm test` 321/321 통과.
  - `claude plugin validate .claude-plugin/plugin.json` 통과. 이것이 플러그인 검사다.
  - `claude plugin validate .` 통과. 루트에 마켓플레이스 파일이 생겨서, 이 명령은 이제 마켓플레이스 매니페스트를 검사한다.
- **2026-10-21 작업은 원격 `feature/make-it-ship-m1-m5`에 push했다**(fast-forward). 커밋: `27f86f3`, `8052bd1`, `c0c11c2`, `9aaf3b1`, 그리고 문서 갱신.
- **최종 검증 이후 바뀐 것**(`FINAL-report.md`에는 없고, `POST-FINAL-report.md`가 7개 모두 검증함):
  1. `73e9260` — NH-1~4를 tmux 대화형 세션으로 자동 확인하고 기록했다(`docs/milestones/NH-auto-check.md`).
  2. `75f2fb8` — guard 수정. 파일 편집 범위를 세션 cwd가 아니라 **파일이 있는 worktree** 기준으로 판정한다.
  3. `a95fb61` — **BSP QA 프로파일 제거**(사용자 결정). NH-9는 해당 없음이다.
  4. `27f86f3` — `mis-bench` 테스트를 결정적으로 바꿨다. baseline을 1e6ms/1ms로 고정한다.
     - 부하를 걸고 비교했을 때 수정 전은 1/15 실패, 수정 후는 0/15 실패였다.
  5. `8052bd1` — **위험 플래그 `hardware` 제거**(사용자 결정). Spec §418과 다른 점은 SPEC_CHANGES에 기록했다.
  6. `c0c11c2` — NH-5 마켓플레이스 설치를 AUTO(tmux)로 확인했다. NH-6·7·8은 "추후 확인 필요"로 표시했다.
  7. `9aaf3b1` — guard 수정. 사후 재검증 D-1(MEDIUM)을 고쳤다.
     - 문제: 2번 수정 이후 `.git/` 내부와 중첩 저장소의 파일 편집이 run 중에도 allow됐다.
     - 결과는 `docs/milestones/POST-FINAL-report.md`에 있다.
  8. `49fd0e5`~`ea36af4` — README 설치 절차를 복사해서 바로 실행할 수 있게 바꿨다.
     - **저장소 자체를 마켓플레이스로 만들었다**(`.claude-plugin/marketplace.json`, `source: "."`).
     - GitHub에서 설치하는 경로와 업데이트 경로를 AUTO로 확인했다(`NH-auto-check.md`). 이 변경들은 POST-FINAL 검증 이후의 것이다.

## 2. 다른 장비에서 시작하기

```sh
git clone git@github.com:tom910903/make-it-ship.git && cd make-it-ship
git checkout feature/make-it-ship-m1-m5
node --version              # 22 이상
npm test                    # 321/321 기대
claude plugin validate .claude-plugin/plugin.json   # 통과 기대
claude --plugin-dir "$PWD"  # 다른 저장소에서 /make-it-ship:run ... 으로 사용
```
설치해서 쓰려면 `claude plugin marketplace add tom910903/make-it-ship` 다음에 `claude plugin install make-it-ship@make-it-ship`를 실행한다. 자세한 내용은 README Install에 있다.

외부 패키지 의존성은 없다. Node 내장 기능과 `node:test`만 쓴다.

## 3. 남은 일 (우선순위 순)

| # | 할 일 | 상태 / 필요한 것 | 참고 |
|---|---|---|---|
| 1 | ~~`mis-bench` 테스트 결정화~~ | **완료** (`27f86f3`, 9aaf3b1에서 보강) | — |
| 2 | ~~NH-5 마켓플레이스 설치 확인~~ | **AUTO 통과** (2026-10-21, 사용자 승인 후 진행). 사람 확인은 아직이다. | `NH-auto-check.md` NH-5 절 |
| 3 | **NH-1~5 사람 확인** | Claude가 tmux로 확인한 것은 AUTO로 통과했다. 사람이 직접 누르는 확인은 아직이다. | `NH-auto-check.md`, `NEEDS_HUMAN.md` |
| 4 | **NH-6 iOS 실기기 브리지** | **추후 확인 필요**(사용자 결정). 기능은 유지한다. iPhone(개발자 모드, USB)을 연결하면 진행할 수 있다. | `NEEDS_HUMAN.md` NH-6 |
| 5 | **NH-7 second opinion / NH-8 Codex 어댑터** | **추후 확인 필요**(사용자 결정). 사내 정책이 정해진 뒤 결정한다. | `NEEDS_HUMAN.md` NH-7·8 |
| 6 | ~~사후 변경 재검증~~ | **완료.** 처음에는 DEFECTS FOUND(D-1 MEDIUM)였고, `9aaf3b1`에서 수정한 뒤 재검증했다. | `POST-FINAL-report.md` |
| 7 | **master 전환** (계획: feature 브랜치에서 개발을 마친 뒤) | master를 만든다. PR은 선택이다(1인 비공개 저장소). **GitHub 기본 브랜치를 master로 바꾼다.** `marketplace add tom910903/make-it-ship`가 기본 브랜치에서 설치하기 때문이다. 이 시점에 10번(version 올리기)도 함께 한다. | — |
| 8 | ~~문서 업로드 정책 확인~~ | **결정됨**(2026-10-21, 사용자): 그대로 둔다. | — |
| 9 | **develop 라인과 합치기** | 오늘 이 브랜치에만 들어간 변경이 develop에는 없다: D-1 guard 수정, `hardware` 제거, bench 결정화, 마켓플레이스·README. develop에서 이어서 개발하기 전에 병합하거나 cherry-pick한다. `scripts/guard.mjs`·`policy.mjs`·README에서 충돌이 예상된다. | develop의 `docs/HANDOFF.md` |
| 10 | **버전 올리기** | `plugin.json` version은 아직 0.1.0이다. 이미 설치한 사용자에게 업데이트를 전달하려면 version을 올려 push해야 한다. version을 올리지 않으면 `plugin update`가 새 커밋을 받지 않는다(실측). | README Install, `NH-auto-check.md` |
| 11 | ~~간헐 실패 테스트 찾기~~ | **완료.** load 170~280에서 재현해 원인 두 개를 찾았다. 두 원인 모두 고정 시간 상한에 걸리는 문제였다. 수정한 뒤 load 100~150에서 3회 연속 통과했다. ① `mis-resume`: 마커를 5초만 기다림 → 마커가 생기거나 자식 프로세스가 끝날 때까지 기다리게 바꿈. ② `mis-concurrency`: 8개 동시 쓰기에서 lock 대기 기본값 30초를 넘김 → 이 테스트만 `MIS_LOCK_WAIT_MS`를 600초로 올림(제품 기본값은 그대로). | — |

## 4. 열린 결정 (사용자에게 물어볼 것)

- NH-6~8: 지금은 "추후 확인 필요"(2026-10-21 결정)다. 실기기와 사내 정책이 준비되면 유지할지, 닫을지, 제거할지 결정한다.
- 10번: 언제, 어떤 번호(예: 0.1.1)로 version을 올릴지
- 9번: develop 라인을 어떻게 할지. (2026-10-21 사용자: 먼저 이 feature 브랜치에서 개발을 마친 뒤 master로 만든다)
- (2026-10-21 결정됨) NH-5는 Claude가 진행했다. `hardware` 플래그는 제거했다. 문서 업로드는 그대로 둔다.

## 4-1. 남은 위험·정리 거리 (사후 재검증에서 나옴, LOW)

- guard: 다음 경우는 allow다. 의도적 우회는 위협 모델 밖이라 결함이 아니라 위험으로 둔다.
  - worktree 안의 implementer가 main 트리의 다른 task 파일을 편집하는 경우
  - `file_path`가 실제 경로가 아닌 경우. 예: `/private/tmp`가 아니라 `/tmp`로 주면 계획 범위 검사를 건너뛴다. 원래 guard부터 있던 동작이다.
  - (참고) 저장소 밖을 가리키는 symlink 편집과 저장소 밖 `.make-it-ship.json` 편집은 `9aaf3b1` 이후 다시 ask다.
- 문서 잔재:
  - `docs/milestones/M5-e2e.md`에 BSP 절차가 남아 있다. 역사 기록이라 수정하지 않았다.
  - Spec §435 qa 행에 BSP가 남아 있다. Spec은 수정하지 않는다는 규칙에 따라 그대로 두고, 대신 SPEC_CHANGES에 기록했다.
- bench: WARN 구간(20~50%)을 다루는 테스트가 없다.
- 설치 확인은 user 범위로만 했다. `--scope project` 설치는 GitHub 마켓플레이스에서 다시 확인하지 않았다.

## 5. 작업 규칙 (원래 /goal 지시에서)

- 우선순위: Spec v1.1(`docs/Make_It_Ship_Spec_v1.1.md` §2·§11·§14) > ADR(`docs/adr/`) > 기획서. **기획서와 ADR은 수정하지 않는다.** Spec과 다르게 가야 하면 PROGRESS.md `SPEC_CHANGES`에만 기록한다.
- 작업마다 TDD로 진행한다: 실패 테스트 → 최소 구현 → 전체 `npm test` → 커밋.
- **금지:**
  - 테스트 삭제·약화·skip
  - 실행하지 않은 검증을 통과로 기록하기
  - Spec에 없는 기능 추가(필요하면 PROGRESS.md 제안으로만)
  - 외부 패키지 추가
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
tmux new-session -d -s nh1 -x 220 -y 60 "claude --plugin-dir <repo> --setting-sources project,local --strict-mcp-config"
tmux send-keys -t nh1 -l "/make-it-ship:run Implement docs/feature-request.md. Use standard mode." && tmux send-keys -t nh1 Enter
tmux capture-pane -p -t nh1 | tail -30   # 확인 창 확인 후 Enter(승인) / Down+Enter(거절)
```

- headless 모드(`claude -p`)에서는 ask 확인 창이 뜨지 않는다(ADR-014). 확인 창을 검증하려면 위처럼 대화형 세션을 써야 한다.
- 사용자 전역 설정(`~/.claude/settings.json`)은 건드리지 않는다. HUD는 데모 저장소의 `.claude/settings.local.json`에 `statusLine`을 넣어 확인한다.
