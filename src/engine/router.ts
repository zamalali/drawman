// Orthogonal A* edge router on a GRID-spaced lattice: cards are obstacles; bends, overlaps, crossings and port reuse cost extra.
import { ZONES, type ZoneKey } from "./kinds.js"
import type { Interface } from "./facts.js"
import { GRID, ZONE_HEAD, type Box, type Pt } from "./metrics.js"

const DIRS = { R: [1, 0], L: [-1, 0], B: [0, 1], T: [0, -1] } as const
export type Dir = keyof typeof DIRS
const BEND = 45, OVERLAP = 60, CROSS = 8, HEADER = 12, PORT_REUSE = 400, FOREIGN_ZONE = 6
const INWARD: Record<Dir, Dir> = { R: "L", L: "R", T: "B", B: "T" }
const DIR_INDEX: Record<Dir, number> = { R: 0, L: 1, B: 2, T: 3 }
const DIR_NAMES: Dir[] = ["R", "L", "B", "T"]
const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1]
// Grid points as numbers: no string building in the A* loop.
const k = (x: number, y: number) => (x + 50_000) * 200_000 + (y + 50_000)

// The router's lookups by grid point, backed by typed arrays over the routing area instead of hash maps (same keys,
// same results, far faster). Keys outside the area fall back to a plain map.
class Area {
  constructor(readonly gx0: number, readonly gy0: number, readonly nx: number, readonly ny: number) {}
  index(key: number) {
    const xs = Math.floor(key / 200_000)
    return this.cell(xs - 50_000, key - xs * 200_000 - 50_000)
  }
  // The same index straight from coordinates, for the search loop (no key decoding).
  cell(x: number, y: number) {
    const i = (x - this.gx0) / GRID, j = (y - this.gy0) / GRID
    return i >= 0 && j >= 0 && i < this.nx && j < this.ny && Number.isInteger(i) && Number.isInteger(j) ? i * this.ny + j : -1
  }
}
// Typed arrays are reused from one call to the next while the routing area keeps its size (the live view routes one
// new line per frame on the same canvas): allocating and collecting them each time cost more than the search itself.
// Each slot is used by one structure per call, and routing is synchronous, so a slot is never shared.
type Typed = Float64Array | Uint8Array | Int32Array | Int8Array
const pool = new Map<string, Typed>()
// fill undefined: the caller only reads what it wrote in this call, so old values do not matter.
function scratch<T extends Typed>(slot: string, make: (n: number) => T, n: number, fill?: number): T {
  let a = pool.get(slot) as T | undefined
  if (!a || a.length !== n) { a = make(n); pool.set(slot, a) }
  return (fill === undefined ? a : a.fill(fill)) as T
}
// The *At methods take the cell index (Area.cell) the caller already has; the key is only used outside the area.
class DenseCount {
  readonly a: Float64Array
  private rest = new Map<number, number>()
  constructor(private area: Area, slot: string, fill = 0, per = 1) { this.a = scratch(slot, (n) => new Float64Array(n), area.nx * area.ny * per, fill); this.fillValue = fill; this.per = per }
  private fillValue: number
  private per: number
  private at(key: number) {
    if (this.per === 1) return this.area.index(key)
    const base = this.area.index(Math.floor(key / 4))
    return base < 0 ? -1 : base * 4 + (key % 4)
  }
  get(key: number): number | undefined { const i = this.at(key); return i >= 0 ? this.a[i] : this.rest.get(key) }
  set(key: number, v: number) { const i = this.at(key); if (i >= 0) this.a[i] = v; else this.rest.set(key, v); return this }
  getAt(i: number, key: number): number | undefined { return i >= 0 ? this.a[i] : this.rest.get(key) }
  setAt(i: number, key: number, v: number) { if (i >= 0) this.a[i] = v; else this.rest.set(key, v) }
  reset() { this.a.fill(this.fillValue); this.rest.clear() }
}
class DenseFlag {
  private a: Uint8Array
  private rest = new Set<number>()
  constructor(private area: Area, slot: string) { this.a = scratch(slot, (n) => new Uint8Array(n), area.nx * area.ny, 0) }
  has(key: number) { const i = this.area.index(key); return i >= 0 ? this.a[i] === 1 : this.rest.has(key) }
  hasAt(i: number, key: number) { return i >= 0 ? this.a[i] === 1 : this.rest.has(key) }
  add(key: number) { const i = this.area.index(key); if (i >= 0) this.a[i] = 1; else this.rest.add(key); return this }
}
class DenseName {
  private a: Int32Array
  private names: string[] = []
  private rest = new Map<number, string>()
  constructor(private area: Area) { this.a = scratch("interior", (n) => new Int32Array(n), area.nx * area.ny, -1) }
  get(key: number) { const i = this.area.index(key); return this.getAt(i, key) }
  getAt(i: number, key: number) { if (i < 0) return this.rest.get(key); const v = this.a[i]; return v < 0 ? undefined : this.names[v] }
  set(key: number, name: string) {
    const i = this.area.index(key)
    if (i < 0) { this.rest.set(key, name); return this }
    let v = this.names.indexOf(name)
    if (v < 0) { v = this.names.length; this.names.push(name) }
    this.a[i] = v
    return this
  }
}

function ports(box: Box, used: Map<number, number>, exact = false, pull = 1, allowed?: Dir[]) {
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
        out.push({ stub: [sx, v], boundary: [edge, v], side, pen: Math.abs(v - centre) * 0.4 * pull + PORT_REUSE * (used.get(k(sx, v)) ?? 0) })
      }
    } else {
      const edge = dy > 0 ? y + h : y
      const sy = dy > 0 ? (Math.floor((edge + GRID) / GRID) + 1) * GRID : Math.floor((edge - GRID) / GRID) * GRID
      const span: number[] = []
      for (let v = (Math.floor(x / GRID) + 1) * GRID; v < Math.trunc(x + w); v += GRID) if (x + 40 <= v && v <= x + w - 20) span.push(v)
      const centre = x + w / 2
      for (const v of span.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre)).slice(0, exact ? 1 : 7)) {
        out.push({ stub: [v, sy], boundary: [v, edge], side, pen: Math.abs(v - centre) * 0.15 * pull + PORT_REUSE * (used.get(k(v, sy)) ?? 0) })
      }
    }
  }
  return out
}

// A binary heap of search states kept in typed arrays (no object per push). Ties break exactly as before: f, then g,
// then x, then y, then insertion order, so routes do not depend on the heap's layout.
class Heap {
  private f = new Float64Array(1024); private g = new Float64Array(1024); private x = new Float64Array(1024); private y = new Float64Array(1024)
  private d = new Uint8Array(1024); private goal = new Uint8Array(1024)
  private h = new Int32Array(1024)
  private items = 0
  private n = 0
  get size() { return this.n }
  // The fields of the item pop() returned last.
  topF = 0; topG = 0; topX = 0; topY = 0; topD = 0; topGoal = false
  clear() { this.items = 0; this.n = 0 }
  private less(p: number, q: number) {
    const { f, g, x, y } = this
    return f[p] !== f[q] ? f[p] < f[q] : g[p] !== g[q] ? g[p] < g[q] : x[p] !== x[q] ? x[p] < x[q] : y[p] !== y[q] ? y[p] < y[q] : p < q
  }
  private grow() {
    const size = this.f.length * 2
    const up = <T extends Float64Array | Uint8Array | Int32Array>(a: T): T => { const b = new (a.constructor as new (n: number) => T)(size); b.set(a); return b }
    this.f = up(this.f); this.g = up(this.g); this.x = up(this.x); this.y = up(this.y); this.d = up(this.d); this.goal = up(this.goal); this.h = up(this.h)
  }
  push(f: number, g: number, goal: boolean, x: number, y: number, d: number) {
    if (this.items === this.f.length) this.grow()
    const id = this.items++
    this.f[id] = f; this.g[id] = g; this.x[id] = x; this.y[id] = y; this.d[id] = d; this.goal[id] = goal ? 1 : 0
    const h = this.h
    let i = this.n++
    h[i] = id
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(h[i], h[p])) break
      const t = h[i]; h[i] = h[p]; h[p] = t
      i = p
    }
  }
  pop() {
    const h = this.h
    const top = h[0]
    const last = h[--this.n]
    if (this.n) {
      h[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < this.n && this.less(h[l], h[m])) m = l
        if (r < this.n && this.less(h[r], h[m])) m = r
        if (m === i) break
        const t = h[i]; h[i] = h[m]; h[m] = t
        i = m
      }
    }
    this.topF = this.f[top]; this.topG = this.g[top]; this.topX = this.x[top]; this.topY = this.y[top]; this.topD = this.d[top]; this.topGoal = this.goal[top] === 1
  }
}


export function routeEdges(
  edges: Interface[], cards: Map<string, Box>, zones: Map<string, { key: ZoneKey; box: Box; title?: string; parent?: string }>, bounds: Box,
  opts: { exact?: Set<string>; straightFirst?: boolean; crossCost?: number; refine?: number; centrePull?: number; sides?: Map<string, [Dir[], Dir[]]>; fixed?: Pt[][] } = {},
) {
  const exact = opts.exact
  const CROSSING = opts.crossCost ?? CROSS
  const [x0, y0, x1, y1] = bounds
  const gx0 = Math.floor(x0 / GRID) * GRID, gy0 = Math.floor(y0 / GRID) * GRID
  const area = new Area(gx0, gy0, Math.floor((x1 - gx0) / GRID) + 1, Math.floor((y1 - gy0) / GRID) + 1)
  const blocked = new DenseFlag(area, "blocked")
  for (const [x, y, w, h] of cards.values()) {
    for (let gx = Math.floor((x - 6) / GRID) * GRID; gx < Math.trunc(x + w + 6) + GRID; gx += GRID) {
      for (let gy = Math.floor((y - 6) / GRID) * GRID; gy < Math.trunc(y + h + 6) + GRID; gy += GRID) {
        if (x - 6 <= gx && gx <= x + w + 6 && y - 6 <= gy && gy <= y + h + 6) blocked.add(k(gx, gy))
      }
    }
  }
  const header = new DenseFlag(area, "header")
  const interior = new DenseName(area)
  // Larger zones first, so a cell inside nested groups belongs to the innermost one.
  const byArea = [...zones].sort(([, a], [, b]) => b.box[2] * b.box[3] - a.box[2] * a.box[3])
  for (const [z, { key, title, box: [zx, zy, zw, zh] }] of byArea) {
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
    zoneOf.set(cid, [...byArea].reverse().find(([, { box: [zx, zy, zw, zh] }]) => zx <= x && x + w <= zx + zw && zy <= y && y + h <= zy + zh)?.[0])
  }
  // An edge may run freely inside the groups that hold either of its ends, including every enclosing group.
  const chain = (z: string | undefined) => {
    const out: (string | undefined)[] = [z]
    let p = z ? zones.get(z)?.parent : undefined
    while (p && !out.includes(p)) { out.push(p); p = zones.get(p)?.parent }
    return out
  }
  const usedH = new DenseCount(area, "usedH"), usedV = new DenseCount(area, "usedV"), portUse = new Map<number, number>()
  const add = (m: DenseCount | Map<number, number>, key: number) => m.set(key, (m.get(key) ?? 0) + 1)
  // Lines that stay as they are (kept from before an edit) occupy their tracks and ports, so new lines avoid riding on them.
  for (const pts of opts.fixed ?? []) {
    const snap = (v: number) => Math.round(v / GRID) * GRID
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i]
      const flat = Math.abs(ay - by) <= Math.abs(ax - bx)
      const end = i === 1 || i === pts.length - 1
      const [from, to, at] = flat ? [snap(ax), snap(bx), snap(ay)] : [snap(ay), snap(by), snap(ax)]
      const step = from <= to ? GRID : -GRID
      for (let v = from; step > 0 ? v <= to : v >= to; v += step) {
        const key = flat ? k(v, at) : k(at, v)
        add(flat ? usedH : usedV, key)
        if (end) add(portUse, key)
      }
    }
  }
  const best = new DenseCount(area, "best", Infinity, 4)
  // Search state per (grid point, direction): the state it was reached from (pd -1: a start, px/py its boundary point).
  const states = area.nx * area.ny * 4
  const px = scratch("px", (n) => new Float64Array(n), states), py = scratch("py", (n) => new Float64Array(n), states), pd = scratch("pd", (n) => new Int8Array(n), states)
  const parentRest = new Map<number, { start: Pt } | { x: number; y: number; d: Dir }>()
  const heap = new Heap()
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
  interface Routed { corners: Pt[]; cells: [DenseCount, number][]; portKeys: [number, number] }
  // On large canvases the search first stays in a corridor around both ends (wide enough to go around neighbours) and
  // only falls back to the whole canvas when no route exists there. Small and medium diagrams always search everything.
  const LARGE = (x1 - x0) * (y1 - y0) > 2_500_000
  const routeOne = (e: Interface, wide = !LARGE): Routed | null => {
    if (!wide) {
      const a = cards.get(e.from)!, b = cards.get(e.to)!
      const lx = Math.min(a[0], b[0]), hx = Math.max(a[0] + a[2], b[0] + b[2]), ly = Math.min(a[1], b[1]), hy = Math.max(a[1] + a[3], b[1] + b[3])
      const m = Math.max(400, 0.3 * Math.max(hx - lx, hy - ly))
      const lim: Box = [Math.max(x0, lx - m), Math.max(y0, ly - m), Math.min(x1, hx + m), Math.min(y1, hy + m)]
      return search(e, lim) ?? search(e, [x0, y0, x1, y1])
    }
    return search(e, [x0, y0, x1, y1])
  }
  const search = (e: Interface, [sx0, sy0, sx1, sy1]: Box): Routed | null => {
    const side = opts.sides?.get(e.id)
    const src = ports(cards.get(e.from)!, portUse, exact?.has(e.from), opts.centrePull, side?.[0])
    const dst = ports(cards.get(e.to)!, portUse, exact?.has(e.to), opts.centrePull, side?.[1])
    const goals = new Map(dst.map((p) => [k(...p.stub), p]))
    const own = new Set([...chain(zoneOf.get(e.from)), ...chain(zoneOf.get(e.to))])
    const heur = (x: number, y: number) => {
      let m = Infinity
      for (const p of dst) { const v = Math.abs(x - p.stub[0]) + Math.abs(y - p.stub[1]); if (v < m) m = v }
      return m
    }
    type Parent = { start: Pt } | { x: number; y: number; d: Dir }
    heap.clear()
    best.reset()
    parentRest.clear()
    const goalBest = new Map<number, number>()
    const goalParent = new Map<number, { x: number; y: number; d: Dir }>()
    for (const p of src) {
      const sd = DIR_INDEX[p.side], c = area.cell(p.stub[0], p.stub[1])
      const si = c >= 0 ? c * 4 + sd : -1, key = k(...p.stub) * 4 + sd
      if (p.pen < (best.getAt(si, key) ?? Infinity)) {
        best.setAt(si, key, p.pen)
        if (si >= 0) { pd[si] = -1; px[si] = p.boundary[0]; py[si] = p.boundary[1] } else parentRest.set(key, { start: p.boundary })
      }
      heap.push(p.pen + heur(p.stub[0], p.stub[1]), p.pen, false, p.stub[0], p.stub[1], sd)
    }
    let found: number | null = null
    let guard = 0
    while (heap.size && guard++ < 600_000) {
      heap.pop()
      const g = heap.topG, x = heap.topX, y = heap.topY, d = heap.topD
      if (heap.topGoal) {
        found = k(x, y)
        break
      }
      const here = k(x, y), c = area.cell(x, y)
      if (g > (best.getAt(c >= 0 ? c * 4 + d : -1, here * 4 + d) ?? Infinity)) continue
      const gp = goals.get(here)
      if (gp) {
        const cost = g + gp.pen + (d === DIR_INDEX[INWARD[gp.side]] ? 0 : BEND)
        if (cost < (goalBest.get(here) ?? Infinity)) {
          goalBest.set(here, cost)
          goalParent.set(here, { x, y, d: DIR_NAMES[d] })
          heap.push(cost, cost, true, x, y, d)
        }
      }
      const rdx = DX[d], rdy = DY[d]
      for (let nd = 0; nd < 4; nd++) {
        const dx = DX[nd], dy = DY[nd]
        if (dx === -rdx && dy === -rdy) continue
        const nx = x + dx * GRID, ny = y + dy * GRID
        if (!(sx0 <= nx && nx <= sx1 && sy0 <= ny && ny <= sy1)) continue
        const nk = k(nx, ny), nc = area.cell(nx, ny)
        if (blocked.hasAt(nc, nk) && !goals.has(nk)) continue
        let step = GRID + (nd !== d ? BEND : 0) + (header.hasAt(nc, nk) ? HEADER : 0)
        const iz = interior.getAt(nc, nk)
        if (iz !== undefined && !own.has(iz)) step += FOREIGN_ZONE
        step += dx
          ? OVERLAP * (usedH.getAt(nc, nk) ?? 0) + CROSSING * (usedV.getAt(nc, nk) ?? 0)
          : OVERLAP * (usedV.getAt(nc, nk) ?? 0) + CROSSING * (usedH.getAt(nc, nk) ?? 0)
        const ng = g + step
        const ci = nc >= 0 ? nc * 4 + nd : -1, ck = nk * 4 + nd
        if (ng < (best.getAt(ci, ck) ?? Infinity)) {
          best.setAt(ci, ck, ng)
          if (ci >= 0) { pd[ci] = d; px[ci] = x; py[ci] = y } else parentRest.set(ck, { x, y, d: DIR_NAMES[d] })
          heap.push(ng + heur(nx, ny), ng, false, nx, ny, nd)
        }
      }
    }
    if (found === null) return null
    const parentOf = (x: number, y: number, d: Dir): Parent => {
      const c = area.cell(x, y), si = c >= 0 ? c * 4 + DIR_INDEX[d] : -1
      if (si < 0) return parentRest.get(k(x, y) * 4 + DIR_INDEX[d])!
      return pd[si] < 0 ? { start: [px[si], py[si]] } : { x: px[si], y: py[si], d: DIR_NAMES[pd[si]] }
    }
    const pts: Pt[] = []
    let state = goalParent.get(found)!
    let startBoundary: Pt
    for (;;) {
      pts.push([state.x, state.y])
      const prev = parentOf(state.x, state.y, state.d)
      if ("start" in prev) {
        startBoundary = prev.start
        break
      }
      state = prev
    }
    pts.reverse()
    const endBoundary = goals.get(found)!.boundary
    const cells: [DenseCount, number][] = []
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
  const bump = (m: DenseCount | Map<number, number>, key: number, by: number) => m.set(key, (m.get(key) ?? 0) + by)
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
