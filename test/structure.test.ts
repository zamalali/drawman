import { test } from "node:test"
import assert from "node:assert/strict"
import "../src/engine/server-setup.js"
import { buildScene, edgeText, normaliseFacts, renderDiagram, restoreLayout, serialiseLayout, type Box } from "../src/engine/index.js"

const inside = (outer: Box, inner: Box) =>
  outer[0] <= inner[0] && outer[1] <= inner[1] && inner[0] + inner[2] <= outer[0] + outer[2] && inner[1] + inner[3] <= outer[1] + outer[3]
const overlaps = (a: Box, b: Box) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]

const nested = {
  title: "Three-tier on AWS",
  groups: [
    { id: "vpc", title: "VPC 10.0.0.0/16" },
    { id: "public", title: "Public subnets", parent: "vpc" },
    { id: "app", title: "Private app subnets", parent: "vpc" },
    { id: "data", title: "Private data subnets", parent: "vpc" },
  ],
  nodes: [
    { id: "users", title: "Customers", icon: "user" },
    { id: "cdn", title: "CloudFront", icon: "aws_cloudfront" },
    { id: "alb", title: "Application Load Balancer", group: "public" },
    { id: "web", title: "Web tier Auto Scaling group", group: "app" },
    { id: "api", title: "App tier Auto Scaling group", group: "app" },
    { id: "db", title: "RDS PostgreSQL primary", group: "data" },
    { id: "replica", title: "RDS read replica", group: "data" },
  ],
  interfaces: [
    { from: "users", to: "cdn", protocol: "HTTPS" },
    { from: "cdn", to: "alb", label: "dynamic requests" },
    { from: "alb", to: "web", label: "HTTP" },
    { from: "web", to: "api", label: "REST" },
    { from: "api", to: "db", label: "SQL writes" },
    { from: "api", to: "replica", label: "SQL reads" },
    { from: "db", to: "replica", label: "replication" },
    { from: "api", to: "api", label: "retry" },
  ],
}

test("nested groups are drawn inside their parents and ungrouped nodes stay outside every group", () => {
  const scene = buildScene(normaliseFacts(nested))
  const zone = (id: string) => scene.zones.find((z) => z.id === `g_${id}`)!
  for (const sub of ["public", "app", "data"]) {
    assert.equal(zone(sub).parent, "g_vpc")
    assert.ok(inside(zone("vpc").box, zone(sub).box), `${sub} inside the VPC`)
  }
  assert.ok(scene.zones.findIndex((z) => z.id === "g_vpc") < scene.zones.findIndex((z) => z.id === "g_app"), "parents are drawn first")
  for (const c of scene.cards) {
    const n = nested.nodes.find((x) => x.id === c.node.id)!
    if (n.group) assert.ok(inside(zone(n.group).box, c.box), `${c.node.id} inside ${n.group}`)
    else assert.ok(scene.zones.every((z) => !overlaps(z.box, c.box)), `${c.node.id} outside every group`)
  }
})

test("compound layout: no overlapping cards, no edge through a card, every edge routed, self-loops drawn", () => {
  const scene = buildScene(normaliseFacts(nested))
  assert.equal(scene.unrouted.length, 0)
  assert.equal(scene.edges.length, nested.interfaces.length)
  for (let i = 0; i < scene.cards.length; i++) for (let j = i + 1; j < scene.cards.length; j++) assert.ok(!overlaps(scene.cards[i].box, scene.cards[j].box))
  for (const e of scene.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const [a, b] = [e.points[i - 1], e.points[i]]
      assert.ok(a[0] === b[0] || a[1] === b[1], `${e.id} is orthogonal`)
      for (const c of scene.cards) {
        if (c.node.id === e.from || c.node.id === e.to) continue
        const [x, y, w, h] = c.box
        const hitsCard = Math.max(a[0], b[0]) > x + 1 && Math.min(a[0], b[0]) < x + w - 1 && Math.max(a[1], b[1]) > y + 1 && Math.min(a[1], b[1]) < y + h - 1
        assert.ok(!hitsCard, `${e.id} crosses ${c.node.id}`)
      }
    }
  }
  const loop = scene.edges.find((e) => e.from === "api" && e.to === "api")!
  assert.ok(loop.points.length >= 4, "the self-loop has a visible route")
})

test("edges carry their label, else protocol, and the legend keeps the ids", () => {
  const scene = buildScene(normaliseFacts(nested))
  assert.equal(edgeText(scene.edges[0], false), "HTTPS")
  assert.equal(edgeText(scene.edges[1], false), "dynamic requests")
  assert.equal(edgeText({ id: "IF-09", label: "", protocol: "", description: "" }, false), "IF-09")
  const { xml } = renderDiagram(nested)
  assert.match(xml, /value="SQL writes"/)
  assert.match(xml, /&lt;b&gt;F-05&lt;\/b&gt;/)
})

test("the live view redraws the server's layout exactly from the tool result", () => {
  const facts = normaliseFacts(nested)
  const server = buildScene(facts)
  assert.ok(server.placed, "the server sends its layout")
  const view = buildScene(facts, undefined, undefined, JSON.parse(JSON.stringify(server.placed)))
  assert.deepEqual(view.cards.map((c) => c.box), server.cards.map((c) => c.box))
  assert.deepEqual(view.zones, server.zones)
  assert.deepEqual(view.edges.map((e) => e.points), server.edges.map((e) => e.points))
  const partial = restoreLayout(serialiseLayout(restoreLayout(server.placed!)), normaliseFacts({ ...nested, nodes: nested.nodes.slice(0, 3) }))
  assert.deepEqual([...partial.cards.keys()].sort(), ["alb", "cdn", "users"])
  assert.deepEqual([...partial.zones.keys()].sort(), ["g_public", "g_vpc"], "only groups holding visible cards are shown while streaming")
})

test("structure is never rejected: unknown parents, cycles and missing groups degrade gracefully", () => {
  const f = normaliseFacts({
    title: "t",
    groups: [{ id: "a", title: "A", parent: "b" }, { id: "b", title: "B", parent: "a" }, { id: "c", title: "C", parent: "nope" }],
    nodes: [{ id: "x", title: "X", group: "a" }, { id: "y", title: "Y", group: "zzz" }, { id: "z", title: "Z" }],
    interfaces: [{ from: "x", to: "y" }, { from: "y", to: "z" }],
  })
  assert.ok(f.groups!.every((g) => g.parent !== "nope"))
  assert.ok(!(f.groups!.find((g) => g.id === "a")!.parent && f.groups!.find((g) => g.id === "b")!.parent), "a cycle is broken")
  const scene = buildScene(f)
  assert.equal(scene.cards.length, 3)
  assert.equal(scene.unrouted.length, 0)
})

test("large grouped diagrams lay out fast and completely", () => {
  const groups = Array.from({ length: 8 }, (_, g) => ({ id: `g${g}`, title: `Group ${g}`, ...(g > 3 ? { parent: `g${g - 4}` } : {}) }))
  const nodes = Array.from({ length: 120 }, (_, i) => ({ id: `n${i}`, title: `Service ${i}`, group: i % 10 === 9 ? undefined : `g${i % 8}` }))
  const interfaces = Array.from({ length: 160 }, (_, i) => ({ from: `n${i % 120}`, to: `n${(i * 7 + 3) % 120}`, label: `call ${i}` })).filter((e) => e.from !== e.to)
  const t0 = performance.now()
  const scene = buildScene(normaliseFacts({ title: "big", groups, nodes, interfaces }))
  const ms = performance.now() - t0
  assert.equal(scene.cards.length, 120)
  assert.equal(scene.unrouted.length, 0)
  assert.ok(ms < 8000, `took ${ms.toFixed(0)} ms`)
})

test("architecture: named containers give a grouped diagram with real icons; without them the original frames stay", () => {
  const nodes = [
    { id: "users", kind: "user", title: "Customers" },
    { id: "alb", kind: "aws_alb", title: "Application Load Balancer", group: "public" },
    { id: "rds", kind: "aws_rds", title: "RDS PostgreSQL primary", group: "data" },
  ]
  const interfaces = [{ from: "users", to: "alb", protocol: "HTTPS" }, { from: "alb", to: "rds", label: "SQL" }]
  const grouped = buildScene(normaliseFacts({ title: "t", nodes, interfaces,
    containers: [{ id: "vpc", title: "VPC" }, { id: "public", title: "Public subnet", parent: "vpc" }, { id: "data", title: "Data subnet", parent: "vpc" }] }))
  assert.deepEqual(grouped.zones.map((z) => z.title), ["VPC", "Public subnet", "Data subnet"])
  assert.equal(grouped.frames.length, 0)
  assert.notEqual(grouped.cards.find((c) => c.node.id === "rds")!.icon, "g_process", "keeps the real service icon")
  const plain = buildScene(normaliseFacts({ title: "t", nodes: nodes.map(({ group, ...n }) => n), interfaces }))
  assert.ok(plain.frames.length >= 1, "original platform frame")
  assert.ok(plain.zones.every((z) => !["VPC", "Public subnet"].includes(z.title)))
})
