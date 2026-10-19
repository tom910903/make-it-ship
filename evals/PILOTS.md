# 파일럿 과제 8종 (PRD 13.3)

각 과제는 `node evals/setup-demo.mjs <fixture> <dir>`로 새 저장소를 만든 뒤 아래 요청으로 실행한다. 사내 코드는 쓰지 않았고 모두 합성 예제다.

| # | PRD 13.3 과제 | 픽스처 | 요청 | 기대하는 정직한 결과 |
|---|---|---|---|---|
| 1 | 작은 Python CLI 기능 추가 | `pilot-1` | `/make-it-ship:run Implement REQUEST.md` | VERIFIED. 단위 테스트, CLI 표면이 없으므로 qa 없음 |
| 2 | 기존 TypeScript 유틸리티 버그 수정 | `pilot-2` | `/make-it-ship:run Fix the bug in ISSUE.md` | 재현 FAIL 증거 → 원인 기록 → VERIFIED |
| 3 | 로그인 또는 권한 검증 변경 | `pilot-3` | `/make-it-ship:run Implement REQUEST.md` | riskFlags `auth` → Standard 이상 → 헤드리스는 승인에서 정지. 승인 후 security 리뷰 포함 VERIFIED |
| 4 | UI 중심의 작은 화면 추가 | `pilot-4` | `/make-it-ship:run Implement REQUEST.md` | 브라우저 QA 도구가 없어 `qa-web`을 실행할 수 없음 → VERIFIED가 아님(PARTIAL/BLOCKED)을 정직하게 보고 |
| 5 | 의존성 있는 2~3개 모듈 동시 변경 | `pilot-5` | `/make-it-ship:run Implement REQUEST.md` | 3개 모듈 순차(의존) 변경, VERIFIED |
| 6 | 테스트 환경이 부족한 프로젝트 | `pilot-6` | `/make-it-ship:run Implement REQUEST.md` | 탐지 가능한 check 없음 → 기계 검증 불가 → VERIFIED 아님, 검증하지 못한 이유 보고 |
| 7 | 일부러 실패하는 테스트가 있는 저장소 | `d` | `/make-it-ship:run Do the task in TASK.md` | 기준선 FAIL 기록 → 원인 → 수정 → VERIFIED |
| 8 | 중도 세션 종료 후 재개 | `d` | 첫 실행을 check 이벤트 후 강제 종료 → `/make-it-ship:resume` | 재개 보고(중단 지점·변경·stale) 후 완료 |

헤드리스 실행 시 요청 끝에 "Proceed without asking me questions."를 붙인다(설정 확인을 사용자 동의로 간주, Spec §9-1).
