import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { checkLayout, diagramKind, normaliseFacts, renderDiagram } from "../src/engine/index.js"
import { quality } from "./quality-helper.js"

const cases = JSON.parse(readFileSync(new URL("./dev-cases.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""))

test("developer diagrams: each input is recognised by its own fields", () => {
  assert.equal(diagramKind(cases.sequence), "sequence")
  assert.equal(diagramKind(cases.state), "state")
  assert.equal(diagramKind(cases.class), "class")
  assert.equal(diagramKind(cases.er), "er")
  assert.equal(diagramKind({ nodes: [], connections: [] }), "flowchart")
  assert.equal(diagramKind({ groups: [], nodes: [] }), "general")
  assert.equal(diagramKind({ nodes: [{ id: "a", kind: "cloud_run" }], interfaces: [] }), "architecture")
})

test("state machine: pseudo-states, event [guard] / action labels, clean routing", () => {
  const { scene, xml } = renderDiagram(cases.state)
  checkLayout(scene)
  assert.equal(scene.unrouted.length, 0)
  const q = quality(scene)
  assert.equal(q.through, 0)
  assert.ok(q.crossings <= 1, `${q.crossings} crossings`)
  assert.ok(scene.edges.some((e) => e.label === "retry [attempts < 3]"))
  assert.match(xml, /shape=startState/)
  assert.match(xml, /shape=endState/)
  const box = (id: string) => scene.cards.find((c) => c.node.id === id)!.box
  assert.ok(box("start")[1] < box("created")[1] && box("created")[1] < box("paid")[1], "lifecycle reads top-down")
  assert.equal(scene.cards.find((c) => c.node.id === "cancelled")!.node.tone, "danger")
})

test("class diagram: compartments, parents above children, UML line ends", () => {
  const { scene, xml } = renderDiagram(cases.class)
  checkLayout(scene)
  assert.equal(scene.unrouted.length, 0)
  assert.equal(quality(scene).through, 0)
  const box = (id: string) => scene.cards.find((c) => c.node.id === id)!.box
  for (const child of ["customer", "order", "product"]) assert.ok(box("entity")[1] < box(child)[1], `BaseEntity above ${child}`)
  assert.ok(box("payment")[1] < box("card")[1] && box("payment")[1] < box("paypal")[1], "interface above its implementations")
  const e = scene.edges.find((x) => x.from === "customer" && x.to === "entity")!
  assert.equal(e.points[e.points.length - 1][1], box("entity")[1] + box("entity")[3])
  assert.match(xml, /«abstract»/)
  assert.match(xml, /«interface»/)
  assert.match(xml, /value="\+ placeOrder\(cart: Cart\): Order"/)
  assert.match(xml, /endArrow=block;endFill=0;endSize=12/, "hollow triangle for inheritance")
  assert.match(xml, /startArrow=diamondThin;startFill=1/, "filled diamond for composition")
  assert.match(xml, /dashed=1;endArrow=block;endFill=0/, "dashed triangle for realisation")
})

test("ER diagram: typed columns with keys, crow's foot, one side above many side, no crossings", () => {
  const { scene, xml } = renderDiagram(cases.er)
  checkLayout(scene)
  assert.equal(scene.unrouted.length, 0)
  assert.deepEqual(quality(scene), { ...quality(scene), crossings: 0, through: 0 })
  const box = (id: string) => scene.cards.find((c) => c.node.id === id)!.box
  assert.ok(box("customers")[1] < box("orders")[1] && box("orders")[1] < box("order_items")[1])
  assert.match(xml, /value="PK id: uuid"[^>]*fontStyle=5/)
  assert.match(xml, /value="FK customer_id: uuid"/)
  assert.match(xml, /startArrow=ERmandOne;endArrow=ERmany/)
  const facts = normaliseFacts({ entities: [{ id: "a", name: "a", fields: ["PK id: int"] }, { id: "b", name: "b", fields: [] }], relationships: [{ from: "b", to: "a", cardinality: "N:1" }] })
  assert.equal(facts.interfaces[0].rel, "many-to-one")
})

test("sequence diagram: lifelines, activations, fragments and notes in time order", () => {
  const { scene, xml } = renderDiagram(cases.sequence)
  const seq = scene.seq!
  assert.equal(seq.lifelines.length, 5)
  assert.equal(scene.edges.length, 15)
  const ys = scene.edges.map((e) => e.points[0][1])
  assert.deepEqual([...ys].sort((a, b) => a - b), ys, "messages run top to bottom")
  const xs = new Map(seq.lifelines.map((l) => [l.id, l.x]))
  for (let i = 1; i < seq.lifelines.length; i++) assert.ok(seq.lifelines[i].x > seq.lifelines[i - 1].x, "participants left to right")
  for (const e of scene.edges) if (e.from !== e.to) assert.ok(Math.abs(xs.get(e.to)! - xs.get(e.from)!) >= e.label.length * 5.5, e.label)
  assert.deepEqual(seq.fragments.map((f) => f.type).sort(), ["alt", "loop"])
  const alt = seq.fragments.find((f) => f.type === "alt")!
  assert.equal(alt.elses.length, 1)
  assert.equal(seq.notes.length, 1)
  assert.ok(seq.activations.length >= 4, "calls open activation bars")
  assert.match(xml, /shape=umlLifeline/)
  assert.match(xml, /participant=umlActor/)
  assert.match(xml, /shape=umlFrame/)
  assert.match(xml, /value="\[credentials valid\]"/)
  assert.match(xml, /value="rows"[^>]*dashed=1;endArrow=open/, "returns are dashed with an open arrow")
  const partial = renderDiagram({ ...cases.sequence, messages: cases.sequence.messages.slice(0, 8) }, true)
  assert.equal(partial.scene.seq!.fragments.length, 1)
})

test("developer diagrams render fast", () => {
  for (const name of ["state", "class", "er", "sequence"]) {
    const t0 = performance.now()
    renderDiagram(cases[name])
    assert.ok(performance.now() - t0 < 1500, name)
  }
})
