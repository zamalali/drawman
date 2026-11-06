// UML sequence diagrams: lifelines, activations, fragments, notes and messages.
import { SEQ_COLOURS, participantType, type Card, type Edge, type Scene } from "../engine/index.js"
import { el, keyed, layers, sweep } from "./dom.js"
import { highlight } from "./interaction.js"
import { seenCards, seenEdges } from "./state.js"

export function drawSequence(scene: Scene, added: Card[], addedEdges: Edge[]) {
  const seq = scene.seq!
  layers.seq.replaceChildren()
  for (const f of seq.fragments) {
    const [x, y, w, h] = f.box
    const tab = Math.max(50, f.type.length * 8 + 26)
    const g = el("g", { class: "frag" }, layers.seq)
    el("rect", { x, y, width: w, height: h, rx: 3, fill: "rgba(248,249,250,.55)", stroke: "#9aa0a6" }, g)
    el("path", { d: `M${x},${y + 22} H${x + tab - 8} L${x + tab},${y + 14} V${y}`, fill: "#ffffff", stroke: "#9aa0a6" }, g)
    el("text", { x: x + 8, y: y + 15, "font-size": 11, "font-weight": 700, fill: "#202124" }, g).textContent = f.type
    if (f.label) el("text", { x: x + tab + 8, y: y + 15, "font-size": 11, "font-style": "italic", fill: "#5f6368" }, g).textContent = `[${f.label}]`
    for (const e of f.elses) {
      el("line", { x1: x, y1: e.y, x2: x + w, y2: e.y, stroke: "#9aa0a6", "stroke-dasharray": "4 3" }, g)
      if (e.label) el("text", { x: x + 8, y: e.y + 15, "font-size": 11, "font-style": "italic", fill: "#5f6368" }, g).textContent = `[${e.label}]`
    }
  }
  for (const l of seq.lifelines) el("line", { x1: l.x, y1: l.top, x2: l.x, y2: l.bottom, stroke: "#9aa0a6", "stroke-dasharray": "5 4" }, layers.seq)
  for (const a of seq.activations) el("rect", { x: a.box[0], y: a.box[1], width: a.box[2], height: a.box[3], fill: "#ffffff", stroke: "#5f6368" }, layers.seq)
  for (const n of seq.notes) {
    const [x, y, w, h] = n.box
    el("path", { d: `M${x},${y} H${x + w - 12} L${x + w},${y + 12} V${y + h} H${x} Z`, fill: "#fff2cc", stroke: "#d6b656" }, layers.seq)
    const t = el("text", { "font-size": 11, fill: "#202124" }, layers.seq)
    n.text.forEach((s, i) => { const sp = el("tspan", { x: x + 8, y: y + 16 + i * 14 }, t); sp.textContent = s })
  }
  for (const c of scene.cards) {
    const n = c.node
    const [x, y, w, h] = c.box
    const type = participantType(n)
    const [fill, stroke] = SEQ_COLOURS[type] ?? SEQ_COLOURS.service
    const g = keyed(layers.cards, `p${n.index}`, () => {
      const g = el("g", { class: "card" })
      el("g", { class: "pop" }, g)
      g.addEventListener("mouseenter", () => highlight(g.dataset.id!))
      g.addEventListener("mouseleave", () => highlight(null))
      return g
    })
    g.dataset.id = n.id
    g.style.transform = `translate(${x}px, ${y}px)`
    const pop = g.querySelector(".pop")!
    pop.replaceChildren()
    if (type === "actor") {
      el("circle", { cx: w / 2, cy: 7, r: 6, fill: "#ffffff", stroke: "#202124", "stroke-width": 1.3 }, pop)
      el("path", { d: `M${w / 2},13 V27 M${w / 2 - 10},18 H${w / 2 + 10} M${w / 2},27 L${w / 2 - 8},38 M${w / 2},27 L${w / 2 + 8},38`, stroke: "#202124", "stroke-width": 1.3, fill: "none" }, pop)
      el("text", { x: w / 2, y: h + 12, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: "#202124" }, pop).textContent = n.title
    } else {
      el("rect", { width: w, height: h, rx: type === "database" ? 12 : 4, fill, stroke, "stroke-dasharray": type === "external" ? "4 3" : "", filter: "url(#shadow)" }, pop)
      el("text", { x: w / 2, y: h / 2 + 4, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: "#202124" }, pop).textContent = n.title
    }
    if (!seenCards.has(n.index)) { seenCards.add(n.index); g.classList.add("enter"); added.push(c) }
  }
  sweep(layers.cards)
  for (const e of scene.edges) {
    const key = String(e.index)
    const g = keyed(layers.edges, key, () => { const g = el("g", { class: "edge" }); el("path", {}, g); return g })
    g.dataset.from = e.from
    g.dataset.to = e.to
    const path = g.querySelector("path")!
    path.setAttribute("d", `M${e.points.map((p) => p.join(",")).join(" L")}`)
    path.setAttribute("marker-end", e.rel === "sync" ? "url(#arrow)" : "url(#m-open)")
    path.style.strokeDasharray = e.rel === "return" || e.rel === "create" ? "5 4" : ""
    if (!seenEdges.has(e.index)) { seenEdges.add(e.index); g.classList.add("enter"); addedEdges.push(e) }
    const lg = keyed(layers.labels, key, () => { const lg = el("g", { class: "elabel slabel enter" }); el("text", {}, lg); return lg })
    lg.dataset.from = e.from
    lg.dataset.to = e.to
    const [sx, sy] = e.points[0], [ex] = e.points[e.points.length - 1]
    const self = e.from === e.to
    const t = lg.querySelector("text")!
    t.setAttribute("x", String(self ? sx + 48 : (sx + ex) / 2))
    t.setAttribute("y", String(self ? sy + 18 : sy - 5))
    t.setAttribute("text-anchor", self ? "start" : "middle")
    t.textContent = e.label
  }
  sweep(layers.edges)
  sweep(layers.labels)
}
