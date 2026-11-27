# Changelog

All notable changes to Drawman. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [0.2.8] - 2026-11-27

### Fixed

- Large diagrams (dozens of components and connections) made the page stop responding while they were drawn, and
  again when a fresh copy of the view opened (a side panel, fullscreen, a reload). The view re-routed every line on
  each revealed item; it now keeps the lines already on screen and routes only new ones, and every result carries the
  exact final layout, so a fresh view shows the diagram at once. For a 66-component, 89-interface diagram the page was
  blocked for over two minutes in total; it is now a fraction of a second.
- After the model finished writing, a large diagram kept assembling at the drawing pace for many seconds. What is left
  is now caught up in about a second.
- A sequence diagram streamed into the live view started with an invalid size (before its first participant), which
  the browser reported as an error.

### Changed

- Line routing is about two and a half times faster with the same routes, so large diagrams also come back from the
  server sooner.
- The progress lines fade out shortly after a diagram is ready, leaving a clean canvas. A view that did not watch
  the drawing (a side panel, a reload) shows none.
- The Flow button is called Animation and is off until it is turned on.
- The toolbar and overlays keep clear of the host's safe-area insets (`hostContext.safeAreaInsets`), for hosts that
  draw their own controls over the view.

## [0.2.7] - 2026-11-25

### Added

- The live view follows the host's dark theme, including theme changes while it is open. The diagram keeps its
  colours as dark tints, icons keep their brand colours, and the file opened in or downloaded for draw.io stays the
  usual light diagram.

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
