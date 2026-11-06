// DOM handles and small SVG/HTML helpers shared by every part of the view.
export const SVG = "http://www.w3.org/2000/svg"
export const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T
export const world = $<SVGGElement>("#world")
export const canvas = $<SVGSVGElement>("#canvas")
export const layers = {
  title: $<SVGGElement>("#layer-title"), frame: $<SVGGElement>("#layer-frame"), zones: $<SVGGElement>("#layer-zones"),
  seq: $<SVGGElement>("#layer-seq"),
  edges: $<SVGGElement>("#layer-edges"), cards: $<SVGGElement>("#layer-cards"), labels: $<SVGGElement>("#layer-labels"),
  flow: $<SVGGElement>("#layer-flow"), legend: $<SVGGElement>("#layer-legend"),
}
export const ui = {
  title: $<HTMLElement>("#title"), subtitle: $<HTMLElement>("#subtitle"), status: $<HTMLElement>("#status"),
  statusText: $<HTMLElement>("#status-text"), empty: $<HTMLElement>("#empty"), ticker: $<HTMLOListElement>("#ticker"),
  inspector: $<HTMLElement>("#inspector"), suggest: $<HTMLElement>("#suggest"), insights: $<HTMLElement>("#insights"),
  download: $<HTMLButtonElement>("#download"), open: $<HTMLButtonElement>("#open"), fit: $<HTMLButtonElement>("#fit"),
  flow: $<HTMLButtonElement>("#flow"), fullscreen: $<HTMLButtonElement>("#fullscreen"), reset: $<HTMLButtonElement>("#reset"),
}

export const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) => {
  const node = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  parent?.appendChild(node)
  return node
}
export const dataUri = (image: string) => image.replace(/^data:([^,;]+),/, "data:$1;base64,")

export const measure = document.createElement("canvas").getContext("2d")!
export function fit(text: string, font: string, max: number) {
  measure.font = font
  if (measure.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && measure.measureText(s + "…").width > max) s = s.slice(0, -1)
  return s.trimEnd() + "…"
}

export function keyed<T extends SVGElement>(layer: SVGGElement, key: string, make: () => T) {
  let node = layer.querySelector<T>(`[data-key="${CSS.escape(key)}"]`)
  if (!node) {
    node = make()
    node.dataset.key = key
    layer.appendChild(node)
  }
  node.dataset.live = "1"
  return node
}
export function sweep(layer: SVGGElement) {
  for (const node of Array.from(layer.children) as SVGElement[]) {
    if (node.dataset.live) delete node.dataset.live
    else node.remove()
  }
}

export function tick(html: string) {
  const li = document.createElement("li")
  li.innerHTML = html
  ui.ticker.appendChild(li)
  for (const old of Array.from(ui.ticker.children).slice(0, -1)) old.classList.add("old")
  while (ui.ticker.children.length > 5) ui.ticker.firstElementChild!.remove()
}
export const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

export function setStatus(kind: "waiting" | "building" | "done" | "error", text: string) {
  ui.status.className = `status ${kind}`
  ui.statusText.textContent = text
}
