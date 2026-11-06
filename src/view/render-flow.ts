// Flowchart, state and UML (class / ER) shapes.
import { ROW, flowColours, isCompartment, nodeBox, type Card, type Scene } from "../engine/index.js"
import { el, keyed, layers, sweep } from "./dom.js"
import { flowDeco, flowPath } from "./geometry.js"
import { bindCard } from "./interaction.js"
import { seenCards } from "./state.js"

export function drawFlowCards(scene: Scene, added: Card[]) {
  for (const c of scene.cards) {
    const [x, y, w, h] = c.box
    const n = c.node
    const g = keyed(layers.cards, `f${n.index}`, () => {
      const g = el("g", { class: "card" })
      const pop = el("g", { class: "pop" }, g)
      el("path", { class: "ring", fill: "none", stroke: "#f08705", "stroke-width": 2.5, filter: "url(#glow)", "vector-effect": "non-scaling-stroke" }, pop)
      el("path", { class: "body", filter: "url(#shadow)", "stroke-width": 1.2 }, pop)
      el("path", { class: "deco", fill: "none", "stroke-width": 1.2 }, pop)
      el("circle", { class: "dot" }, pop)
      el("text", { class: "ft", "text-anchor": "middle", "font-size": 12, fill: "#202124" }, pop)
      bindCard(g)
      return g
    })
    g.dataset.id = n.id
    g.style.transform = `translate(${x}px, ${y}px)`
    const shape = n.shape ?? "process"
    const nb = nodeBox(n)
    const d = flowPath(shape, w, h)
    const [fill, stroke] = flowColours(n)
    const body = g.querySelector<SVGPathElement>(".body")!
    body.setAttribute("d", d)
    body.setAttribute("fill", fill)
    body.setAttribute("stroke", stroke)
    body.setAttribute("stroke-dasharray", n.status === "planned" || n.status === "bypassed" ? "4 3" : "")
    const ring = g.querySelector<SVGPathElement>(".ring")!
    ring.setAttribute("d", d)
    ring.setAttribute("transform", `translate(-3,-3) scale(${(w + 6) / w},${(h + 6) / h})`)
    const split = nb.methods?.length ? nb.head! + Math.max(nb.fields!.length, 1) * ROW + 4 : 0
    const deco = g.querySelector<SVGPathElement>(".deco")!
    deco.setAttribute("d", flowDeco(shape, w, h, nb.head, split))
    deco.setAttribute("stroke", stroke)
    const dot = g.querySelector<SVGCircleElement>(".dot")!
    dot.setAttribute("cx", String(w / 2)); dot.setAttribute("cy", String(h / 2)); dot.setAttribute("r", shape === "final" ? String(w / 2 - 7) : "0")
    dot.setAttribute("fill", "#202124")
    if (isCompartment(shape)) body.setAttribute("fill", "#ffffff")
    let head = g.querySelector<SVGPathElement>(".head")
    if (isCompartment(shape)) {
      if (!head) { head = el("path", { class: "head" }); g.querySelector(".pop")!.insertBefore(head, g.querySelector(".deco")) }
      const hh = nb.head!
      head.setAttribute("d", `M4,0 H${w - 4} Q${w},0 ${w},4 V${hh} H0 V4 Q0,0 4,0 Z`)
      head.setAttribute("fill", fill)
    } else head?.remove()
    const lines = isCompartment(shape) ? [] : nb.lines
    const rows = isCompartment(shape) ? [...nb.fields!, ...(nb.methods ?? [])] : nb.sub ?? []
    const key = JSON.stringify([lines, rows, nb.stereo, shape])
    const text = g.querySelector<SVGTextElement>(".ft")!
    if (text.dataset.key !== key) {
      text.dataset.key = key
      const spans: SVGTSpanElement[] = []
      const span = (s: string, attrs: Record<string, string | number>) => { const t = el("tspan", attrs); t.textContent = s; spans.push(t) }
      if (isCompartment(shape)) {
        const hh = nb.head!
        if (nb.stereo) span(nb.stereo, { x: w / 2, y: 15, "font-size": 10, "font-style": "italic", fill: "#5f6368" })
        span(nb.lines[0], { x: w / 2, y: nb.stereo ? 31 : 20, "font-weight": 700, "font-size": 13, ...(shape === "abstract" ? { "font-style": "italic" } : {}) })
        nb.fields!.forEach((f, i) => span(f, { x: 8, y: hh + 14 + i * ROW, "text-anchor": "start", ...(/^PK /.test(f) ? { "font-weight": 700, "text-decoration": "underline" } : {}) }))
        nb.methods!.forEach((m, i) => span(m, { x: 8, y: split + 18 + i * ROW, "text-anchor": "start" }))
      } else if (shape === "state") {
        const top = h / 2 - ((lines.length - 1) * 15 + (rows.length ? 8 + rows.length * 14 : 0)) / 2 + 4
        lines.forEach((l, i) => span(l, { x: w / 2, y: top + i * 15, "font-weight": 700 }))
        rows.forEach((r, i) => span(r, { x: w / 2, y: top + lines.length * 15 + 6 + i * 14, "font-size": 10, fill: "#5f6368" }))
      } else {
        const shift = shape === "database" ? 4 : shape === "document" ? -5 : 0
        lines.forEach((l, i) => span(l, { x: w / 2, y: h / 2 + shift + 4 + (i - (lines.length - 1) / 2) * 15 }))
      }
      text.replaceChildren(...spans)
    }
    if (!seenCards.has(n.index)) {
      seenCards.add(n.index)
      g.classList.add("enter")
      added.push(c)
    }
  }
  sweep(layers.cards)
}
