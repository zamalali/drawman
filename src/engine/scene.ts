import {
  FRAME_LEFT, FRAME_ORDER, FRAME_RIGHT, KIND, ORDER, OUTSIDE_LEFT, OUTSIDE_RIGHT, PLATFORMS, ZONES, frameTitle,
  type FramePlatform, type Platform, type ZoneKey,
} from "./kinds.js"
import type { Facts, Interface, Node } from "./facts.js"
import { labelNear, layoutFlow } from "./flow.js"
import { layoutSequence, type SeqLayout } from "./sequence.js"
import { textWidth } from "./text.js"

export type Box = [x: number, y: number, w: number, h: number]
export type Pt = [x: number, y: number]

export const CARD_W = 236, CARD_H = 58, CARD_GAP = 16, ZONE_W = 276, ZONE_HEAD = 40, PAD = 20
export const GRID = 10
const DIRS = { R: [1, 0], L: [-1, 0], B: [0, 1], T: [0, -1] } as const
type Dir = keyof typeof DIRS
const BEND = 45, OVERLAP = 60, CROSS = 8, HEADER = 12, PORT_REUSE = 400, FOREIGN_ZONE = 6
const INWARD: Record<Dir, Dir> = { R: "L", L: "R", T: "B", B: "T" }

export interface ZoneBox { id: string; key: ZoneKey; platform: Platform; title: string; fill: string; stroke: string; box: Box }
export interface FrameBox { platform: FramePlatform; title: string; stroke: string; font: string; box: Box }
export interface Card { node: Node; box: Box; zone: ZoneKey; zoneId: string; zoneTitle: string; platform: Platform; icon: string }
export interface LaidZone { key: ZoneKey; platform: Platform; box: Box; title: string; fill: string; stroke: string }
export interface Placement { zone: ZoneKey; zoneId: string; icon: string; platform: Platform }
export interface Layout { zones: Map<string, LaidZone>; cards: Map<string, Box>; frames: { platform: FramePlatform; box: Box }[]; place: Map<string, Placement> }
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
}

export const zoneHeight = (n: number) => ZONE_HEAD + n * CARD_H + Math.max(0, n - 1) * CARD_GAP + PAD

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

function ports(box: Box, used: Map<string, number>, exact = false, pull = 1, allowed?: Dir[]) {
  const [x, y, w, h] = box
  const out: { stub: Pt; boundary: Pt; side: Dir; pen: number }[] = []
  for (const side of (allowed ?? Object.keys(DIRS)) as Dir[]) {
    const [dx, dy] = DIRS[side]
    if (dx) {
      const edge = dx > 0 ? x + w : x
      const sx = dx > 0 ? (Math.floor((edge + GRID) / GRID) + 1) * GRID : Math.floor((edge - GRID) / GRID) * GRID
      const span: number[] = []
      for (let v = (Math.floor(y / GRID) + 1) * GRID; v < Math.trunc(y + h); v += GRID) if (y + 12 <= v && v <= y + h - 12) span.push(v)
      const centre = y + h / 2
      for (const v of span.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre)).slice(0, exact ? 1 : 3)) {
        out.push({ stub: [sx, v], boundary: [edge, v], side, pen: Math.abs(v - centre) * 0.4 * pull + PORT_REUSE * (used.get(`${sx},${v}`) ?? 0) })
      }
    } else {
      const edge = dy > 0 ? y + h : y
      const sy = dy > 0 ? (Math.floor((edge + GRID) / GRID) + 1) * GRID : Math.floor((edge - GRID) / GRID) * GRID
      const span: number[] = []
      for (let v = (Math.floor(x / GRID) + 1) * GRID; v < Math.trunc(x + w); v += GRID) if (x + 40 <= v && v <= x + w - 20) span.push(v)
      const centre = x + w / 2
      for (const v of span.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre)).slice(0, exact ? 1 : 7)) {
        out.push({ stub: [v, sy], boundary: [v, edge], side, pen: Math.abs(v - centre) * 0.15 * pull + PORT_REUSE * (used.get(`${v},${sy}`) ?? 0) })
      }
    }
  }
  return out
}

interface HeapItem { f: number; g: number; goal: boolean; x: number; y: number; d: string; seq: number }
class Heap {
  private a: HeapItem[] = []
  private seq = 0
  get size() { return this.a.length }
  private less(p: HeapItem, q: HeapItem) {
    return p.f !== q.f ? p.f < q.f : p.g !== q.g ? p.g < q.g : p.x !== q.x ? p.x < q.x : p.y !== q.y ? p.y < q.y : p.seq < q.seq
  }
  push(item: Omit<HeapItem, "seq">) {
    const a = this.a
    a.push({ ...item, seq: this.seq++ })
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]]
      i = p
    }
  }
  pop(): HeapItem {
    const a = this.a
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < a.length && this.less(a[l], a[m])) m = l
        if (r < a.length && this.less(a[r], a[m])) m = r
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]
        i = m
      }
    }
    return top
  }
}

const k = (x: number, y: number) => `${x},${y}`

export function routeEdges(
  edges: Interface[], cards: Map<string, Box>, zones: Map<string, { key: ZoneKey; box: Box; title?: string }>, bounds: Box,
  opts: { exact?: Set<string>; straightFirst?: boolean; crossCost?: number; refine?: number; centrePull?: number; sides?: Map<string, [Dir[], Dir[]]> } = {},
) {
  const exact = opts.exact
  const CROSSING = opts.crossCost ?? CROSS
  const [x0, y0, x1, y1] = bounds
  const blocked = new Set<string>()
  for (const [x, y, w, h] of cards.values()) {
    for (let gx = Math.floor((x - 6) / GRID) * GRID; gx < Math.trunc(x + w + 6) + GRID; gx += GRID) {
      for (let gy = Math.floor((y - 6) / GRID) * GRID; gy < Math.trunc(y + h + 6) + GRID; gy += GRID) {
        if (x - 6 <= gx && gx <= x + w + 6 && y - 6 <= gy && gy <= y + h + 6) blocked.add(k(gx, gy))
      }
    }
  }
  const header = new Set<string>()
  const interior = new Map<string, string>()
  for (const [z, { key, title, box: [zx, zy, zw, zh] }] of zones) {
    const half = (title ?? ZONES[key][0]).length * 4 + 16
    for (let gx = Math.floor(zx / GRID) * GRID; gx < Math.trunc(zx + zw) + GRID; gx += GRID) {
      for (let gy = Math.floor(zy / GRID) * GRID; gy < Math.trunc(zy + zh) + GRID; gy += GRID) {
        if (zx <= gx && gx <= zx + zw && zy <= gy && gy <= zy + zh) {
          interior.set(k(gx, gy), z)
          if (gy < zy + ZONE_HEAD - 8) {
            header.add(k(gx, gy))
            if (Math.abs(gx - (zx + zw / 2)) <= half && gy > zy) blocked.add(k(gx, gy))
          }
        }
      }
    }
  }
  const zoneOf = new Map<string, string | undefined>()
  for (const [cid, [x, y, w, h]] of cards) {
    zoneOf.set(cid, [...zones].find(([, { box: [zx, zy, zw, zh] }]) => zx <= x && x + w <= zx + zw && zy <= y && y + h <= zy + zh)?.[0])
  }
  const usedH = new Map<string, number>(), usedV = new Map<string, number>(), portUse = new Map<string, number>()
  const routes = new Map<string, Pt[]>()
  const failed: string[] = []
  const dist = (e: Interface) => {
    const a = cards.get(e.from)!, b = cards.get(e.to)!
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])
  }
  const order = [...edges].sort((a, b) => dist(b) - dist(a))
  if (opts.straightFirst) {
    const centre = (id: string) => { const [x, y, w, h] = cards.get(id)!; return [x + w / 2, y + h / 2] }
    const aligned = (e: Interface) => { const [ax, ay] = centre(e.from), [bx, by] = centre(e.to); return ax === bx || ay === by }
    order.sort((a, b) => Number(aligned(b)) - Number(aligned(a)) || dist(a) - dist(b))
  }
  interface Routed { corners: Pt[]; cells: [Map<string, number>, string][]; portKeys: [string, string] }
  const routeOne = (e: Interface): Routed | null => {
    const side = opts.sides?.get(e.id)
    const src = ports(cards.get(e.from)!, portUse, exact?.has(e.from), opts.centrePull, side?.[0])
    const dst = ports(cards.get(e.to)!, portUse, exact?.has(e.to), opts.centrePull, side?.[1])
    const goals = new Map(dst.map((p) => [k(...p.stub), p]))
    const own = new Set([zoneOf.get(e.from), zoneOf.get(e.to)])
    const heur = (x: number, y: number) => Math.min(...dst.map((p) => Math.abs(x - p.stub[0]) + Math.abs(y - p.stub[1])))
    type Parent = { start: Pt } | { x: number; y: number; d: Dir }
    const heap = new Heap()
    const best = new Map<string, number>()
    const parent = new Map<string, Parent>()
    for (const p of src) {
      const key = `${k(...p.stub)},${p.side}`
      if (p.pen < (best.get(key) ?? Infinity)) {
        best.set(key, p.pen)
        parent.set(key, { start: p.boundary })
      }
      heap.push({ f: p.pen + heur(...p.stub), g: p.pen, goal: false, x: p.stub[0], y: p.stub[1], d: p.side })
    }
    let found: string | null = null
    let guard = 0
    while (heap.size && guard++ < 600_000) {
      const { g, goal, x, y, d } = heap.pop()
      if (goal) {
        found = k(x, y)
        break
      }
      const sk = `${k(x, y)},${d}`
      if (g > (best.get(sk) ?? Infinity)) continue
      const gp = goals.get(k(x, y))
      if (gp) {
        const cost = g + gp.pen + (d === INWARD[gp.side] ? 0 : BEND)
        const gk = `GOAL,${k(x, y)}`
        if (cost < (best.get(gk) ?? Infinity)) {
          best.set(gk, cost)
          parent.set(gk, { x, y, d: d as Dir })
          heap.push({ f: cost, g: cost, goal: true, x, y, d })
        }
      }
      const [rdx, rdy] = DIRS[d as Dir]
      for (const nd of Object.keys(DIRS) as Dir[]) {
        const [dx, dy] = DIRS[nd]
        if (dx === -rdx && dy === -rdy) continue
        const nx = x + dx * GRID, ny = y + dy * GRID
        const nk = k(nx, ny)
        if (!(x0 <= nx && nx <= x1 && y0 <= ny && ny <= y1) || (blocked.has(nk) && !goals.has(nk))) continue
        let step = GRID + (nd !== d ? BEND : 0) + (header.has(nk) ? HEADER : 0)
        const iz = interior.get(nk)
        if (iz !== undefined && !own.has(iz)) step += FOREIGN_ZONE
        step += dx
          ? OVERLAP * (usedH.get(nk) ?? 0) + CROSSING * (usedV.get(nk) ?? 0)
          : OVERLAP * (usedV.get(nk) ?? 0) + CROSSING * (usedH.get(nk) ?? 0)
        const ng = g + step
        const ck = `${nk},${nd}`
        if (ng < (best.get(ck) ?? Infinity)) {
          best.set(ck, ng)
          parent.set(ck, { x, y, d: d as Dir })
          heap.push({ f: ng + heur(nx, ny), g: ng, goal: false, x: nx, y: ny, d: nd })
        }
      }
    }
    if (found === null) return null
    const pts: Pt[] = []
    let state = parent.get(`GOAL,${found}`) as { x: number; y: number; d: Dir }
    let startBoundary: Pt
    for (;;) {
      pts.push([state.x, state.y])
      const prev = parent.get(`${k(state.x, state.y)},${state.d}`)!
      if ("start" in prev) {
        startBoundary = prev.start
        break
      }
      state = prev
    }
    pts.reverse()
    const endBoundary = goals.get(found)!.boundary
    const cells: [Map<string, number>, string][] = []
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]]
      cells.push([a[1] === b[1] ? usedH : usedV, k(...b)])
    }
    const full: Pt[] = [startBoundary, ...pts, endBoundary]
    const corners: Pt[] = [full[0]]
    for (let i = 1; i < full.length - 1; i++) {
      const [a, b, c] = [full[i - 1], full[i], full[i + 1]]
      if (!((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1]))) corners.push(b)
    }
    corners.push(full[full.length - 1])
    return { corners, cells, portKeys: [k(...pts[0]), found] }
  }
  const committed = new Map<string, Routed>()
  const bump = (m: Map<string, number>, key: string, by: number) => m.set(key, (m.get(key) ?? 0) + by)
  const commit = (e: Interface, r: Routed) => {
    for (const [m, key] of r.cells) bump(m, key, 1)
    for (const key of r.portKeys) bump(portUse, key, 1)
    routes.set(e.id, r.corners)
    committed.set(e.id, r)
  }
  const uncommit = (e: Interface) => {
    const r = committed.get(e.id)!
    for (const [m, key] of r.cells) bump(m, key, -1)
    for (const key of r.portKeys) bump(portUse, key, -1)
    routes.delete(e.id)
    committed.delete(e.id)
  }
  for (const e of order) {
    const r = routeOne(e)
    if (r) commit(e, r)
    else failed.push(e.id)
  }
  const crossings = (r: Routed) => r.cells.filter(([m, key]) => ((m === usedH ? usedV : usedH).get(key) ?? 0) > 0).length
  const score = (r: Routed) => r.cells.length * GRID + BEND * (r.corners.length - 2) + CROSSING * crossings(r)
  for (let pass = 0; pass < (opts.refine ?? 0); pass++) {
    let improved = false
    for (const e of order) {
      const before = committed.get(e.id)
      if (!before) continue
      uncommit(e)
      const was = score(before)
      const after = routeOne(e)
      if (after && score(after) < was) { commit(e, after); improved = true }
      else commit(e, before)
    }
    if (!improved) break
  }
  return { routes, failed }
}

export function labelPos(points: Pt[]) {
  const segs = points.slice(1).map((b, i) => Math.abs(b[0] - points[i][0]) + Math.abs(b[1] - points[i][1]))
  const total = segs.reduce((s, v) => s + v, 0) || 1
  let i = 0
  segs.forEach((v, j) => { if (v > segs[i]) i = j })
  return (2 * (segs.slice(0, i).reduce((s, v) => s + v, 0) + segs[i] / 2)) / total - 1
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
  for (const [id, z] of zones) {
    let box = z.box
    for (const [cid, [x, y, w, h]] of cards) {
      if (zoneOfNode.get(cid) !== id) continue
      const next = grow(box, [x - side, y - ZONE_HEAD, x + w + side, y + h + PAD])
      const blocked = [...zones].some(([o, oz]) => o !== id && hit(next, oz.box, 10)) ||
        [...cards].some(([o, ob]) => zoneOfNode.get(o) !== id && hit(next, ob, 4))
      if (!blocked) box = next
    }
    z.box = box
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

const GROUP_PALETTE: ZoneKey[] = ["runtime", "data", "ai", "integration", "build", "edge", "secops", "consumers", "egress", "cicd", "external"]

export function layoutGroups(facts: Facts): Layout {
  const declared = [...(facts.groups ?? [])]
  for (const n of facts.nodes) if (!declared.some((g) => g.id === n.group)) declared.push({ id: n.group!, title: n.group === "other" ? "" : n.group!.replace(/_/g, " ") })
  const used = declared.filter((g) => facts.nodes.some((n) => n.group === g.id))
  const order = new Map(used.map((g, i) => [g.id, i]))
  const groupOf = new Map(facts.nodes.map((n) => [n.id, n.group!]))
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
    const members = facts.nodes.filter((n) => n.group === g.id)
    const x = 40 + r * (ZONE_W + 110), y = columnY.get(r) ?? 140
    const h = zoneHeight(members.length)
    const zoneId = `g_${g.id}`
    zones.set(zoneId, { key, platform: "neutral", box: [x, y, ZONE_W, h], title: g.title, fill: ZONES[key][1], stroke: ZONES[key][2] })
    members.forEach((n, j) => {
      cards.set(n.id, [x + (ZONE_W - CARD_W) / 2, y + ZONE_HEAD + j * (CARD_H + CARD_GAP), CARD_W, CARD_H])
      place.set(n.id, { zone: key, zoneId, icon: n.icon ?? "g_process", platform: "neutral" })
    })
    columnY.set(r, y + h + 40)
  })
  return { zones, cards, frames: [], place }
}

export interface Reroute { moved: Set<string>; previous: Map<string, Pt[]> }

export function buildScene(facts: Facts, positions?: Positions, reroute?: Reroute): Scene {
  if (facts.sequence) return layoutSequence(facts)
  const laid = facts.flow ? layoutFlow(facts) : facts.groups ? layoutGroups(facts) : layout(facts)
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
  const { routes, failed } = routeEdges(edgesIn.filter((e) => !keepIds.has(e.id)), cards, zones, [0, 110, right + 40, bottom + 30],
    facts.flow ? { exact: decisions, straightFirst: true, crossCost: 120, refine: 2, centrePull: 8, sides } : {})
  for (const e of keep) routes.set(e.id, reroute!.previous.get(e.id)!)
  const width = right + 40
  const edges: Edge[] = edgesIn.filter((e) => routes.has(e.id)).map((e) => {
    const points = routes.get(e.id)!
    const near = facts.flow && e.label && facts.nodes.find((n) => n.id === e.from)?.shape === "decision"
    return { ...e, points, labelPos: near ? labelNear(points, 18 + textWidth(e.label, 11) / 2) : labelPos(points) }
  })
  const legendRows = facts.flow ? 0 : edges.length
  if (facts.flow) placeFlowLabels(edges, [...cards.values()], decisions!)
  return {
    facts,
    zones: [...zones].map(([id, z]) => ({ id, key: z.key, platform: z.platform, title: z.title, fill: z.fill, stroke: z.stroke, box: z.box })),
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
  }
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

function placeFlowLabels(edges: Edge[], cards: Box[], decisions: Set<string>) {
  const placed: Box[] = []
  for (const e of edges) {
    if (!e.label) continue
    const w = textWidth(e.label, 11) + 12, h = 16
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
    let chosen = cands[0]
    for (const c of cands) {
      const [x, y] = pointAt(e.points, c)
      const box: Box = [x - w / 2, y - h / 2, w, h]
      if (!cards.some((b) => hit(box, b, 2)) && !placed.some((b) => hit(box, b, 2))) { chosen = c; break }
    }
    e.labelPos = chosen
    const [x, y] = pointAt(e.points, chosen)
    placed.push([x - w / 2, y - h / 2, w, h])
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
