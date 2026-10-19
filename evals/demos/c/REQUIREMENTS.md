# tally — habit tally CLI

Build a small command-line app `tally` (Node, no dependencies) that counts how often habits are done per day.

## Commands
- `tally add <habit>` — record one occurrence for today. Prints `<habit>: <count today>`.
- `tally today` — list today's habits, one per line as `<habit> <count>`, sorted by habit name. Prints `nothing yet` if empty.
- `tally week <habit>` — counts for the last 7 days (oldest first) as `YYYY-MM-DD <count>`, one per line, including zero days.
- `tally reset <habit>` — remove all records of the habit. Prints `reset <habit>`.

## Rules
- Data lives in a JSON file at `$TALLY_FILE` (default `~/.tally.json`). A missing file means no data.
- Habit names: 1–32 characters of letters, digits, `-` or `_`. Anything else → exit code 2 and a message on stderr.
- Unknown command or missing argument → usage text on stderr, exit code 2.
- Dates use the local time zone.

## Done when
- Unit tests cover the counting and date logic.
- `qa/cli-smoke.mjs` runs the real CLI against a temp `TALLY_FILE` for every command, including the error cases, and exits non-zero on any mismatch (the project config already requires it as `qa-cli`).
