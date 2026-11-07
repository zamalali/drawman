import {
  FRAME_LEFT, FRAME_ORDER, FRAME_RIGHT, KIND, ORDER, OUTSIDE_LEFT, OUTSIDE_RIGHT, PLATFORMS, ZONES, frameTitle,
  type FramePlatform, type Platform, type ZoneKey,
} from "./kinds.js"
import type { Facts, Interface, Node } from "./facts.js"
import { labelNear, layoutFlow } from "./flow.js"
import { layoutSequence, type SeqLayout } from "./sequence.js"
import { textWidth } from "./text.js"
import { CARD_GAP, CARD_H, CARD_W, PAD, ZONE_HEAD, ZONE_W, type Box, type Pt } from "./metrics.js"
import { labelPos, routeEdges, type Dir } from "./router.js"

export * from "./metrics.js"
export { labelPos, routeEdges } from "./router.js"

export interface ZoneBox { id: string; key: ZoneKey; platform: Platform; title: string; fill: string; stroke: string; box: Box; parent?: string }
export interface FrameBox { platform: FramePlatform; title: string; stroke: string; font: string; box: Box }
export interface Card { node: Node; box: Box; zone: ZoneKey; zoneId: string; zoneTitle: string; platform: Platform; icon: string }
export interface LaidZone { key: ZoneKey; platform: Platform; box: Box; title: string; fill: string; stroke: string; parent?: string }
export interface Placement { zone: ZoneKey; zoneId: string; icon: string; platform: Platform }
export interface Layout {
  zones: Map<string, LaidZone>; cards: Map<string, Box>; frames: { platform: FramePlatform; box: Box }[]; place: Map<string, Placement>
  // Edge routes that came with the placement (compound layout); edges without one are routed by the A* router.
  routes?: Map<string, Pt[]>
  labels?: Map<string, Pt>
}
export interface Edge extends Interface { points: Pt[]; labelPos: number }
export interface Scene {
  facts: Facts
  zones: ZoneBox[]
  frames: FrameBox[]
  cards: Card[]
  edges: Edge[]
  width: number
  height: number
  legend: Box
  unrouted: string[]
  seq?: SeqLayout
  // The compound layout the server computed, so the live view can draw exactly the same diagram.
  placed?: SerialLayout
}

export const zoneHeight = (n: number) => ZONE_HEAD + n * CARD_H + Math.max(0, n - 1) * CARD_GAP + PAD

// The text drawn on an edge. Flow diagrams show their branch / relation label. Architecture and grouped diagrams show
// what the connection carries (label, else protocol, else a short description); the interface id only when there is
// nothing else, and the legend keeps id, protocol and description together.
export function edgeText(e: Pick<Interface, "id" | "label" | "protocol" | "description">, flow: boolean): string {
  if (flow) return e.label
  const short = e.description && e.description.length <= 28 ? e.description : ""
  return e.label || e.protocol || short || e.id
}

// A placer computes the final layout for grouped diagrams (the server registers the compound ELK layout). Without one,
// the fast built-in layout is used, which is what the live view shows while a diagram streams in.
export type Placer = (facts: Facts) => Layout | undefined
let placer: Placer | undefined
export function usePlacer(p: Placer | undefined) { placer = p }

export interface SerialLayout { zones: [string, LaidZone][]; cards: [string, Box][]; frames: Layout["frames"]; place: [string, Placement][]; routes?: [string, Pt[]][]; labels?: [string, Pt][] }
export const serialiseLayout = (l: Layout): SerialLayout => ({
  zones: [...l.zones].map(([id, z]) => [id, { ...z, box: [...z.box] as Box }]),
  cards: [...l.cards].map(([id, b]) => [id, [...b] as Box]),
  frames: l.frames.map((f) => ({ ...f, box: [...f.box] as Box })),
  place: [...l.place].map(([id, p]) => [id, { ...p }]),
  ...(l.routes ? { routes: [...l.routes].map(([id, pts]) => [id, pts.map((p) => [...p] as Pt)]) } : {}),
  ...(l.labels ? { labels: [...l.labels].map(([id, p]) => [id, [...p] as Pt]) } : {}),
})
export function restoreLayout(s: SerialLayout, facts?: Facts): Layout {
  const keep = facts ? new Set(facts.nodes.map((n) => n.id)) : null
  const cards = new Map(s.cards.filter(([id]) => !keep || keep.has(id)).map(([id, b]) => [id, [...b] as Box]))
  const place = new Map(s.place.filter(([id]) => cards.has(id)))
  // While cards are still being revealed, only groups that hold (or contain groups that hold) a visible card are shown.
  const zones = new Map(s.zones.map(([id, z]) => [id, { ...z, box: [...z.box] as Box }]))
  const used = new Set<string>()
  for (const p of place.values()) {
    let z: string | undefined = p.zoneId
    while (z && !used.has(z)) { used.add(z); z = zones.get(z)?.parent }
  }
  for (const id of [...zones.keys()]) if (!used.has(id)) zones.delete(id)
  const routes = s.routes ? new Map(s.routes.map(([id, pts]) => [id, pts.map((p) => [...p] as Pt)])) : undefined
  const labels = s.labels ? new Map(s.labels.map(([id, p]) => [id, [...p] as Pt])) : undefined
  return { zones, cards, frames: s.frames.map((f) => ({ ...f, box: [...f.box] as Box })), place, ...(routes ? { routes } : {}), ...(labels ? { labels } : {}) }
}

const zoneIdOf = (zone: ZoneKey, platform: Platform) => (platform === "neutral" ? zone : `${platform}_${zone}`)

export function layout(facts: Facts) {
  const members = new Map<string, Node[]>()
  for (const n of facts.nodes) {
    const [zone, , platform] = KIND[n.kind]
    const id = zoneIdOf(zone, platform)
    members.set(id, [...(members.get(id) ?? []), n])
  }
  for (const list of members.values()) {
    list.sort((a, b) => (ORDER[a.kind] ?? 999) - (ORDER[b.kind] ?? 999) || a.index - b.index)
  }
  const has = (id: string) => (members.get(id)?.length ?? 0) > 0
  const zones = new Map<string, LaidZone>()
  const cards = new Map<string, Box>()
  const frames: { platform: FramePlatform; box: Box }[] = []
  const top = 140

  const placeZone = (id: string, key: ZoneKey, platform: Platform, x: number, y: number) => {
    const nodes = members.get(id) ?? []
    const h = zoneHeight(nodes.length)
    zones.set(id, { key, platform, box: [x, y, ZONE_W, h], title: ZONES[key][0], fill: ZONES[key][1], stroke: ZONES[key][2] })
    nodes.forEach((n, i) => cards.set(n.id, [x + (ZONE_W - CARD_W) / 2, y + ZONE_HEAD + i * (CARD_H + CARD_GAP), CARD_W, CARD_H]))
    return h
  }

  const left = OUTSIDE_LEFT.filter((z) => has(z))
  let x = 40 + left.length * (ZONE_W + 90)
  const frameY = top
  let rightEdge = x - 90
  for (const platform of FRAME_ORDER) {
    const leftCol = FRAME_LEFT.filter((z) => has(zoneIdOf(z, platform)))
    const rightCol = FRAME_RIGHT.filter((z) => has(zoneIdOf(z, platform)))
    if (!leftCol.length && !rightCol.length) continue
    const colY = { L: frameY + 60, R: frameY + 60 }
    for (const z of leftCol) colY.L += placeZone(zoneIdOf(z, platform), z, platform, x + 30, colY.L) + 40
    const rx = leftCol.length ? x + 30 + ZONE_W + 110 : x + 30
    for (const z of rightCol) colY.R += placeZone(zoneIdOf(z, platform), z, platform, rx, colY.R) + 40
    const cols = (leftCol.length ? 1 : 0) + (rightCol.length ? 1 : 0)
    const w = cols === 2 ? 2 * ZONE_W + 170 : ZONE_W + 60
    frames.push({ platform, box: [x, frameY, w, Math.max(colY.L, colY.R) - frameY] })
    rightEdge = x + w
    x += w + 90
  }
  left.forEach((z, i) => placeZone(z, z, "neutral", 40 + i * (ZONE_W + 90), frameY + 60))
  let ry = frameY + 60
  const rx = rightEdge + 90
  for (const z of OUTSIDE_RIGHT) if (has(z)) ry += placeZone(z, z, "neutral", rx, ry) + 30
  const place = new Map<string, Placement>(facts.nodes.map((n) => {
    const [zone, icon, platform] = KIND[n.kind]
    return [n.id, { zone, zoneId: zoneIdOf(zone, platform), icon, platform }]
  }))
  return { zones, cards, frames, place } satisfies Layout
}

export type Positions = Record<string, Pt>

const hit = (a: Box, b: Box, gap = 0) =>
  a[0] < b[0] + b[2] + gap && b[0] < a[0] + a[2] + gap && a[1] < b[1] + b[3] + gap && b[1] < a[1] + a[3] + gap

function applyPositions(positions: Positions, out: Layout) {
  const { zones, cards, frames, place } = out
  const zoneOfNode = new Map([...place].map(([id, p]) => [id, p.zoneId]))
  const platformOf = new Map([...place].map(([id, p]) => [id, p.platform]))
  for (const [key, [x, y]] of Object.entries(positions)) {
    if (key.startsWith("zone:")) {
      const z = zones.get(key.slice(5))
      if (z) z.box = [Math.max(40, x), Math.max(130, y), z.box[2], z.box[3]]
      continue
    }
    const box = cards.get(key)
    if (box) cards.set(key, [Math.max(60, x), Math.max(170, y), box[2], box[3]])
  }
  const grow = (box: Box, [x0, y0, x1, y1]: [number, number, number, number]): Box => {
    const nx = Math.min(box[0], x0), ny = Math.min(box[1], y0)
    return [nx, ny, Math.max(box[0] + box[2], x1) - nx, Math.max(box[1] + box[3], y1) - ny]
  }
  const side = (ZONE_W - CARD_W) / 2
  const ancestorsOf = (id: string) => {
    const out = new Set<string>()
    let p = zones.get(id)?.parent
    while (p && !out.has(p)) { out.add(p); p = zones.get(p)?.parent }
    return out
  }
  const related = (a: string, b: string) => ancestorsOf(a).has(b) || ancestorsOf(b).has(a)
  const within = (cardZone: string | undefined, id: string) => !!cardZone && (cardZone === id || ancestorsOf(cardZone).has(id))
  for (const [id, z] of zones) {
    let box = z.box
    for (const [cid, [x, y, w, h]] of cards) {
      if (zoneOfNode.get(cid) !== id) continue
      const next = grow(box, [x - side, y - ZONE_HEAD, x + w + side, y + h + PAD])
      const blocked = [...zones].some(([o, oz]) => o !== id && !related(o, id) && hit(next, oz.box, 10)) ||
        [...cards].some(([o, ob]) => !within(zoneOfNode.get(o), id) && hit(next, ob, 4))
      if (!blocked) box = next
    }
    z.box = box
  }
  // Nested groups: a parent grows to keep every child group inside it (deepest first).
  const depth = (id: string) => ancestorsOf(id).size
  for (const id of [...zones.keys()].sort((a, b) => depth(b) - depth(a))) {
    const z = zones.get(id)!
    const parent = z.parent ? zones.get(z.parent) : undefined
    if (!parent) continue
    const [x, y, w, h] = z.box
    parent.box = grow(parent.box, [x - side, y - ZONE_HEAD, x + w + side, y + h + PAD])
  }
  for (const f of frames) {
    let box = f.box
    const want: Box[] = [
      ...[...zones.values()].filter((z) => z.platform === f.platform).map((z) => z.box),
      ...[...cards].filter(([cid]) => platformOf.get(cid) === f.platform).map(([, b]) => b),
    ]
    for (const [x, y, w, h] of want) {
      const next = grow(box, [x - 30, y - 60, x + w + 30, y + h + 40])
      if (!frames.some((o) => o !== f && hit(next, o.box, 20))) box = next
    }
    f.box = box
  }
}

export const GROUP_PALETTE: ZoneKey[] = ["runtime", "data", "ai", "integration", "build", "edge", "secops", "consumers", "egress", "cicd", "external"]

// Fast layout for grouped diagrams: one column per dependency rank, each group a stack of cards. Ungrouped cards form
// columns of their own with no container. Nested groups are shown flat here; the compound placer draws the nesting.
export function layoutGroups(facts: Facts): Layout {
  const declared = [...(facts.groups ?? [])]
  for (const n of facts.nodes) if (n.group && !declared.some((g) => g.id === n.group)) declared.push({ id: n.group, title: n.group === "other" ? "" : n.group.replace(/_/g, " ") })
  if (facts.nodes.some((n) => !n.group)) declared.push({ id: "", title: "" })
  const used = declared.filter((g) => facts.nodes.some((n) => (n.group ?? "") === g.id))
  const order = new Map(used.map((g, i) => [g.id, i]))
  const groupOf = new Map(facts.nodes.map((n) => [n.id, n.group ?? ""]))
  const rank = new Map(used.map((g) => [g.id, 0]))
  const deps = facts.interfaces.map((i) => [groupOf.get(i.from)!, groupOf.get(i.to)!] as const)
    .filter(([a, b]) => a !== b && order.get(a)! < order.get(b)!)
  for (let pass = 0; pass < used.length; pass++) {
    let changed = false
    for (const [a, b] of deps) if (rank.get(b)! < rank.get(a)! + 1) { rank.set(b, rank.get(a)! + 1); changed = true }
    if (!changed) break
  }
  const zones = new Map<string, LaidZone>()
  const cards = new Map<string, Box>()
  const place = new Map<string, Placement>()
  const columnY = new Map<number, number>()
  used.forEach((g, i) => {
    const r = rank.get(g.id)!
    const key = GROUP_PALETTE[i % GROUP_PALETTE.length]
    const members = facts.nodes.filter((n) => (n.group ?? "") === g.id)
    const x = 40 + r * (ZONE_W + 110), y = columnY.get(r) ?? 140
    const h = zoneHeight(members.length)
    const zoneId = g.id ? `g_${g.id}` : ""
    if (zoneId) zones.set(zoneId, { key, platform: "neutral", box: [x, y, ZONE_W, h], title: g.title, fill: ZONES[key][1], stroke: ZONES[key][2] })
    members.forEach((n, j) => {
      cards.set(n.id, [x + (ZONE_W - CARD_W) / 2, y + ZONE_HEAD + j * (CARD_H + CARD_GAP), CARD_W, CARD_H])
      place.set(n.id, { zone: zoneId ? key : "external", zoneId, icon: n.icon ?? "g_process", platform: "neutral" })
    })
    columnY.set(r, y + h + 40)
  })
  return { zones, cards, frames: [], place }
}

export interface Reroute { moved: Set<string>; previous: Map<string, Pt[]> }

export function buildScene(facts: Facts, positions?: Positions, reroute?: Reroute, base?: SerialLayout): Scene {
  if (facts.sequence) return layoutSequence(facts)
  const placedBy = !base && !facts.flow ? placer?.(facts) : undefined
  const placed = placedBy ? serialiseLayout(placedBy) : undefined
  const laid: Layout = base ? restoreLayout(base, facts) : placedBy ?? (facts.flow ? layoutFlow(facts) : facts.groups ? layoutGroups(facts) : layout(facts))
  if (positions && Object.keys(positions).length) applyPositions(positions, laid)
  const { zones, cards, frames, place } = laid
  const boxes = [...[...zones.values()].map((z) => z.box), ...frames.map((f) => f.box), ...cards.values()]
  const right = boxes.length ? Math.max(...boxes.map(([x, , w]) => x + w)) : 600
  const bottom = boxes.length ? Math.max(...boxes.map(([, y, , h]) => y + h)) : 300
  const edgesIn = facts.interfaces.filter((i) => cards.has(i.from) && cards.has(i.to) && i.from !== i.to)
  const keep = reroute ? edgesIn.filter((e) => !reroute.moved.has(e.from) && !reroute.moved.has(e.to) && reroute.previous.has(e.id)) : []
  const keepIds = new Set(keep.map((e) => e.id))
  const decisions = facts.flow ? new Set(facts.nodes.filter((n) => ["decision", "choice", "initial", "final"].includes(n.shape ?? "")).map((n) => n.id)) : undefined
  let sides: Map<string, [Dir[], Dir[]]> | undefined
  if (facts.flow && (facts.flow.family === "class" || facts.flow.family === "er")) {
    const tb = facts.flow.direction === "TB" || facts.flow.direction === "BT"
    sides = new Map()
    for (const e of edgesIn) {
      if (facts.flow.family === "class" && (e.rel === "association" || e.rel === "dependency")) continue
      const [ax, ay, aw, ah] = cards.get(e.from)!, [bx, by, bw, bh] = cards.get(e.to)!
      const below = tb ? by > ay + ah : bx > ax + aw, above = tb ? by + bh < ay : bx + bw < ax
      if (below) sides.set(e.id, tb ? [["B"], ["T"]] : [["R"], ["L"]])
      else if (above) sides.set(e.id, tb ? [["T"], ["B"]] : [["L"], ["R"]])
    }
  }
  const moved = new Set(Object.keys(positions ?? {}))
  const crossesCard = (pts: Pt[], e: Interface) => [...cards].some(([id, [x, y, w, h]]) => id !== e.from && id !== e.to &&
    pts.slice(1).some((b, i) => {
      const a = pts[i]
      return Math.max(a[0], b[0]) > x + 1 && Math.min(a[0], b[0]) < x + w - 1 && Math.max(a[1], b[1]) > y + 1 && Math.min(a[1], b[1]) < y + h - 1
    }))
  const preset = new Map<string, Pt[]>()
  for (const e of edgesIn) {
    const pts = laid.routes?.get(e.id)
    if (pts && !keepIds.has(e.id) && !moved.has(e.from) && !moved.has(e.to) && !crossesCard(pts, e)) preset.set(e.id, pts)
  }
  const { routes, failed } = routeEdges(edgesIn.filter((e) => !keepIds.has(e.id) && !preset.has(e.id)), cards, zones, [0, 110, right + 40, bottom + 30],
    facts.flow ? { exact: decisions, straightFirst: true, crossCost: 120, refine: 2, centrePull: 8, sides } : { crossCost: 60 })
  for (const [id, pts] of preset) routes.set(id, pts)
  for (const e of keep) routes.set(e.id, reroute!.previous.get(e.id)!)
  // Self-loops (a node that talks to itself, a self-referencing table) leave and re-enter the card's right side.
  for (const e of facts.interfaces) {
    if (e.from !== e.to || !cards.has(e.from)) continue
    const [x, y, w, h] = cards.get(e.from)!
    const top = y + Math.round(h * 0.3), low = y + Math.round(h * 0.7)
    routes.set(e.id, [[x + w, top], [x + w + 30, top], [x + w + 30, low], [x + w, low]])
  }
  const width = right + 40
  const edges: Edge[] = facts.interfaces.filter((e) => routes.has(e.id) && cards.has(e.from) && cards.has(e.to)).map((e) => {
    const points = routes.get(e.id)!
    const near = facts.flow && e.label && facts.nodes.find((n) => n.id === e.from)?.shape === "decision"
    const reserved = preset.has(e.id) ? laid.labels?.get(e.id) : undefined
    return { ...e, points, labelPos: near ? labelNear(points, 18 + textWidth(e.label, 11) / 2) : reserved ? relAt(points, reserved) : labelPos(points) }
  })
  const legendRows = facts.flow ? 0 : edges.length
  placeLabels(edges, [...cards.values()], decisions ?? new Set(), (e) => edgeText(e, !!facts.flow), facts.flow ? 11 : 10,
    new Set(edges.filter((e) => preset.has(e.id) && laid.labels?.has(e.id)).map((e) => e.id)))
  return {
    facts,
    zones: [...zones].map(([id, z]) => ({ id, key: z.key, platform: z.platform, title: z.title, fill: z.fill, stroke: z.stroke, box: z.box, ...(z.parent ? { parent: z.parent } : {}) })),
    frames: frames.map((f) => ({
      platform: f.platform, ...PLATFORMS[f.platform], box: f.box,
      title: frameTitle(f.platform, facts.nodes.filter((n) => place.get(n.id)?.platform === f.platform).map((n) => n.kind)),
    })),
    cards: facts.nodes.filter((n) => cards.has(n.id)).map((n) => {
      const p = place.get(n.id)!
      return { node: n, box: cards.get(n.id)!, zone: p.zone, zoneId: p.zoneId, zoneTitle: zones.get(p.zoneId)?.title ?? "", platform: p.platform, icon: p.icon }
    }),
    edges,
    width,
    height: legendRows ? bottom + 40 + 50 + 22 * legendRows + 40 : bottom + 40,
    legend: [40, bottom + 40, width - 80, legendRows ? 50 + 22 * legendRows : 0],
    unrouted: failed,
    ...(placed ? { placed } : {}),
  }
}

// Relative position (-1..1, draw.io's edge-label convention) of the point on the route closest to p.
export function relAt(points: Pt[], p: Pt): number {
  const segs = points.slice(1).map((b, i) => Math.abs(b[0] - points[i][0]) + Math.abs(b[1] - points[i][1]))
  const total = segs.reduce((s, v) => s + v, 0) || 1
  let best = 0, bestD = Infinity, walked = 0
  segs.forEach((len, i) => {
    const [a, b] = [points[i], points[i + 1]]
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len))) : 0
    const q: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    const d = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (d < bestD) { bestD = d; best = walked + len * t }
    walked += len
  })
  return (2 * best) / total - 1
}

export function pointAt(points: Pt[], rel: number): Pt {
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

// Puts each edge label where it touches no card, no other label and no other edge, trying the long segments first;
// when no spot is completely clear, the one with the fewest conflicts wins. Labels whose place was reserved by the
// layout (keep) stay where they are.
function placeLabels(edges: Edge[], cards: Box[], decisions: Set<string>, text: (e: Edge) => string, size: number, keep = new Set<string>()) {
  const placed: Box[] = []
  const boxAt = (e: Edge, rel: number, w: number, h: number): Box => { const [x, y] = pointAt(e.points, rel); return [x - w / 2, y - h / 2, w, h] }
  for (const e of edges) {
    const label = text(e)
    if (label && keep.has(e.id)) placed.push(boxAt(e, e.labelPos, textWidth(label, size) + 12, 16))
  }
  const crosses = (box: Box, own: Edge) => edges.reduce((n, o) => o === own ? n : n + o.points.slice(1).filter((b, i) => {
    const a = o.points[i]
    return Math.max(a[0], b[0]) > box[0] && Math.min(a[0], b[0]) < box[0] + box[2] && Math.max(a[1], b[1]) > box[1] && Math.min(a[1], b[1]) < box[1] + box[3]
  }).length, 0)
  for (const e of edges) {
    const label = text(e)
    if (!label || keep.has(e.id)) continue
    const w = textWidth(label, size) + 12, h = 16
    const segs = e.points.slice(1).map((b, i) => Math.abs(b[0] - e.points[i][0]) + Math.abs(b[1] - e.points[i][1]))
    const total = segs.reduce((s, v) => s + v, 0) || 1
    const rel = (d: number) => (2 * Math.max(0, Math.min(total, d))) / total - 1
    const cands: number[] = []
    if (decisions.has(e.from)) for (const d of [18 + w / 2, 34 + w / 2, 56 + w / 2]) cands.push(Math.min(0, rel(Math.min(d, total / 2))))
    cands.push(e.labelPos)
    const starts = segs.map((_, i) => segs.slice(0, i).reduce((s, v) => s + v, 0))
    for (const i of segs.map((_, i) => i).sort((a, b) => segs[b] - segs[a])) {
      for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) cands.push(rel(starts[i] + segs[i] * f))
    }
    let chosen = cands[0], fewest = Infinity
    for (const c of cands) {
      const box = boxAt(e, c, w, h)
      const conflicts = 10 * (cards.filter((b) => hit(box, b, 2)).length + placed.filter((b) => hit(box, b, 2)).length) + crosses(box, e)
      if (conflicts < fewest) { fewest = conflicts; chosen = c }
      if (!conflicts) break
    }
    e.labelPos = chosen
    placed.push(boxAt(e, chosen, w, h))
  }
}

export function checkLayout(scene: Scene) {
  const b = scene.cards
  for (let i = 0; i < b.length; i++) {
    for (let j = i + 1; j < b.length; j++) {
      const [ax, ay, aw, ah] = b[i].box, [bx, by, bw, bh] = b[j].box
      if (ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah) {
        throw new Error(`layout overlap between ${b[i].node.id} and ${b[j].node.id}`)
      }
    }
  }
}
