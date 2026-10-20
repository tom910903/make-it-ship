# Third-party notices

Make It Ship reimplements behavior from the following MIT-licensed projects. Apart from the vendored code listed at the end, no source files are copied verbatim; the
always-on layer (M6+) follows their designs closely, so their notices are reproduced here.

| Project | Version studied | Copyright | Used for |
|---|---|---|---|
| oh-my-claudecode | 4.15.6 | Copyright (c) 2025 Yeachan Heo | keyword router, persistent loop, rules injection, post-tool reminders, HUD elements, team pipeline and tmux worker runtime, project session manager, visual-verdict JSON shape, subagent tracking, deliverable check, read-only permission handler, workflow drift and code-simplifier Stop hooks, session-end summary, project-memory hot paths and directives (M9-F) |
| Superpowers | 6.1.1 | Copyright (c) 2025 Jesse Vincent | session-start skill discipline, always-on TDD / verification / debugging rules, brainstorming visual companion |
| Ponytail | 5.2.0 | Copyright (c) 2026 DietrichGebert | style levels, subagent injection, codebase map |
| gstack | 1.58.5.0 | Copyright (c) 2026 Garry Tan | careful / freeze guard rules; built-in browser command set, snapshot @refs, handoff, make-pdf print style (M8-A); investigate debug scope, timeline and session kind, CLAUDE.md skill routing, proactive suggestions and question format (M9-F) |

MIT License (applies to each project above, with its own copyright line):

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Vendored code

`vendor/marked/marked.esm.js` is marked 18.0.2 (https://github.com/markedjs/marked), copied unmodified except for the
removed `sourceMappingURL` line. It is used by `mis pdf`. Its license (MIT, plus the original Markdown BSD-style notice
by John Gruber) is in `vendor/marked/LICENSE.md`:

- Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
- Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)
- Markdown: Copyright © 2004, John Gruber
