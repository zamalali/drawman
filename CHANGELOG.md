# Changelog

All notable changes to Drawman. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [0.2.6] - 2026-11-20

### Added

- Architecture diagrams with containers and grouped diagrams take a `direction`: `LR` lays them out horizontally,
  `TB` vertically. An edit that changes the direction lays the diagram out afresh.

### Fixed

- Edits that made cards taller (columns added to every table, longer titles) failed with "layout overlap". Cards
  below a grown one now slide down; if the earlier arrangement cannot hold the change, it is laid out afresh. This
  affected every earlier version.
- An edit failed as a whole when it named an id that is not in the diagram. Unknown ids are skipped and named in the
  result; the rest of the change applies.
- Containers named without any node in them stacked every card in one tall column. They are ignored, so the
  platform frames and zones are drawn.
- The canvas could differ from the file that is downloaded or opened in draw.io (a grouped diagram drawn without
  groups, extra fields a model added, lanes after some edits). The view now finishes with exactly the server's
  diagram and layout.
- In hosts that connect without the MCP Apps capability and whose view cannot call tools, an edit stayed on
  "Applying the change…". Edit results carry the edited diagram again, and a view with nothing to draw says so.
- Tool schemas used a tuple and `$ref`, which some model APIs reject, failing every request in hosts that pass all
  tools to the model.
- Dragging a card made untouched cards jump, zooming while a diagram streamed could freeze a half-drawn layout,
  and Reset kept the dragged arrangement.
- Kind hints matched inside words ("Centralized logging" became Azure Entra ID). They match at the start of a word.
- Download is offered only where the view can save a file; elsewhere Open in draw.io is the export.
- Two different diagrams with the same title overwrote each other's .drawio file in the project. The second one
  gets a numbered name; an edit keeps writing to its own diagram's file.

## [0.2.5] - 2026-11-19

### Fixed

- Follow-up changes failed in chat hosts that show earlier results as a short preview: the
  diagram id came last and was cut off, so the model sent another reference and redrew the diagram. Results now
  start with the diagram id, and an unknown id explains what a diagram id looks like.
- A view that did not watch the drawing (a fullscreen copy, a reload or a reopened chat) replayed entrance
  animations and an edit's additions. It now shows the finished diagram at once and still.
- A tool error could be replaced by "building" again by a pending reveal step or an edit's diagram fetch. Errors
  now stay shown.

## [0.2.4] - 2026-11-19

### Fixed

- Diagrams with containers (regions, zones, or an edit that adds them) failed with "ELK worker not available" when
  Drawman ran under Bun or Deno. They now lay out on every runtime.
- A failed call left the canvas pulsing "Designing…" or "Applying the change…" as if still busy. The canvas now stops
  and shows the error.

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
