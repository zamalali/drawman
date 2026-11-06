import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps"
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps"
import { ICONS, INPUT_KEYS, PLATFORMS, ZONES, GRID, ROW, SEQ_COLOURS, buildDrawio, buildScene, checkLayout, diagramKind, flowColours, iconBox, isCompartment, labelColour, nodeBox, normaliseFacts, participantType, type Box, type Card, type Edge, type Positions, type Pt, type Scene } from "../engine/index.js"
import "./styles.css"

const SVG = "http://www.w3.org/2000/svg"
const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T
const world = $<SVGGElement>("#world")
const canvas = $<SVGSVGElement>("#canvas")
const layers = {
  title: $<SVGGElement>("#layer-title"), frame: $<SVGGElement>("#layer-frame"), zones: $<SVGGElement>("#layer-zones"),
  seq: $<SVGGElement>("#layer-seq"),
  edges: $<SVGGElement>("#layer-edges"), cards: $<SVGGElement>("#layer-cards"), labels: $<SVGGElement>("#layer-labels"),
  flow: $<SVGGElement>("#layer-flow"), legend: $<SVGGElement>("#layer-legend"),
}
const ui = {
  title: $<HTMLElement>("#title"), subtitle: $<HTMLElement>("#subtitle"), status: $<HTMLElement>("#status"),
  statusText: $<HTMLElement>("#status-text"), empty: $<HTMLElement>("#empty"), ticker: $<HTMLOListElement>("#ticker"),
  inspector: $<HTMLElement>("#inspector"), suggest: $<HTMLElement>("#suggest"), insights: $<HTMLElement>("#insights"),
  download: $<HTMLButtonElement>("#download"), open: $<HTMLButtonElement>("#open"), fit: $<HTMLButtonElement>("#fit"),
  flow: $<HTMLButtonElement>("#flow"), fullscreen: $<HTMLButtonElement>("#fullscreen"), reset: $<HTMLButtonElement>("#reset"),
}

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) => {
  const node = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  parent?.appendChild(node)
  return node
}
const dataUri = (image: string) => image.replace(/^data:([^,;]+),/, "data:$1;base64,")

const measure = document.createElement("canvas").getContext("2d")!
function fit(text: string, font: string, max: number) {
  measure.font = font
  if (measure.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && measure.measureText(s + "…").width > max) s = s.slice(0, -1)
  return s.trimEnd() + "…"
}

type Cam = { x: number; y: number; w: number; h: number }
let cam: Cam = { x: 0, y: 0, w: 1400, h: 800 }
let target: Cam = { ...cam }
let userMoved = false
let raf = 0
function applyCam() { canvas.setAttribute("viewBox", `${cam.x} ${cam.y} ${cam.w} ${cam.h}`) }
function animateCam() {
  cancelAnimationFrame(raf)
  const step = () => {
    const t = 0.14
    cam = { x: cam.x + (target.x - cam.x) * t, y: cam.y + (target.y - cam.y) * t, w: cam.w + (target.w - cam.w) * t, h: cam.h + (target.h - cam.h) * t }
    applyCam()
    if (Math.abs(cam.w - target.w) + Math.abs(cam.x - target.x) + Math.abs(cam.y - target.y) > 0.5) raf = requestAnimationFrame(step)
    else { cam = { ...target }; applyCam() }
  }
  raf = requestAnimationFrame(step)
}
function fitTo(scene: Scene | null, instant = false) {
  const w = scene ? scene.width : 1400, h = scene ? scene.height : 800
  const r = canvas.getBoundingClientRect()
  const aspect = r.width && r.height ? r.width / r.height : 16 / 9
  let vw = w + 40, vh = h + 10
  if (vw / vh < aspect) vw = vh * aspect
  else vh = vw / aspect
  target = { x: (w - vw) / 2, y: 10 + (h - vh) / 2, w: vw, h: vh }
  if (instant) { cam = { ...target }; applyCam() } else animateCam()
}
function toWorld(cx: number, cy: number) {
  const p = canvas.createSVGPoint()
  p.x = cx; p.y = cy
  return p.matrixTransform(canvas.getScreenCTM()!.inverse())
}
canvas.addEventListener("wheel", (e) => {
  e.preventDefault()
  userMoved = true
  const p = toWorld(e.clientX, e.clientY)
  const z = Math.exp(e.deltaY * 0.0012)
  const w = Math.min(8000, Math.max(200, target.w * z)), h = target.h * (w / target.w)
  target = { x: p.x - (p.x - target.x) * (w / target.w), y: p.y - (p.y - target.y) * (h / target.h), w, h }
  animateCam()
}, { passive: false })
let drag: { x: number; y: number; cam: Cam } | null = null
canvas.addEventListener("pointerdown", (e) => {
  if ((e.target as Element).closest(".card")) return
  drag = { x: e.clientX, y: e.clientY, cam: { ...target } }
  canvas.classList.add("dragging")
  try { canvas.setPointerCapture(e.pointerId) } catch { /* pointer already released or synthetic */ }
  hideInspector()
})
canvas.addEventListener("pointermove", (e) => {
  if (cardDrag) return e.buttons & 1 ? moveCard(e) : endCardDrag()
  if (drag && !(e.buttons & 1)) { drag = null; canvas.classList.remove("dragging") }
  if (!drag) return
  const r = canvas.getBoundingClientRect()
  const s = Math.max(drag.cam.w / r.width, drag.cam.h / r.height)
  userMoved = true
  target = { ...drag.cam, x: drag.cam.x - (e.clientX - drag.x) * s, y: drag.cam.y - (e.clientY - drag.y) * s }
  cam = { ...target }
  applyCam()
})
canvas.addEventListener("pointerup", () => { if (cardDrag) endCardDrag(); drag = null; canvas.classList.remove("dragging") })
canvas.addEventListener("pointercancel", () => { if (cardDrag) endCardDrag(); drag = null; canvas.classList.remove("dragging") })
canvas.addEventListener("lostpointercapture", () => { if (cardDrag) endCardDrag() })
window.addEventListener("blur", () => { if (cardDrag) endCardDrag() })
new ResizeObserver(() => { if (!userMoved) fitTo(current, true) }).observe(canvas)

let positions: Positions = {}
let serverXml = ""
let cardDrag: { label: string; focus: string | null; start: DOMPoint; origin: Positions; moved: boolean } | null = null
let suppressClick = false
let pending = 0

function beginDrag(e: PointerEvent, label: string, focus: string | null, origin: Positions) {
  e.stopPropagation()
  e.preventDefault()
  cardDrag = { label, focus, start: toWorld(e.clientX, e.clientY), origin, moved: false }
  try { canvas.setPointerCapture(e.pointerId) } catch { /* pointer already released or synthetic */ }
}
function startCardDrag(e: PointerEvent, id: string) {
  if (!done || !current || e.button !== 0) return
  const card = current.cards.find((c) => c.node.id === id)
  if (card) beginDrag(e, card.node.title, id, { [id]: [card.box[0], card.box[1]] })
}
function startZoneDrag(e: PointerEvent, zoneId: string) {
  if (!done || !current || e.button !== 0) return
  const zone = current.zones.find((z) => z.id === zoneId)
  if (!zone || toWorld(e.clientX, e.clientY).y > zone.box[1] + 36) return
  const origin: Positions = { [`zone:${zoneId}`]: [zone.box[0], zone.box[1]] }
  for (const c of current.cards) if (c.zoneId === zoneId) origin[c.node.id] = [c.box[0], c.box[1]]
  beginDrag(e, zone.title, null, origin)
}
function moveCard(e: PointerEvent) {
  const d = cardDrag!
  const p = toWorld(e.clientX, e.clientY)
  const dx = Math.round((p.x - d.start.x) / GRID) * GRID, dy = Math.round((p.y - d.start.y) / GRID) * GRID
  if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 4) return
  if (!d.moved) {
    d.moved = true
    userMoved = true
    world.classList.add("moving")
    layers.flow.replaceChildren()
    hideInspector()
    if (d.focus) highlight(d.focus)
  }
  const next: Positions = {}
  for (const [key, [x, y]] of Object.entries(d.origin)) next[key] = [x + dx, y + dy]
  const clash = current!.cards.some((c) => {
    if (c.node.id in next) return false
    return Object.entries(next).some(([key, [x, y]]) => !key.startsWith("zone:") &&
      x < c.box[0] + c.box[2] + 8 && c.box[0] < x + c.box[2] + 8 && y < c.box[1] + c.box[3] + 8 && c.box[1] < y + c.box[3] + 8)
  })
  if (clash) return
  positions = { ...positions, ...next }
  if (!pending) pending = requestAnimationFrame(() => {
    pending = 0
    draw(new Set(Object.keys(cardDrag?.origin ?? {}).filter((k) => !k.startsWith("zone:"))))
  })
}
function endCardDrag() {
  const d = cardDrag!
  cardDrag = null
  if (!d.moved) return
  suppressClick = true
  setTimeout(() => { suppressClick = false }, 0)
  cancelAnimationFrame(pending)
  pending = 0
  draw()
  world.classList.remove("moving")
  highlight(null)
  commitEdit(`Moved <b>${escHtml(d.label)}</b> · ${current?.facts.flow ? "connections" : "interfaces"} re-routed`)
}
function commitEdit(message: string) {
  if (!current) return
  const edited = Object.keys(positions).length > 0
  xml = edited ? buildDrawio(current).xml : serverXml
  ui.reset.hidden = !edited
  drawFlow()
  tick(message + (current.unrouted.length ? ` · ${current.unrouted.length} could not be routed` : ""))
  void app.updateModelContext({
    content: [{ type: "text", text: edited
      ? `The user rearranged the draw.io diagram by hand (moved: ${Object.keys(positions).map((k) => k.replace(/^zone:/, "zone ")).join(", ")}). Keep that arrangement in mind if you redraw it.`
      : "The user reset the draw.io diagram to the automatic layout." }],
  }).catch(() => undefined)
}
ui.reset.onclick = () => {
  positions = {}
  draw()
  commitEdit("↺ <b>Automatic layout</b> restored")
  userMoved = false
  fitTo(current)
}

let current: Scene | null = null
let xml = ""
let done = false
let flowOn = true
const seenCards = new Set<number>()
const seenEdges = new Set<number>()
const seenZones = new Set<string>()

function roundedPath(points: Pt[], r = 7) {
  if (points.length < 2) return ""
  let d = `M${points[0][0]},${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1], [x, y] = points[i], [nx, ny] = points[i + 1]
    const r1 = Math.min(r, Math.hypot(x - px, y - py) / 2), r2 = Math.min(r, Math.hypot(nx - x, ny - y) / 2)
    const ax = x - Math.sign(x - px) * r1, ay = y - Math.sign(y - py) * r1
    const bx = x + Math.sign(nx - x) * r2, by = y + Math.sign(ny - y) * r2
    d += ` L${ax},${ay} Q${x},${y} ${bx},${by}`
  }
  const [lx, ly] = points[points.length - 1]
  return d + ` L${lx},${ly}`
}
function pointAt(points: Pt[], rel: number): Pt {
  const segs = points.slice(1).map((b, i) => Math.abs(b[0] - points[i][0]) + Math.abs(b[1] - points[i][1]))
  let left = ((rel + 1) / 2) * segs.reduce((s, v) => s + v, 0)
  for (let i = 0; i < segs.length; i++) {
    if (left <= segs[i]) {
      const t = segs[i] ? left / segs[i] : 0
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t]
    }
    left -= segs[i]
  }
  return points[points.length - 1]
}

function keyed<T extends SVGElement>(layer: SVGGElement, key: string, make: () => T) {
  let node = layer.querySelector<T>(`[data-key="${CSS.escape(key)}"]`)
  if (!node) {
    node = make()
    node.dataset.key = key
    layer.appendChild(node)
  }
  node.dataset.live = "1"
  return node
}
function sweep(layer: SVGGElement) {
  for (const node of Array.from(layer.children) as SVGElement[]) {
    if (node.dataset.live) delete node.dataset.live
    else node.remove()
  }
}

function drawTitle(scene: Scene) {
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

function drawFrame(scene: Scene) {
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

function drawZones(scene: Scene) {
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
}

function drawCards(scene: Scene, added: Card[]) {
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
      g.addEventListener("mouseenter", () => highlight(g.dataset.id!))
      g.addEventListener("mouseleave", () => highlight(null))
      g.addEventListener("pointerdown", (e) => startCardDrag(e, g.dataset.id!))
      g.addEventListener("click", (e) => { e.stopPropagation(); if (!suppressClick) showInspector(g.dataset.id!) })
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

function flowPath(shape: string, w: number, h: number) {
  const rect = (r: number) => `M${r},0 H${w - r} Q${w},0 ${w},${r} V${h - r} Q${w},${h} ${w - r},${h} H${r} Q0,${h} 0,${h - r} V${r} Q0,0 ${r},0 Z`
  const circle = (r: number) => `M${w / 2 - r},${h / 2} A${r},${r} 0 1 0 ${w / 2 + r},${h / 2} A${r},${r} 0 1 0 ${w / 2 - r},${h / 2} Z`
  switch (shape) {
    case "decision": case "choice": return `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z`
    case "start": case "end": { const r = h / 2; return `M${r},0 H${w - r} A${r},${r} 0 0 1 ${w - r},${h} H${r} A${r},${r} 0 0 1 ${r},0 Z` }
    case "data": return `M14,0 H${w} L${w - 14},${h} H0 Z`
    case "document": return `M0,0 H${w} V${h - 10} Q${w * 0.75},${h - 22} ${w / 2},${h - 10} T0,${h - 10} Z`
    case "database": return `M0,8 A${w / 2},8 0 0 1 ${w},8 V${h - 8} A${w / 2},8 0 0 1 0,${h - 8} Z`
    case "subprocess": return rect(3)
    case "initial": return circle(w / 2 - 6)
    case "final": return circle(w / 2 - 2)
    case "state": return rect(Math.min(14, h / 2))
    default: return isCompartment(shape) ? rect(4) : rect(6)
  }
}

function flowDeco(shape: string, w: number, h: number, head = 0, split = 0) {
  if (shape === "database") return `M0,8 A${w / 2},8 0 0 0 ${w},8`
  if (shape === "subprocess") return `M10,0 V${h} M${w - 10},0 V${h}`
  if (isCompartment(shape)) return `M0,${head} H${w}${split ? ` M0,${split} H${w}` : ""}`
  return ""
}

function drawFlowCards(scene: Scene, added: Card[]) {
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
      g.addEventListener("mouseenter", () => highlight(g.dataset.id!))
      g.addEventListener("mouseleave", () => highlight(null))
      g.addEventListener("pointerdown", (e) => startCardDrag(e, g.dataset.id!))
      g.addEventListener("click", (e) => { e.stopPropagation(); if (!suppressClick) showInspector(g.dataset.id!) })
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

function drawSequence(scene: Scene, added: Card[], addedEdges: Edge[]) {
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

function markers(scene: Scene, e: Edge): [string, string] {
  const family = scene.facts.flow?.family
  if (family === "class") {
    switch (e.rel) {
      case "inherits": case "implements": return ["", "url(#m-tri)"]
      case "composition": return ["url(#m-dia)", ""]
      case "aggregation": return ["url(#m-odia)", ""]
      default: return ["", "url(#m-open)"]
    }
  }
  if (family === "er") {
    const [a, b] = e.rel === "one-to-one" ? ["one", "one"] : e.rel === "many-to-one" ? ["many", "one"] : e.rel === "many-to-many" ? ["many", "many"] : ["one", "many"]
    return [`url(#m-${a})`, `url(#m-${b})`]
  }
  return ["", "url(#arrow)"]
}

function drawEdges(scene: Scene, added: Edge[]) {
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
    const label = scene.facts.flow ? e.label : e.id
    lg.style.display = label ? "" : "none"
    const lt = lg.querySelector("text")!
    lt.textContent = label
    if (scene.facts.flow && label) {
      measure.font = "bold 11px Segoe UI"
      const lw = Math.ceil(measure.measureText(label).width) + 10
      const lr = lg.querySelector("rect")!
      lr.setAttribute("x", String(-lw / 2)); lr.setAttribute("width", String(lw))
      lt.style.fill = scene.facts.flow.family === "flowchart" ? labelColour(label) : "#5f6368"
      lt.style.fontSize = "11px"
    }
  }
  sweep(layers.edges)
  sweep(layers.labels)
}

function drawLegend(scene: Scene) {
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

function drawFlow() {
  layers.flow.replaceChildren()
  if (!done || !flowOn || !current || current.facts.flow?.family === "class" || current.facts.flow?.family === "er") return
  for (const e of current.edges) {
    const d = roundedPath(e.points)
    const len = e.points.slice(1).reduce((s, b, i) => s + Math.abs(b[0] - e.points[i][0]) + Math.abs(b[1] - e.points[i][1]), 0)
    for (const offset of [0, 0.5]) {
      const dot = el("circle", { r: 3.2, class: "flowdot" }, layers.flow)
      const motion = el("animateMotion", { dur: `${Math.max(1.6, len / 110).toFixed(2)}s`, repeatCount: "indefinite", path: d, begin: `${(-offset * Math.max(1.6, len / 110)).toFixed(2)}s` }, dot)
      motion.setAttribute("rotate", "auto")
    }
  }
}

function tick(html: string) {
  const li = document.createElement("li")
  li.innerHTML = html
  ui.ticker.appendChild(li)
  for (const old of Array.from(ui.ticker.children).slice(0, -1)) old.classList.add("old")
  while (ui.ticker.children.length > 5) ui.ticker.firstElementChild!.remove()
}
const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

function highlight(id: string | null) {
  world.classList.toggle("dim", !!id)
  for (const n of world.querySelectorAll<SVGElement>(".hot")) n.classList.remove("hot")
  for (const p of world.querySelectorAll('path[marker-end="url(#arrow-hot)"]')) p.setAttribute("marker-end", "url(#arrow)")
  if (!id) return
  layers.cards.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.add("hot")
  for (const n of world.querySelectorAll<SVGElement>(".edge, .elabel")) {
    if (n.dataset.from === id || n.dataset.to === id) {
      n.classList.add("hot")
      for (const other of [n.dataset.from, n.dataset.to]) layers.cards.querySelector(`[data-id="${CSS.escape(other!)}"]`)?.classList.add("hot")
      n.querySelector("path")?.setAttribute("marker-end", "url(#arrow-hot)")
    }
  }
  if (!id) return
}
world.addEventListener("mouseleave", () => {
  for (const p of world.querySelectorAll("path[marker-end]")) p.setAttribute("marker-end", "url(#arrow)")
})
canvas.addEventListener("pointerleave", () => { if (!cardDrag) highlight(null) })
canvas.addEventListener("pointerover", (e) => { if (!cardDrag && !(e.target as Element).closest(".card, .edge, .elabel")) highlight(null) })

function showInspector(id: string) {
  if (!current) return
  const card = current.cards.find((c) => c.node.id === id)
  if (!card) return
  const n = card.node
  const titles = new Map(current.facts.nodes.map((x) => [x.id, x.title]))
  const ifs = current.edges.filter((e) => e.from === id || e.to === id)
  ui.inspector.innerHTML = `
    <h4>${escHtml(n.title)}</h4>
    <div class="k">${current.facts.flow ? `${escHtml(n.shape ?? "step")}${card.zoneTitle ? ` · ${escHtml(card.zoneTitle)}` : ""}` : `${current.facts.groups ? "" : `${escHtml(n.kind)} · `}${escHtml(card.platform === "neutral" ? "" : `${PLATFORMS[card.platform].title} · `)}${escHtml(card.zoneTitle)}`}${n.status !== "active" ? ` · ${n.status}` : ""}</div>
    ${n.detail ? `<div>${escHtml(n.detail)}</div>` : ""}
    <ul>${ifs.map((e) => current!.facts.flow
      ? `<li>${escHtml(titles.get(e.from) ?? "")} → ${escHtml(titles.get(e.to) ?? "")}${e.label ? ` <span class="k">(${escHtml(e.label)})</span>` : ""}</li>`
      : `<li><b>${e.id}</b> ${escHtml(titles.get(e.from) ?? "")} → ${escHtml(titles.get(e.to) ?? "")}${e.protocol ? ` <span class="k">(${escHtml(e.protocol)})</span>` : ""}</li>`).join("") || "<li>No connections</li>"}</ul>
    <div class="row">
      <button data-ask="explain">Ask about it</button>
      <button data-ask="remove">Remove it</button>
    </div>`
  ui.inspector.hidden = false
  void app.updateModelContext({
    content: [{ type: "text", text: current.facts.flow
      ? `In the flowchart the user selected the step "${n.title}" (${n.shape}, id ${n.id}).`
      : `In the draw.io diagram the user selected "${n.title}" (${n.kind}, id ${n.id}) with interfaces ${ifs.map((e) => e.id).join(", ") || "none"}.` }],
  }).catch(() => undefined)
  ui.inspector.querySelector<HTMLButtonElement>('[data-ask="explain"]')!.onclick = () =>
    ask(current?.facts.flow
      ? `Explain the step "${n.title}" in this flowchart: what happens there and where each of its branches leads.`
      : `Explain the role of "${n.title}" in this architecture and walk through its interfaces ${ifs.map((e) => e.id).join(", ")}.`)
  ui.inspector.querySelector<HTMLButtonElement>('[data-ask="remove"]')!.onclick = () =>
    ask(`Remove "${n.title}" (${n.id}) from the diagram and redraw it with every interface it had either rewired or removed.`)
}
function hideInspector() { ui.inspector.hidden = true }
canvas.addEventListener("click", (e) => { if (!(e.target as Element).closest(".card")) hideInspector() })

async function ask(text: string) {
  hideInspector()
  try { await app.sendMessage({ role: "user", content: [{ type: "text", text }] }) }
  catch { tick("Host did not accept the follow-up message") }
}

function showSuggestions() {
  const kinds = new Set(current?.facts.nodes.map((n) => n.kind))
  const ideas: [string, string][] = []
  const family = current?.seq ? "sequence" : current?.facts.flow?.family
  if (family === "sequence") {
    ideas.push(["Add error paths", "Add the error, timeout and retry paths to this sequence diagram (as alt fragments) and redraw it."])
    ideas.push(["Add caching", "Add a cache in front of the slowest call in this sequence and redraw the diagram."])
    ideas.push(["Explain the flow", "Walk me through this sequence diagram message by message."])
  } else if (family === "state") {
    ideas.push(["Add error states", "Add the missing failure and timeout states and transitions to this state machine and redraw it."])
    ideas.push(["Add guards", "Add guard conditions and actions to the transitions where they matter and redraw the state machine."])
    ideas.push(["Explain it", "Explain this state machine: the normal path and every way it can end."])
  } else if (family === "class") {
    ideas.push(["Apply a pattern", "Refactor this class diagram with a suitable design pattern (e.g. strategy or repository) and redraw it."])
    ideas.push(["Add methods", "Add the key methods and their signatures to the classes and redraw the class diagram."])
    ideas.push(["Generate the code", "Generate the code skeleton for these classes in TypeScript."])
  } else if (family === "er") {
    ideas.push(["Add indexes and audit", "Add audit columns (created_at, updated_at) and the important foreign key indexes, then redraw the ER diagram."])
    ideas.push(["Generate the SQL", "Generate the PostgreSQL DDL for this schema."])
    ideas.push(["Normalise it", "Review this schema for normalisation issues and redraw the improved ER diagram."])
  } else if (current?.facts.flow) {
    ideas.push(["Add error handling", "Add the missing error, timeout and exception paths to this flowchart and redraw it."])
    ideas.push([current.facts.flow.lanes.length ? "Simplify it" : "Add swimlanes",
      current.facts.flow.lanes.length ? "Make a simpler version of this flowchart for a non-technical audience and redraw it."
        : "Split this flowchart into swimlanes by who performs each step and redraw it."])
    ideas.push(["Explain it step by step", "Walk me through this flowchart step by step, including every decision and where each branch leads."])
  }
  if (current?.facts.groups) {
    ideas.push(["Explain it step by step", "Walk me through this diagram step by step using the F numbers."])
    ideas.push(["Add more detail", "Expand the most important group into its sub-steps and redraw the diagram."])
    ideas.push(["Simplify it", "Make a simpler version of this diagram for a non-technical audience and redraw it."])
  }
  const cloud = [...kinds].find((k) => k.startsWith("aws_")) ? "aws" : [...kinds].find((k) => k.startsWith("az_")) ? "azure" : "gcp"
  if (!current?.facts.groups && !current?.facts.flow && !current?.seq && !kinds.has("cloud_monitoring") && !kinds.has("aws_cloudwatch") && !kinds.has("az_monitor") && !kinds.has("prometheus")) {
    ideas.push(["Add observability", cloud === "aws" ? "Add CloudWatch and X-Ray with the right interfaces and redraw the diagram."
      : cloud === "azure" ? "Add Azure Monitor, Application Insights and Log Analytics and redraw the diagram."
      : "Add logging, monitoring and tracing with the right interfaces and redraw the diagram."])
  }
  if (!current?.facts.groups && !current?.facts.flow && !current?.seq) {
    ideas.push(["Harden security", "Add the missing security controls (WAF, identity, secrets, encryption) where they belong and redraw the diagram."])
    ideas.push(["Make it multi-region", "Make this architecture highly available across two regions and redraw it."])
    ideas.push(["Explain the data flow", "Walk me through the end-to-end request and data flow using the IF numbers."])
  }
  ui.suggest.replaceChildren(...ideas.slice(0, 3).map(([label, prompt]) => {
    const b = document.createElement("button")
    b.textContent = label
    b.onclick = () => ask(prompt)
    return b
  }))
  ui.suggest.hidden = false
}

// Arguments may arrive in bursts, so the view reveals one item per beat until it has caught up.
type Stats = { cards: number; zones: number; edges: number }
let latest: Record<string, unknown> | null = null
let inputFinal = false
let resultStats: Stats | undefined
let resultReady = false
let shownNodes = 0
let shownEdges = 0
let beat = 0

function setStatus(kind: "waiting" | "building" | "done" | "error", text: string) {
  ui.status.className = `status ${kind}`
  ui.statusText.textContent = text
}

function available(args: Record<string, unknown>) {
  const f = normaliseFacts(args, !inputFinal)
  const [, edgeKey] = INPUT_KEYS[diagramKind(args)]
  return {
    nodes: f.nodes.length ? Math.max(...f.nodes.map((n) => n.index)) + 1 : 0,
    edges: f.interfaces.length ? Math.max(...f.interfaces.map((i) => i.index)) + 1 : 0,
    edgesStarted: Array.isArray(args[edgeKey]),
  }
}

function nouns(scene: Scene): [string, string, string, string] {
  if (scene.seq) return ["participants", "messages", "Adding participants", "Sending messages"]
  switch (scene.facts.flow?.family) {
    case "state": return ["states", "transitions", "Placing states", "Adding transitions"]
    case "class": return ["classes", "relationships", "Placing classes", "Relating classes"]
    case "er": return ["tables", "relationships", "Placing tables", "Relating tables"]
    case "flowchart": return ["steps", "connections", "Placing steps", "Connecting steps"]
  }
  return ["components", "interfaces", "Placing components", "Wiring interfaces"]
}

function receive(args: Record<string, unknown>, final: boolean) {
  latest = args
  if (final) inputFinal = true
  draw()
  if (!beat) step()
}

function step() {
  beat = 0
  if (!latest) return
  const a = available(latest)
  const nodesDone = shownNodes >= a.nodes && (a.edgesStarted || inputFinal)
  let backlog = 0
  if (shownNodes < a.nodes) {
    shownNodes++
    backlog = a.nodes - shownNodes
  } else if (nodesDone && shownEdges < a.edges) {
    shownEdges++
    backlog = a.edges - shownEdges
  } else {
    if (inputFinal && resultReady && !done) finish(resultStats)
    return
  }
  draw()
  const edgesPhase = shownNodes >= a.nodes && nodesDone
  const delay = edgesPhase ? (backlog > 8 ? 90 : 150) : backlog > 8 ? 130 : backlog > 3 ? 190 : 260
  beat = window.setTimeout(step, delay)
}

function draw(moved?: Set<string>) {
  if (!latest) return
  const [nodeKey, edgeKey] = INPUT_KEYS[diagramKind(latest)]
  const rawNodes = Array.isArray(latest[nodeKey]) ? latest[nodeKey] as unknown[] : []
  const rawIfs = Array.isArray(latest[edgeKey]) ? latest[edgeKey] as unknown[] : []
  const slice = { ...latest, [nodeKey]: rawNodes.slice(0, shownNodes), [edgeKey]: rawIfs.slice(0, shownEdges) }
  let scene: Scene
  try {
    const reroute = moved && current ? { moved, previous: new Map(current.edges.map((e) => [e.id, e.points] as [string, Pt[]])) } : undefined
    scene = buildScene(normaliseFacts(slice, false), positions, reroute)
    checkLayout(scene)
  } catch (error) {
    if (inputFinal) setStatus("error", (error as Error).message)
    return
  }
  current = scene
  ui.title.textContent = scene.facts.title
  ui.subtitle.textContent = scene.facts.subtitle || "draw.io · live"
  if (scene.cards.length) ui.empty.classList.add("gone")
  const addedCards: Card[] = [], addedEdges: Edge[] = []
  drawTitle(scene)
  drawFrame(scene)
  drawZones(scene)
  if (scene.seq) drawSequence(scene, addedCards, addedEdges)
  else {
    layers.seq.replaceChildren()
    drawCards(scene, addedCards)
    drawEdges(scene, addedEdges)
  }
  drawLegend(scene)
  const titles = new Map(scene.facts.nodes.map((n) => [n.id, n.title]))
  const [, , placing, linking] = nouns(scene)
  for (const c of addedCards) tick(`＋ <b>${escHtml(c.node.title)}</b>${c.zoneTitle ? ` → ${escHtml(c.zoneTitle)}` : ""}`)
  for (const e of addedEdges) tick(scene.facts.flow || scene.seq
    ? `↳ ${escHtml(titles.get(e.from) ?? "")} → ${escHtml(titles.get(e.to) ?? "")}${e.label ? ` · <b>${escHtml(e.label)}</b>` : ""}`
    : `↳ <b>${e.id}</b> ${escHtml(titles.get(e.from) ?? "")} → ${escHtml(titles.get(e.to) ?? "")}${e.protocol ? ` · ${escHtml(e.protocol)}` : ""}`)
  if (!done) {
    const total = latest ? available(latest) : { nodes: 0, edges: 0 }
    setStatus("building", shownEdges || (inputFinal && shownNodes >= total.nodes)
      ? `${linking} · ${scene.edges.length}/${Math.max(total.edges, scene.edges.length)}`
      : `${placing} · ${scene.cards.length}/${Math.max(total.nodes, scene.cards.length)}`)
  }
  if (!userMoved) fitTo(scene)
}

function finish(stats?: { cards: number; zones: number; edges: number }) {
  done = true
  world.classList.add("editable")
  ui.download.disabled = !xml
  ui.open.disabled = !xml
  ui.flow.disabled = false
  ui.flow.classList.toggle("on", flowOn)
  setStatus("done", current?.facts.flow || current?.seq
    ? `${current.cards.length} ${nouns(current)[0]} · ${current.edges.length} ${nouns(current)[1]}`
    : stats ? `${stats.cards} components · ${stats.zones} zones · ${stats.edges} interfaces` : "Done")
  tick(`✓ <b>Diagram ready</b> · routed with A* (no ${current?.facts.flow ? "line" : "edge"} crosses a ${current?.facts.flow ? "shape" : "card"})`)
  drawFlow()
  showSuggestions()
  if (!userMoved) fitTo(current)
}

const app = new App({ name: "drawman", version: "0.1.0" }, { availableDisplayModes: ["inline", "fullscreen"] })

function applyContext(ctx: McpUiHostContext | undefined) {
  if (!ctx) return
  if (ctx.theme) applyDocumentTheme(ctx.theme)
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)
  if (ctx.displayMode) {
    document.documentElement.dataset.display = ctx.displayMode
    ui.fullscreen.textContent = ctx.displayMode === "fullscreen" ? "⤡" : "⤢"
  }
  const dims = ctx.containerDimensions as { height?: number; maxHeight?: number } | undefined
  const app = document.getElementById("app")!
  if (dims && typeof dims.height === "number") app.style.height = "100vh"
  else app.style.height = `${Math.min(dims?.maxHeight ?? 620, 620)}px`
}

type Analysis = {
  repository: string; commit?: string; files: number; read: number; platforms: string[]
  signals: { kind: string; source: string; at: string }[]; findings: string[]; model: string; ms: number
  coverage: { represented: number; total: number; missing: string[] }
}
let analysis: Analysis | null = null
let findingTimer = 0

function showScanning(repository: string) {
  ui.empty.querySelector("div:last-child")!.textContent = `Reading ${repository} — workflows, IaC, SAP MTA, dependencies…`
  setStatus("building", "Analyzing repository")
  ui.title.textContent = repository
  ui.subtitle.textContent = "repository → architecture"
}

function showAnalysis(a: Analysis) {
  analysis = a
  const chips = a.platforms.map((p) => (p in PLATFORMS ? PLATFORMS[p as keyof typeof PLATFORMS] : null))
    .filter(Boolean).map((p) => `<span class="chip" style="border-color:${p!.stroke};color:${p!.font}">${escHtml(p!.title)}</span>`).join("")
  ui.insights.innerHTML = `
    <div class="ins-head">
      <div><b>${escHtml(a.repository)}</b>${a.commit ? ` <span class="k">@ ${escHtml(a.commit)}</span>` : ""}</div>
      <button class="ins-toggle" title="Collapse">–</button>
    </div>
    <div class="ins-stats">${a.files} files · ${a.read} read · ${a.signals.length} signals · ${a.coverage.represented}/${a.coverage.total} drawn · ${(a.ms / 1000).toFixed(0)}s</div>
    <div class="chips">${chips}</div>
    <ol class="findings"></ol>
    <details><summary>Evidence (${a.signals.length})</summary><ul class="ev">${a.signals.map((s) => `<li><b>${escHtml(s.kind)}</b> <span class="k">${escHtml(s.at)}</span></li>`).join("")}</ul></details>`
  ui.insights.hidden = false
  ui.insights.querySelector<HTMLButtonElement>(".ins-toggle")!.onclick = () => ui.insights.classList.toggle("collapsed")
  const list = ui.insights.querySelector<HTMLOListElement>(".findings")!
  let i = 0
  clearInterval(findingTimer)
  findingTimer = window.setInterval(() => {
    if (i >= a.findings.length) return clearInterval(findingTimer)
    const li = document.createElement("li")
    li.textContent = a.findings[i++]
    list.appendChild(li)
    list.scrollTop = list.scrollHeight
  }, 650)
}

app.ontoolinputpartial = ({ arguments: args }) => { if (args && !inputFinal && !("repository" in args)) receive(args, false) }
app.ontoolinput = ({ arguments: args }) => {
  if (!args) return
  if (typeof args.repository === "string") showScanning(args.repository)
  else receive(args, true)
}
app.ontoolresult = (result) => {
  if (result.isError) {
    setStatus("error", result.content?.map((c) => ("text" in c ? c.text : "")).join(" ") || "Diagram failed")
    return
  }
  const sc = result.structuredContent as { xml?: string; stats?: Stats; diagram?: Record<string, unknown>; analysis?: Analysis; handoff?: boolean } | undefined
  xml = serverXml = sc?.xml ?? ""
  resultStats = sc?.stats
  if (sc?.analysis) showAnalysis(sc.analysis)
  if (sc?.handoff) {
    setStatus("done", "Evidence collected · the agent is drawing the diagram")
    ui.empty.querySelector("div:last-child")!.textContent = "Evidence handed to the agent; the diagram follows in its next step."
    return
  }
  if (sc?.diagram && (!latest || sc.analysis)) {
    resultReady = true
    receive(sc.diagram, true)
    return
  }
  resultReady = true
  if (!beat) step()
}
app.ontoolcancelled = ({ reason }) => setStatus("error", `Cancelled${reason ? `: ${reason}` : ""}`)
app.onhostcontextchanged = (ctx) => applyContext({ ...app.getHostContext(), ...ctx })
app.onteardown = async () => ({})

ui.fit.onclick = () => { userMoved = false; fitTo(current) }
ui.flow.onclick = () => { flowOn = !flowOn; ui.flow.classList.toggle("on", flowOn); drawFlow() }
ui.fullscreen.onclick = async () => {
  const mode = document.documentElement.dataset.display === "fullscreen" ? "inline" : "fullscreen"
  try {
    const res = await app.requestDisplayMode({ mode })
    document.documentElement.dataset.display = res.mode
    ui.fullscreen.textContent = res.mode === "fullscreen" ? "⤡" : "⤢"
    setTimeout(() => { userMoved = false; fitTo(current) }, 120)
  } catch { /* host refused */ }
}
const fileName = () => (current?.facts.title || "architecture").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".drawio"
ui.download.onclick = async () => {
  if (!xml) return
  try {
    const res = await app.downloadFile({ contents: [{ type: "resource", resource: { uri: `file:///${fileName()}`, mimeType: "application/vnd.jgraph.mxfile", text: xml } }] })
    if (res.isError) throw new Error("denied")
    tick(`⬇ <b>${escHtml(fileName())}</b> downloaded`)
  } catch {
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([xml], { type: "application/xml" }))
    a.download = fileName()
    a.click()
  }
}
ui.open.onclick = async () => {
  if (!xml) return
  const bytes = new TextEncoder().encode(encodeURIComponent(xml))
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))
  const buf = new Uint8Array(await new Response(stream).arrayBuffer())
  let bin = ""
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  const url = `https://app.diagrams.net/?title=${encodeURIComponent(fileName())}#R${encodeURIComponent(btoa(bin))}`
  try { await app.openLink({ url }) } catch { tick("Host blocked opening the link") }
}

fitTo(null, true)
void ICONS
app.connect().then(() => applyContext(app.getHostContext())).catch(() => setStatus("error", "No MCP Apps host connection"))
