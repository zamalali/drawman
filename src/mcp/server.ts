import { existsSync, realpathSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { RESOURCE_MIME_TYPE, getUiCapability, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { config, isBroad } from "../config.js"
import { FLOW_SHAPES, FLOW_TONES, GENERAL_ICONS } from "../engine/index.js"
import { httpCompleter, samplingCompleter } from "../llm.js"
import { analyzeRepository, applyRecentEvidence, type Analysis } from "../repo/analyze.js"
import { VERSION } from "../version.js"
import { ANALYZE_DESCRIPTION, CLASS_DESCRIPTION, ER_DESCRIPTION, FLOWCHART_DESCRIPTION, GENERAL_DESCRIPTION, SEQUENCE_DESCRIPTION, STATE_DESCRIPTION, TOOL_DESCRIPTION } from "./descriptions.js"
import { failure, summarise } from "./output.js"

export * from "./descriptions.js"
export { diagramsNetLink } from "./output.js"

export const RESOURCE_URI = "ui://drawman/view.html"

// Generous limits: the layout handles large diagrams, so the schema never forces the model to drop or merge parts.
const MAX_NODES = 200, MAX_EDGES = 400, MAX_TABLES = 80
const GROUPS_ARG = z.array(z.object({
  id: z.string(),
  title: z.string(),
  parent: z.string().optional().describe("id of the enclosing group, for nested containers (subnet inside VPC, namespace inside cluster)"),
})).max(80).optional().describe("ONLY containers the user's request explicitly names (e.g. 'inside the VPC', 'in the payments namespace'); never invent them")
const VIEW_CANDIDATES = ["./view/view.html", "../../dist/view/view.html"].map((p) => fileURLToPath(new URL(p, import.meta.url)))
const viewHtml = () => {
  const file = VIEW_CANDIDATES.find((f) => existsSync(f))
  if (!file) throw new Error("The diagram view is not built; run `npm run build`")
  return readFile(file, "utf8")
}

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
        title: z.string().max(120).describe("Diagram title, e.g. 'Order Platform - GCP Architecture'"),
        subtitle: z.string().max(120).optional().describe("Context line, e.g. 'my-project · europe-west3'"),
        nodes: z.array(z.object({
          id: z.string().describe("short_snake_case unique id"),
          kind: z.string().describe("a kind from the vocabulary in the tool description"),
          title: z.string().describe("the component's name, in the user's own wording"),
          detail: z.string().optional().describe("max 7 words"),
          status: z.enum(["active", "planned", "bypassed", "external"]).optional(),
          group: z.string().optional().describe("only with containers: id of the container it sits in; omit when outside all of them"),
        })).min(1).max(MAX_NODES),
        containers: GROUPS_ARG,
        interfaces: z.array(z.object({
          from: z.string(),
          to: z.string(),
          label: z.string().optional(),
          protocol: z.string().optional(),
          description: z.string().optional(),
        })).max(MAX_EDGES),
        repository: z.string().optional().describe("Only after analyze_repository handed you its evidence: the repository name it reported"),
        save: z.boolean().optional().describe("Also write the .drawio file into the workspace (always done when the host has no live view)"),
        workspace: workspaceArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: meta,
    },
    async ({ repository, save, workspace, ...args }) => {
      await adoptWorkspace(workspace)
      // Named containers switch to the grouped layout; without them the original platform frames and zones are used.
      if (!args.containers?.length) { delete args.containers; for (const n of args.nodes) delete (n as { group?: string }).group }
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
        groups: GROUPS_ARG,
        nodes: z.array(z.object({
          id: z.string().describe("short_snake_case unique id"),
          title: z.string().describe("the name, in the user's own wording"),
          detail: z.string().optional().describe("max 8 words"),
          group: z.string().optional().describe("id of its group; omit when it sits outside every group"),
          icon: z.string().optional().describe(`${GENERAL_ICONS.join(" | ")} | any architecture kind`),
          status: z.enum(["active", "planned", "bypassed", "external"]).optional(),
        })).min(1).max(MAX_NODES),
        interfaces: z.array(z.object({
          from: z.string(), to: z.string(), label: z.string().optional(), description: z.string().optional(),
        })).max(MAX_EDGES),
        save: z.boolean().optional().describe("Also write the .drawio file into the workspace (always done when the host has no live view)"),
        workspace: workspaceArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: meta,
    },
    async ({ save, workspace, ...args }) => {
      await adoptWorkspace(workspace)
      try {
        // Always a grouped diagram, also when every node sits outside a group.
        return summarise({ ...args, groups: args.groups ?? [] }, shouldSave(save), liveView())
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
        })).min(2).max(MAX_NODES),
        connections: z.array(z.object({
          from: z.string(),
          to: z.string(),
          label: z.string().optional().describe("branch label, max 3 words: Yes / No for decisions, otherwise usually empty"),
        })).max(MAX_EDGES),
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
      })).min(2).max(24),
      messages: z.array(z.object({
        from: z.string().optional(), to: z.string().optional(), label: z.string().optional(),
        type: z.enum(["sync", "async", "return", "create"]).optional(),
        fragment: z.enum(["alt", "opt", "loop", "par", "critical", "break"]).optional(),
        else: z.string().optional(), end: z.boolean().optional(),
        note: z.string().optional(), over: z.union([z.string(), z.array(z.string())]).optional(),
      }).passthrough()).max(MAX_EDGES).describe("messages and control items (fragment / else / end / note) in time order"),
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
      })).min(2).max(MAX_NODES),
      transitions: z.array(z.object({
        from: z.string(), to: z.string(), event: z.string().optional(), guard: z.string().optional(), action: z.string().optional(),
      })).max(MAX_EDGES),
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
      })).min(1).max(MAX_TABLES),
      relationships: z.array(z.object({
        from: z.string(), to: z.string(),
        type: z.enum(["inherits", "implements", "composition", "aggregation", "association", "dependency"]),
        label: z.string().optional().describe("multiplicity or role, e.g. 1..*"),
      })).max(MAX_EDGES),
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
      })).min(1).max(MAX_TABLES),
      relationships: z.array(z.object({
        from: z.string(), to: z.string(),
        cardinality: z.enum(["one-to-one", "one-to-many", "many-to-one", "many-to-many"]),
        label: z.string().optional(),
      })).max(MAX_EDGES),
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
