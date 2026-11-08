// Pointer interaction: zoom, pan, hover highlighting and drag-to-edit of cards and zones.
import { GRID, buildDrawio, type Positions } from "../engine/index.js"
import { canvas, escHtml, layers, tick, ui, world } from "./dom.js"
import { animateCam, applyCam, fitTo, toWorld } from "./camera.js"
import { app } from "./host.js"
import { hideInspector, showInspector } from "./panels.js"
import { drawFlow } from "./render.js"
import { state, type Cam } from "./state.js"
import { draw } from "./stream.js"

let drag: { x: number; y: number; cam: Cam } | null = null
let cardDrag: { label: string; focus: string | null; start: DOMPoint; origin: Positions; moved: boolean } | null = null
let suppressClick = false
let pending = 0

canvas.addEventListener("wheel", (e) => {
  e.preventDefault()
  state.userMoved = true
  const p = toWorld(e.clientX, e.clientY)
  const z = Math.exp(e.deltaY * 0.0012)
  const w = Math.min(8000, Math.max(200, state.target.w * z)), h = state.target.h * (w / state.target.w)
  state.target = { x: p.x - (p.x - state.target.x) * (w / state.target.w), y: p.y - (p.y - state.target.y) * (h / state.target.h), w, h }
  animateCam()
}, { passive: false })
canvas.addEventListener("pointerdown", (e) => {
  if ((e.target as Element).closest(".card")) return
  drag = { x: e.clientX, y: e.clientY, cam: { ...state.target } }
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
  state.userMoved = true
  state.target = { ...drag.cam, x: drag.cam.x - (e.clientX - drag.x) * s, y: drag.cam.y - (e.clientY - drag.y) * s }
  state.cam = { ...state.target }
  applyCam()
})
canvas.addEventListener("pointerup", () => { if (cardDrag) endCardDrag(); drag = null; canvas.classList.remove("dragging") })
canvas.addEventListener("pointercancel", () => { if (cardDrag) endCardDrag(); drag = null; canvas.classList.remove("dragging") })
canvas.addEventListener("lostpointercapture", () => { if (cardDrag) endCardDrag() })
window.addEventListener("blur", () => { if (cardDrag) endCardDrag() })
new ResizeObserver(() => { if (!state.userMoved) fitTo(state.current, true) }).observe(canvas)


function beginDrag(e: PointerEvent, label: string, focus: string | null, origin: Positions) {
  e.stopPropagation()
  e.preventDefault()
  cardDrag = { label, focus, start: toWorld(e.clientX, e.clientY), origin, moved: false }
  try { canvas.setPointerCapture(e.pointerId) } catch { /* pointer already released or synthetic */ }
}
function startCardDrag(e: PointerEvent, id: string) {
  if (!state.done || !state.current || e.button !== 0) return
  const card = state.current.cards.find((c) => c.node.id === id)
  if (card) beginDrag(e, card.node.title, id, { [id]: [card.box[0], card.box[1]] })
}
export function startZoneDrag(e: PointerEvent, zoneId: string) {
  if (!state.done || !state.current || e.button !== 0) return
  const zone = state.current.zones.find((z) => z.id === zoneId)
  if (!zone || toWorld(e.clientX, e.clientY).y > zone.box[1] + 36) return
  const origin: Positions = { [`zone:${zoneId}`]: [zone.box[0], zone.box[1]] }
  // Nested groups move with their parent, together with their cards.
  const inside = new Set([zoneId])
  for (let grew = true; grew;) {
    grew = false
    for (const z of state.current.zones) if (z.parent && inside.has(z.parent) && !inside.has(z.id)) { inside.add(z.id); grew = true }
  }
  for (const z of state.current.zones) if (z.id !== zoneId && inside.has(z.id)) origin[`zone:${z.id}`] = [z.box[0], z.box[1]]
  for (const c of state.current.cards) if (inside.has(c.zoneId)) origin[c.node.id] = [c.box[0], c.box[1]]
  beginDrag(e, zone.title, null, origin)
}
function moveCard(e: PointerEvent) {
  const d = cardDrag!
  const p = toWorld(e.clientX, e.clientY)
  const dx = Math.round((p.x - d.start.x) / GRID) * GRID, dy = Math.round((p.y - d.start.y) / GRID) * GRID
  if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 4) return
  if (!d.moved) {
    d.moved = true
    state.userMoved = true
    world.classList.add("moving")
    layers.flow.replaceChildren()
    hideInspector()
    if (d.focus) highlight(d.focus)
  }
  const next: Positions = {}
  for (const [key, [x, y]] of Object.entries(d.origin)) next[key] = [x + dx, y + dy]
  const clash = state.current!.cards.some((c) => {
    if (c.node.id in next) return false
    return Object.entries(next).some(([key, [x, y]]) => !key.startsWith("zone:") &&
      x < c.box[0] + c.box[2] + 8 && c.box[0] < x + c.box[2] + 8 && y < c.box[1] + c.box[3] + 8 && c.box[1] < y + c.box[3] + 8)
  })
  if (clash) return
  state.positions = { ...state.positions, ...next }
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
  draw(new Set(Object.keys(d.origin).filter((k) => !k.startsWith("zone:"))))
  world.classList.remove("moving")
  highlight(null)
  commitEdit(`Moved <b>${escHtml(d.label)}</b> · ${state.current?.facts.flow ? "connections" : "interfaces"} re-routed`)
}
function commitEdit(message: string) {
  if (!state.current) return
  const edited = Object.keys(state.positions).length > 0
  state.xml = edited ? buildDrawio(state.current).xml : state.serverXml
  ui.reset.hidden = !edited
  drawFlow()
  tick(message + (state.current.unrouted.length ? ` · ${state.current.unrouted.length} could not be routed` : ""))
  void app.updateModelContext({
    content: [{ type: "text", text: edited
      ? `The user rearranged the draw.io diagram by hand (moved: ${Object.keys(moved()).map((k) => k.replace(/^zone:/, "zone ")).join(", ")}). edit_diagram keeps that arrangement.`
      : "The user reset the draw.io diagram to the automatic layout." }],
  }).catch(() => undefined)
  // The server starts the next edit from what the user sees now.
  if (state.sheet) void app.callServerTool({ name: "remember_layout", arguments: { diagram: state.sheet, positions: edited ? moved() : null } }).catch(() => undefined)
}
// Only what the user moved, not the positions the server pinned after an edit.
const moved = () => Object.fromEntries(Object.entries(state.positions).filter(([k, [x, y]]) => state.pinned[k]?.[0] !== x || state.pinned[k]?.[1] !== y))
ui.reset.onclick = () => {
  state.positions = {}
  state.pinned = {}
  draw()
  commitEdit("↺ <b>Automatic layout</b> restored")
  state.userMoved = false
  fitTo(state.current)
}

export function highlight(id: string | null) {
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

canvas.addEventListener("click", (e) => { if (!(e.target as Element).closest(".card")) hideInspector() })

// Hover, drag and click behaviour shared by architecture and flow cards.
export function bindCard(g: SVGGElement) {
  g.addEventListener("mouseenter", () => highlight(g.dataset.id!))
  g.addEventListener("mouseleave", () => highlight(null))
  g.addEventListener("pointerdown", (e) => startCardDrag(e, g.dataset.id!))
  g.addEventListener("click", (e) => { e.stopPropagation(); if (!suppressClick) showInspector(g.dataset.id!) })
}
