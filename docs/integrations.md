# Integrations

All hosts run the same server: `npx -y drawman` (stdio) or `npx -y drawman serve` (HTTP at `/mcp`).
Pass settings as environment variables (see `.env.example`).

`npx -y drawman install` sets up every host below that it finds, `doctor` verifies the result and
`uninstall` reverts it. It registers through each tool's own CLI where one exists (`claude`, `copilot`, `codex`,
`devin`, `code --add-mcp`) and otherwise merges a single entry into the JSON config, keeping everything else. Files with
comments are never rewritten; add the entry by hand there. File-configured hosts on Windows get `cmd /c npx`, because
they start servers without a shell.

| Host | Live canvas | Manual setup |
| --- | --- | --- |
| VS Code + GitHub Copilot | yes | one-click link in the README, `code --add-mcp '{"name":"drawman","command":"npx","args":["-y","drawman"]}'`, or the `.vsix` extension |
| Cursor | yes (≥ 2.6) | one-click link in the README, or `~/.cursor/mcp.json` |
| Claude Desktop | yes | `claude_desktop_config.json` (Windows `%APPDATA%\Claude`, macOS `~/Library/Application Support/Claude`) |
| Claude Code | file + link | `claude mcp add -s user drawman -- npx -y drawman`, or the plugin |
| GitHub Copilot CLI | file + link | `copilot mcp add drawman -- npx -y drawman`, or the plugin |
| Windsurf | file + link | `~/.codeium/windsurf/mcp_config.json` |
| Antigravity | file + link | `~/.gemini/antigravity/mcp_config.json` (Agent panel → MCP Servers → View raw config) |
| Codex CLI | file + link | `codex mcp add drawman -- npx -y drawman` |
| Gemini CLI | file + link | `~/.gemini/settings.json` |
| Any other MCP host | depends on host | `"drawman": { "command": "npx", "args": ["-y", "drawman"] }` under `mcpServers` |
| MCP gateways (LiteLLM, internal portals) | if the portal hosts MCP Apps | `npx -y drawman serve --host 0.0.0.0` behind the gateway's auth, with `DRAWMAN_ALLOWED_HOSTS` |

Hosts without MCP Apps support get `diagrams/<title>.drawio` (`DRAWMAN_SAVE=auto`), which opens in draw.io
desktop or the VS Code Draw.io Integration extension, and `diagrams/<title>.drawio.html`, a link that opens the same
diagram in the draw.io web editor (the diagram is carried in the URL fragment and never sent to a server).

## Repository analysis model

| Situation | What happens |
| --- | --- |
| `DRAWMAN_LLM_URL` + `_KEY` set | the server's architect prompt runs on that endpoint (any OpenAI-compatible API) |
| host supports MCP sampling (VS Code) | the server asks the host's model; the user approves once |
| neither | the tool returns the evidence; the calling agent draws with `create_architecture_diagram({ repository, ... })`, and the release path is still enforced from the evidence |
