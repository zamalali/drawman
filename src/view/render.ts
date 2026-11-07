// Draws a scene into the SVG layers, reusing nodes by key so updates animate instead of flashing.
import { edgeText, iconBox, labelColour, pointAt, type Card, type Edge, type Scene } from "../engine/index.js"
import { dataUri, el, fit, keyed, layers, measure, sweep } from "./dom.js"
import { markers, roundedPath } from "./geometry.js"
import { bindCard, startZoneDrag } from "./interaction.js"
import { drawFlowCards } from "./render-flow.js"
import { seenCards, seenEdges, seenZones, state } from "./state.js"

export function drawTitle(scene: Scene) {
  const g = keyed(layers.title, "t", () => {
    const g = el("g")
    el("text", { x: 40, y: 56, "font-size": 22, "font-weight": 700, fill: "#202124" }, g)
    el("text", { x: 40, y: 80, "font-size": 13, fill: "#5f6368" }, g)
    return g
  })
  const [t, s] = g.querySelectorAll("text")
  t.textContent = scene.facts.title
  s.textContent = [scene.facts.subtitle, "generated live by Drawman"].filter(Boolean).join(" · ")
  sweep(layers.title)
}

export function drawFrame(scene: Scene) {
  for (const f of scene.frames) {
    const [x, y, w, h] = f.box
    const g = keyed(layers.frame, f.platform, () => {
      const g = el("g", { class: "frame enter" })
      el("rect", { rx: 6, fill: "#ffffff", "stroke-width": 2, "stroke-dasharray": "6 4" }, g)
      el("text", { "font-size": 13, "font-weight": 700 }, g)
      return g
    })
    const rect = g.querySelector("rect")!
    rect.setAttribute("stroke", f.stroke)
    rect.setAttribute("x", String(x)); rect.setAttribute("y", String(y))
    rect.style.width = `${w}px`; rect.style.height = `${h}px`
    const label = g.querySelector("text")!
    label.setAttribute("fill", f.font)
    label.setAttribute("x", String(x + 14)); label.setAttribute("y", String(y + 24))
    label.textContent = f.title + (scene.frames.length === 1 && scene.facts.subtitle ? ` · ${scene.facts.subtitle}` : "")
  }
  sweep(layers.frame)
}

export function drawZones(scene: Scene) {
  for (const z of scene.zones) {
    const [x, y, w, h] = z.box
    const fresh = !seenZones.has(z.id)
    const g = keyed(layers.zones, z.id, () => {
      const g = el("g", { class: "zone" })
      g.addEventListener("pointerdown", (e) => startZoneDrag(e, g.dataset.key!))
      el("rect", { class: "zbody", rx: 8, width: w, fill: z.fill, stroke: z.stroke, "stroke-width": 1.2 }, g)
      el("rect", { class: "grip", height: 34, fill: "transparent" }, g)
      el("text", { x: w / 2, y: 24, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: "#202124" }, g).textContent = z.title
      return g
    })
    g.style.transform = `translate(${x}px, ${y}px)`
    const zbody = g.querySelector<SVGRectElement>(".zbody")!
    zbody.style.height = `${h}px`
    zbody.setAttribute("width", String(w))
    g.querySelector(".grip")!.setAttribute("width", String(w))
    g.querySelector("text")!.setAttribute("x", String(w / 2))
    if (fresh) {
      seenZones.add(z.id)
      g.classList.add("enter")
    }
  }
  sweep(layers.zones)
  // Nested groups: a parent must sit underneath its children even when it appeared later (only reorder when needed,
  // so entrance animations are not replayed).
  const want = scene.zones.map((z) => z.id)
  const have = (Array.from(layers.zones.children) as SVGElement[]).map((n) => n.dataset.key ?? "")
  if (want.join("\n") !== have.join("\n")) {
    for (const id of want) {
      const node = layers.zones.querySelector(`[data-key="${CSS.escape(id)}"]`)
      if (node) layers.zones.appendChild(node)
    }
  }
}

export function drawCards(scene: Scene, added: Card[]) {
  if (scene.facts.flow) return drawFlowCards(scene, added)
  for (const c of scene.cards) {
    const [x, y, w, h] = c.box
    const n = c.node
    const key = String(n.index)
    const g = keyed(layers.cards, key, () => {
      const g = el("g", { class: "card" })
      const pop = el("g", { class: "pop" }, g)
      el("rect", { class: "ring", x: -3, y: -3, width: w + 6, height: h + 6, rx: 9, fill: "none", stroke: "#f08705", "stroke-width": 2.5, filter: "url(#glow)" }, pop)
      el("rect", { class: "body", width: w, height: h, rx: 6, fill: "#ffffff", stroke: "#dddddd", filter: "url(#shadow)" }, pop)
      el("image", { class: "icon" }, pop)
      el("text", { class: "t", x: 50, "font-size": 11, "font-weight": 700, fill: "#202124" }, pop)
      el("text", { class: "d", x: 50, "font-size": 10, fill: "#5f6368" }, pop)
      bindCard(g)
      return g
    })
    g.dataset.id = n.id
    g.style.transform = `translate(${x}px, ${y}px)`
    const ib = iconBox(c.icon, h)
    const icon = g.querySelector("image")!
    icon.setAttribute("href", dataUri(ib.ic.image))
    icon.setAttribute("x", String(ib.x)); icon.setAttribute("y", String(ib.y))
    icon.setAttribute("width", String(ib.w)); icon.setAttribute("height", String(ib.h))
    const body = g.querySelector<SVGRectElement>(".body")!
    const dashed = n.status === "planned" || n.status === "bypassed"
    body.setAttribute("stroke-dasharray", dashed ? "4 3" : "")
    body.setAttribute("stroke", dashed ? "#9aa0a6" : "#dddddd")
    const t = g.querySelector<SVGTextElement>(".t")!, d = g.querySelector<SVGTextElement>(".d")!
    t.textContent = fit(n.title, "bold 11px Segoe UI", w - 58)
    d.textContent = fit(n.detail, "10px Segoe UI", w - 58)
    t.setAttribute("y", String(n.detail ? h / 2 - 3 : h / 2 + 4))
    d.setAttribute("y", String(h / 2 + 12))
    if (!seenCards.has(n.index)) {
      seenCards.add(n.index)
      g.classList.add("enter")
      added.push(c)
    }
  }
  sweep(layers.cards)
}

export function drawEdges(scene: Scene, added: Edge[]) {
  const family = scene.facts.flow?.family
  for (const e of scene.edges) {
    const key = String(e.index)
    const g = keyed(layers.edges, key, () => {
      const g = el("g", { class: "edge" })
      el("path", { "marker-end": "url(#arrow)" }, g)
      return g
    })
    g.dataset.from = e.from
    g.dataset.to = e.to
    const path = g.querySelector("path")!
    const d = roundedPath(e.points)
    if (path.getAttribute("d") !== d) path.setAttribute("d", d)
    if (family && family !== "flowchart") {
      const [start, end] = markers(scene, e)
      path.dataset.marker = end
      if (start) path.setAttribute("marker-start", start); else path.removeAttribute("marker-start")
      if (end) path.setAttribute("marker-end", end); else path.removeAttribute("marker-end")
      path.dataset.dash = family === "class" && (e.rel === "implements" || e.rel === "dependency") ? "6 4" : ""
      if (!g.classList.contains("enter")) path.style.strokeDasharray = path.dataset.dash
    }
    if (!seenEdges.has(e.index)) {
      seenEdges.add(e.index)
      const len = path.getTotalLength()
      path.style.setProperty("--len", String(len))
      path.style.strokeDasharray = String(len)
      g.classList.add("enter")
      path.addEventListener("animationend", () => { path.style.strokeDasharray = path.dataset.dash ?? ""; g.classList.remove("enter") }, { once: true })
      added.push(e)
    }
    const [lx, ly] = pointAt(e.points, e.labelPos)
    const lg = keyed(layers.labels, key, () => {
      const lg = el("g", { class: "elabel enter" })
      el("rect", { x: -17, y: -8, width: 34, height: 15, rx: 3 }, lg)
      el("text", { "text-anchor": "middle", y: 4 }, lg)
      return lg
    })
    lg.dataset.from = e.from
    lg.dataset.to = e.to
    lg.setAttribute("transform", `translate(${lx},${ly})`)
    const label = edgeText(e, !!scene.facts.flow)
    lg.style.display = label ? "" : "none"
    const lt = lg.querySelector("text")!
    lt.textContent = label
    if (label) {
      measure.font = scene.facts.flow ? "bold 11px Segoe UI" : "bold 10px Segoe UI"
      const lw = Math.ceil(measure.measureText(label).width) + 10
      const lr = lg.querySelector("rect")!
      lr.setAttribute("x", String(-lw / 2)); lr.setAttribute("width", String(lw))
    }
    if (scene.facts.flow && label) {
      lt.style.fill = scene.facts.flow.family === "flowchart" ? labelColour(label) : "#5f6368"
      lt.style.fontSize = "11px"
    }
  }
  sweep(layers.edges)
  sweep(layers.labels)
}

export function drawLegend(scene: Scene) {
  layers.legend.replaceChildren()
  if (!scene.edges.length || scene.facts.flow) return
  const [x, y, w, h] = scene.legend
  el("rect", { x, y, width: w, height: h, rx: 6, fill: "#ffffff", stroke: "#dddddd" }, layers.legend)
  el("text", { x: x + 12, y: y + 22, "font-size": 12, "font-weight": 700, fill: "#202124" }, layers.legend).textContent = scene.facts.groups ? "Connections" : "Interfaces"
  const titles = new Map(scene.facts.nodes.map((n) => [n.id, n.title]))
  const col2 = 70, col3 = Math.min(400, w * 0.36), col4 = col3 + 110
  scene.edges.forEach((e, i) => {
    const ry = y + 46 + i * 22
    el("text", { x: x + 20, y: ry, "font-size": 11, "font-weight": 700, fill: "#1a73e8" }, layers.legend).textContent = e.id
    el("text", { x: x + col2, y: ry, "font-size": 11, fill: "#202124" }, layers.legend).textContent =
      fit(`${titles.get(e.from)} → ${titles.get(e.to)}`, "11px Segoe UI", col3 - col2 - 10)
    el("text", { x: x + col3, y: ry, "font-size": 11, fill: "#202124" }, layers.legend).textContent = fit(e.protocol, "11px Segoe UI", 100)
    el("text", { x: x + col4, y: ry, "font-size": 11, fill: "#5f6368" }, layers.legend).textContent =
      fit(e.description || e.label, "11px Segoe UI", w - col4 - 20)
  })
}

export function drawFlow() {
  layers.flow.replaceChildren()
  if (!state.done || !state.flowOn || !state.current || state.current.facts.flow?.family === "class" || state.current.facts.flow?.family === "er") return
  for (const e of state.current.edges) {
    const d = roundedPath(e.points)
    const len = e.points.slice(1).reduce((s, b, i) => s + Math.abs(b[0] - e.points[i][0]) + Math.abs(b[1] - e.points[i][1]), 0)
    for (const offset of [0, 0.5]) {
      const dot = el("circle", { r: 3.2, class: "flowdot" }, layers.flow)
      const motion = el("animateMotion", { dur: `${Math.max(1.6, len / 110).toFixed(2)}s`, repeatCount: "indefinite", path: d, begin: `${(-offset * Math.max(1.6, len / 110)).toFixed(2)}s` }, dot)
      motion.setAttribute("rotate", "auto")
    }
  }
}
