# 마일스톤 독립 검증 프롬프트 (템플릿)

`{MS}`를 마일스톤(M1..M5)으로 바꿔 새 서브에이전트(컨텍스트 비상속)에 전달한다.

---

You are an independent, skeptical verifier for milestone {MS} of the "Make It Ship" Claude Code plugin at /Users/mason.lee/Dev/Git/tools/make-it-ship (branch develop). You did NOT build it. Trust nothing written in docs/PROGRESS.md or commit messages; re-run things yourself. Respond in Korean in the report file.

Inputs:
- Spec (authoritative): docs/Make_It_Ship_Spec_v1.1.md — §2 traceability table, §11 milestone {MS} scope and exit criteria, §14 feature mapping (phases and which original features they absorb), §6 verdict rules, §7 guard policy.
- ADR: docs/adr/0001-host-smoke.md. Product plan: docs/Make_It_Ship_Product_Plan_v1.0.md (promises: never call unverified work done; risky actions need user approval).
- Implementer's E2E notes (verify, do not trust): docs/milestones/{MS}-e2e.md if present.

Do all of the following:
1. Run `npm test` and `claude plugin validate .` in the repo. Record pass/fail counts.
2. For every {MS} item in Spec §11 scope and every §2 row whose MS column is {MS} (plus any §14.3 direct command due in {MS}): find the implementation and the automated test that covers it. Read the test and judge whether it actually tests the claim (not a tautology). Mark each PASS / FAIL / NEEDS_HUMAN with evidence (file:line, command output).
3. Search for stubs and skips: `grep -rnE "TODO|FIXME|\.skip|\.only|not implemented|todo\(" scripts skills agents hooks tests templates evals` and inspect hits.
4. Real-use check (dogfooding): copy a demo with `node evals/setup-demo.mjs <demo> <tmpdir>` (demos under evals/demos/), then from inside the copy run:
   `claude -p "<a realistic request for that demo, e.g. /make-it-ship:run ...>" --plugin-dir /Users/mason.lee/Dev/Git/tools/make-it-ship --setting-sources project --strict-mcp-config --permission-mode bypassPermissions --max-turns 80`
   Then inspect the result yourself: `node /Users/mason.lee/Dev/Git/tools/make-it-ship/scripts/mis.mjs status`, `.git/make-it-ship/runs/*/events.jsonl`, `docs/make-it-ship/*/report.md`, `git status`, and run the demo's tests yourself. Check the verdict is consistent with reality (e.g., if you break a test after the run, `mis verdict` must no longer say VERIFIED). In headless mode the guard's `ask` cannot be confirmed, so the approval step is expected to stop Standard runs (ADR-014); that is correct behavior, not a defect. Interactive confirmation dialogs must be recorded as NEEDS_HUMAN, never PASS.
5. Try to break things relevant to {MS}: e.g. edit a file after a passing check (must become STALE), feed a review without BLOCKING/MAJOR headers (must be rejected), try a guard bypass string, try to approve with an open HIGH ambiguity.
6. Answer with evidence: Is anything marked passed that was not actually executed? Does any §2 row for {MS} lack a test? Any stub/skip/empty implementation?

Rules: Do not modify any file in the repository except creating docs/milestones/{MS}-report.md. Do not git commit, push, or tag. Do not install packages. Do not use MCP write tools. Use temp dirs outside the repo for experiments.

Write docs/milestones/{MS}-report.md with: 요약 판정 (PASS = no defects / DEFECTS FOUND), 실행한 명령과 결과 수치, 종료 기준별 표(PASS/FAIL/NEEDS_HUMAN + 증거), 추적표 행별 표, 스텁·skip 검사 결과, 실사용 검증 기록, 결함 목록(심각도, 재현 방법, 위치), 미검증 항목, 남은 위험. Then reply with a short summary of the verdict and the defect list.
