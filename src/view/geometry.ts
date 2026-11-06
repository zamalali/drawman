// Pure path geometry for edges and flowchart / UML shapes.
import { isCompartment, type Edge, type Pt, type Scene } from "../engine/index.js"

export function roundedPath(points: Pt[], r = 7) {
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

export function flowPath(shape: string, w: number, h: number) {
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

export function flowDeco(shape: string, w: number, h: number, head = 0, split = 0) {
  if (shape === "database") return `M0,8 A${w / 2},8 0 0 0 ${w},8`
  if (shape === "subprocess") return `M10,0 V${h} M${w - 10},0 V${h}`
  if (isCompartment(shape)) return `M0,${head} H${w}${split ? ` M0,${split} H${w}` : ""}`
  return ""
}

export function markers(scene: Scene, e: Edge): [string, string] {
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
