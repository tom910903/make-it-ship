# HUD 기본값과 쉬운 설정 — 설계

- 상태: 확정(2026-11-13). 설계는 사용자가 "그대로 진행"으로 확인, 기본 구성은 focused로 결정
- 구현: 0.9.0 (`scripts/lib/hud-items.mjs`, `scripts/lib/hud-sources.mjs`, `scripts/statusline.mjs`, `mis hud`, `skills/hud/SKILL.md`)
- 날짜: 2026-11-13
- 선행 작업: OMC 전용 HUD 항목 구현(로컬 커밋 ed95ebb, push 없음)

## 배경

- 0.8.0에서 Claude Code가 넘겨주는 모든 필드를 HUD 항목으로 만들고, `statusLine.items` 목록과 `mis hud set|add|remove|reset`, `/make-it-ship:hud`로 고르게 했다. 기본값은 "모든 항목, 한 줄"이라 너무 길다.
- 선행 작업으로 OMC에만 있던 항목(repo, git 변경 상태, 마지막 프롬프트 후 경과, 마지막 스킬, 호출 수, 백그라운드 작업, API 키 출처, 에이전트 상세 줄, duration 상태 색, thinking 의미 변경)이 추가된다.
- 지금 불편한 점: `mis`가 PATH에 없어 명령이 길다, 항목 이름을 알아야 한다, 목록을 통째로 저장해서 업데이트로 생긴 새 항목이 바꾼 사용자에게 보이지 않는다.

## 목표

1. 기본으로 보일 항목을 정해 프리셋(minimal / focused / full)으로 제공한다.
2. 명령 이름을 몰라도 HUD를 바꿀 수 있게 한다: `/make-it-ship:hud`가 프리셋 선택 → 그룹별 조정 → 미리보기 → 저장 순서로 묻는다.
3. 업데이트로 생긴 새 항목이 프리셋에 들어 있으면, 이미 HUD를 바꾼 사용자에게도 보인다.

## 인터뷰 결정

| qid | 질문 | 결정 | 근거 |
|---|---|---|---|
| hud-config-ux | HUD를 쉽게 설정하는 방법 | 프리셋 + 대화형 선택 | 사용자 선택(추천안). 웹 설정 페이지, `mis` PATH 등록은 선택하지 않음 |
| hud-storage-model | 저장 방식 | 프리셋 + 바꾼 것만 저장 | 사용자 선택(추천안) |
| hud-default-preset | 기본 구성(프리셋 내용, 줄 구성) | focused (두 줄 + 에이전트별 줄) | 사용자 선택(추천안). 이 세션의 실제 값으로 렌더한 세 프리셋을 비교 |

## 설계

### 1. 저장 형식 (`~/.make-it-ship/config.json`)

```json
"statusLine": {
  "preset": "focused",
  "add": ["git"],
  "remove": ["style"],
  "chain": ""
}
```

- `preset`: `minimal` | `focused` | `full` | `custom`. 없으면 기본 프리셋.
- `add` / `remove`: 프리셋 기준으로 켜고 끈 항목.
- `items`: `preset`이 `custom`일 때만 쓰는, 순서까지 고정한 목록.

### 2. 해석 규칙

1. `preset`이 `custom`이면 `items`를 그대로 쓴다(모르는 이름은 무시).
2. `preset`이 없고 `items`만 있으면(0.8.0 형식) `custom`으로 본다.
3. 그 밖에는 프리셋 목록에서 `remove`를 빼고 `add`를 넣는다. 추가한 항목은 끝이 아니라 제자리에 들어간다(예: focused에 `cost`를 넣으면 1행의 `spend` 뒤, `repo`는 2행의 `branch` 앞). 기준은 3절의 full 프리셋이다.
4. 모르는 프리셋 이름은 기본 프리셋으로 본다.

### 3. 프리셋

`br`은 줄바꿈이다. 각 항목은 값이 있을 때만 보인다. `agents-list`는 에이전트마다 한 줄을 차지하므로 프리셋 맨 끝에 둔다.

| 프리셋 | 항목 |
|---|---|
| minimal | `model effort fast ctx 5h 7d spend loop frozen agents todo` (한 줄) |
| focused (기본) | `model effort fast thinking ctx 5h 7d spend` / `branch git pr worktree duration prompt skill calls loop frozen agents bg todo` / `agents-list` |
| full | `model effort fast thinking ctx 5h 7d spend cost cache` / `repo branch git pr worktree duration prompt lines skill calls loop frozen agents bg todo` / `style apikey session agent vim output-style` / `agents-list` |

full은 모든 항목을 담는다. 2절의 "기본 순서상 제자리"는 full의 순서와 줄을 기준으로 한다: 추가한 항목은 full에서 같은 줄에 있는 바로 앞 항목 뒤에, 그런 항목이 없으면 같은 줄의 바로 뒤 항목 앞에 들어간다.

focused 예시(이 세션의 실제 값으로 렌더, NO_COLOR):

```
MIS ▸ idle · Opus 5.5 · effort max · think · ctx ████░░░░░░ 42% · 5h ██░░░░░░░░ 23% (3h42m) · 7d ███████░░░ 71% (2d4h)
master · ?1 ⇡1 · 1h13m · prompt 1m24s · skill interview · 🔧779 🤖35 ⚡1 · agents 2 · bg 1 · todo 1/3
├─ explorer 0s
└─ critic 0s
```

### 4. `mis hud` 명령

| 명령 | 동작 |
|---|---|
| `mis hud` | 현재 프리셋, 추가·제외 항목, 최종 항목 순서, 전체 항목과 설명, 미리보기 |
| `mis hud preset <이름>` | 프리셋 변경. `add`/`remove`는 비운다(이전 프리셋 기준이라서) |
| `mis hud add <항목…>` | `remove`에 있으면 거기서 빼고, 프리셋에 없으면 `add`에 넣는다 |
| `mis hud remove <항목…>` | `add`에 있으면 거기서 빼고, 프리셋에 있으면 `remove`에 넣는다 |
| `mis hud set <항목…>` | `custom`으로 바꾸고 순서까지 그대로 저장(`br`로 줄 나눔) |
| `mis hud reset` | `preset`/`add`/`remove`/`items`를 지운다. `chain`은 유지 |
| `mis hud preview [--preset <이름>]` | 마지막 상태줄 입력(없으면 샘플 입력)으로 렌더한 결과 |

`add`/`remove`는 프리셋 기준일 때 `br`을 받지 않는다. 줄 구성을 직접 바꾸려면 `set`을 쓴다. `custom`일 때는 0.8.0처럼 목록 자체를 고친다(추가는 끝에, `br` 허용).

`mis hud`는 그룹별 항목(on/off, 설명)과 세 프리셋의 미리보기를 함께 돌려준다. 스킬은 이 출력 하나로 질문을 만든다.

그룹(8개, 각 4개 항목): 모델 `model effort thinking fast`, 사용량 `ctx 5h 7d spend`, 비용 `cost lines cache duration`, git `repo branch git pr`, 작업 `loop agents agents-list todo`, 활동 `prompt skill calls bg`, 세션 `worktree session agent output-style`, 기타 `style frozen vim apikey`.

### 5. `/make-it-ship:hud` 대화 흐름

1. 프리셋 질문: 프리셋마다 실제 렌더 결과를 미리보기로 붙인다(`mis hud preview --preset <이름>`).
2. 같은 호출에서 "세부 조정" 질문: 그대로 저장 / 항목 켜고 끄기 / 순서·줄 직접 정하기.
3. 켜고 끄기를 고르면 "조정할 그룹" 질문(여러 개 선택). 그룹이 8개라 4개씩 두 질문으로 나눈다.
4. 고른 그룹마다 "보일 항목을 모두 고르세요" 질문(여러 개 선택, 지금 켜진 항목 표시). 그룹마다 항목이 4개라 질문 하나에 들어간다. 한 번에 질문 4개까지 묶는다.
5. 고른 결과를 프리셋 대비 `add`/`remove`로 바꿔 `mis hud preset …`, `add …`, `remove …`를 실행하고, `mis hud preview`로 결과를 보여 준다.
6. 사용자에게 항목 이름이나 명령을 입력하라고 요구하지 않는다. 순서·줄 직접 정하기를 고른 경우에만 `set`을 쓴다.

### 6. 미리보기 데이터

상태줄이 받은 마지막 입력을 `~/.make-it-ship/statusline-last.json`에 저장한다(5초에 한 번까지, 실패해도 출력에 영향 없음). 로컬 파일이고 밖으로 보내지 않는다. 입력이 없으면 고정 샘플을 쓴다.

### 7. 이전 설정 호환

0.8.0의 `statusLine.items`는 `custom`으로 그대로 동작한다. 여러 줄일 때 `statusLine.chain`의 첫 줄은 0.8.0과 같이 1행 끝에 ` | `로 붙는다. `mis config set`은 `statusLine.preset`, `statusLine.add`, `statusLine.remove`도 검증한다.

## 제약

- Spec/ADR 문서는 바꾸지 않는다. 테스트를 약화·삭제하지 않는다.
- 상태줄은 빠르고, 어떤 경우에도 예외를 내거나 오류를 출력하지 않는다.
- 설정은 전역(`~/.make-it-ship/config.json`) 하나다.
- 버전 올림과 push는 이 작업이 끝난 뒤 한 번에 한다.

## 비목표

- 웹 설정 페이지, `mis` PATH 등록(인터뷰에서 선택하지 않음).
- 프로젝트별 HUD 설정.
- 터미널 폭에 맞춘 자동 줄바꿈(상태줄 입력에 폭 정보가 없음).
- 제외한 OMC 요소: 세션 요약(`claude -p`로 토큰 소모), mission board, 권한 추정, custom buckets, cwd, hostname, profile, lastTool, tokens, context warning.

## 수용 기준

1. 설정이 없으면 focused 프리셋 항목이 그 순서와 줄로 렌더된다. (unit + 스크립트)
2. `mis hud preset full` 뒤 config에는 `preset: "full"`만 남고 렌더 결과는 full 프리셋과 같다. (integration)
3. focused에서 `mis hud add git` → `add: ["git"]`, 출력에서 `git`이 `branch` 바로 뒤에 온다. (integration)
4. `mis hud remove style` → `remove: ["style"]`. 프리셋 정의에 새 항목을 넣으면(테스트에서 주입) 그 항목은 보이고 `style`은 계속 안 보인다. (unit)
5. `mis hud set a br b` → `preset: "custom"`, 그 순서와 줄 구성 그대로 렌더된다. (integration)
6. `items`만 있는 0.8.0 설정은 이전과 같은 출력을 낸다. (unit)
7. `mis hud reset`은 `chain`만 남긴다. (integration)
8. `mis hud preview`는 마지막 입력이 있으면 그것으로, 없으면 샘플로 렌더한다. (integration)
9. 상태줄의 마지막 입력 저장은 5초에 한 번까지이고, 저장 실패가 출력을 바꾸지 않는다. (unit)
10. `/make-it-ship:hud` 스킬은 5절 흐름을 따르고, 질문당 선택지 4개 이하로 그룹을 나눈다. (plugin-files 테스트 + 문서 검토)
11. `mis config set`이 새 키의 잘못된 값을 거부한다. (integration)
12. 전체 `npm test`와 CI가 통과한다.

## 가정

| 가정 | 확인 방법 | 결과 |
|---|---|---|
| 상태줄 입력은 갱신마다 전체 객체로 들어온다 | Claude Code 바이너리의 입력 생성 함수 확인 | 확인됨 |
| AskUserQuestion은 질문당 선택지 4개, 호출당 질문 4개까지 | 도구 정의 확인 | 확인됨 |
| 설정 변경은 재시작 없이 반영된다 | `statusline.mjs`가 갱신마다 설정을 읽음 | 확인됨 |
| 여러 줄 출력은 줄마다 표시된다 | 실제 화면 | 미확인 |

## 열린 질문

없음.

## 자체 검토

- 자리표시자: 없음(3절 프리셋 확정).
- 모순: 2절 "제자리" 기준을 3절 full 프리셋으로 통일. `custom`의 `add`/`remove`는 0.8.0 동작 유지로 명시.
- 모호함: 프리셋 변경 시 `add`/`remove` 초기화, `br` 처리, 여러 줄일 때 `chain` 위치(1행 끝, 0.8.0과 같음)를 명시.
- 범위: 웹 페이지·PATH 등록·프로젝트별 설정은 비목표로 분리.
