// Robustness: every kind of diagram, drawn and then changed many times in a row the way a model does it (tables and
// classes that grow, nodes added, renamed and removed, groups added, direction flipped). No call may fail.
// FUZZ_ROUNDS raises the number of change sequences per kind (default 4) for a longer run.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { createServer } from "../src/mcp/server.js"
import { config } from "../src/config.js"
import { INPUT_KEYS, buildDrawio, buildScene, diagramKind, normaliseFacts, usedContainers, type DiagramInput, type Positions, type Pt, type SerialLayout } from "../src/engine/index.js"

const places = (xml: string) => new Map([...xml.matchAll(/<mxCell id="([^"]+)"[^>]*vertex="1"[^>]*>\s*<mxGeometry x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
  .map((m) => [m[1], m.slice(2, 6).join(",")]))

config.workspaceRoots = []
const UI = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } }
const json = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8").replace(/^\uFEFF/, ""))
const asList = (j: unknown) => (Array.isArray(j) ? j : Object.values(j as object)) as Record<string, unknown>[]
const dev = asList(json("./dev-cases.json"))
const flows = asList(json("./flow-cases.json"))
const devCase = (key: string) => { const { name: _n, ...args } = dev.find((c) => Array.isArray(c[key]))!; return args }

const CASES: [tool: string, args: Record<string, unknown>][] = [
  ["create_architecture_diagram", json("./sample.json")],
  // Containers named but no node placed in them, as models sometimes write it.
  ["create_architecture_diagram", { ...json("./sample.json"), containers: [{ id: "front", title: "Frontend" }, { id: "back", title: "Backend" }] }],
  ["create_flowchart", flows.find((c) => !c.lanes)!],
  ["create_flowchart", flows.find((c) => c.lanes)!],
  ["create_er_diagram", devCase("entities")],
  ["create_class_diagram", devCase("classes")],
  ["create_state_diagram", devCase("states")],
  ["create_sequence_diagram", devCase("participants")],
  ["create_diagram", { title: "Platform", groups: [{ id: "web", title: "Web" }, { id: "data", title: "Data" }],
    nodes: [{ id: "ui", title: "UI", group: "web" }, { id: "api", title: "API", group: "web" }, { id: "db", title: "DB", group: "data" }],
    interfaces: [{ from: "ui", to: "api" }, { from: "api", to: "db" }] }],
]
const GROUPS: Record<string, [string, string]> = { create_architecture_diagram: ["containers", "group"], create_diagram: ["groups", "group"], create_flowchart: ["lanes", "lane"] }

function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const text = (r: CallToolResult) => r.content.map((c) => (c.type === "text" ? c.text : "")).join(" ")

// One change of the kind a model makes, built from the diagram as it is now.
function change(tool: string, args: Record<string, unknown>, rand: () => number, step: number): Record<string, unknown> {
  const kind = diagramKind(args as DiagramInput)
  const [nodeKey, edgeKey] = INPUT_KEYS[kind]
  const nodes = (args[nodeKey] as Record<string, unknown>[]) ?? []
  const edges = (args[edgeKey] as Record<string, unknown>[]) ?? []
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
  const ids = nodes.map((n) => String(n.id))
  const fresh = (i: number) => `n${step}_${i}`
  const grow = (n: Record<string, unknown>) => {
    if (kind === "er") return { id: n.id, fields: [...((n.fields as unknown[]) ?? []), { name: `created_at_${step}`, type: "timestamp" }, { name: `updated_at_${step}`, type: "timestamp" }, { name: `audit_${step}`, type: "varchar(64)" }] }
    if (kind === "class") return { id: n.id, attributes: [...((n.attributes as unknown[]) ?? []), `- audit${step}: String`, `- createdAt${step}: Instant`] }
    return { id: n.id, title: `${String(n.title ?? n.id)} (revised ${step}, a longer title)` }
  }
  const node = (i: number) => {
    const like = structuredClone(pick(nodes))
    const id = fresh(i)
    const out: Record<string, unknown> = { ...like, id, title: `New ${id}` }
    if (kind === "er") Object.assign(out, { name: id, fields: [{ name: "id", type: "uuid", pk: true }, { name: "label", type: "text" }] })
    if (kind === "class") Object.assign(out, { name: `New${i}${step}`, type: "class", attributes: ["- id: UUID"], methods: [] })
    if (kind === "state") Object.assign(out, { type: undefined })
    return out
  }
  const edge = (from: string, to: string) => {
    const like = structuredClone(pick(edges) ?? {})
    return { ...like, from, to, ...(kind === "sequence" || kind === "flowchart" || kind === "state" ? { label: `step ${step}` } : {}) }
  }
  const op = Math.floor(rand() * 9)
  switch (op) {
    case 8: return { direction: pick(["TB", "LR"]), remove: ["ghost", "ghost>phantom"], update: [{ id: "phantom", title: "x" }] } // a guess the model makes
    case 0: return { update: nodes.map(grow) } // every table / class grows (the audit-columns case)
    case 1: return { update: [grow(pick(nodes))] }
    case 2: { const n = node(0); return { add_nodes: [n], add_connections: [edge(pick(ids), String(n.id))] } }
    case 3: { const a = node(0), b = node(1); return { add_nodes: [a, b], add_connections: [edge(pick(ids), String(a.id)), edge(String(a.id), String(b.id))] } }
    case 4: return ids.length > 3 ? { remove: [pick(ids.filter((id) => !/^(start|end|initial|final)/.test(id)))] } : { update: [grow(pick(nodes))] }
    case 5: return edges.length > 2 ? { remove: [`${edges[0].from}>${edges[0].to}`] } : { title: `Renamed ${step}` }
    case 6: {
      const g = GROUPS[tool]
      if (!g) return kind === "sequence" ? { add_connections: [edge(pick(ids), pick(ids))] } : { direction: pick(["TB", "LR"]) }
      const gid = `g${step}`
      return { add_groups: [{ id: gid, title: `Region ${step}` }], update: ids.slice(0, Math.max(1, Math.floor(ids.length / 2))).map((id) => ({ id, [g[1]]: gid })) }
    }
    default: return { title: `Renamed ${step}`, update: [{ id: pick(ids), title: `Renamed node ${step}` }] }
  }
}

const rounds = Number(process.env.FUZZ_ROUNDS ?? 4)
for (const [tool, base] of CASES) {
  test(`${tool}${base.lanes ? " with lanes" : ""}${base.containers ? " with unused containers" : ""}: ${rounds} sequences of changes never fail`, async () => {
    for (let round = 0; round < rounds; round++) {
      const rand = rng(round * 7919 + tool.length)
      const [a, b] = InMemoryTransport.createLinkedPair()
      await createServer().connect(b)
      const client = new Client({ name: "fuzz", version: "1" }, { capabilities: UI as never })
      await client.connect(a)
      const first = (await client.callTool({ name: tool, arguments: base })) as CallToolResult
      assert.ok(!first.isError, `${tool} create: ${text(first)}`)
      const sc = first.structuredContent as { sheet: string; diagram?: Record<string, unknown> }
      let args = sc.diagram ?? base
      for (let step = 1; step <= 8; step++) {
        const delta = change(tool, args, rand, step)
        const r = (await client.callTool({ name: "edit_diagram", arguments: { diagram: sc.sheet, ...delta } })) as CallToolResult
        assert.ok(!r.isError, `${tool} round ${round} step ${step} ${JSON.stringify(delta).slice(0, 300)}: ${text(r)}`)
        assert.ok(text(r).slice(0, 160).includes(`Diagram id: ${sc.sheet}`), "the id stays in the preview")
        args = (r.structuredContent as { diagram: Record<string, unknown> }).diagram
        // The view rebuilds an edit from the result as stream.ts does; it must show what the file contains.
        const res = r.structuredContent as { xml: string; positions?: Positions; routes?: Record<string, Pt[]>; layout?: SerialLayout; final?: SerialLayout }
        const containers = usedContainers(args as DiagramInput)
        const kept = res.routes ? { moved: new Set<string>(), previous: new Map(Object.entries(res.routes)) } : undefined
        const scene = buildScene(normaliseFacts({ ...args, ...(containers ? { groups: containers } : {}) } as DiagramInput, false), res.final ? {} : { ...(res.positions ?? {}) }, kept, res.final ?? res.layout)
        const want = places(res.xml), got = places(buildDrawio(scene).xml)
        const diff = [...new Set([...want.keys(), ...got.keys()])].filter((k) => want.get(k) !== got.get(k)).slice(0, 4).map((k) => `${k}: file ${want.get(k)} view ${got.get(k)}`)
        assert.deepEqual(diff, [], `${tool} round ${round} step ${step} ${JSON.stringify(delta).slice(0, 200)}: the view and the file differ`)
      }
      const shown = (await client.callTool({ name: "show_diagram", arguments: { diagram: sc.sheet } })) as CallToolResult
      assert.ok(!shown.isError, text(shown))
      const redrawn = (await client.callTool({ name: tool, arguments: args })) as CallToolResult
      assert.ok(!redrawn.isError, `${tool} redraw after changes: ${text(redrawn)}`)
      await client.close()
    }
  })
}

// A host may open a fresh copy of the view after the call (fullscreen, a side panel, a reload): it gets the result only
// and must show the file's diagram without routing anything itself, which takes seconds on large diagrams.
test("every first drawing's result rebuilds in a fresh view exactly as the file, from its final layout", async () => {
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createServer().connect(b)
  const client = new Client({ name: "fresh-view", version: "1" }, { capabilities: UI as never })
  await client.connect(a)
  for (const [tool, base] of CASES) {
    const r = (await client.callTool({ name: tool, arguments: base })) as CallToolResult
    assert.ok(!r.isError, `${tool}: ${text(r)}`)
    const res = r.structuredContent as { xml: string; diagram: Record<string, unknown>; final?: SerialLayout }
    if (diagramKind(res.diagram as DiagramInput) === "sequence") { assert.equal(res.final, undefined, "sequence diagrams lay themselves out"); continue }
    assert.ok(res.final?.routes, `${tool}: the result carries the drawn boxes and lines`)
    const containers = usedContainers(res.diagram as DiagramInput)
    const scene = buildScene(normaliseFacts({ ...res.diagram, ...(containers ? { groups: containers } : {}) } as DiagramInput, false), {}, undefined, res.final)
    assert.equal(buildDrawio(scene).xml, res.xml, `${tool}${base.containers ? " with containers" : ""}: the fresh view draws the file`)
  }
  await client.close()
})
