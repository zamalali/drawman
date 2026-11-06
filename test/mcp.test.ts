import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { CreateMessageRequestSchema, ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { fileURLToPath, pathToFileURL } from "node:url"
import { inflateRawSync } from "node:zlib"
import { config } from "../src/config.js"
import { httpApp } from "../src/mcp/http.js"
import { RESOURCE_URI, createServer } from "../src/mcp/server.js"

const UI = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } }
const sample = JSON.parse(readFileSync(new URL("./sample.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""))
const text = (r: CallToolResult) => r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n")

async function connect(capabilities: Record<string, unknown>) {
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createServer().connect(b)
  const client = new Client({ name: "test", version: "1" }, { capabilities: capabilities as never })
  await client.connect(a)
  return client
}

const workspace = mkdtempSync(path.join(tmpdir(), "drawio-mcp-"))
config.workspaceRoots = [workspace]
config.llm.baseUrl = ""
test.after(() => rmSync(workspace, { recursive: true, force: true }))

test("tools advertise the MCP App view and the view resource is served", async () => {
  const client = await connect(UI)
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "analyze_repository", "create_architecture_diagram", "create_class_diagram", "create_diagram", "create_er_diagram",
    "create_flowchart", "create_sequence_diagram", "create_state_diagram",
  ])
  for (const t of tools) assert.equal((t._meta as { ui: { resourceUri: string } }).ui.resourceUri, RESOURCE_URI)
  if (existsSync(new URL("../dist/view/view.html", import.meta.url))) {
    const { contents } = await client.readResource({ uri: RESOURCE_URI })
    assert.match(String((contents[0] as { text: string }).text), /<svg|<html/i)
  }
})

test("a host with the live view gets XML for the canvas and no file on disk", async () => {
  const client = await connect(UI)
  const r = (await client.callTool({ name: "create_architecture_diagram", arguments: sample })) as CallToolResult
  assert.ok(!r.isError, text(r))
  assert.match(String((r.structuredContent as { xml: string }).xml), /^<mxfile/)
  assert.ok(!existsSync(path.join(workspace, "diagrams")))
  assert.match(text(r), /live for the user/)
})

test("create_flowchart renders flowchart shapes and summarises the branches for the model", async () => {
  const client = await connect(UI)
  const refund = JSON.parse(readFileSync(new URL("./refund-flow.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""))
  const r = (await client.callTool({ name: "create_flowchart", arguments: refund })) as CallToolResult
  assert.ok(!r.isError, text(r))
  assert.match(text(r), /^Rendered flowchart "Customer Refund Request Flow" live for the user: 10 steps, 11 connections/)
  assert.match(text(r), /Within 30 days\? -> Inspect the item \(Yes\)/)
  assert.match(String((r.structuredContent as { xml: string }).xml), /rhombus;/)
})

test("a terminal host without MCP Apps gets a .drawio file in the workspace and no XML in its context", async () => {
  const client = await connect({})
  const r = (await client.callTool({ name: "create_architecture_diagram", arguments: sample })) as CallToolResult
  const sc = r.structuredContent as { file: string; xml?: string }
  assert.ok(sc.file.startsWith(path.join(workspace, "diagrams")), sc.file)
  assert.match(readFileSync(sc.file, "utf8"), /^<mxfile/)
  assert.equal(sc.xml, undefined, "the 30 KB XML is not sent to hosts that cannot render it")
})

test("hosts without the live view get a short link to a page that opens the exact diagram in the draw.io editor", async () => {
  const client = await connect({})
  const r = (await client.callTool({ name: "create_architecture_diagram", arguments: sample })) as CallToolResult
  const sc = r.structuredContent as { file: string; open: string }
  assert.match(sc.open, /^file:\/\/.+\.drawio\.html$/)
  assert.ok(text(r).includes(sc.open) && text(r).length < 3000, "the agent only has to repeat a short path")
  const page = readFileSync(fileURLToPath(sc.open), "utf8")
  const url = JSON.parse(page.match(/location\.replace\((".*?")\)/)![1]) as string
  assert.match(url, /^https:\/\/app\.diagrams\.net\/\?title=[^#]+\.drawio#R/)
  const xml = decodeURIComponent(inflateRawSync(Buffer.from(decodeURIComponent(url.split("#R")[1]), "base64")).toString("utf8"))
  assert.equal(xml, readFileSync(sc.file, "utf8"))
})

test("the client's workspace roots decide what is read and where diagrams are saved", async () => {
  const project = mkdtempSync(path.join(tmpdir(), "drawio-roots-"))
  const saved = [...config.workspaceRoots]
  try {
    const [a, b] = InMemoryTransport.createLinkedPair()
    await createServer().connect(b)
    const client = new Client({ name: "agent-cli", version: "1" }, { capabilities: { roots: { listChanged: true } } })
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [{ uri: pathToFileURL(project).href, name: "project" }] }))
    await client.connect(a)
    const r = (await client.callTool({ name: "create_diagram", arguments: { title: "Roots", groups: [{ id: "g", title: "G" }], nodes: [{ id: "a", title: "A", group: "g" }, { id: "b", title: "B", group: "g" }], interfaces: [{ from: "a", to: "b" }] } })) as CallToolResult
    const file = (r.structuredContent as { file: string }).file
    assert.ok(file.startsWith(path.join(project, "diagrams")), `${file} should be inside the client's root ${project}`)
  } finally {
    config.workspaceRoots = saved
    rmSync(project, { recursive: true, force: true })
  }
})

test("Copilot CLI: started in the plugin folder, announces MCP Apps, no roots -> uses the agent's workspace and saves a file", async () => {
  const project = mkdtempSync(path.join(tmpdir(), "drawio-copilot-"))
  const saved = { roots: [...config.workspaceRoots], source: config.rootsSource }
  try {
    config.workspaceRoots = []
    config.rootsSource = "none"
    const [a, b] = InMemoryTransport.createLinkedPair()
    await createServer().connect(b)
    const client = new Client({ name: "copilot-cli", version: "1.0.105" }, { capabilities: { ...UI, sampling: {} } as never })
    await client.connect(a)
    writeFileSync(path.join(project, "docker-compose.yml"), "services:\n  db:\n    image: postgres:16\n  api:\n    build: .\n")
    const analysed = (await client.callTool({ name: "analyze_repository", arguments: { repository: ".", workspace: project } })) as CallToolResult
    assert.ok(!analysed.isError, text(analysed))
    assert.match(text(analysed), /Analyzed drawio-copilot-/)
    const drawn = (await client.callTool({ name: "create_diagram", arguments: { title: "Copilot", groups: [{ id: "g", title: "G" }], nodes: [{ id: "a", title: "A", group: "g" }, { id: "b", title: "B", group: "g" }], interfaces: [{ from: "a", to: "b" }], workspace: project } })) as CallToolResult
    const sc = drawn.structuredContent as { file?: string; xml?: string }
    assert.ok(sc.file?.startsWith(path.join(realpathSync(project), "diagrams")), String(sc.file))
    assert.equal(sc.xml, undefined)
  } finally {
    config.workspaceRoots = saved.roots
    config.rootsSource = saved.source
    rmSync(project, { recursive: true, force: true })
  }
})

test("an agent-provided workspace never overrides configured or client roots, and broad paths are refused", async () => {
  const saved = { roots: [...config.workspaceRoots], source: config.rootsSource }
  try {
    config.rootsSource = "default"
    const client = await connect({})
    await client.callTool({ name: "create_diagram", arguments: { title: "X", groups: [{ id: "g", title: "G" }], nodes: [{ id: "a", title: "A", group: "g" }], interfaces: [], workspace: tmpdir() } })
    assert.deepEqual(config.workspaceRoots, saved.roots)
    config.rootsSource = "none"
    await client.callTool({ name: "create_diagram", arguments: { title: "X", groups: [{ id: "g", title: "G" }], nodes: [{ id: "a", title: "A", group: "g" }], interfaces: [], workspace: path.parse(process.cwd()).root } })
    assert.equal(config.rootsSource, "none", "a filesystem root is never adopted")
  } finally {
    config.workspaceRoots = saved.roots
    config.rootsSource = saved.source
  }
})

test("sampling is not attempted by default, so headless agents get the evidence instead of waiting", async () => {
  const repo = path.join(workspace, "sampled")
  mkdirSync(repo, { recursive: true })
  writeFileSync(path.join(repo, "Dockerfile"), "FROM node:22\n")
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createServer().connect(b)
  const client = new Client({ name: "headless", version: "1" }, { capabilities: { sampling: {} } })
  let asked = false
  client.setRequestHandler(CreateMessageRequestSchema, async () => { asked = true; return new Promise(() => {}) })
  await client.connect(a)
  const r = (await client.callTool({ name: "analyze_repository", arguments: { repository: "sampled" } })) as CallToolResult
  assert.equal(asked, false)
  assert.equal((r.structuredContent as { handoff?: boolean }).handoff, true)
})

test("without a model the evidence is handed to the agent, and its diagram gets the evidence-based release path", async () => {
  const repo = path.join(workspace, "svc")
  mkdirSync(path.join(repo, ".github", "workflows"), { recursive: true })
  writeFileSync(path.join(repo, ".github", "workflows", "release.yml"),
    "jobs:\n  r:\n    steps:\n      - run: docker build -t x .\n      - run: jf rt upload\n      - run: gcloud run deploy api --image europe-docker.pkg.dev/p/r/x\n")
  writeFileSync(path.join(repo, "Dockerfile"), "FROM node:22\n")
  const client = await connect(UI)
  const handoff = (await client.callTool({ name: "analyze_repository", arguments: { repository: "svc" } })) as CallToolResult
  assert.ok(!handoff.isError, text(handoff))
  assert.equal((handoff.structuredContent as { handoff: boolean }).handoff, true)
  assert.match(text(handoff), /call create_architecture_diagram with repository="svc"/)
  const drawn = (await client.callTool({
    name: "create_architecture_diagram",
    arguments: {
      repository: "svc", title: "svc", nodes: [
        { id: "gha", kind: "github_actions", title: "Actions" }, { id: "api", kind: "cloud_run", title: "API" },
        { id: "db", kind: "cloud_sql", title: "DB" },
      ], interfaces: [{ from: "gha", to: "api" }, { from: "api", to: "db" }],
    },
  })) as CallToolResult
  const kinds = ((drawn.structuredContent as { diagram: { nodes: { kind: string }[] } }).diagram.nodes).map((n) => n.kind)
  for (const k of ["docker_build", "artifact_registry"]) assert.ok(kinds.includes(k), `${k} added from evidence: ${kinds}`)
})

test("Streamable HTTP transport serves the same tools", async () => {
  const server = httpApp().listen(0, "127.0.0.1")
  await new Promise((r) => server.once("listening", r))
  try {
    const client = new Client({ name: "http-test", version: "1" })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)))
    const r = (await client.callTool({ name: "create_architecture_diagram", arguments: sample })) as CallToolResult
    assert.ok(!r.isError, text(r))
    await client.close()
  } finally { server.close() }
})
