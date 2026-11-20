// What the live view shows must be what the user downloads or opens in draw.io: for every drawing tool and the input
// shapes models send, the view's final picture (built from the raw tool input and the server's layout, as the view
// builds it) places every shape exactly where the server's .drawio file does.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { createServer } from "../src/mcp/server.js"
import { config } from "../src/config.js"
import { buildDrawio, buildScene, diagramKind, normaliseFacts, usedContainers, type DiagramInput, type Positions, type SerialLayout } from "../src/engine/index.js"

config.workspaceRoots = []
const UI = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } }
const json = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8").replace(/^\uFEFF/, ""))
const asList = (j: unknown) => (Array.isArray(j) ? j : Object.values(j as object)) as Record<string, unknown>[]
const dev = asList(json("./dev-cases.json")).map(({ name: _n, ...args }) => args)
const flows = asList(json("./flow-cases.json"))
const sample = json("./sample.json")
const gcpNodes = [
  { id: "users", kind: "user", title: "Users" }, { id: "lb", kind: "load_balancer", title: "Load Balancer" },
  { id: "run", kind: "cloud_run", title: "Cloud Run" }, { id: "sql", kind: "cloud_sql", title: "Cloud SQL" },
  { id: "bq", kind: "bigquery", title: "BigQuery" },
]
const gcpLinks = [{ from: "users", to: "lb" }, { from: "lb", to: "run" }, { from: "run", to: "sql" }, { from: "run", to: "bq" }]
const general = (extra: Record<string, unknown>, icon = true) => ({
  title: "Full-stack app",
  nodes: gcpNodes.map(({ kind, ...n }) => ({ ...n, ...(icon ? { icon: kind } : {}) })),
  interfaces: gcpLinks, ...extra,
})

const CASES: [name: string, tool: string, args: Record<string, unknown>][] = [
  ["architecture", "create_architecture_diagram", sample],
  ["architecture with containers", "create_architecture_diagram", { title: "Regions", containers: [{ id: "a", title: "europe-west3" }, { id: "b", title: "europe-west4" }],
    nodes: gcpNodes.map((n, i) => ({ ...n, ...(i > 1 ? { group: i % 2 ? "a" : "b" } : {}) })), interfaces: gcpLinks }],
  ["architecture with containers, left to right", "create_architecture_diagram", { title: "Regions", direction: "LR", containers: [{ id: "a", title: "A" }],
    nodes: gcpNodes.map((n, i) => ({ ...n, ...(i > 1 ? { group: "a" } : {}) })), interfaces: gcpLinks }],
  ["architecture with unused containers", "create_architecture_diagram", { title: "Unused", containers: [{ id: "front", title: "Front" }], nodes: gcpNodes, interfaces: gcpLinks }],
  ["general without groups", "create_diagram", general({})],
  ["general without groups or icons", "create_diagram", general({}, false)],
  ["general without groups, top down", "create_diagram", general({ direction: "TB" })],
  ["general with groups", "create_diagram", general({ groups: [{ id: "g", title: "Backend" }] })],
  ["flowchart", "create_flowchart", flows.find((c) => !c.lanes)!],
  ["flowchart with lanes", "create_flowchart", flows.find((c) => c.lanes)!],
  ["ER", "create_er_diagram", dev.find((c) => Array.isArray(c.entities))!],
  ["class", "create_class_diagram", dev.find((c) => Array.isArray(c.classes))!],
  ["state", "create_state_diagram", dev.find((c) => Array.isArray(c.states))!],
  ["sequence", "create_sequence_diagram", dev.find((c) => Array.isArray(c.participants))!],
]

const places = (xml: string) => new Map([...xml.matchAll(/<mxCell id="([^"]+)"[^>]*vertex="1"[^>]*>\s*<mxGeometry x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
  .map((m) => [m[1], m.slice(2, 6).join(",")]))

for (const [name, tool, args] of CASES) {
  test(`${name}: the view shows what the .drawio file contains`, async () => {
    const [a, b] = InMemoryTransport.createLinkedPair()
    await createServer().connect(b)
    const client = new Client({ name: "consistency", version: "1" }, { capabilities: UI as never })
    await client.connect(a)
    const r = (await client.callTool({ name: tool, arguments: args })) as CallToolResult
    assert.ok(!r.isError, JSON.stringify(r.content))
    const sc = r.structuredContent as { xml: string; layout?: SerialLayout; positions?: Positions }
    // As stream.ts draw() does once everything is revealed.
    const raw = args as DiagramInput
    const containers = usedContainers(raw)
    const facts = normaliseFacts({ ...raw, ...(containers ? { groups: containers } : {}) }, false)
    const scene = buildScene(facts, sc.positions ?? {}, undefined, sc.layout)
    const server = places(sc.xml), view = places(buildDrawio(scene).xml)
    assert.ok(server.size > 0, "the file has shapes")
    assert.deepEqual(view, server, `${diagramKind(raw)}: the view and the file differ`)
    await client.close()
  })
}

// Models add fields a tool does not know (a label on a state transition, a colour on a node): the server drops them,
// so the view must finish with the server's arguments, or the canvas and the file drift apart.
test("unknown fields in the tool input change neither the file nor what the view finishes with", async () => {
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createServer().connect(b)
  const client = new Client({ name: "consistency", version: "1" }, { capabilities: UI as never })
  await client.connect(a)
  const state = dev.find((c) => Array.isArray(c.states))!
  const noisy = { ...state, transitions: (state.transitions as Record<string, unknown>[]).map((t) => ({ ...t, label: "a much longer label than any event" })) }
  const r = (await client.callTool({ name: "create_state_diagram", arguments: noisy })) as CallToolResult
  const sc = r.structuredContent as { xml: string; diagram: Record<string, unknown> }
  assert.ok(!(sc.diagram.transitions as Record<string, unknown>[]).some((t) => "label" in t), "the drawn arguments have no unknown field")
  const clean = (await client.callTool({ name: "create_state_diagram", arguments: { ...state, title: String(state.title) } })) as CallToolResult
  assert.deepEqual(places(sc.xml), places((clean.structuredContent as { xml: string }).xml))
  const view = readFileSync(new URL("../src/view/stream.ts", import.meta.url), "utf8")
  assert.match(view, /if \(sc\?\.diagram && latest && !sc\.analysis\) \{ latest = sc\.diagram; inputFinal = true \}/)
  await client.close()
})