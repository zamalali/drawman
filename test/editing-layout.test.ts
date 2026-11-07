import { test } from "node:test"
import assert from "node:assert/strict"
import { summarise } from "../src/mcp/output.js"

type Box = [number, number, number, number]
const boxes = (r: ReturnType<typeof summarise>) => {
  const out = new Map<string, Box>()
  for (const m of String(r.structuredContent.xml).matchAll(/<mxCell id="([^"]+)"[^>]*vertex="1" parent="1"><mxGeometry x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
    out.set(m[1], [+m[2], +m[3], +m[4], +m[5]])
  }
  return out
}
const overlaps = (a: Box, b: Box) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]

function editKeepsPlaces(name: string, first: Record<string, unknown>, second: Record<string, unknown>, added: string[]) {
  test(`edits keep existing nodes in place: ${name}`, () => {
    const a = boxes(summarise(first, false, true))
    const r = summarise(second, false, true)
    const b = boxes(r)
    assert.ok(r.structuredContent.positions, "the edit was recognised")
    for (const [id, box] of a) {
      if (!b.has(id) || id.startsWith("zone_") || id === "legend") continue
      assert.deepEqual(b.get(id)!.slice(0, 2), box.slice(0, 2), `${id} did not move`)
    }
    for (const id of added) {
      assert.ok(b.has(id), `${id} was added`)
      for (const [o, box] of b) if (o !== id && !o.startsWith("zone_") && o !== "legend" && !o.startsWith("frame") && o !== "gcp" && !o.includes("_f") && !o.includes("_icon") && !o.includes("_m") && !o.includes("_div"))
        assert.ok(!overlaps(b.get(id)!, box), `${id} overlaps ${o}`)
    }
  })
}

const er = (extra: boolean) => ({
  title: "Bookstore", direction: "TB",
  entities: [
    { id: "customers", name: "customers", fields: ["PK id: uuid", "email: text"] },
    { id: "orders", name: "orders", fields: ["PK id: uuid", "FK customer_id: uuid"] },
    { id: "books", name: "books", fields: ["PK id: uuid", "title: text"] },
    { id: "order_items", name: "order_items", fields: ["FK order_id: uuid", "FK book_id: uuid"] },
    ...(extra ? [{ id: "wishlists", name: "wishlists", fields: ["PK id: uuid", "FK customer_id: uuid", "FK book_id: uuid"] }] : []),
  ],
  relationships: [
    { from: "customers", to: "orders", cardinality: "one-to-many" },
    { from: "orders", to: "order_items", cardinality: "one-to-many" },
    { from: "books", to: "order_items", cardinality: "one-to-many" },
    ...(extra ? [{ from: "customers", to: "wishlists", cardinality: "one-to-many" }, { from: "books", to: "wishlists", cardinality: "one-to-many" }] : []),
  ],
})
editKeepsPlaces("ER diagram, one table added", er(false), er(true), ["wishlists"])

const flow = (extra: boolean) => ({
  title: "Checkout", direction: "TB",
  nodes: [
    { id: "start", type: "start", title: "Cart" }, { id: "pay", type: "process", title: "Pay" },
    { id: "ok", type: "decision", title: "Paid?" }, ...(extra ? [{ id: "fraud", type: "process", title: "Fraud check" }] : []),
    { id: "ship", type: "process", title: "Ship" }, { id: "end", type: "end", title: "Done" },
  ],
  connections: [
    { from: "start", to: "pay" }, { from: "pay", to: extra ? "fraud" : "ok" }, ...(extra ? [{ from: "fraud", to: "ok" }] : []),
    { from: "ok", to: "ship", label: "Yes" }, { from: "ok", to: "pay", label: "No" }, { from: "ship", to: "end" },
  ],
})
editKeepsPlaces("flowchart, one step inserted", flow(false), flow(true), ["fraud"])

const arch = (extra: boolean) => ({
  title: "Shop on GCP",
  nodes: [
    { id: "users", kind: "user", title: "Customers" }, { id: "lb", kind: "load_balancer", title: "Load balancer" },
    { id: "api", kind: "cloud_run", title: "API" }, { id: "db", kind: "cloud_sql", title: "Orders DB" },
    ...(extra ? [{ id: "cache", kind: "memorystore", title: "Session cache" }] : []),
  ],
  interfaces: [
    { from: "users", to: "lb", label: "HTTPS" }, { from: "lb", to: "api", label: "HTTP" }, { from: "api", to: "db", label: "SQL" },
    ...(extra ? [{ from: "api", to: "cache", label: "sessions" }] : []),
  ],
})
editKeepsPlaces("architecture, one service added", arch(false), arch(true), ["cache"])

const grouped = (extra: boolean) => ({
  title: "Pipeline",
  groups: [{ id: "ingest", title: "Ingest" }, { id: "serve", title: "Serve" }],
  nodes: [
    { id: "src", title: "Source", group: "ingest" }, { id: "etl", title: "ETL", group: "ingest" },
    { id: "store", title: "Store", group: "serve" }, { id: "dash", title: "Dashboard" },
    ...(extra ? [{ id: "alerts", title: "Alerts", group: "serve" }] : []),
  ],
  interfaces: [
    { from: "src", to: "etl" }, { from: "etl", to: "store" }, { from: "store", to: "dash" },
    ...(extra ? [{ from: "store", to: "alerts" }] : []),
  ],
})
editKeepsPlaces("grouped diagram, one node added", grouped(false), grouped(true), ["alerts"])

test("a different diagram is laid out fresh, not pinned to an earlier one", () => {
  summarise(er(false), false, true)
  const other = summarise({ ...er(false), entities: [{ id: "x", name: "x", fields: [] }, { id: "y", name: "y", fields: [] }], relationships: [] }, false, true)
  assert.equal(other.structuredContent.positions, undefined)
})
