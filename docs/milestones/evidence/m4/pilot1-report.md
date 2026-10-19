# Make It Ship 결과 보고서 — 20261019-1230-3be6

> **판정: VERIFIED** — 배포 준비 완료 (정의된 검증 범위 안에서)
> 판정은 `mis verdict`가 규칙(Spec §6)으로 계산했다. 모델이 정한 값이 아니다.
> 코드 상태(tree): `840d8e76159b3ff3ec6a522a1651c2524dd8b051` · 모드: quick — Single small flag on a 20-line CLI, no risk flags · 생성: 2026-10-19T03:31:17.419Z

## 1. 목표와 달성 여부
목표: Add a --lines flag to wc.py that prints the line count instead of the word count, keeping default behavior unchanged.

달성 여부: 수용 조건과 필수 검증이 현재 코드 기준으로 충족됨

제약: Default output (word count) unchanged; No new dependencies; Only \n ends a line

## 2. 작업 상태 (모델 판단)
- [DONE] T1 Add count_lines and --lines flag with tests — 수용 기준: count_lines('') == 0; count_lines('a\nb\n') == 2; count_lines('a\nb') == 2; count_lines('\n') == 1; main(['--lines', f]) prints line count; main([f]) prints word count (tested via captured stdout)

## 3. 변경한 기능과 주요 파일
- A `.make-it-ship.json`
- M `tests/test_wc.py`
- M `wc.py`

## 4. 수행한 검증과 실제 결과 (기계 검증)
| ID | check | 명령(argv) | exit | 기록 당시 | 현재 코드 기준 | 종료 시각 |
|---|---|---|---|---|---|---|
| E1 | unit | `python3 -m unittest discover -s tests -v` | 0 | PASS | PASS | 2026-10-19T03:30:43.937Z |

## 5. 리뷰 (모델 판단)
- quality: blocking 0, major 0 — 현재 코드 기준 (`reviews/1-quality.md`)

## 6. 검증하지 못한 영역과 이유
없음

## 7. 코드 변경 이후 무효가 된 검증
없음

## 8. 사용자 결정·배포 전 주의사항
- 가정: Q1 (MED) Is a final line without a trailing newline counted, and which characters end a line? → Default: only \n ends a line (\r\n is normalized by text-mode open); a final line without a trailing newline counts as one line, so 'a\nb' = 2, 'a\nb\n' = 2, '' = 0. (다르면 알려 달라)
- 원격 push·PR·배포는 사용자 승인 후에만 수행한다.

## 9. 실행·확인 방법
- `python3 -m unittest discover -s tests -v`
- `python3 wc.py --lines REQUEST.md`
- `python3 -m unittest discover -s tests -v` (필수 check 재실행)

## 10. 의도적 지름길 (shortcut)
코드의 `shortcut: <한계>, <업그레이드 시점>` 주석 목록이다. 트리거가 없는 항목은 방치될 위험이 있다.

No shortcut debt.

## 정직성 표기
- **기계 검증**: 4절의 check 결과. `mis check`가 명령을 직접 실행하고 exit code를 기록했다.
- **모델 판단**: 2절 작업 완료 여부, 5절 리뷰, 수용 기준 충족 여부. 모델이 작성했으며 기계로 확인되지 않았다.
- **미지원**: 토큰 예산 — 플러그인은 토큰 사용량을 얻을 수 없다. 실행 시간·재시도 상한만 강제한다.
