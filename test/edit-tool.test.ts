import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { config } from "../src/config.js"
import { createServer } from "../src/mcp/server.js"
import { applyChange } from "../src/mcp/sheets.js"

const UI = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } }
const sample = JSON.parse(readFileSync(new URL("./sample.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""))
const text = (r: CallToolResult) => r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n")
config.workspaceRoots = []

async function connect() {
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createServer().connect(b)
  const client = new Client({ name: "test", version: "1" }, { capabilities: UI as never })
  await client.connect(a)
  return client
}
type Sc = { xml: string; sheet: string; diagram: Record<string, unknown[]>; edit?: { nodes: number; edges: number } }
const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as CallToolResult
  return { r, sc: r.structuredContent as Sc }
}
const places = (xml: string) => new Map([...xml.matchAll(/<mxCell id="([^"]+)" value="[^"]*"[^>]*vertex="1"[^>]*>\s*<mxGeometry x="([\d.]+)" y="([\d.]+)"/g)]
  .map((m) => [m[1], `${m[2]},${m[3]}`]))

const shop = {
  title: "Shop",
  entities: [
    { id: "customers", name: "customers", fields: ["PK id: uuid", "email: text"] },
    { id: "orders", name: "orders", fields: ["PK id: uuid", "FK customer_id: uuid"] },
    { id: "products", name: "products", fields: ["PK id: uuid", "name: text"] },
    { id: "order_items", name: "order_items", fields: ["PK order_id: uuid", "PK product_id: uuid"] },
  ],
  relationships: [
    { from: "customers", to: "orders", cardinality: "one-to-many" },
    { from: "orders", to: "order_items", cardinality: "one-to-many" },
    { from: "products", to: "order_items", cardinality: "one-to-many" },
  ],
}

test("every drawing gets an id and the model is told to edit it instead of redrawing", async () => {
  const { r, sc } = await call(await connect(), "create_er_diagram", shop)
  assert.match(sc.sheet, /^[0-9a-f]{8}$/)
  assert.match(text(r), new RegExp(`Diagram id: ${sc.sheet}\\. For any follow-up change to it, call edit_diagram`))
})

test("edit_diagram adds a table from a small change and keeps every existing table in place", async () => {
  const client = await connect()
  const first = await call(client, "create_er_diagram", shop)
  const { r, sc } = await call(client, "edit_diagram", {
    diagram: first.sc.sheet,
    add_nodes: [{ id: "reviews", name: "reviews", fields: ["PK id: uuid", "FK product_id: uuid", "rating: int"] }],
    add_connections: [{ from: "products", to: "reviews", cardinality: "one-to-many" }],
  })
  assert.ok(!r.isError, text(r))
  assert.match(text(r), /^Edited \(\+1 entities, \+1 relationships\)\./)
  assert.equal(sc.sheet, first.sc.sheet, "an edited diagram keeps its id")
  assert.deepEqual(sc.edit, { nodes: 4, edges: 3 })
  assert.equal(sc.diagram.entities.length, 5)
  const before = places(first.sc.xml), after = places(sc.xml)
  for (const [id, at] of before) assert.equal(after.get(id), at, `${id} moved`)
  assert.ok(after.has("reviews"))
})

test("edits chain, update fields and remove nodes together with their connections", async () => {
  const client = await connect()
  const first = await call(client, "create_architecture_diagram", sample)
  const id = first.sc.sheet
  const renamed = await call(client, "edit_diagram", { diagram: id, update: [{ id: "gcs", title: "Archive bucket" }] })
  assert.ok(!renamed.r.isError, text(renamed.r))
  assert.match(renamed.sc.xml, /Archive bucket/)
  const removed = await call(client, "edit_diagram", { diagram: id, remove: ["logs", "repo>actions"] })
  assert.ok(!removed.r.isError, text(removed.r))
  const nodes = removed.sc.diagram.nodes as { id: string; title: string }[]
  const ifs = removed.sc.diagram.interfaces as { from: string; to: string }[]
  assert.ok(!nodes.some((n) => n.id === "logs"))
  assert.equal(nodes.find((n) => n.id === "gcs")?.title, "Archive bucket", "the earlier edit is kept")
  assert.ok(!ifs.some((i) => i.from === "logs" || i.to === "logs" || (i.from === "repo" && i.to === "actions")))
  const before = places(first.sc.xml), after = places(removed.sc.xml)
  for (const [cell, at] of after) if (before.has(cell) && !cell.startsWith("zone")) assert.equal(at, before.get(cell), `${cell} moved`)
})

test("edit_diagram explains unknown diagrams, unknown ids and invalid changes", async () => {
  const client = await connect()
  const missing = await call(client, "edit_diagram", { diagram: "00000000", add_nodes: [{ id: "x", name: "x", fields: [] }] })
  assert.ok(missing.r.isError)
  assert.match(text(missing.r), /Draw it again/)
  const { sc } = await call(client, "create_er_diagram", shop)
  const unknown = await call(client, "edit_diagram", { diagram: sc.sheet, remove: ["invoices"] })
  assert.ok(unknown.r.isError)
  assert.match(text(unknown.r), /"invoices".*Ids here: customers, orders/)
  const invalid = await call(client, "edit_diagram", { diagram: sc.sheet, add_connections: [{ from: "orders", to: "products" }] })
  assert.ok(invalid.r.isError)
  assert.match(text(invalid.r), /not valid for create_er_diagram.*cardinality/)
})

test("removing a group moves its members and child groups out of it", () => {
  const base = {
    title: "G", groups: [{ id: "outer", title: "Outer" }, { id: "inner", title: "Inner", parent: "outer" }],
    nodes: [{ id: "a", title: "A", group: "outer" }, { id: "b", title: "B", group: "inner" }],
    interfaces: [{ from: "a", to: "b" }],
  }
  const { args } = applyChange(base, { remove: ["outer"] })
  assert.deepEqual(args.groups, [{ id: "inner", title: "Inner" }])
  assert.deepEqual(args.nodes, [{ id: "a", title: "A" }, { id: "b", title: "B", group: "inner" }])
  assert.equal((args.interfaces as unknown[]).length, 1)
  assert.deepEqual(base.groups[1], { id: "inner", title: "Inner", parent: "outer" }, "the remembered diagram is not mutated")
})
test("an edit keeps shapes where the user dragged them in the view", async () => {
  const client = await connect()
  const first = await call(client, "create_er_diagram", shop)
  const r = (await client.callTool({ name: "remember_layout", arguments: { diagram: first.sc.sheet, positions: { products: [1400, 900] } } })) as CallToolResult
  assert.match(text(r), /Layout remembered/)
  const { sc } = await call(client, "edit_diagram", { diagram: first.sc.sheet, update: [{ id: "customers", name: "clients" }] })
  const before = places(first.sc.xml), after = places(sc.xml)
  assert.equal(after.get("products"), "1400,900")
  for (const id of ["customers", "orders", "order_items"]) assert.equal(after.get(id), before.get(id), `${id} moved`)
})

test("show_diagram hands the view the diagram as it is now, with the server's layout after an edit", async () => {
  const client = await connect()
  const first = await call(client, "create_er_diagram", shop)
  const fresh = await call(client, "show_diagram", { diagram: first.sc.sheet })
  assert.equal((fresh.sc.diagram.entities as unknown[]).length, 4)
  const edited = await call(client, "edit_diagram", { diagram: first.sc.sheet, add_nodes: [{ id: "tags", name: "tags", fields: ["PK id: uuid"] }] })
  const shown = (await client.callTool({ name: "show_diagram", arguments: { diagram: first.sc.sheet } })) as CallToolResult
  const sc = shown.structuredContent as { diagram: { entities: unknown[] }; positions: Record<string, number[]> }
  assert.equal(sc.diagram.entities.length, 5)
  assert.deepEqual(sc.positions, (edited.r.structuredContent as { positions: unknown }).positions)
  const missing = (await client.callTool({ name: "show_diagram", arguments: { diagram: "ffffffff" } })) as CallToolResult
  assert.ok(missing.isError)
})

test("container edits on an architecture diagram use its containers", async () => {
  const client = await connect()
  const vpc = {
    title: "VPC", containers: [{ id: "vpc", title: "VPC" }],
    nodes: [{ id: "lb", kind: "load_balancer", title: "LB" }, { id: "api", kind: "cloud_run", title: "API", group: "vpc" }],
    interfaces: [{ from: "lb", to: "api" }],
  }
  const first = await call(client, "create_architecture_diagram", vpc)
  const added = await call(client, "edit_diagram", {
    diagram: first.sc.sheet, add_groups: [{ id: "data", title: "Data subnet", parent: "vpc" }],
    add_nodes: [{ id: "db", kind: "cloud_sql", title: "DB", group: "data" }], add_connections: [{ from: "api", to: "db" }],
  })
  assert.ok(!added.r.isError, text(added.r))
  assert.deepEqual((added.sc.diagram.containers as { id: string }[]).map((c) => c.id), ["vpc", "data"])
  assert.equal(added.sc.diagram.groups, undefined)
  assert.match(added.sc.xml, /Data subnet/)
  const renamed = await call(client, "edit_diagram", { diagram: first.sc.sheet, update: [{ id: "vpc", title: "Prod VPC" }] })
  assert.match(renamed.sc.xml, /Prod VPC/)
  const removed = await call(client, "edit_diagram", { diagram: first.sc.sheet, remove: ["data"] })
  assert.ok(!removed.r.isError, text(removed.r))
  assert.equal((removed.sc.diagram.nodes as { id: string; group?: string }[]).find((n) => n.id === "db")?.group, undefined)
})

test("each diagram keeps its own layout, however many others are drawn in between", async () => {
  const client = await connect()
  const first = await call(client, "create_er_diagram", shop)
  const other = await connect()
  for (let i = 0; i < 14; i++) await call(other, "create_er_diagram", { ...shop, title: `Other ${i}` })
  const { sc } = await call(client, "edit_diagram", { diagram: first.sc.sheet, add_nodes: [{ id: "tags", name: "tags", fields: ["PK id: uuid"] }] })
  const before = places(first.sc.xml), after = places(sc.xml)
  for (const [id, at] of before) assert.equal(after.get(id), at, `${id} moved`)
})

test("an edit that removes most of the diagram still keeps what is left in place", async () => {
  const client = await connect()
  const first = await call(client, "create_er_diagram", shop)
  const { sc } = await call(client, "edit_diagram", { diagram: first.sc.sheet, remove: ["customers", "orders", "order_items"] })
  assert.equal(places(sc.xml).get("products"), places(first.sc.xml).get("products"))
})
