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
  assert.match(text(r), new RegExp(`^Diagram id: ${sc.sheet} \\(call edit_diagram with it for any follow-up change\\)\\. Rendered`))
})

// Some hosts show earlier results to the model as a short preview (160 characters); the id must be inside it.
test("the diagram id stays within the first 160 characters, for drawings and for edits", async () => {
  const client = await connect()
  const first = await call(client, "create_architecture_diagram", sample)
  assert.ok(text(first.r).slice(0, 160).includes(`Diagram id: ${first.sc.sheet}`), text(first.r).slice(0, 160))
  const edited = await call(client, "edit_diagram", {
    diagram: first.sc.sheet,
    add_nodes: [{ id: "armor", kind: "cloud_armor", title: "Cloud Armor" }, { id: "sm", kind: "secret_manager", title: "Secret Manager" }],
    add_connections: [{ from: "armor", to: "run", label: "filters" }, { from: "run", to: "sm", label: "secrets" }],
    update: [{ id: "gcs", title: "Archive bucket" }],
    remove: ["logs"],
  })
  assert.ok(!edited.r.isError, text(edited.r))
  assert.ok(text(edited.r).slice(0, 160).includes(`Diagram id: ${first.sc.sheet}`), text(edited.r).slice(0, 160))
})

test("an unknown id says what a diagram id looks like", async () => {
  const { r } = await call(await connect(), "edit_diagram", { diagram: "688e19ba.5", add_nodes: [{ id: "x" }] })
  assert.ok(r.isError)
  assert.match(text(r), /No diagram "688e19ba\.5"\. Use the 8-character id that follows "Diagram id:"/)
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
  assert.match(text(missing.r), /draw it again with that tool/)
  const { sc } = await call(client, "create_er_diagram", shop)
  // Unknown ids are skipped and named; the rest of the change still applies, so the edit never fails over a guess.
  const unknown = await call(client, "edit_diagram", {
    diagram: sc.sheet, remove: ["invoices", "customers>invoices"], update: [{ id: "products", name: "items" }, { id: "nope", name: "x" }],
  })
  assert.ok(!unknown.r.isError, text(unknown.r))
  assert.match(text(unknown.r), /^Edited \(1 updated\)\. Diagram id: /)
  assert.match(text(unknown.r), /Skipped, not in this diagram: invoices, customers>invoices, nope\. Ids here: customers, orders/)
  assert.equal((unknown.sc.diagram.entities as { id: string; name: string }[]).find((e) => e.id === "products")?.name, "items")
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

// Every table growing at once (audit columns on all of them) used to overlap the tables below and fail the edit.
test("adding columns to every table pushes the tables below down instead of failing", async () => {
  const client = await connect()
  const first = await call(client, "create_er_diagram", shop)
  const { r, sc } = await call(client, "edit_diagram", {
    diagram: first.sc.sheet,
    update: shop.entities.map((e: { id: string; fields: string[] }) => ({ id: e.id, fields: [...e.fields, "created_at: timestamp", "updated_at: timestamp", "deleted_at: timestamp", "created_by: uuid", "updated_by: uuid"] })),
  })
  assert.ok(!r.isError, text(r))
  assert.equal(sc.diagram.entities.length, shop.entities.length)
})

// From a real chat: four containers named, no node placed in any; then "make it horizontal".
const gcp = {
  title: "Full-stack GCP app",
  containers: [{ id: "frontend_zone", title: "Frontend" }, { id: "api_zone", title: "API" }, { id: "data_zone", title: "Data & ML" }],
  nodes: [
    { id: "users", kind: "user", title: "Users" }, { id: "cdn", kind: "cloud_cdn", title: "Cloud CDN" },
    { id: "lb", kind: "load_balancer", title: "Load Balancer" }, { id: "run", kind: "cloud_run", title: "Cloud Run" },
    { id: "sql", kind: "cloud_sql", title: "Cloud SQL" }, { id: "vertex", kind: "vertex_ai", title: "Vertex AI" },
    { id: "bq", kind: "bigquery", title: "BigQuery" },
  ],
  interfaces: [
    { from: "users", to: "cdn" }, { from: "cdn", to: "lb" }, { from: "lb", to: "run" }, { from: "run", to: "sql" },
    { from: "run", to: "vertex" }, { from: "run", to: "bq" },
  ],
}

test("containers no node sits in are ignored, so the diagram keeps its platform frames instead of one long column", async () => {
  const client = await connect()
  const empty = await call(client, "create_architecture_diagram", gcp)
  const { containers: _c, ...plain } = gcp
  const without = await call(client, "create_architecture_diagram", { ...plain, title: "Plain" })
  assert.ok(!empty.r.isError, text(empty.r))
  assert.deepEqual(places(empty.sc.xml), places(without.sc.xml))
})

test("a direction turns a grouped architecture horizontal, and later edits still treat it as an architecture", async () => {
  const client = await connect()
  const grouped = { ...gcp, nodes: gcp.nodes.map((n, i) => ({ ...n, group: gcp.containers[Math.min(2, Math.floor(i / 3))].id })) }
  const first = await call(client, "create_architecture_diagram", grouped)
  const wide = await call(client, "edit_diagram", { diagram: first.sc.sheet, direction: "LR" })
  assert.ok(!wide.r.isError, text(wide.r))
  const span = (xml: string) => { const at = [...places(xml).values()].map((p) => p.split(",").map(Number)); const xs = at.map((p) => p[0]), ys = at.map((p) => p[1]); return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] }
  const [w, h] = span(wide.sc.xml)
  assert.ok(w > h, `left to right is wider than tall (${w}x${h})`)
  const tall = await call(client, "edit_diagram", { diagram: first.sc.sheet, direction: "TB" })
  const [w2, h2] = span(tall.sc.xml)
  assert.ok(h2 > w2, `top to bottom is taller than wide (${w2}x${h2})`)
  const more = await call(client, "edit_diagram", { diagram: first.sc.sheet, add_nodes: [{ id: "gcs", kind: "cloud_storage", title: "Cloud Storage", group: "data_zone" }], add_connections: [{ from: "run", to: "gcs" }] })
  assert.ok(!more.r.isError, text(more.r))
  assert.equal(more.sc.diagram.interfaces.length, gcp.interfaces.length + 1, "still an architecture: interfaces, not flowchart connections")
})

test("a new direction in an edit lays a flowchart out afresh", async () => {
  const client = await connect()
  const flow = { title: "Refund", nodes: [{ id: "a", type: "start", title: "Request" }, { id: "b", type: "process", title: "Check" }, { id: "c", type: "end", title: "Refund" }], connections: [{ from: "a", to: "b" }, { from: "b", to: "c" }] }
  const first = await call(client, "create_flowchart", flow)
  const turned = await call(client, "edit_diagram", { diagram: first.sc.sheet, direction: "LR" })
  assert.ok(!turned.r.isError, text(turned.r))
  const [a0, b0] = ["a", "b"].map((id) => places(first.sc.xml).get(id)!.split(",").map(Number))
  const [a1, b1] = ["a", "b"].map((id) => places(turned.sc.xml).get(id)!.split(",").map(Number))
  assert.ok(b0[1] > a0[1] && b0[0] === a0[0], "first top to bottom")
  assert.ok(b1[0] > a1[0], "then left to right")
})