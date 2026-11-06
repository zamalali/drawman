import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import express from "express"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js"
import { config, llmConfigured, llmHeaders } from "../config.js"
import { listen, localOnly } from "../local-guard.js"
import { createServer } from "../mcp/server.js"
import { parsePartialJson } from "./partial-json.js"

const LLM_URL = config.llm.baseUrl
const DEFAULT_MODEL = config.llm.model
const chatUrl = (p: string) => (/\/v\d+$/.test(LLM_URL) ? `${LLM_URL}${p}` : `${LLM_URL}/v1${p}`)

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
await createServer().connect(serverTransport)
const mcp = new Client({ name: "drawman-host", version: "0.1.0" }, {
  capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } as never,
})
await mcp.connect(clientTransport)
const { tools } = await mcp.listTools()
type UiMeta = { ui?: { resourceUri?: string; visibility?: string[] } }
const uiOf = (t: Tool) => ((t._meta ?? {}) as UiMeta).ui ?? {}
const modelTools = tools.filter((t) => (uiOf(t).visibility ?? ["model", "app"]).includes("model"))
const appTools = new Set(tools.filter((t) => (uiOf(t).visibility ?? ["model", "app"]).includes("app")).map((t) => t.name))
const openAiTools = modelTools.map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema },
}))
console.log(`MCP server ready: ${tools.map((t) => `${t.name}${uiOf(t).resourceUri ? ` (ui: ${uiOf(t).resourceUri})` : ""}`).join(", ")}`)

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string }
interface Session { messages: ChatMessage[]; modelContext?: string }
const sessions = new Map<string, Session>()
const session = (id: string) => {
  if (!sessions.has(id)) sessions.set(id, { messages: [] })
  return sessions.get(id)!
}

const SYSTEM_PROMPT = `You are "Drawman", a senior cloud architect.
You design cloud architectures and draw them with the create_architecture_diagram tool; the user watches the
draw.io diagram build itself live in an interactive canvas right in the chat.

How to work:
- For ANY request to draw, design, sketch, change or extend an architecture: first write ONE short sentence on what
  you are about to draw, then call create_architecture_diagram. Never ask clarifying questions first; make
  sensible senior-architect assumptions and state them afterwards.
- When the user names an existing repository, codebase, project folder or git link, call analyze_repository
  instead: it reads the real code, CI/CD, Terraform, Bicep and SAP MTA descriptors and draws the diagram from evidence.
- Diagrams can span Google Cloud, Microsoft Azure, SAP BTP and on-premises SAP; pick the platform the user asks for.
- For flowcharts, processes, workflows, approval flows and decision trees call create_flowchart (real flowchart
  shapes, Yes/No branches); for API / auth / call flows create_sequence_diagram; for lifecycles and statuses
  create_state_diagram; for object models create_class_diagram; for database schemas create_er_diagram; for other
  connected diagrams (ML models, concept maps) create_diagram. Spatial pictures (floor plans, maps, UI mockups, charts
  of data) are not possible: say so plainly instead of forcing them into a diagram.
- After the tool returns, reply with 3-6 crisp bullets: key design decisions and the most important flows,
  citing interface numbers (IF-01, IF-02...); for flowcharts walk through the main path and each decision.
  Never paste XML, JSON or coordinates.
- ${config.profile.defaults || "When unspecified, follow cloud best practice: keyless CI/CD federation, least-privilege identities, managed secrets, central logging and monitoring, private egress."}
- To modify an existing diagram call the tool again with the COMPLETE updated nodes and interfaces.
- For questions that do not need a diagram, answer briefly in plain text.`

type Emit = (event: Record<string, unknown>) => void

async function* sse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith("data:")) continue
      const data = line.slice(5).trim()
      if (data === "[DONE]") return
      try { yield JSON.parse(data) } catch { /* keep-alive or partial line */ }
    }
  }
}

async function runTurn(s: Session, model: string, emit: Emit, signal: AbortSignal) {
  const usage = { prompt: 0, completion: 0, calls: 0 }
  for (let round = 0; round < 4; round++) {
    const system = SYSTEM_PROMPT + (s.modelContext ? `\n\nCurrent UI context from the diagram app:\n${s.modelContext}` : "")
    const body: Record<string, unknown> = {
      model, stream: true, stream_options: { include_usage: true }, max_tokens: 12000,
      messages: [{ role: "system", content: system }, ...s.messages], tools: openAiTools, tool_choice: "auto",
    }
    if (!/^(openai\/)?(o\d|gpt-5)/.test(model)) body.temperature = 0.2
    const res = await fetch(chatUrl("/chat/completions"), {
      method: "POST", signal,
      headers: {
        ...llmHeaders(), "Content-Type": "application/json",
        // Without this Anthropic buffers tool-input JSON and releases it in a few large bursts.
        ...(/anthropic|claude/i.test(model) ? { "anthropic-beta": "fine-grained-tool-streaming-2025-05-14" } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!res.ok || !res.body) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 400)}`)
    usage.calls++
    let text = ""
    const calls: { id: string; name: string; args: string; started: boolean; lastSent: number; lastJson: string }[] = []
    for await (const chunk of sse(res.body)) {
      if (chunk.usage) { usage.prompt += chunk.usage.prompt_tokens ?? 0; usage.completion += chunk.usage.completion_tokens ?? 0 }
      const delta = chunk.choices?.[0]?.delta
      if (!delta) continue
      if (delta.content) {
        text += delta.content
        emit({ type: "text", delta: delta.content })
      }
      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? 0
        calls[i] ??= { id: "", name: "", args: "", started: false, lastSent: 0, lastJson: "" }
        const c = calls[i]
        if (tc.id) c.id = tc.id
        if (tc.function?.name) c.name += tc.function.name
        if (tc.function?.arguments) c.args += tc.function.arguments
        if (!c.started && c.name && c.id) {
          c.started = true
          const tool = tools.find((t) => t.name === c.name)
          emit({ type: "tool_start", callId: c.id, name: c.name, title: tool?.title ?? c.name, resourceUri: tool ? uiOf(tool).resourceUri : undefined })
        }
        const now = Date.now()
        if (c.started && now - c.lastSent > 50) {
          const partial = parsePartialJson(c.args)
          const json = partial ? JSON.stringify(partial) : ""
          if (partial && json !== c.lastJson) {
            c.lastSent = now
            c.lastJson = json
            emit({ type: "tool_partial", callId: c.id, args: partial })
          }
        }
      }
    }
    const done = calls.filter((c) => c?.name)
    if (!done.length) {
      s.messages.push({ role: "assistant", content: text })
      return usage
    }
    s.messages.push({
      role: "assistant", content: text || null,
      tool_calls: done.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args || "{}" } })),
    })
    for (const c of done) {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(c.args || "{}") } catch { args = parsePartialJson(c.args) ?? {} }
      emit({ type: "tool_input", callId: c.id, args })
      const t0 = Date.now()
      let result: CallToolResult
      try {
        result = (await mcp.callTool({ name: c.name, arguments: args })) as CallToolResult
      } catch (error) {
        result = { isError: true, content: [{ type: "text", text: (error as Error).message }] }
      }
      emit({ type: "tool_result", callId: c.id, result, ms: Date.now() - t0 })
      // Only `content` goes back to the model; structuredContent (the XML) is for the View only.
      const forModel = result.content.map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join("\n")
      s.messages.push({ role: "tool", tool_call_id: c.id, content: forModel })
    }
  }
  return usage
}

const app = express()
app.use(localOnly())
app.use(express.json({ limit: "4mb" }))

app.get("/api/info", async (_req, res) => {
  let models: string[] = []
  try {
    const r = await fetch(chatUrl("/models"), { headers: llmHeaders() })
    models = ((await r.json()).data ?? []).map((m: { id: string }) => m.id)
      .filter((id: string) => !/(tts|whisper|image|embedding|moderation|audio|realtime|fake)/i.test(id))
  } catch { /* offline: just the default */ }
  res.json({ defaultModel: DEFAULT_MODEL, models: models.length ? models.sort() : [DEFAULT_MODEL], gateway: new URL(LLM_URL).host, tools: modelTools.map((t) => t.name) })
})

app.get("/api/resource", async (req, res) => {
  try {
    const r = await mcp.readResource({ uri: String(req.query.uri) })
    res.json(r.contents[0])
  } catch (error) {
    res.status(404).json({ error: (error as Error).message })
  }
})

app.post("/api/tools/call", async (req, res) => {
  const { name, arguments: args } = req.body ?? {}
  if (!appTools.has(name)) return res.status(403).json({ isError: true, content: [{ type: "text", text: `${name} is not callable by apps` }] })
  res.json(await mcp.callTool({ name, arguments: args ?? {} }))
})

app.post("/api/context", (req, res) => {
  session(String(req.body?.sessionId)).modelContext = String(req.body?.text ?? "").slice(0, 4000)
  res.json({})
})

app.post("/api/chat", async (req, res) => {
  const { sessionId, message, model } = req.body ?? {}
  if (!sessionId || !message) return res.status(400).json({ error: "sessionId and message required" })
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" })
  const emit: Emit = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`)
  const ac = new AbortController()
  res.on("close", () => ac.abort())
  const s = session(sessionId)
  s.messages.push({ role: "user", content: String(message) })
  const t0 = Date.now()
  try {
    const usage = await runTurn(s, String(model || DEFAULT_MODEL), emit, ac.signal)
    emit({ type: "done", ms: Date.now() - t0, usage })
  } catch (error) {
    if (!ac.signal.aborted) emit({ type: "error", message: (error as Error).message })
  }
  res.end()
})

app.post("/api/reset", (req, res) => {
  sessions.delete(String(req.body?.sessionId))
  res.json({})
})

const WEB = ["./web/", "../../dist/web/"].map((p) => fileURLToPath(new URL(p, import.meta.url))).find((d) => existsSync(`${d}index.html`) && existsSync(`${d}assets`))
if (WEB) app.use(express.static(WEB))

export function startWeb(port: number) {
  if (!llmConfigured()) throw new Error("The chat UI needs a model: set DRAWMAN_LLM_URL and DRAWMAN_LLM_KEY (any OpenAI-compatible endpoint)")
  if (!WEB) throw new Error("The web UI is not built; run `npm run build`")
  return listen(app, port, "127.0.0.1").then(() => {
    console.error(`Drawman -> http://127.0.0.1:${port}  (model ${DEFAULT_MODEL} via ${new URL(LLM_URL).host})`)
  })
}
