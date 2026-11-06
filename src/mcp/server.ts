import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { deflateRawSync } from "node:zlib"
import { RESOURCE_MIME_TYPE, getUiCapability, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { config, conventions, isBroad } from "../config.js"
import { FLOW_SHAPES, FLOW_TONES, GENERAL_ICONS, NODE_KINDS, renderDiagram, type DiagramInput } from "../engine/index.js"
import { httpCompleter, samplingCompleter } from "../llm.js"
import { analyzeRepository, applyRecentEvidence, vocabulary, type Analysis } from "../repo/analyze.js"
import { VERSION } from "../version.js"

export const RESOURCE_URI = "ui://drawman/view.html"
const VIEW_CANDIDATES = ["./view/view.html", "../../dist/view/view.html"].map((p) => fileURLToPath(new URL(p, import.meta.url)))
const viewHtml = () => {
  const file = VIEW_CANDIDATES.find((f) => existsSync(f))
  if (!file) throw new Error("The diagram view is not built; run `npm run build`")
  return readFile(file, "utf8")
}

const org = () => (conventions() ? `\nOrganisation conventions${config.profile.name ? ` (${config.profile.name})` : ""}:\n${conventions()}\n` : "")

export const TOOL_DESCRIPTION = () => `Draw a cloud architecture diagram (draw.io) that the user watches being built live.
Works for Google Cloud, Microsoft Azure, SAP BTP, on-premises SAP (S/4HANA, ECC, BW, GRC) and hybrid landscapes:
each component is drawn inside the frame of its platform, with official GCP, Azure and SAP BTP icons.
You only describe WHAT exists and HOW it talks; frames, zones, icons, orthogonal edge routing and the interface
legend are computed deterministically, so never think about positions or coordinates.

Write the arguments in this order: title, subtitle, then ALL nodes, then ALL interfaces.
Order nodes along the flow (users/sources first, then ingress, compute, data, consumers) so the diagram grows naturally.

Rules:
- 6-26 nodes, 5-26 interfaces. Group many similar externals into ONE node.
- node.id: short_snake_case, unique. node.title: max 4 words. node.detail: max 7 words (concrete: name, tier, region).
- node.kind MUST be one of the vocabulary below; it decides the platform frame, the zone and the official icon.
- status: "active" (default), "planned" or "bypassed" (drawn dashed), "external".
- interface: from/to are node ids, label max 4 words, protocol (HTTPS, OData, RFC, gRPC, Pub/Sub, JDBC, OIDC...), description one sentence.
- subtitle: e.g. "<gcp project> · <region>", "<BTP subaccount>" or the scenario.
- Release path: source repo -> CI -> docker_build -> (jfrog_artifactory when used) -> registry -> runtime.
  SAP BTP apps reach on-premises via sap_destination -> sap_connectivity -> sap_cloud_connector.
- To diagram an EXISTING codebase or repository, call analyze_repository instead of guessing. If analyze_repository
  handed you the evidence, pass repository=<its name> so the evidence-based release path is applied.
${org()}
Vocabulary (platform / zone: kinds):
${vocabulary()}

To change an existing diagram, call this tool again with the COMPLETE updated node and interface lists.
For flowcharts, business processes, approval and decision flows use create_flowchart; for API call flows
create_sequence_diagram; for lifecycles create_state_diagram; for object models create_class_diagram; for database
schemas create_er_diagram; for other diagrams that are NOT cloud or software infrastructure (ML model architectures
such as a Transformer, org charts, concept maps) use create_diagram.`

export const FLOWCHART_DESCRIPTION = () => `Draw a flowchart as a live, editable draw.io diagram with real flowchart shapes: rounded start/end, process
boxes, decision diamonds with Yes/No branches, data (input/output) parallelograms, documents, databases and sub-processes,
optionally in swimlanes. Use it for processes, workflows, procedures, approval flows, decision trees, algorithms, user
journeys and incident or support runbooks. The layout (rows along the flow, straight main line, branches beside it,
merges below), shape sizes and orthogonal routing are computed deterministically: never think about coordinates.

Write the arguments in this order: title, subtitle, direction, lanes, then ALL nodes, then ALL connections.
- nodes: {id, type, title, detail?, lane?, tone?} in flow order. type is one of ${FLOW_SHAPES.join(", ")}.
  Begin with one start and finish with end node(s). Decisions are short questions ending with "?".
  Step titles are short verb phrases (max 6 words). Steps that reject, fail or cancel are coloured red automatically.
- connections: {from, to, label?}. Every decision has 2-4 outgoing connections with labels ("Yes"/"No" or the options).
  Loops back to an earlier step (retry, rework) are fine.
- direction: "TB" top-down (default), "LR" left-to-right (short linear processes), "RL" right-to-left or "BT"
  bottom-to-top. lanes only when roles or departments matter.
- 3-40 nodes. To change a flowchart, call the tool again with the COMPLETE updated nodes and connections.`

const NOT_FOR = `These tools draw boxes and the lines between them. They cannot draw spatial or pixel-accurate pictures:
floor plans, maps, seating plans, UI mockups / wireframes, charts or graphs of data, illustrations. For those, say so
plainly and suggest a fitting tool instead of forcing them into a diagram.`

export const SEQUENCE_DESCRIPTION = () => `Draw a UML sequence diagram as a live, editable draw.io diagram (native UML lifelines, activation
bars, fragments). Use it for API calls between services, request / auth / payment flows (OAuth, OIDC, SAML, checkout),
message exchanges, "what happens when ..." questions and call chains in code. Layout, spacing, activation bars and
fragment boxes are computed deterministically.

Write title, then ALL participants, then ALL messages, in time order.
- participants: {id, title, type?} left to right in the order they first act. type: ${["actor", "service", "database", "queue", "external"].join(", ")}
  (also boundary, control, entity). Max 10.
- messages: {from, to, label, type?} with type sync (default, a call), async (fire and forget), return (the answer,
  dashed) or create. A participant may message itself (internal step). Give every sync call its return when the
  answer matters. Labels are short: "POST /token (code)", "200 OK", "validate JWT".
- Inside messages you can also put control items, in order: {fragment: "alt" | "opt" | "loop" | "par" | "critical" | "break",
  label: "condition"} opens a box, {else: "condition"} starts its next branch, {end: true} closes it, and
  {note: "text", over: "participant id" or [ids]} adds a note. Fragments may nest.
- 2-10 participants, 2-60 messages. To change it, call again with the COMPLETE lists.`

export const STATE_DESCRIPTION = () => `Draw a UML state machine (state diagram) as a live, editable draw.io diagram: lifecycles and statuses of
orders, tickets, payments, documents, connections, workflows, protocol or UI states. Layout and routing are computed.

Write title, direction, then ALL states, then ALL transitions.
- states: {id, title, type?, detail?}. type is initial (the start dot, no title), final (end bullseye), state (default) or
  choice (a decision diamond). detail holds entry / do / exit activities, e.g. "entry / send email".
- transitions: {from, to, event?, guard?, action?} drawn as "event [guard] / action". Self-transitions are not supported.
- direction: "TB" (default), "LR", "RL" (right-to-left) or "BT" (bottom-to-top). 3-30 states. To change it, call again with the COMPLETE lists.`

export const CLASS_DESCRIPTION = () => `Draw a UML class diagram as a live, editable draw.io diagram (native class boxes with attribute and
method compartments). Use it for domain models, object-oriented designs, design patterns and the types in a codebase.

Write title, direction, then ALL classes, then ALL relationships.
- classes: {id, name, type?, attributes?, methods?}. type: class (default), interface, abstract or enum. attributes and
  methods are strings in UML notation, e.g. "- email: String", "+ placeOrder(cart: Cart): Order" (enum values go in
  attributes). Keep each list to the members that matter (max ~8).
- relationships: {from, to, type, label?}: inherits (from = subclass, to = parent), implements (from = class, to =
  interface), composition / aggregation (from = the whole, to = the part), association (label = multiplicity such as
  "1..*"), dependency (from uses to). Parents are placed above their children automatically.
- 2-24 classes. To change it, call again with the COMPLETE lists.`

export const ER_DESCRIPTION = () => `Draw an entity relationship (ER) / database schema diagram as a live, editable draw.io diagram: tables
with their columns, primary and foreign keys, and crow's-foot relationships. Use it for database designs, data models
and schemas (SQL, migrations, ORM models).

Write title, direction, then ALL entities, then ALL relationships.
- entities: {id, name, fields}. fields: {name, type, pk?, fk?} or strings like "PK id: uuid". Key columns first.
- relationships: {from, to, cardinality, label?} with cardinality one-to-one, one-to-many (from = the "one" side, e.g.
  customers -> orders), many-to-one or many-to-many. The "one" side is placed above the "many" side.
- 2-24 entities. To change it, call again with the COMPLETE lists.`

export const GENERAL_DESCRIPTION = () => `Draw ANY other connected diagram as a live, editable draw.io diagram: ML / neural-network
architectures (e.g. a Transformer), system context diagrams, data pipelines in the abstract, concept maps, org charts,
layered models. The user watches it build itself. You only describe groups, nodes and connections; the layout (groups
as columns ranked along the flow), icons and orthogonal edge routing are computed deterministically.
For cloud / software infrastructure with real services (AWS, GCP, Azure, SAP, Kubernetes) use create_architecture_diagram.
For flowcharts, processes, workflows, decision trees and approval flows use create_flowchart. For API call flows use
create_sequence_diagram, for lifecycles create_state_diagram, for object models create_class_diagram and for database
schemas create_er_diagram. ${NOT_FOR}

Write the arguments in this order: title, subtitle, groups, nodes, interfaces.
- groups: the stages / containers / swimlanes, in flow order, e.g. [{id:"encoder", title:"Encoder (×N)"}, {id:"decoder", title:"Decoder (×N)"}].
- nodes: {id, title (max 4 words), detail (max 8 words), group (a group id), icon?}. Order nodes inside a group along the flow.
  icon (optional) is one of ${GENERAL_ICONS.join(", ")} or any architecture kind (e.g. postgres, aws_lambda, kafka);
  when omitted it is chosen from the wording.
- interfaces: {from, to, label (max 4 words), description (one sentence)}. Numbered F-01, F-02... in the legend.
- 4-30 nodes, 2-12 groups. Keep loops and residual connections as interfaces; the router keeps them readable.`

export const ANALYZE_DESCRIPTION = () => `Read a real codebase and draw its architecture as a live draw.io diagram.
Use whenever the user names a repository, codebase, project folder or git link ("draw the architecture of this repo",
"diagram org/service", "how is X deployed"). Scans CI/CD workflows, Terraform (google/azurerm/btp), Bicep/ARM, SAP MTA
descriptors (mta.yaml, xs-security.json, xs-app.json, CDS), Cloud Foundry manifests, Dockerfiles, dependencies and
endpoints with file:line evidence (credentials are never read), then an architect model turns that into the diagram
across GCP, Azure, SAP BTP and on-premises. Takes 20-60 seconds. If no model is available to the server, it returns the
evidence and you draw the diagram yourself with create_architecture_diagram. Afterwards summarise the architecture
citing interface numbers (IF-01...) and the evidence.
repository: "." for the current workspace, a folder name or path inside the workspace, "owner/repo" on ${config.githubHost},
or an https git URL.`

export function diagramsNetLink(title: string, xml: string): string {
  const data = deflateRawSync(Buffer.from(encodeURIComponent(xml), "utf8")).toString("base64")
  return `https://app.diagrams.net/?title=${encodeURIComponent(`${slug(title)}.drawio`)}#R${encodeURIComponent(data)}`
}

// Agents won't paste a multi-KB link, so a small page carries it; the diagram stays in the URL fragment, never sent to a server.
const opener = (title: string, url: string) => `<!doctype html><meta charset="utf-8"><title>${title.replace(/[<&"]/g, "")}</title>
<script>location.replace(${JSON.stringify(url).replace(/</g, "\\u003c")})</script>
<p>Opening the diagram in draw.io… <a href="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">Click here</a> if nothing happens.</p>
`

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "architecture"

function saveDrawio(title: string, xml: string): { file?: string; open?: string; note?: string } {
  const root = config.workspaceRoots[0]
  if (!root) return { note: "Not saved: no workspace folder is configured (set DRAWMAN_WORKSPACE_ROOTS)." }
  const dir = path.resolve(root, config.outputDir)
  const rel = path.relative(root, dir)
  if (rel.startsWith("..") || path.isAbsolute(rel)) return { note: `Not saved: the output folder ${config.outputDir} is outside the workspace.` }
  try {
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${slug(title)}.drawio`)
    writeFileSync(file, xml)
    const open = path.join(dir, `${slug(title)}.drawio.html`)
    writeFileSync(open, opener(title, diagramsNetLink(title, xml)))
    return { file, open }
  } catch (error) {
    return { note: `Not saved (${(error as NodeJS.ErrnoException).code ?? (error as Error).message}); the diagram is in the tool result.` }
  }
}

function summarise(args: DiagramInput, save: boolean, withXml = true) {
  const { facts, xml, stats, scene } = renderDiagram(args)
  const frames = scene.frames.map((f) => f.title).join(", ")
  const zones = scene.zones.map((z) => `${z.title} (${scene.cards.filter((c) => c.zoneId === z.id).length})`).join(", ")
  const titles = new Map(facts.nodes.map((n) => [n.id, n.title]))
  const ifs = scene.edges.map((e) => `${e.id} ${titles.get(e.from)} -> ${titles.get(e.to)}`).join("; ")
  const saved = save ? saveDrawio(facts.title, xml) : {}
  const file = saved.file ?? null
  const open = saved.open ? pathToFileURL(saved.open).href : null
  const notes = [
    facts.dropped.length ? `Dropped: ${facts.dropped.join("; ")}.` : "",
    scene.unrouted.length ? `No clear route for ${scene.unrouted.join(", ")}.` : "",
    file ? `Saved to ${file} (opens in draw.io desktop or the VS Code Draw.io extension).` : saved.note ?? "",
    open ? `Show the user this link, which opens it in the draw.io web editor: ${open}` : "",
  ].filter(Boolean).join(" ")
  const steps = facts.flow || facts.sequence
    ? scene.edges.map((e) => `${titles.get(e.from)} -> ${titles.get(e.to)}${e.rel && !facts.sequence ? ` ${e.rel}` : ""}${e.label ? ` (${e.label})` : ""}`).join("; ")
    : ""
  const kind = facts.sequence ? ["sequence diagram", "participants", "messages"] : facts.flow
    ? ({ flowchart: ["flowchart", "steps", "connections"], state: ["state diagram", "states", "transitions"],
      class: ["class diagram", "classes", "relationships"], er: ["ER diagram", "tables", "relationships"] } as const)[facts.flow.family]
    : null
  return {
    content: [{
      type: "text" as const,
      text: (kind
        ? `Rendered ${kind[0]} "${facts.title}"${file ? "" : " live for the user"}: ${stats.cards} ${kind[1]}${facts.flow?.lanes.length ? ` in ${zones}` : ""}, ` +
          `${stats.edges} ${kind[2]} [${steps}]. draw.io file: ${(stats.bytes / 1024).toFixed(0)} KB. ${notes}`
        : `Rendered "${facts.title}"${file ? "" : " live for the user"}: ${stats.cards} components in ${stats.zones} zones` +
          `${frames ? ` across ${frames}` : ""} [${zones}], ${stats.edges} routed interfaces [${ifs}]. ` +
          `draw.io file: ${(stats.bytes / 1024).toFixed(0)} KB. ${notes}`).trim(),
    }],
    structuredContent: { title: facts.title, stats, ...(withXml || !file ? { xml } : {}), ...(file ? { file } : {}), ...(open ? { open } : {}) } as Record<string, unknown>,
  }
}

const failure = (prefix: string, error: unknown) =>
  ({ isError: true, content: [{ type: "text" as const, text: `${prefix}: ${(error as Error).message}` }] })

export interface ServerOptions {
  stateless?: boolean
}

export function createServer(opts: ServerOptions = {}) {
  const server = new McpServer({ name: "drawman", version: VERSION }, {
    instructions: "Draws draw.io diagrams with deterministic layout and routing. Use create_architecture_diagram " +
      "to design or change a cloud architecture, analyze_repository to diagram an existing codebase, create_flowchart for " +
      "flowcharts and processes, create_sequence_diagram for API / call flows, create_state_diagram for lifecycles, " +
      "create_class_diagram for object models, create_er_diagram for database schemas and create_diagram for any other " +
      "connected diagram. Spatial pictures (floor plans, maps, UI mockups, data charts) are out of scope.",
  })
  const hasUi = () => Boolean(getUiCapability(server.server.getClientCapabilities() as never)?.mimeTypes?.includes(RESOURCE_MIME_TYPE))
  const shouldSave = (asked?: boolean) => Boolean(asked) || config.save === "always" ||
    (config.save === "auto" && !opts.stateless && !liveView())
  const meta = { ui: { resourceUri: RESOURCE_URI, visibility: ["model", "app"] as ("model" | "app")[] } }

  let rootsReady: Promise<void> = Promise.resolve()
  const refreshRoots = async () => {
    if (opts.stateless || config.rootsSource === "env" || !server.server.getClientCapabilities()?.roots) return
    try {
      const { roots } = await server.server.listRoots(undefined, { timeout: 5_000 })
      const dirs = roots.map((r) => r.uri).filter((u) => u.startsWith("file:")).map((u) => fileURLToPath(u)).filter((d) => !isBroad(d))
      if (dirs.length) { config.workspaceRoots = dirs; config.rootsSource = "client" }
    } catch { /* keep the current roots */ }
  }
  server.server.oninitialized = () => { rootsReady = refreshRoots() }
  server.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => { rootsReady = refreshRoots() })
  const adoptWorkspace = async (workspace?: string) => {
    await rootsReady
    if (!workspace || opts.stateless || (config.rootsSource !== "none" && config.rootsSource !== "agent")) return
    const dir = workspace.trim()
    if (!path.isAbsolute(dir) || /^(\\\\|\/\/)/.test(dir) || !existsSync(dir) || !statSync(dir).isDirectory() || isBroad(dir)) return
    config.workspaceRoots = [realpathSync(dir)]
    config.rootsSource = "agent"
  }
  // Terminal agents cannot display the live view even when they announce MCP Apps support: they get the .drawio file.
  const terminal = () => /^(copilot-cli|claude-code|codex|gemini-cli|opencode|cline)/i.test(server.server.getClientVersion()?.name ?? "")
  const liveView = () => hasUi() && !terminal()
  const workspaceArg = z.string().optional().describe("Absolute path of the user's project (your current working directory). Coding agents should always pass it.")

  registerAppTool(
    server,
    "create_architecture_diagram",
    {
      title: "Create architecture diagram",
      description: TOOL_DESCRIPTION(),
      inputSchema: {
        title: z.string().max(80).describe("Diagram title, e.g. 'Order Platform - GCP Architecture'"),
        subtitle: z.string().max(120).optional().describe("Context line, e.g. 'my-project · europe-west3'"),
        nodes: z.array(z.object({
          id: z.string().describe("short_snake_case unique id"),
          kind: z.enum(NODE_KINDS as [string, ...string[]]),
          title: z.string().describe("max 4 words"),
          detail: z.string().optional().describe("max 7 words"),
          status: z.enum(["active", "planned", "bypassed", "external"]).optional(),
        })).min(1).max(40),
        interfaces: z.array(z.object({
          from: z.string(),
          to: z.string(),
          label: z.string().optional(),
          protocol: z.string().optional(),
          description: z.string().optional(),
        })).max(40),
        repository: z.string().optional().describe("Only after analyze_repository handed you its evidence: the repository name it reported"),
        save: z.boolean().optional().describe("Also write the .drawio file into the workspace (always done when the host has no live view)"),
        workspace: workspaceArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: meta,
    },
    async ({ repository, save, workspace, ...args }) => {
      await adoptWorkspace(workspace)
      try {
        const evidence = repository && !opts.stateless ? applyRecentEvidence(repository, args) : null
        const base = summarise(evidence?.diagram ?? args, shouldSave(save), liveView())
        if (!evidence) return base
        return { ...base, structuredContent: { ...base.structuredContent, diagram: evidence.diagram, analysis: evidence.analysis } }
      } catch (error) {
        return failure("Diagram failed", error)
      }
    },
  )

  registerAppTool(
    server,
    "create_diagram",
    {
      title: "Create diagram",
      description: GENERAL_DESCRIPTION(),
      inputSchema: {
        title: z.string().max(100),
        subtitle: z.string().max(140).optional(),
        groups: z.array(z.object({ id: z.string(), title: z.string() })).max(16).describe("stages / containers in flow order"),
        nodes: z.array(z.object({
          id: z.string().describe("short_snake_case unique id"),
          title: z.string().describe("max 4 words"),
          detail: z.string().optional().describe("max 8 words"),
          group: z.string().describe("id of its group"),
          icon: z.string().optional().describe(`${GENERAL_ICONS.join(" | ")} | any architecture kind`),
          status: z.enum(["active", "planned", "bypassed", "external"]).optional(),
        })).min(1).max(40),
        interfaces: z.array(z.object({
          from: z.string(), to: z.string(), label: z.string().optional(), description: z.string().optional(),
        })).max(50),
        save: z.boolean().optional().describe("Also write the .drawio file into the workspace (always done when the host has no live view)"),
        workspace: workspaceArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: meta,
    },
    async ({ save, workspace, ...args }) => {
      await adoptWorkspace(workspace)
      try {
        return summarise(args, shouldSave(save), liveView())
      } catch (error) {
        return failure("Diagram failed", error)
      }
    },
  )

  registerAppTool(
    server,
    "create_flowchart",
    {
      title: "Create flowchart",
      description: FLOWCHART_DESCRIPTION(),
      inputSchema: {
        title: z.string().max(100),
        subtitle: z.string().max(140).optional(),
        direction: z.enum(["TB", "LR", "RL", "BT"]).optional().describe("TB top-down (default), LR left-to-right, RL right-to-left, BT bottom-to-top"),
        lanes: z.array(z.object({ id: z.string(), title: z.string() })).max(8).optional()
          .describe("Swimlanes, only when the user asks for them or roles/departments matter, e.g. [{id:'customer',title:'Customer'}]"),
        nodes: z.array(z.object({
          id: z.string().describe("short_snake_case unique id"),
          type: z.string().describe(`One of ${FLOW_SHAPES.join(", ")}`),
          title: z.string().describe("max 6 words; decisions are questions ending with ?"),
          detail: z.string().optional().describe("optional extra explanation (shown on hover, not on the shape)"),
          lane: z.string().optional().describe("lane id, only when lanes are used"),
          tone: z.string().optional().describe(`optional colour override: ${FLOW_TONES.join(", ")}`),
        })).min(2).max(50),
        connections: z.array(z.object({
          from: z.string(),
          to: z.string(),
          label: z.string().optional().describe("branch label, max 3 words: Yes / No for decisions, otherwise usually empty"),
        })).max(80),
        save: z.boolean().optional().describe("Also write the .drawio file into the workspace (always done when the host has no live view)"),
        workspace: workspaceArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: meta,
    },
    async ({ save, workspace, ...args }) => {
      await adoptWorkspace(workspace)
      try {
        return summarise(args, shouldSave(save), liveView())
      } catch (error) {
        return failure("Flowchart failed", error)
      }
    },
  )

  const draw = (label: string) => async ({ save, workspace, ...args }: { save?: boolean; workspace?: string } & Record<string, unknown>) => {
    await adoptWorkspace(workspace)
    try {
      return summarise(args, shouldSave(save), liveView())
    } catch (error) {
      return failure(`${label} failed`, error)
    }
  }
  const common = {
    save: z.boolean().optional().describe("Also write the .drawio file into the workspace (always done when the host has no live view)"),
    workspace: workspaceArg,
  }
  const annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }

  registerAppTool(server, "create_sequence_diagram", {
    title: "Create sequence diagram",
    description: SEQUENCE_DESCRIPTION(),
    inputSchema: {
      title: z.string().max(100),
      subtitle: z.string().max(140).optional(),
      participants: z.array(z.object({
        id: z.string().describe("short_snake_case unique id"),
        title: z.string().describe("max 4 words"),
        type: z.string().optional().describe("actor, service (default), database, queue, external, boundary, control, entity"),
      })).min(2).max(12),
      messages: z.array(z.object({
        from: z.string().optional(), to: z.string().optional(), label: z.string().optional(),
        type: z.enum(["sync", "async", "return", "create"]).optional(),
        fragment: z.enum(["alt", "opt", "loop", "par", "critical", "break"]).optional(),
        else: z.string().optional(), end: z.boolean().optional(),
        note: z.string().optional(), over: z.union([z.string(), z.array(z.string())]).optional(),
      }).passthrough()).max(80).describe("messages and control items (fragment / else / end / note) in time order"),
      ...common,
    },
    annotations,
    _meta: meta,
  }, draw("Sequence diagram"))

  registerAppTool(server, "create_state_diagram", {
    title: "Create state diagram",
    description: STATE_DESCRIPTION(),
    inputSchema: {
      title: z.string().max(100),
      subtitle: z.string().max(140).optional(),
      direction: z.enum(["TB", "LR", "RL", "BT"]).optional().describe("TB top-down (default), LR left-to-right, RL right-to-left, BT bottom-to-top"),
      states: z.array(z.object({
        id: z.string(), title: z.string().optional(),
        type: z.enum(["initial", "final", "state", "choice"]).optional(),
        detail: z.string().optional().describe("entry / do / exit activities"),
        tone: z.string().optional().describe(`optional colour: ${FLOW_TONES.join(", ")}`),
      })).min(2).max(40),
      transitions: z.array(z.object({
        from: z.string(), to: z.string(), event: z.string().optional(), guard: z.string().optional(), action: z.string().optional(),
      })).max(80),
      ...common,
    },
    annotations,
    _meta: meta,
  }, draw("State diagram"))

  registerAppTool(server, "create_class_diagram", {
    title: "Create class diagram",
    description: CLASS_DESCRIPTION(),
    inputSchema: {
      title: z.string().max(100),
      subtitle: z.string().max(140).optional(),
      direction: z.enum(["TB", "LR", "RL", "BT"]).optional().describe("TB top-down (default), LR left-to-right, RL right-to-left, BT bottom-to-top"),
      classes: z.array(z.object({
        id: z.string(), name: z.string(),
        type: z.enum(["class", "interface", "abstract", "enum"]).optional(),
        attributes: z.array(z.string()).max(16).optional(),
        methods: z.array(z.string()).max(16).optional(),
      })).min(1).max(30),
      relationships: z.array(z.object({
        from: z.string(), to: z.string(),
        type: z.enum(["inherits", "implements", "composition", "aggregation", "association", "dependency"]),
        label: z.string().optional().describe("multiplicity or role, e.g. 1..*"),
      })).max(60),
      ...common,
    },
    annotations,
    _meta: meta,
  }, draw("Class diagram"))

  registerAppTool(server, "create_er_diagram", {
    title: "Create ER diagram",
    description: ER_DESCRIPTION(),
    inputSchema: {
      title: z.string().max(100),
      subtitle: z.string().max(140).optional(),
      direction: z.enum(["TB", "LR", "RL", "BT"]).optional().describe("TB top-down (default), LR left-to-right, RL right-to-left, BT bottom-to-top"),
      entities: z.array(z.object({
        id: z.string(), name: z.string(),
        fields: z.array(z.union([z.string(), z.object({
          name: z.string(), type: z.string().optional(), pk: z.boolean().optional(), fk: z.boolean().optional(),
        })])).max(24),
      })).min(1).max(30),
      relationships: z.array(z.object({
        from: z.string(), to: z.string(),
        cardinality: z.enum(["one-to-one", "one-to-many", "many-to-one", "many-to-many"]),
        label: z.string().optional(),
      })).max(60),
      ...common,
    },
    annotations,
    _meta: meta,
  }, draw("ER diagram"))

  registerAppTool(
    server,
    "analyze_repository",
    {
      title: "Analyze repository architecture",
      description: ANALYZE_DESCRIPTION(),
      inputSchema: {
        repository: z.string().min(1).describe(`The absolute path of the project folder (preferred for coding agents), "." for the workspace, a folder inside it, owner/repo on ${config.githubHost}, or an https git URL`),
        ref: z.string().optional().describe("branch or tag (default: the default branch)"),
        focus: z.string().max(400).optional().describe("optional emphasis, e.g. 'runtime only' or 'show the SAP integration'"),
        workspace: workspaceArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: meta,
    },
    async ({ repository, ref, focus, workspace }) => {
      await adoptWorkspace(workspace ?? (path.isAbsolute(repository.trim()) ? repository.trim() : undefined))
      try {
        const complete = httpCompleter() ?? (opts.stateless || !config.sampling ? null : samplingCompleter(server))
        const result = await analyzeRepository(repository, { ref, focus, complete, remember: !opts.stateless })
        const a: Analysis = result.analysis
        const head = `Analyzed ${a.repository}${a.commit ? ` @ ${a.commit}` : ""}: ${a.files} files scanned, ${a.read} read, ` +
          `${a.signals.length} deterministic signals across ${a.platforms.join(", ") || "no cloud"}.`
        if (result.mode === "handoff") {
          return {
            content: [{ type: "text" as const, text: `${head}\n\n${result.brief}` }],
            structuredContent: { analysis: a, handoff: true },
          }
        }
        const base = summarise(result.diagram, shouldSave(), liveView())
        const missing = a.coverage.missing.length ? ` Signals not drawn: ${a.coverage.missing.join(", ")}.` : ""
        return {
          content: [{
            type: "text" as const,
            text: `${head} (${a.coverage.represented}/${a.coverage.total} represented, model ${a.model}).${missing}\n` +
              `Architect findings:\n${a.findings.slice(0, 10).map((f) => `- ${f}`).join("\n")}\n\n${base.content[0].text}`,
          }],
          structuredContent: { ...base.structuredContent, diagram: result.diagram, analysis: a },
        }
      } catch (error) {
        return failure("Repository analysis failed", error)
      }
    },
  )

  registerAppResource(
    server,
    "draw.io live architecture view",
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE, description: "Live draw.io canvas for architectures, flowcharts and general diagrams." },
    async () => ({
      contents: [{
        uri: RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: await viewHtml(),
        _meta: { ui: { prefersBorder: false, csp: {} } },
      }],
    }),
  )

  return server
}
