# M5 E2E 기록 (2026-10-19)

| AC | 실사용·실측 | 결과 | 증거 |
|---|---|---|---|
| M5-01 retro | 파일럿 2 저장소에서 `/make-it-ship:retro`를 헤드리스로 실행 | `mis retro`가 기계 지표(실패→통과 1, 원인 기록 1, 중앙값 0.8분)를 집계했다. 모델은 지표에 근거한 습관 2개를 "판단"으로 구분해 덧붙였다. 학습 기록 기준(쉽게 찾을 수 없음, 코드베이스 특유, 발견에 노력)에 맞는 것이 없어 기록하지 않았다. 프로세스 변경도 제안하지 않았다 | `evidence/m5/retro-*` |
| M5-02 learn | 통합 테스트 | 검증, 추가 전용, 최신 우선, STALE 동작 확인 | `tests/integration/mis-learn.test.mjs` |
| M5-03 second opinion | `mis second-opinion detect` 실측 | 이 환경에는 codex·gemini CLI가 없다 → `available: []`이며 "설치되지 않아 생략"으로 처리했다. guard가 외부 모델 호출에 ask를 거는 동작은 테스트로 확인했다 | `mis-second.test.mjs` |
| M5-04 iOS 브리지 | `xcrun --sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios16.0-simulator -D DEBUG` | **DEBUG 타입체크 통과**(iPhoneSimulator 26.0 SDK). `-D DEBUG` 없이 빌드한 Release 라이브러리를 `nm -j`로 보면 `DebugBridge` 심볼이 **0개**다. `xcrun devicectl list devices` 결과는 "No devices found" → 기기 QA는 BLOCKED다 | 이 문서, `mis-ios.test.mjs` |
| M5-05 BSP | 통합 테스트(합성 Yocto·Buildroot·커널 트리) | 빌드 check를 제안한다. `qa-bsp`(타깃)가 없으면 Standard 이상에서 VERIFIED가 불가하다 | `mis-qa.test.mjs` |
| M5-06 bench | 통합 테스트(5회 반복해도 결과가 같음) | BASELINE/OK/REGRESSION 판정과 보고서 반영 | `mis-bench.test.mjs` |
| M5-07 토큰 예산 | 공식 문서로 statusLine 입력 필드 확인(`cost.total_cost_usd`, `workspace.current_dir`; code.claude.com/docs/en/statusline) | HUD에 비용을 표시하고, doctor는 "token budget not supported"로 경고한다. 강제는 미지원이다 | `statusline.test.mjs` |
| M5-08 Codex 어댑터 | 파일 검사 | mis 명령과 phase 경로가 실재한다. guard가 강제되지 않는다는 점을 명시했다 | `plugin-files.test.mjs` |

## NEEDS_HUMAN
- **NH-6** iOS 실기기 브리지
  - 절차: 실기기를 연결하고 데모 iOS 앱에 `templates/ios-debug-bridge`를 README 절차대로 추가한다. DEBUG로 설치·실행한 뒤, 터널을 통해 `/healthz`, `/state`, `/screenshot` 응답을 확인한다.
  - 이어서 README의 제거 절차를 따른 다음 `mis ios bridge-scan`이 비어 있는지, `mis ship`이 READY인지 확인한다.
- **NH-7** second opinion 실제 호출: codex 또는 gemini CLI 설치·로그인이 필요하고, 외부 서비스로 코드가 전송된다. 사내 정책상 합성 데모 저장소에서만 실행한다. 확인할 것은 세 가지다: guard 확인 창이 뜨는지, `mis note second-opinion`으로 기록되는지, 보고서에 표시되는지.
- **NH-8** Codex 어댑터 실제 사용: Codex CLI로 데모 A에서 `adapters/codex/AGENTS.md` 흐름을 따라 VERIFIED까지 가는지 확인한다(외부 서비스).
- **NH-9** BSP 실제 빌드·타깃 검증: Yocto 등 실제 BSP 트리와 보드가 필요하다. 사내 BSP 코드는 평가셋에 넣지 않는다.
- **NH-3** HUD 비용 표시: 실제 상태 줄에 `$x.xx`가 나오는지 확인한다.
