# Make It Ship 결과 보고서 — 20261019-1230-81f8

> **판정: VERIFIED** — 배포 준비 완료 (정의된 검증 범위 안에서)
> 판정은 `mis verdict`가 규칙(Spec §6)으로 계산했다. 모델이 정한 값이 아니다.
> 코드 상태(tree): `51c2b38fc9c5d0aaa41d0a192600a5f027389bf2` · 모드: standard — Small change but touches authorization (auth risk flag forces at least Standard) · 생성: 2026-10-19T03:35:42.048Z

## 1. 목표와 달성 여부
목표: Add canDelete(user, doc) (admin, or owner who is an editor) and make canView/canEdit/canDelete deny every role other than admin/editor/viewer.

달성 여부: 수용 조건과 필수 검증이 현재 코드 기준으로 충족됨

제약: Known-role behavior of canEdit and canView stays the same for users with an id: admin and editor can edit any doc; a viewer can edit only docs they own; admin/editor/viewer can view. Deliberate tightening: a user whose id is null/undefined never counts as an owner; Role match is exact and case-sensitive, using an array/Set membership check (not object-key lookup), so 'constructor' or '__proto__' are unknown roles; Ownership means user.id != null && user.id === doc.ownerId (a user without an id, null or undefined, owns nothing); No new dependencies; ES module exports from src/authz.js; tests use node:test + node:assert/strict

## 2. 작업 상태 (모델 판단)
- [DONE] T1 Deny unknown roles in canView and canEdit; require a non-null id for ownership — 수용 기준: canEdit({id:2, role:'guest'}, {id:9, ownerId:2}) === false (unknown-role owner); canEdit with role undefined and owner match === false; canView({role:'guest'}), canView({role:'Admin'}), canView({role:'constructor'}), canView({}) === false; canEdit({role:'viewer'}, {id:9}) === false and canEdit({id:null, role:'viewer'}, {id:9, ownerId:null}) === false; Existing cases unchanged: editor non-owner edit true, viewer non-owner edit false, viewer owner edit true, admin edit true, admin/editor/viewer view true
- [DONE] T2 Add canDelete(user, doc) — 수용 기준: admin non-owner -> true; editor owner -> true; editor non-owner -> false; viewer owner -> false; viewer non-owner -> false; unknown role owner ('guest', 'Admin', 'constructor', undefined) -> false; canDelete({role:'editor'}, {id:9}) === false and canDelete({id:null, role:'editor'}, {id:9, ownerId:null}) === false
- [DONE] T3 Role x ownership matrix test for all three functions — 수용 기준: A table test covers roles admin, editor, viewer, guest, Admin, constructor, undefined x owner/non-owner for canView, canEdit, canDelete (42 assertions; canView expected identical for owner and non-owner) with expected values matching the rules above; npm test passes

## 3. 변경한 기능과 주요 파일
- A `.make-it-ship.json`
- M `src/authz.js`
- M `test/authz.test.js`

## 4. 수행한 검증과 실제 결과 (기계 검증)
| ID | check | 명령(argv) | exit | 기록 당시 | 현재 코드 기준 | 종료 시각 |
|---|---|---|---|---|---|---|
| E1 | unit | `npm test` | 0 | PASS | STALE | 2026-10-19T03:34:17.857Z |
| E2 | unit | `npm test` | 0 | PASS | STALE | 2026-10-19T03:34:29.757Z |
| E3 | unit | `npm test` | 0 | PASS | PASS | 2026-10-19T03:34:44.427Z |

## 5. 리뷰 (모델 판단)
- plan-critic: blocking 0, major 0 — 현재 코드 기준 (`reviews/1-plan-critic.md`)
- spec: blocking 0, major 0 — 현재 코드 기준 (`reviews/2-spec.md`)
- quality: blocking 0, major 0 — 현재 코드 기준 (`reviews/3-quality.md`)
- security: blocking 0, major 0 — 현재 코드 기준 (`reviews/4-security.md`)

## 6. 검증하지 못한 영역과 이유
없음

## 7. 코드 변경 이후 무효가 된 검증
- E1 `unit` (PASS) — 이후 코드 또는 설정이 바뀌어 무효
- E2 `unit` (PASS) — 이후 코드 또는 설정이 바뀌어 무효

## 8. 사용자 결정·배포 전 주의사항
- 가정: Q1 (MED) Should a viewer who owns a document keep edit rights (current canEdit grants owner edit regardless of role)? → Default: keep existing behavior (viewer-owner may edit); request does not change edit rules for known roles (다르면 알려 달라)
- 가정: Q2 (LOW) Are role names case-sensitive (e.g. Admin)? → Default: case-sensitive exact match, as in existing code; 'Admin' is an unknown role and is denied (다르면 알려 달라)
- 가정: Q3 (HIGH) Does an unknown-role owner lose edit on their own doc? → Yes - answered by REQUEST.md: 'Unknown roles are denied everything (canView/canEdit/canDelete)' (다르면 알려 달라)
- 원격 push·PR·배포는 사용자 승인 후에만 수행한다.

## 9. 실행·확인 방법
- `npm test`
- `npm test` (필수 check 재실행)

## 10. 의도적 지름길 (shortcut)
코드의 `shortcut: <한계>, <업그레이드 시점>` 주석 목록이다. 트리거가 없는 항목은 방치될 위험이 있다.

No shortcut debt.

## 정직성 표기
- **기계 검증**: 4절의 check 결과. `mis check`가 명령을 직접 실행하고 exit code를 기록했다.
- **모델 판단**: 2절 작업 완료 여부, 5절 리뷰, 수용 기준 충족 여부. 모델이 작성했으며 기계로 확인되지 않았다.
- **미지원**: 토큰 예산 — 플러그인은 토큰 사용량을 얻을 수 없다. 실행 시간·재시도 상한만 강제한다.
