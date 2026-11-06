// Orthogonal A* edge router on a GRID-spaced lattice: cards are obstacles; bends, overlaps, crossings and port reuse cost extra.
import { ZONES, type ZoneKey } from "./kinds.js"
import type { Interface } from "./facts.js"
import { GRID, ZONE_HEAD, type Box, type Pt } from "./metrics.js"

const DIRS = { R: [1, 0], L: [-1, 0], B: [0, 1], T: [0, -1] } as const
export type Dir = keyof typeof DIRS
const BEND = 45, OVERLAP = 60, CROSS = 8, HEADER = 12, PORT_REUSE = 400, FOREIGN_ZONE = 6
const INWARD: Record<Dir, Dir> = { R: "L", L: "R", T: "B", B: "T" }

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
