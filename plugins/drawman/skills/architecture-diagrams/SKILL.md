---
name: architecture-diagrams
description: "Use when the user asks to draw, diagram, visualise or explain the architecture of this codebase, a repository, a service or a system, or wants a cloud / infrastructure diagram (AWS, Google Cloud, Azure, SAP BTP, Kubernetes, on-premises), a draw.io / .drawio file, a flowchart, a sequence diagram, a state machine, a UML class diagram, an ER / database diagram, or any other connected diagram such as an ML model architecture or business process."
---

# Architecture diagrams with Drawman

The `drawman` MCP server turns a description or a real codebase into a native, editable draw.io diagram.
You never write coordinates or XML: you describe **what exists and how it connects**, and the server computes the layout,
platform frames, official icons and obstacle-free orthogonal routing.

## Which tool

| The user wants | Call |
|---|---|
| The architecture of **this** project / a repo / a folder / a git URL | `analyze_repository` with `repository: "."` (or the folder, `owner/repo`, or the URL) |
| A cloud or software architecture they describe | `create_architecture_diagram` |
| A flowchart, process, workflow, approval flow, decision tree or runbook (steps with Yes/No decisions) | `create_flowchart` |
| How a request / login / payment flows between services, "what happens when ...", API call chains | `create_sequence_diagram` |
| The lifecycle or statuses of something (order, ticket, payment, connection) | `create_state_diagram` |
| A domain model, object-oriented design, design pattern, the types in a codebase | `create_class_diagram` |
| A database schema, data model, tables and relations (SQL, migrations, ORM models) | `create_er_diagram` |
| Anything else connected: ML model (e.g. a Transformer), concept map, org chart, data pipeline in the abstract | `create_diagram` |

Spatial pictures (floor plans, maps, UI mockups, charts of data) are out of scope: say so instead of forcing them into a diagram.
For diagrams of real code (class or ER diagrams of this project), read the relevant source files first and draw what is there.

## Rules

- Always pass `workspace` with the absolute path of your current working directory: some agents start this server in
  another folder, and the path tells it which project to read and where to save the `.drawio` file.
- Never ask clarifying questions first; make sensible senior-architect assumptions and state them afterwards.
- `analyze_repository` scans the code deterministically (CI/CD, Terraform, Bicep, CloudFormation/CDK, docker-compose,
  Kubernetes, SAP MTA, dependencies) with file:line evidence. If it returns the evidence instead of a diagram, YOU are
  the architect: derive nodes and interfaces from that evidence only, then call `create_architecture_diagram` with
  `repository` set to the repository name it reported, so the server re-applies the evidence-based release path.
- Use only the `kind` values listed in the tool description; the kind decides the platform frame, zone and icon. Use
  cloud-specific kinds only for a cloud the code proves; containers, compose and Kubernetes use the open-source kinds.
- To change a diagram, call the same tool again with the COMPLETE updated lists.

## After the diagram is drawn

- In terminal agents the diagram is saved to `diagrams/<title>.drawio` in the workspace; the tool result contains the
  path. Tell the user the path, and that it opens in draw.io desktop, app.diagrams.net or the VS Code "Draw.io
  Integration" extension, where every shape is editable.
- In hosts with MCP Apps (VS Code chat, Claude Desktop, Cursor) the diagram builds itself live in the chat.
- Summarise the architecture in 3-6 bullets citing the interface numbers (IF-01, IF-02, ... or F-01 for general diagrams);
  for flowcharts, walk through the main path and each decision. Never paste XML, JSON or coordinates.
