---
name: telemetry
description: Make It Ship usage telemetry and analytics (absorbs gstack telemetry preamble, gstack-telemetry-log, gstack-telemetry-sync, gstack-analytics, community and security dashboards). Off by default; when the user turns it on, skill runs are recorded in a local JSONL file only. Uploading to an endpoint the user sets always asks.
---

# Make It Ship — telemetry

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`.

- Telemetry is **off by default**: nothing is recorded. `mis telemetry status` shows the state; only the user turns it on (`mis telemetry on`) or off.
- When on, each skill run is appended to `~/.make-it-ship/telemetry/events.jsonl` (skill name, outcome, duration; no code, no paths). `mis telemetry log --skill <s> --outcome success|error --duration <sec>` adds one by hand.
- `mis analytics [--days 30]` — personal usage from the local file: runs per skill, outcomes, average duration.
- Upload is never automatic. `mis telemetry endpoint <url>` sets where; `mis telemetry sync` posts the new events there and `mis telemetry dashboard community|security` reads aggregates from it. Both ask the user every time: the data leaves this machine and **company policy may forbid it**. There is no default endpoint and no hosted backend.
