# Changelog

All notable changes to Drawman. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [0.2.3] - 2026-11-18

### Fixed

- A diagram drawn live jumped to its finished state as soon as the model finished (since 0.2.2) instead of
  finishing its drawing. It draws to the end again; only a view that never saw the streaming, such as after a
  reload, shows the finished diagram at once.

## [0.2.2] - 2026-11-18

### Fixed

- Reloading a chat no longer replays a finished diagram step by step: once the result is in, the view shows the
  whole diagram at once. Live drawing while the model writes is unchanged.

## [0.2.1] - 2026-11-16

### Fixed

- **Download .drawio** and **Open in draw.io** stayed disabled in hosts that show the live view but are identified as a
  terminal agent, such as a GitHub Copilot CLI session in VS Code. The view now fetches the diagram the server saved, so
  it shows the same final layout and exports exactly that file. Results sent to the model are unchanged.

### Changed

- The Claude Code and GitHub Copilot CLI plugins start the latest 0.2.x release, so fixes arrive with a restart instead
  of a plugin update.
- The README explains how updates arrive.

## [0.2.0] - 2026-11-13

First public release.

- MCP server with an MCP App live view for VS Code (GitHub Copilot), Claude, Copilot CLI, Cursor and any MCP host.
- Architecture diagrams (cloud, on-premises, SAP, AI systems with official icons), flowcharts with swimlanes, sequence,
  state, UML class and ER diagrams, and any other connected diagram, in four directions.
- Repository analysis with `file:line` evidence, and follow-up edits that send only what changes.
- `drawman install`, `doctor` and `uninstall` for every detected AI tool and IDE; plugins for Claude Code and Copilot CLI.
- CLI: `render`, `analyze`, `serve` (Streamable HTTP) and a standalone chat UI.

[0.2.1]: https://github.com/zamalali/drawman/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/zamalali/drawman/releases/tag/v0.2.0
