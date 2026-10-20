---
name: browse
description: Make It Ship built-in browser - drive a real headless Chrome from Bash (mis browse) to QA web pages, take screenshots, check console/network/performance, and compare screenshots; no Playwright needed.
---

`mis` = the shell function `mis() { node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" "$@"; }` (define it in the same Bash call, or type the full `node` command; not a variable: `M="node …"; $M` fails in zsh). Absorbs gstack browse (and the browser parts of qa, qa-only, design-review, benchmark, make-pdf) and OMC visual-verdict.

`mis browse <command>` talks to one headless Chrome per worktree. The first command starts it and it stops after 30 idle minutes. Each call takes about 0.2–0.7 s including node start-up (the first one 2–3 s, while Chrome starts). If Chrome, Chromium or Edge is missing, every command prints `BLOCKED: ...`. Report that as BLOCKED; never fake a result. `mis browse` with no arguments lists every command.

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
- `storage`, `js`, `eval` and `upload` run directly on local pages: `localhost`, `127.x`, `*.localhost`, `file:` and pages from `load-html`. The page counts by the origin the browser gives it, so a `blob:` page or an `about:blank` popup made by a real site counts as that site, and pages with no real origin (`about:blank`, `data:`) are not local.
- On any other site, page JS and storage can read session cookies or tokens, and `upload` sends a local file out of the machine (internal data must not go to outside services). There they refuse unless you add `--remote`, and the guard asks the user first. Plain `goto` to a real site does not ask.
- `upload` is also judged by where the file goes: on a local page whose form posts to a real site it refuses without `--remote`, and while a page holds a file attached without `--remote` the browser blocks every request to a non-local host (the command that triggered it fails and names the request). To send a file to a real site on purpose, attach it with `upload ... --remote`.
- `mis browse cdp <Domain.method> [json]` (raw DevTools Protocol) always asks, and is refused inside `chain`.
- Never type real passwords into reports. Write `[REDACTED]`.

## CAPTCHA, MFA, logins: hand off
`mis browse handoff "log in with your SSO"` reopens the same pages in a visible Chrome window on the same profile. Tell the user what to do there. When they say they are done, run `mis browse resume`. It returns to headless with their cookies kept and prints a fresh `snapshot -i`. Without a display (Linux with no `DISPLAY`) handoff is BLOCKED.

## Visual checks and PDFs
- `mis visual-verdict <screenshot.png> <reference.png>` returns JSON (`score` 0–100, `verdict`, `differences`, `diffImage`). The score counts differing pixels against the page content (a shared background is not counted, a few stray pixels cost a point each, and a whole page moved by up to 3px is aligned first at a point per px, reported as `offset`); below 90 the command exits 1. The score is only an aid: **Read both images and the diffImage and judge yourself** whether they match; your judgment is the verdict, and a passing score alone never means the design is done. Fix the regions it lists, take a new screenshot, and run it again.
- `mis pdf notes.md [-o notes.pdf] [--page-size a4] [--margins 1in] [--no-page-numbers]` turns markdown into a print-ready PDF in the same Chrome. Remote images are blocked unless you pass `--allow-network`.

## Lifecycle
`mis browse status` (pid, mode, tabs, URL), `mis browse stop`, `mis browse restart`. QA scripts started by `mis check` find the CLI in `$MIS_CLI`, so they can call `node "$MIS_CLI" browse ...`.
