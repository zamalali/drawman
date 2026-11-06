import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { buildScene, checkLayout, flowShape, flowTone, normaliseFacts, renderDiagram } from "../src/engine/index.js"
import { quality } from "./quality-helper.js"

const refund = JSON.parse(readFileSync(new URL("./refund-flow.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""))
const cases = JSON.parse(readFileSync(new URL("./flow-cases.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""))

test("flowchart: JGraph's refund prompt draws as a clean top-down flowchart", () => {
  const { scene, xml } = renderDiagram(refund)
  checkLayout(scene)
  assert.equal(scene.unrouted.length, 0)
  const q = quality(scene)
  assert.equal(q.crossings, 0)
  assert.equal(q.through, 0)
  assert.ok(q.bends <= 6, `${q.bends} bends`)
  const box = (id: string) => scene.cards.find((c) => c.node.id === id)!.box
  const cx = (id: string) => box(id)[0] + box(id)[2] / 2
  for (const id of ["check_date", "within_30", "inspect", "damaged"]) assert.equal(cx(id), cx("received"), `${id} on the main line`)
  for (const id of ["check_date", "within_30", "inspect", "damaged", "store_credit", "notify", "closed"]) {
    const prev = scene.facts.interfaces.find((e) => e.to === id)!.from
    assert.ok(box(id)[1] > box(prev)[1], `${id} sits below ${prev}`)
  }
  for (const e of scene.edges) for (const [id, p] of [[e.from, e.points[0]], [e.to, e.points[e.points.length - 1]]] as const) {
    const c = scene.cards.find((k) => k.node.id === id)!
    if (c.node.shape !== "decision") continue
    const [x, y, w, h] = c.box
    const corners = [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]]
    assert.ok(corners.some(([a, b]) => a === p[0] && b === p[1]), `${e.id} meets ${id} at a corner`)
  }
  assert.match(xml, /style="rhombus;/)
  assert.match(xml, /value="Yes"[^>]*fontColor=#2e7d32/)
  assert.match(xml, /value="No"[^>]*fontColor=#c62828/)
  assert.match(xml, /value="Reject request"[^>]*fillColor=#f8cecc/, "rejecting steps are red")
  assert.doesNotMatch(xml, /id="legend"/, "flowcharts have no legend")
  assert.equal(scene.legend[3], 0)
})

test("flowchart: loops, multi-way decisions, swimlanes and a 22-step process route cleanly in both directions", () => {
  // Regression baseline: the remaining crossings are loop-backs a person would draw the same way.
  const maxCrossings: Record<string, [number, number]> = {
    "Login with retry and MFA": [1, 1], "Purchase order approval": [0, 1], "Support ticket triage": [0, 0], "Software release process": [2, 5],
  }
  for (const c of cases) {
    for (const [i, direction] of (["TB", "LR"] as const).entries()) {
      const t0 = performance.now()
      const { scene } = renderDiagram({ ...c, direction })
      const ms = performance.now() - t0
      checkLayout(scene)
      const q = quality(scene)
      assert.equal(scene.unrouted.length, 0, `${c.title} ${direction}: every connection routed`)
      assert.equal(q.through, 0, `${c.title} ${direction}: no line runs through a shape`)
      assert.ok(q.crossings <= maxCrossings[c.title][i], `${c.title} ${direction}: ${q.crossings} crossings`)
      assert.ok(ms < 2000, `${c.title} ${direction}: ${ms.toFixed(0)} ms`)
    }
  }
})

test("flowchart: right-to-left and bottom-to-top mirror the layout and stay clean", () => {
  assert.equal(normaliseFacts({ ...refund, direction: "right to left" }).flow!.direction, "RL")
  assert.equal(normaliseFacts({ ...refund, direction: "bottom-up" }).flow!.direction, "BT")
  for (const direction of ["RL", "BT"]) {
    const { scene } = renderDiagram({ ...refund, direction })
    checkLayout(scene)
    const q = quality(scene)
    assert.equal(scene.unrouted.length, 0, direction)
    assert.equal(q.through, 0, direction)
    assert.equal(q.crossings, 0, direction)
    const box = (id: string) => scene.cards.find((c) => c.node.id === id)!.box
    if (direction === "RL") assert.ok(box("received")[0] > box("check_date")[0] && box("check_date")[0] > box("closed")[0], "flows right to left")
    else assert.ok(box("received")[1] > box("check_date")[1] && box("check_date")[1] > box("closed")[1], "flows bottom to top")
    assert.ok(Math.min(...scene.cards.map((c) => c.box[1])) >= 120, "nothing moves into the title area")
  }
  const lanes = cases.find((c: { title: string }) => c.title === "Purchase order approval")
  const scene = buildScene(normaliseFacts({ ...lanes, direction: "RL" }))
  for (const card of scene.cards) {
    const lane = scene.zones.find((z) => z.id === `lane_${card.node.lane}`)!
    const [x, y, w, h] = card.box, [lx, ly, lw, lh] = lane.box
    assert.ok(x >= lx && y >= ly && x + w <= lx + lw && y + h <= ly + lh, `${card.node.id} inside ${lane.title} (RL)`)
  }
})

test("flowchart: swimlanes keep every step inside its lane", () => {
  const po = cases.find((c: { title: string }) => c.title === "Purchase order approval")
  for (const direction of ["TB", "LR"]) {
    const scene = buildScene(normaliseFacts({ ...po, direction }))
    assert.deepEqual(scene.zones.map((z) => z.title), ["Employee", "Manager", "Finance"])
    for (const card of scene.cards) {
      const lane = scene.zones.find((z) => z.id === `lane_${card.node.lane}`)!
      const [x, y, w, h] = card.box, [lx, ly, lw, lh] = lane.box
      assert.ok(x >= lx && y >= ly && x + w <= lx + lw && y + h <= ly + lh, `${card.node.id} inside ${lane.title} (${direction})`)
    }
  }
})

test("flowchart: input is recognised, repaired and streamed safely", () => {
  assert.equal(flowShape("Terminator", "Begin"), "start")
  assert.equal(flowShape("diamond", "x"), "decision")
  assert.equal(flowShape("", "Is it valid?"), "decision")
  assert.equal(flowShape("db", "Orders"), "database")
  assert.equal(flowShape("whatever", "Do it"), "process")
  assert.equal(flowTone("", "process", "Reject request"), "danger")
  assert.equal(flowTone("", "decision", "Rejected?"), "default")
  assert.equal(flowTone("warning", "process", "x"), "warning")
  const facts = normaliseFacts({ title: "T", nodes: [{ id: "a", type: "start", title: "A" }, { id: "b", type: "process", title: "B" }], connections: [{ from: "a", to: "b" }] })
  assert.ok(facts.flow && !facts.groups)
  assert.equal(facts.flow.direction, "TB")
  assert.equal(facts.interfaces.length, 1)
  const partial = normaliseFacts({ title: "T", direction: "TB", nodes: [{ id: "a", type: "start", title: "A" }, { id: "b", type: "deci" }] }, true)
  assert.deepEqual(partial.nodes.map((n) => n.id), ["a"])
  assert.equal(normaliseFacts({ title: "A", nodes: [{ id: "x", kind: "cloud_run", title: "X", type: "service" }], interfaces: [] }).flow, undefined)
  assert.equal(normaliseFacts({ title: "G", groups: [{ id: "g", title: "G" }], nodes: [{ id: "x", title: "X", group: "g" }], interfaces: [] }).flow, undefined)
})
