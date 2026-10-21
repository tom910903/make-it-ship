---
name: pair-agent
description: Make It Ship pair-agent (absorbs gstack pair-agent) - let another AI agent drive this workspace's built-in browser through a token-protected endpoint, on this machine (--local) or through a tunnel (ngrok). Starting always asks; stop closes the tunnel and the port.
---

# Make It Ship — pair agent

`mis <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/mis.mjs" <args>`.

**Policy.** A paired agent can open pages and read them in your browser profile. Without `--local` a public tunnel makes the endpoint reachable from the internet. The guard asks on every start; **company policy may forbid opening a tunnel** or letting an outside agent see internal pages. Prefer `--local` when the other agent is on this machine.

1. Ask which agent and where it runs. Same machine: `mis pair-agent start --local`. Other machine: `mis pair-agent start` (needs ngrok installed and logged in; otherwise BLOCKED with the setup steps).
2. Give the user the printed instructions: base URL and `Authorization: Bearer <token>` (valid 24h by default, `--ttl`). The agent sends `POST /command {"cmd":"goto","args":[...]}` (read, navigate and interact commands only, and only http(s) URLs: no `file:`/`data:` pages, no page JavaScript, storage, uploads, screenshots or other local file paths; loopback dev servers such as `http://localhost:3000` are allowed, so pair only with an agent you trust to see them) and `GET /health`.
3. `mis pair-agent status` shows it; `mis pair-agent stop` closes the endpoint and the tunnel (the token dies with it). Stop when the pairing is done.
