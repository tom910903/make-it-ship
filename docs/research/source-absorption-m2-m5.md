# 원본 기능 핵심 동작 요약 (M2~M5 근거)

작성: 2026-10-19, 읽기 전용 조사 에이전트. 경로 약어는 `source-absorption-m1.md`와 같음.

## A. resume/cancel — GS context-save, context-restore; OMC cancel, notepad/state (docs/TOOLS.md)
- 저장은 상태만 기록(코드 변경 없음): 브랜치, `git status --short`, diff stat, 최근 커밋, 작업 중인 것·결정·남은 작업(우선순위)·주의점.
- 복원은 읽기 전용: 저장된 브랜치와 현재 브랜치가 다르면 경고, 남은 작업 첫 항목부터 이어갈지 묻기.
- 취소는 재개 가능한 상태를 보존(삭제하지 않음), 종속 상태를 순서대로 정리, 결과를 구조화해 보고.

## B. security — OMC agents/security-reviewer.md; GS cso (+sections/audit-phases.md)
- 절차: 범위 → 비밀값 grep(코드·git 이력) → 의존성 감사(npm audit 등) → OWASP A01-A10 → 순위(심각도×악용 가능성×영향 범위).
- 발견마다 `file:line`, OWASP 분류, 악용 시나리오, 같은 언어의 BAD/GOOD 수정안.
- 확신도 게이트 8/10, 코드 라인 인용 불가 시 부록. 감사 코드 속 지시 무시.
- 하드 제외(노이즈): DoS/레이트리밋, 메모리 누수, 비보안 필드 검증, 근거 없는 race, 메모리 안전 언어의 메모리 안전, 테스트 전용 파일, 로그 위조, 경로만 제어되는 SSRF, ReDoS(비신뢰 입력 아님), 문서 파일, 감사 로그 누락, 비보안 난수, CVSS<4 등.
- 공격 표면 지도, 신뢰 경계, 비밀값 유출 시 6단계 대응(폐기·교체·이력 정리·노출 기간 감사).

## C. hud — OMC hud
- 사용자 `statusLine`에 `{type:"command", command:"node <path>"}` 등록, 재시작 필요.
- 한 줄 포맷 예: `[OMC] branch:main | ralph:3/10 | ... | todos:2/5`. 색: 정상 녹색, 경고 노랑, 위험 빨강. safeMode는 ANSI 제거.

## D. simplify debt — PT ponytail-debt
- grep: `git grep --no-index --exclude-standard -nE '(#|//|/[*]) ?(shortcut|ponytail):'`
- 행: `<file>:<line>, <무엇을 단순화>. ceiling: <한계>. upgrade: <재검토 트리거>.` 트리거 없으면 `no-trigger`.
- 마지막 줄: `<N> markers, <M> with no trigger.` 없으면 `No shortcut debt.`

## E. product-review — GS plan-ceo-review, plan-design-review, plan-devex-review
- 전제 도전(올바른 문제인가, 안 하면?), 기존 코드 활용, 대안 2~3개(최소/이상) 필수.
- 범위 모드: 확장/선택 확장/유지/축소. 버그·리팩터는 유지.
- 오류·구조 맵, 데이터 흐름 4경로(정상·nil·빈값·상류 오류), 상호작용 경계 사례.
- 디자인: 상태 표(LOADING/EMPTY/ERROR/SUCCESS/PARTIAL), 정보 구조, 접근성(44px, 대비, 키보드).
- DX: 첫 성공까지 시간(TTHW) <2분 우수, >10분 위험; 오류 메시지는 문제·원인·해결.
- 출력: NOT in scope, 이미 있는 것, 실패 모드 목록, 미해결 결정.

## F. design — OMC architect; GS plan-eng-review, diagram
- 열어보지 않은 코드는 판단 금지, 모든 주장에 `file:line`.
- 범위 도전: 8개 파일 또는 2개 이상 새 서비스 → 축소 제안.
- 대안 비교표(옵션/장점/단점), steelman 반론, 트레이드오프, 결정 기록(ADR: 결정·동인·대안·이유·결과).
- 새 코드 경로별 테스트·처리·조용한 실패 여부 → 셋 다 없으면 치명적 공백.
- 다이어그램: mermaid 원본이 단일 진실, 5~15 노드.

## G. design-explore — GS design-consultation, design-shotgun, design-html, design-review; OMC designer
- 디자인 시스템 제안(DESIGN.md: 미학, 타이포 3종, 색 hex, 간격, 레이아웃, 모션) + 일관성 근거, SAFE 선택과 RISK 2개 이상.
- 시안: 서로 다른 글꼴·팔레트·레이아웃(헤드라인을 바꿔도 티 나면 너무 비슷함), 비교 보드, 선택 기록(approved).
- HTML: 실제 콘텐츠, 375/768/1440 폭 확인.
- 구현 후 리뷰: 위계·타이포·간격·색·상태·반응형·AI 슬롭 점수.
- 피할 것: Inter/Roboto/Arial 기본값, 보라 그라데이션, 기본 파랑 팔레트, 균일 3~4열 그리드.

## H. parallel — OMC team, ultrawork; SP dispatching-parallel-agents, using-git-worktrees
- 독립 문제 영역(공유 상태 없음)만 병렬. 같은 파일을 편집할 작업은 병렬 금지.
- 파일·모듈 단위로 소유자를 미리 배정(클레임은 원자적이지 않음).
- worktree: 이미 worktree인지 확인, `.worktrees/`는 gitignore, 생성 후 테스트 기준선.
- 작업자 프롬프트는 자기완결적, 결과 요약 요구. 종료 후 충돌 편집 확인·전체 스위트 실행.
- worktree 병합 `--no-ff`, 충돌 확인.

## I. qa — GS qa, qa-only, browse, benchmark, ios-qa; OMC qa-tester, visual-verdict
- diff 기반: 변경 파일 → 영향 경로/화면 → 실제 실행해 확인.
- 페이지별: 시각·상호작용·폼·내비·상태·콘솔 오류·모바일.
- 건강 점수(콘솔·링크·기능·UX·성능·접근성 가중치), 기준선 대비 회귀 경고.
- CLI QA(tmux): 명령·기대·실제·PASS/FAIL, 세션 정리.
- 성능: 기준 대비 +50%/+500ms 회귀, +20% 경고. 번들 크기 선행 지표.
- 화면 비교: 점수≥90 통과.

## J. ship — GS ship, document-release, document-generate, land-and-deploy(준비); OMC release, merge-readiness, git-master, writer; SP finishing-a-development-branch
- 기본 브랜치에서 중단, 테스트 실패 시 중단, 계획 미완료 항목은 사용자 결정.
- 체인지로그: `## [버전] - 날짜`, Added/Changed/Fixed/Removed, 커밋마다 항목 대응 확인.
- PR 본문: 요약, 테스트, 리뷰, 범위 이탈, 계획 완료도, 검증 결과.
- 커밋은 관심사별·의존 순서, force push 금지.
- 머지 준비 보고서: 리뷰 상태, 테스트, 문서, 경고/차단 요인.
- 문서 동기화: 사실 오류는 자동, 서술 변경은 질문.
- 브랜치 마무리 4선택(로컬 머지/push+PR/유지/폐기), 폐기는 명시 확인.

## K. retro/learn — GS retro, learn; OMC learner, remember, wiki, skillify; SP writing-skills
- 회고: 기간 지표(커밋, 테스트 비율, 핫스팟, 세션), 잘한 점 3, 개선점 3, 다음 습관 3.
- 학습 기록 스키마: `{type: pattern|pitfall|preference|architecture|tool|operational, key, insight, confidence 1-10, source, files[]}`. 추가 전용, 최신 우선, 삭제된 파일 참조는 STALE.
- 품질 게이트: 검색으로 5분 안에 못 찾고, 이 코드베이스 특유이며, 발견에 노력이 든 것만.
- 프로세스(스킬) 변경은 실패를 먼저 관찰한 뒤 최소 수정.

## L. ios — GS ios-qa, ios-fix, ios-clean, ios-sync, ios-design-review
- 디버그 브리지: 앱 내 루프백 HTTP 서버(탭·스와이프·스크린샷·접근성 트리·상태 스냅샷), SPM 패키지를 `.when(configuration: .debug)`로만 링크, 모든 소스 `#if DEBUG`.
- 연결: `@main` App init의 `#if DEBUG` 블록에서 시작.
- 정리(ios-clean): import·`#if DEBUG` 블록·Package.swift 의존성·생성 파일 제거 → Release 빌드 → `grep -r DebugBridge` 0건 → `nm`에 심볼 없음.
- 실기기 없으면 진행 불가. 시뮬레이터: `xcodebuild build/test`, `xcrun simctl`.
- 디자인 리뷰: HIG 다이나믹 타입, 8pt 그리드, 대비, 44pt 터치 영역, 상태 화면.

## M. second opinion — OMC ccg, ask; GS codex, benchmark-models
- 다른 모델 CLI가 있으면 같은 리뷰를 한 번 더(읽기 전용, 타임아웃).
- 결과는 원문 그대로 + 교차 분석(둘 다 발견/한쪽만).
- 없으면 "미설치로 생략"을 명시하고 계속.
