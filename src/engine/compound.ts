// Compound layout: ELK's layered algorithm places cards inside (nested) groups with real crossing minimisation and
// routes the edges with room reserved for their labels; Drawman draws everything with its own styling and icons.
// Used for user-defined groups (create_diagram, and the architecture tool when containers are named). Runs on the server;
// the live view gets the result through the tool result.
import type { Facts } from "./facts.js"
import { ZONES } from "./kinds.js"
import { CARD_H, CARD_W, GRID, PAD, ZONE_HEAD, ZONE_W, type Box, type Pt } from "./metrics.js"
import { GROUP_PALETTE, edgeText, type LaidZone, type Layout, type Placement } from "./scene.js"
import { textWidth } from "./text.js"
import { elkLayout, type ElkEdge, type ElkNode } from "./elk.js"

const ORIGIN: [number, number] = [40, 140]
const SIDE = (ZONE_W - CARD_W) / 2
const FRAME_PAD = { top: 60, side: 30, bottom: 30 }

interface TreeGroup { id: string; title: string; parent?: string; frame?: boolean }
interface Tree { groups: TreeGroup[]; member: Map<string, string | undefined>; facts: Facts }
interface Placed { cards: Map<string, Box>; groups: Map<string, Box>; routes: Map<string, Pt[]>; labels: Map<string, Pt> }

function graphFor(t: Tree, direction: "DOWN" | "RIGHT", extra: Record<string, string>): ElkNode {
  const known = new Set(t.groups.map((g) => g.id))
  const kids = new Map<string, ElkNode[]>([["", []]])
  const holder = (id: string) => { if (!kids.has(id)) kids.set(id, []); return kids.get(id)! }
  for (const g of t.groups) {
    const [top, side, bottom] = g.frame ? [FRAME_PAD.top, FRAME_PAD.side, FRAME_PAD.bottom] : [ZONE_HEAD + 6, SIDE, PAD]
    holder(g.parent && known.has(g.parent) ? g.parent : "").push({
      id: `g:${g.id}`,
      layoutOptions: {
        "elk.padding": `[top=${top},left=${side},bottom=${bottom},right=${side}]`,
        "elk.nodeSize.constraints": "MINIMUM_SIZE",
        "elk.nodeSize.minimum": `(${Math.max(g.frame ? 0 : ZONE_W, Math.ceil(textWidth(g.title, g.frame ? 13 : 12) + 48))}, ${ZONE_HEAD + CARD_H + PAD})`,
      },
      children: holder(g.id),
    })
  }
  for (const n of t.facts.nodes) {
    const g = t.member.get(n.id)
    holder(g && known.has(g) ? g : "").push({ id: n.id, width: CARD_W, height: CARD_H })
  }
  const ids = new Set(t.facts.nodes.map((n) => n.id))
  const edges: ElkEdge[] = t.facts.interfaces.filter((i) => i.from !== i.to && ids.has(i.from) && ids.has(i.to)).map((i) => {
    const text = edgeText(i, false)
    return { id: i.id, sources: [i.from], targets: [i.to], labels: text ? [{ text, width: Math.ceil(textWidth(text, 10)) + 12, height: 16 }] : [] }
  })
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "70",
      "elk.spacing.edgeNode": "30",
      "elk.spacing.edgeEdge": "20",
      "elk.layered.spacing.edgeNodeBetweenLayers": "30",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "20",
      "elk.layered.crossingMinimization.thoroughness": "24",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.separateConnectedComponents": "false",
      "elk.json.shapeCoords": "ROOT",
      "elk.json.edgeCoords": "ROOT",
      // Edge text sits on the edge; ELK reserves room for it between layers.
      "elk.edgeLabels.inline": "true",
      "elk.edgeLabels.placement": "CENTER",
      ...extra,
    },
    children: kids.get("")!,
    edges,
  }
}

type Seg = [number, number, number, number]
function crossings(root: ElkNode): number {
  const segs: [string, Seg][] = []
  const walk = (n: ElkNode) => {
    for (const e of n.edges ?? []) for (const s of e.sections ?? []) {
      const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]
      for (let i = 1; i < pts.length; i++) segs.push([e.id, [pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y]])
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(root)
  let n = 0
  for (let i = 0; i < segs.length; i++) {
    const [ea, [ax1, ay1, ax2, ay2]] = segs[i]
    const ah = ay1 === ay2
    for (let j = i + 1; j < segs.length; j++) {
      const [eb, [bx1, by1, bx2, by2]] = segs[j]
      if (ea === eb || ah === (by1 === by2)) continue
      const [h, v] = ah ? [[ax1, ay1, ax2], [bx1, by1, by2]] : [[bx1, by1, bx2], [ax1, ay1, ay2]]
      const [hx1, hy, hx2] = h, [vx, vy1, vy2] = v
      if (Math.min(hx1, hx2) < vx && vx < Math.max(hx1, hx2) && Math.min(vy1, vy2) < hy && hy < Math.max(vy1, vy2)) n++
    }
  }
  return n
}

// Fewer crossings first; between near-equal candidates prefer a landscape page close to 16:10.
function score(root: ElkNode): number {
  const w = root.width ?? 1, h = root.height ?? 1
  return crossings(root) * 100 + Math.abs(Math.log((w / h) / 1.6)) * 60 + (w * h) / 40000
}

// Snaps cards and groups to the 10 px grid (so rows and columns line up exactly) and moves each route's ends with their
// cards, keeping every segment horizontal or vertical.
function snapToGrid(p: Placed, ends: Map<string, [string, string]>) {
  const delta = new Map<string, Pt>()
  for (const [id, [x, y, w, h]] of p.cards) {
    const nx = Math.round(x / GRID) * GRID, ny = Math.round(y / GRID) * GRID
    delta.set(id, [nx - x, ny - y])
    p.cards.set(id, [nx, ny, w, h])
  }
  for (const [id, [x, y, w, h]] of p.groups) {
    const x0 = Math.floor(x / GRID) * GRID, y0 = Math.floor(y / GRID) * GRID
    p.groups.set(id, [x0, y0, Math.ceil((x + w) / GRID) * GRID - x0, Math.ceil((y + h) / GRID) * GRID - y0])
  }
  for (const [id, pts] of p.routes) {
    const [from, to] = ends.get(id) ?? ["", ""]
    const ds = delta.get(from) ?? [0, 0], dt = delta.get(to) ?? [0, 0]
    // ELK may emit collinear intermediate points (e.g. around a label); drop them so only real corners move.
    const q: Pt[] = []
    for (const v of pts) {
      const last = q[q.length - 1]
      if (last && last[0] === v[0] && last[1] === v[1]) continue
      if (q.length >= 2) {
        const a = q[q.length - 2]
        if ((a[0] === last[0] && last[0] === v[0]) || (a[1] === last[1] && last[1] === v[1])) q.pop()
      }
      q.push([...v] as Pt)
    }
    const n = q.length
    if (n < 2) continue
    const vFirst = q[0][0] === q[1][0], vLast = q[n - 1][0] === q[n - 2][0]
    if (n === 2) {
      q[0] = [q[0][0] + ds[0], q[0][1] + ds[1]]
      q[1] = [q[1][0] + dt[0], q[1][1] + dt[1]]
      if (vFirst && q[0][0] !== q[1][0]) { const my = Math.round((q[0][1] + q[1][1]) / 2); q.splice(1, 0, [q[0][0], my], [q[1][0], my]) }
      else if (!vFirst && q[0][1] !== q[1][1]) { const mx = Math.round((q[0][0] + q[1][0]) / 2); q.splice(1, 0, [mx, q[0][1]], [mx, q[1][1]]) }
    } else {
      q[0] = [q[0][0] + ds[0], q[0][1] + ds[1]]
      if (vFirst) q[1][0] += ds[0]; else q[1][1] += ds[1]
      q[n - 1] = [q[n - 1][0] + dt[0], q[n - 1][1] + dt[1]]
      if (vLast) q[n - 2][0] += dt[0]; else q[n - 2][1] += dt[1]
    }
    const clean: Pt[] = []
    for (const v of q) {
      const last = clean[clean.length - 1]
      if (last && last[0] === v[0] && last[1] === v[1]) continue
      if (clean.length >= 2) {
        const a = clean[clean.length - 2]
        if ((a[0] === last[0] && last[0] === v[0]) || (a[1] === last[1] && last[1] === v[1])) clean.pop()
      }
      clean.push(v)
    }
    if (clean.slice(1).every((b, i) => b[0] === clean[i][0] || b[1] === clean[i][1])) p.routes.set(id, clean)
    else p.routes.delete(id)
  }
}

function place(t: Tree, options: Record<string, string>): Placed {
  let best: ElkNode | null = null, bestScore = Infinity
  for (const dir of ["DOWN", "RIGHT"] as const) {
    const out = elkLayout(graphFor(t, dir, options))
    const s = score(out)
    if (s < bestScore) { best = out; bestScore = s }
  }
  const p: Placed = { cards: new Map(), groups: new Map(), routes: new Map(), labels: new Map() }
  const at = (x: number, y: number): Pt => [Math.round(x + ORIGIN[0]), Math.round(y + ORIGIN[1])]
  const walk = (n: ElkNode) => {
    for (const e of n.edges ?? []) {
      const s = e.sections?.[0]
      if (s && e.sections!.length === 1) p.routes.set(e.id, [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((v) => at(v.x, v.y)))
      const lb = e.labels?.[0]
      if (lb?.x != null && lb.y != null) p.labels.set(e.id, at(lb.x + lb.width / 2, lb.y + lb.height / 2))
    }
    for (const c of n.children ?? []) {
      const [x, y] = at(c.x ?? 0, c.y ?? 0)
      if (c.id.startsWith("g:")) {
        p.groups.set(c.id.slice(2), [x, y, Math.round(c.width ?? 0), Math.round(c.height ?? 0)])
        walk(c)
      } else p.cards.set(c.id, [x, y, CARD_W, CARD_H])
    }
  }
  walk(best!)
  snapToGrid(p, new Map(t.facts.interfaces.map((i) => [i.id, [i.from, i.to] as [string, string]])))
  return p
}

const depthIn = (groups: TreeGroup[]) => {
  const parent = new Map(groups.map((g) => [g.id, g.parent]))
  return (id: string) => { let d = 0, q = parent.get(id); while (q && d < 50) { d++; q = parent.get(q) } return d }
}

// create_diagram, and the architecture tool when the user names containers.
export function layoutCompound(facts: Facts, options: Record<string, string> = {}): Layout {
  const groups: TreeGroup[] = (facts.groups ?? []).map((g) => ({ id: g.id, title: g.title, ...(g.parent ? { parent: g.parent } : {}) }))
  for (const n of facts.nodes) if (n.group && !groups.some((g) => g.id === n.group)) groups.push({ id: n.group, title: n.group.replace(/_/g, " ") })
  const p = place({ groups, member: new Map(facts.nodes.map((n) => [n.id, n.group])), facts }, options)
  const order = new Map<string, number>()
  for (const n of facts.nodes) if (n.group && !order.has(n.group)) order.set(n.group, order.size)
  for (const g of groups) if (!order.has(g.id)) order.set(g.id, order.size)
  const depth = depthIn(groups)
  const zones = new Map<string, LaidZone>()
  for (const g of groups.filter((g) => p.groups.has(g.id)).sort((a, b) => depth(a.id) - depth(b.id) || order.get(a.id)! - order.get(b.id)!)) {
    const key = GROUP_PALETTE[order.get(g.id)! % GROUP_PALETTE.length]
    zones.set(`g_${g.id}`, {
      key, platform: "neutral", box: p.groups.get(g.id)!, title: g.title, fill: ZONES[key][1], stroke: ZONES[key][2],
      ...(g.parent && p.groups.has(g.parent) ? { parent: `g_${g.parent}` } : {}),
    })
  }
  const placed = new Map<string, Placement>()
  for (const n of facts.nodes) {
    if (!p.cards.has(n.id)) continue
    const zoneId = n.group && zones.has(`g_${n.group}`) ? `g_${n.group}` : ""
    placed.set(n.id, { zone: zoneId ? zones.get(zoneId)!.key : "external", zoneId, icon: n.icon ?? "g_process", platform: "neutral" })
  }
  return { zones, cards: p.cards, frames: [], place: placed, routes: p.routes, labels: p.labels }
}

// Grouped diagrams get the compound layout; the architecture tool's kind zones keep their designed column layout.
export function layoutPlaced(facts: Facts): Layout | undefined {
  if (facts.flow || facts.sequence || !facts.groups) return undefined
  return layoutCompound(facts)
}
