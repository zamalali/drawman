import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { buildDrawio, buildScene, checkLayout, normaliseFacts, type Box, type Positions, type Scene } from "../src/engine/index.js"

const sample = JSON.parse(readFileSync(new URL("./sample.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""))
const facts = normaliseFacts(sample, false)
const inside = ([x, y, w, h]: Box, [X, Y, W, H]: Box) => X <= x && Y <= y && x + w <= X + W && y + h <= Y + H
const overlap = (a: Box, b: Box) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]

function assertClean(scene: Scene, routed: number) {
  checkLayout(scene)
  scene.zones.forEach((a, i) => scene.zones.slice(i + 1).forEach((b) => assert.ok(!overlap(a.box, b.box), `zones ${a.id} and ${b.id} overlap`)))
  scene.frames.forEach((a, i) => scene.frames.slice(i + 1).forEach((b) => assert.ok(!overlap(a.box, b.box), `frames ${a.platform} and ${b.platform} overlap`)))
  assert.equal(scene.edges.length, routed, `unrouted: ${scene.unrouted.join(",")}`)
  for (const e of scene.edges) {
    for (const c of scene.cards) {
      if (c.node.id === e.from || c.node.id === e.to) continue
      const [x, y, w, h] = c.box
      for (let i = 1; i < e.points.length; i++) {
        const [p, q] = [e.points[i - 1], e.points[i]]
        const crosses = p[0] === q[0]
          ? x < p[0] && p[0] < x + w && Math.min(p[1], q[1]) < y + h && y < Math.max(p[1], q[1])
          : y < p[1] && p[1] < y + h && Math.min(p[0], q[0]) < x + w && x < Math.max(p[0], q[0])
        assert.ok(!crosses, `${e.id} crosses ${c.node.id}`)
      }
    }
  }
}

test("moving cards re-routes every interface, never stretches a zone into a neighbour, and exports the new geometry", () => {
  const base = buildScene(facts)
  const [a, b] = base.cards
  const positions: Positions = { [a.node.id]: [a.box[0] + 120, a.box[1] + 260], [b.node.id]: [b.box[0] - 40, b.box[1] + 400] }
  const t0 = performance.now()
  const moved = buildScene(facts, positions)
  const ms = performance.now() - t0
  assertClean(moved, base.edges.length)
  assert.deepEqual(moved.cards.find((c) => c.node.id === a.node.id)!.box.slice(0, 2), positions[a.node.id])
  const { xml } = buildDrawio(moved)
  assert.match(xml, new RegExp(`id="${a.node.id}"[^>]*><mxGeometry x="${positions[a.node.id][0]}" y="${positions[a.node.id][1]}"`))
  assert.ok(ms < 400, `re-route took ${ms.toFixed(0)}ms`)
})

test("a card moved within free space grows its own zone to keep it", () => {
  const base = buildScene(facts)
  const zone = base.zones.reduce((lo, z) => (z.box[1] + z.box[3] > lo.box[1] + lo.box[3] ? z : lo))
  const card = base.cards.filter((c) => c.zoneId === zone.id).at(-1)!
  const moved = buildScene(facts, { [card.node.id]: [card.box[0], card.box[1] + 120] })
  assertClean(moved, base.edges.length)
  assert.ok(inside(moved.cards.find((c) => c.node.id === card.node.id)!.box, moved.zones.find((z) => z.id === zone.id)!.box))
})

test("dragging a zone header moves the zone with all of its cards", () => {
  const base = buildScene(facts)
  const zone = base.zones.reduce((lo, z) => (z.box[1] + z.box[3] > lo.box[1] + lo.box[3] ? z : lo))
  const dy = 200
  const positions: Positions = { [`zone:${zone.id}`]: [zone.box[0], zone.box[1] + dy] }
  for (const c of base.cards) if (c.zoneId === zone.id) positions[c.node.id] = [c.box[0], c.box[1] + dy]
  const moved = buildScene(facts, positions)
  assertClean(moved, base.edges.length)
  const z = moved.zones.find((x) => x.id === zone.id)!
  assert.deepEqual(z.box, [zone.box[0], zone.box[1] + dy, zone.box[2], zone.box[3]])
  for (const c of moved.cards) if (c.zoneId === zone.id) assert.ok(inside(c.box, z.box), `${c.node.id} left ${zone.id}`)
})

test("dragging re-routes only the moved card's interfaces and keeps every other route", () => {
  const base = buildScene(facts)
  const card = base.cards[Math.floor(base.cards.length / 2)]
  const previous = new Map(base.edges.map((e) => [e.id, e.points]))
  const t0 = performance.now()
  // As in the view: the cards on screen keep their places and only the dragged card has a new one.
  const all = Object.fromEntries(base.cards.map((c) => [c.node.id, [c.box[0], c.box[1]] as [number, number]]))
  const moved = buildScene(facts, { ...all, [card.node.id]: [card.box[0], card.box[1] + 30] }, { moved: new Set([card.node.id]), previous })
  const ms = performance.now() - t0
  const through = (pts: [number, number][], ends: string[]) => moved.cards.some((c) => !ends.includes(c.node.id) && pts.slice(1).some((b, i) => {
    const a = pts[i], [x, y, w, h] = c.box
    return Math.max(a[0], b[0]) > x + 1 && Math.min(a[0], b[0]) < x + w - 1 && Math.max(a[1], b[1]) > y + 1 && Math.min(a[1], b[1]) < y + h - 1
  }))
  const at = new Map(base.cards.map((c) => [c.node.id, c.box.join()]))
  const stayed = (id: string) => moved.cards.find((c) => c.node.id === id)!.box.join() === at.get(id)
  for (const e of moved.edges) {
    if (e.from === card.node.id || e.to === card.node.id) continue
    // A card the dragged one landed on slides out of its way, and its lines go with it.
    if (!stayed(e.from) || !stayed(e.to)) continue
    const before = previous.get(e.id)!
    // A kept line is only redrawn when the dragged card now sits on top of it.
    if (through(before, [e.from, e.to])) assert.ok(!through(e.points, [e.from, e.to]), `${e.id} still runs through a card`)
    else assert.deepEqual(e.points, before, `${e.id} was re-routed`)
  }
  assert.equal(moved.edges.length, base.edges.length)
  assert.ok(ms < 60, `incremental drag frame took ${ms.toFixed(0)}ms`)
})

test("no positions means the deterministic layout is untouched", () => {
  assert.deepEqual(buildScene(facts, {}), buildScene(facts))
})

// A large architecture as a model writes it: 66 components, 89 interfaces, most of them between neighbours.
function largeArchitecture() {
  let seed = 3
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const kinds = ["cloud_run", "cloud_sql", "memorystore", "pubsub", "cloud_storage", "load_balancing", "iam", "kms", "vertex_ai", "github", "user", "artifact_registry", "cloud_scheduler", "secret_manager"]
  const nodes = Array.from({ length: 66 }, (_, i) => ({ id: `c${i}`, title: `Component ${i}`, detail: "service", kind: kinds[Math.floor(rnd() * kinds.length)] }))
  const interfaces = Array.from({ length: 89 }, () => {
    const a = Math.floor(rnd() * 66)
    let b = rnd() < 0.85 ? a + 1 + Math.floor(rnd() * 6) : Math.floor(rnd() * 66)
    if (b >= 66 || b === a) b = (a + 7) % 66
    return { from: `c${a}`, to: `c${b}`, protocol: "HTTPS" }
  })
  return { title: "Large platform", nodes, interfaces }
}

// The live view draws after every revealed line. Routing every line again each time took seconds per frame on a
// diagram this size and blocked the page; lines already on screen keep their route and only the new one is routed.
test("a large diagram streams in line by line without re-routing the lines already on screen", () => {
  const args = largeArchitecture()
  let shown: Scene | null = null
  for (let e = 0; e <= args.interfaces.length; e++) {
    const previous = shown?.edges.length ? new Map(shown.edges.map((x) => [x.id, x.points])) : null
    const scene = buildScene(normaliseFacts({ ...args, interfaces: args.interfaces.slice(0, e) }, false), {}, previous ? { moved: new Set(), previous } : undefined)
    for (const x of scene.edges) if (previous?.has(x.id)) assert.deepEqual(x.points, previous.get(x.id), `${x.id} jumped when line ${e} arrived`)
    shown = scene
  }
  assertClean(shown!, args.interfaces.length)
})

// The router reuses its working arrays between calls on an area of the same size; no call may see another's state.
test("routing is the same whatever was routed before, on areas of the same or another size", () => {
  const small = () => buildScene(facts).edges.map((e) => e.points)
  const large = () => buildScene(normaliseFacts(largeArchitecture(), false)).edges.map((e) => e.points)
  const first = small(), big = large()
  assert.deepEqual(small(), first, "after a larger area")
  assert.deepEqual(small(), first, "twice on the same area")
  assert.deepEqual(large(), big, "after a smaller area")
})
