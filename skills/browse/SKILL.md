---
name: browse
description: Make It Ship built-in browser - drive a real headless Chrome from Bash (mis browse) to QA web pages, take screenshots, check console/network/performance, and compare screenshots; no Playwright needed.
---

`mis` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs"`. Absorbs gstack browse (and the browser parts of qa, qa-only, design-review, benchmark, make-pdf) and OMC visual-verdict.

`mis browse <command>` talks to one headless Chrome per worktree. The first command starts it and it stops after 30 idle minutes. Each call takes about 100–200 ms. If Chrome, Chromium or Edge is missing, every command prints `BLOCKED: ...`. Report that as BLOCKED; never fake a result. `mis browse` with no arguments lists every command.

## Core loop
```sh
mis browse goto http://localhost:3000        # or a file path / file://./page.html
mis browse snapshot -i                       # interactive elements with @e refs
mis browse fill @e3 "user@example.com"
mis browse click @e5                         # prints the new URL if it navigated
mis browse snapshot -D                       # what changed since the last snapshot
mis browse console --errors                  # JS errors and failed loads
mis browse screenshot qa/shots/home.png      # full page; --viewport, or a selector/@ref for one element
```
- Refs (`@e3`) stay the same for the same element across snapshots of one page. They reset on navigation. A ref whose element was removed fails fast with `stale ref`. Run `snapshot` again.
- CSS selectors work everywhere a ref does (`#email`, `.btn`, `[name=q]`) and wait up to 3 s for the element.
- Read: `text [sel]`, `html [sel]`, `links`, `forms` (password values redacted), `accessibility`, `data` (JSON-LD, Open Graph, meta).
- Inspect: `js <expr>` (supports `await`), `eval <file>`, `css <sel> <prop>`, `attrs <sel>`, `is visible|checked|enabled|focused <sel>`, `network`, `dialog`, `storage`, `perf`.
- Interact: `select`, `hover`, `type`, `press Enter|Tab|Shift+Tab|...`, `scroll [sel]`, `viewport 375x812 [--scale 2]`, `upload <sel> <file>`. `dialog-accept [text]` and `dialog-dismiss` set how alerts, confirms and prompts are answered (the default is accept).
- Visual: `responsive <prefix>` (375, 768 and 1280 px screenshots), `pdf <path>`, `diff <url1> <url2>` (text diff), `snapshot -i -a -o shot.png` (screenshot with ref labels).
- Tabs and frames: `tabs`, `newtab [url]`, `tab <id>`, `closetab [id]`, `frame <sel|--name n|--url part>`, `frame main`.
- `chain '[["goto","http://localhost:3000"],["snapshot","-i"]]'` (or a JSON file) runs steps in order and stops at the first failure.
- Show screenshots to the user: Read the PNG after taking it.

## Safety: local is free, real sites ask
- `storage`, `js` and `eval` run directly on local pages: `localhost`, `127.x`, `*.localhost`, `file:` and pages from `load-html`.
- On any other site they can read session cookies or tokens. There they refuse unless you add `--remote`, and the guard asks the user first.
- `mis browse cdp <Domain.method> [json]` (raw DevTools Protocol) always asks, and is refused inside `chain`.
- Never type real passwords into reports. Write `[REDACTED]`.

## CAPTCHA, MFA, logins: hand off
`mis browse handoff "log in with your SSO"` reopens the same pages in a visible Chrome window on the same profile. Tell the user what to do there. When they say they are done, run `mis browse resume`. It returns to headless with their cookies kept and prints a fresh `snapshot -i`. Without a display (Linux with no `DISPLAY`) handoff is BLOCKED.

## Visual checks and PDFs
- `mis visual-verdict <screenshot.png> <reference.png>` returns JSON (`score` 0–100, `verdict`, `differences`, `diffImage`). A score of 90 or more passes; otherwise the command exits 1. Fix the regions it lists, take a new screenshot, and run it again. The score is a pixel comparison, so also look at both images before you call a design done.
- `mis pdf notes.md [-o notes.pdf] [--page-size a4] [--margins 1in] [--no-page-numbers]` turns markdown into a print-ready PDF in the same Chrome. Remote images are blocked unless you pass `--allow-network`.

## Lifecycle
`mis browse status` (pid, mode, tabs, URL), `mis browse stop`, `mis browse restart`. QA scripts started by `mis check` find the CLI in `$MIS_CLI`, so they can call `node "$MIS_CLI" browse ...`.
