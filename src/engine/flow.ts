import type { Facts, Group, Interface, Node } from "./facts.js"
import type { Box, LaidZone, Layout, Placement } from "./scene.js"
import { textWidth, wrapText } from "./text.js"

export const FLOW_SHAPES = ["start", "end", "process", "decision", "data", "document", "database", "subprocess"] as const
export const STATE_SHAPES = ["initial", "final", "state", "choice"] as const
export const CLASS_SHAPES = ["class", "interface", "abstract", "enum"] as const
export type FlowShape = (typeof FLOW_SHAPES)[number] | (typeof STATE_SHAPES)[number] | (typeof CLASS_SHAPES)[number] | "entity"
export const FLOW_TONES = ["default", "success", "danger", "warning", "info", "neutral"] as const
export type FlowTone = (typeof FLOW_TONES)[number]
export type Family = "flowchart" | "state" | "class" | "er"
export type Direction = "TB" | "LR" | "RL" | "BT"
export interface FlowSpec { family: Family; direction: Direction; lanes: Group[] }

export function parseDirection(v: string): Direction {
  const t = v.toLowerCase().replace(/[^a-z]/g, "")
  if (["rl", "righttoleft", "rtl", "leftward", "leftwards"].includes(t)) return "RL"
  if (["bt", "bottomtotop", "bottomup", "upward", "upwards", "btt"].includes(t)) return "BT"
  if (["lr", "lefttoright", "ltr", "horizontal", "rightward", "rightwards"].includes(t)) return "LR"
  return "TB"
}

export const CLASS_RELATIONS = ["inherits", "implements", "composition", "aggregation", "association", "dependency"] as const
export const ER_CARDINALITIES = ["one-to-one", "one-to-many", "many-to-one", "many-to-many"] as const

export const isCompartment = (shape?: string) => shape === "entity" || (CLASS_SHAPES as readonly string[]).includes(shape ?? "")

export function stateShape(type: string): FlowShape {
  const t = type.toLowerCase().replace(/[^a-z]/g, "")
  if (["initial", "start", "begin", "init", "entry"].includes(t)) return "initial"
  if (["final", "end", "terminal", "terminate", "stop", "exit", "done"].includes(t)) return "final"
  if (["choice", "decision", "junction", "condition", "branch"].includes(t)) return "choice"
  return "state"
}

export function classShape(type: string): FlowShape {
  const t = type.toLowerCase().replace(/[^a-z]/g, "")
  if (t.startsWith("interface") || t === "protocol" || t === "trait") return "interface"
  if (t.startsWith("abstract")) return "abstract"
  if (t.startsWith("enum")) return "enum"
  return "class"
}

export function classRelation(type: string): string {
  const t = type.toLowerCase().replace(/[^a-z]/g, "")
  if (/^(extends|inherit|generali[sz]|isa|subclass|specializ)/.test(t)) return "inherits"
  if (/^(implement|reali[sz]|conform)/.test(t)) return "implements"
  if (/^(compos|owns|contains|partof)/.test(t)) return "composition"
  if (/^(aggregat|has)/.test(t)) return "aggregation"
  if (/^(depend|uses|use|calls|creates|instantiates)/.test(t)) return "dependency"
  return "association"
}

export function erCardinality(type: string): string {
  const t = type.toLowerCase().replace(/\s+/g, "")
  if (/^(1:1|1-1|one-?to-?one|onetoone)/.test(t)) return "one-to-one"
  if (/^(n:1|m:1|\*:1|many-?to-?one|manytoone)/.test(t)) return "many-to-one"
  if (/^(n:m|m:n|\*:\*|many-?to-?many|manytomany)/.test(t)) return "many-to-many"
  return "one-to-many"
}

export function rankEdge(family: Family, e: Pick<Interface, "from" | "to" | "rel">): [string, string] {
  if (family === "class" && (e.rel === "inherits" || e.rel === "implements")) return [e.to, e.from]
  if (family === "er" && e.rel === "many-to-one") return [e.to, e.from]
  return [e.from, e.to]
}

const ALIASES: Record<string, FlowShape> = {
  start: "start", begin: "start", terminator: "start", trigger: "start", entry: "start",
  end: "end", stop: "end", finish: "end", terminate: "end", exit: "end",
  process: "process", step: "process", task: "process", action: "process", activity: "process", operation: "process",
  decision: "decision", condition: "decision", if: "decision", question: "decision", rhombus: "decision", diamond: "decision",
  gateway: "decision", choice: "decision", check: "decision", branch: "decision",
  data: "data", io: "data", input: "data", output: "data", inputoutput: "data", parallelogram: "data",
  document: "document", doc: "document", report: "document", form: "document", file: "document",
  database: "database", db: "database", storage: "database", store: "database", cylinder: "database", datastore: "database",
  subprocess: "subprocess", predefined: "subprocess", predefinedprocess: "subprocess", call: "subprocess",
  function: "subprocess", subroutine: "subprocess", module: "subprocess",
}

export function flowShape(type: string, title: string): FlowShape {
  const key = type.toLowerCase().replace(/[^a-z]/g, "")
  if (key in ALIASES) return ALIASES[key]
  return title.trim().endsWith("?") ? "decision" : "process"
}

const DANGER = /\b(reject|rejected|deny|denied|declin\w*|fail\w*|error|cancel\w*|abort\w*|block\w*|escalat\w*|refus\w*|invalid|timeout|lost)\b/i
export function flowTone(tone: string, shape: FlowShape, title: string): FlowTone {
  const t = tone.toLowerCase() as FlowTone
  if ((FLOW_TONES as readonly string[]).includes(t)) return t
  return ["process", "end", "subprocess", "data", "document", "state"].includes(shape) && DANGER.test(title) ? "danger" : "default"
}

const SHAPE_COLOURS: Record<FlowShape, [fill: string, stroke: string]> = {
  start: ["#d5e8d4", "#82b366"], end: ["#d5e8d4", "#82b366"], process: ["#dae8fc", "#6c8ebf"],
  decision: ["#fff2cc", "#d6b656"], data: ["#e1d5e7", "#9673a6"], document: ["#ffe6cc", "#d79b00"],
  database: ["#f5f5f5", "#666666"], subprocess: ["#dae8fc", "#6c8ebf"],
  initial: ["#202124", "#202124"], final: ["#ffffff", "#202124"], state: ["#dae8fc", "#6c8ebf"], choice: ["#fff2cc", "#d6b656"],
  class: ["#dae8fc", "#6c8ebf"], interface: ["#e1d5e7", "#9673a6"], abstract: ["#fff2cc", "#d6b656"], enum: ["#d5e8d4", "#82b366"],
  entity: ["#dae8fc", "#6c8ebf"],
}
const TONE_COLOURS: Record<Exclude<FlowTone, "default">, [string, string]> = {
  success: ["#d5e8d4", "#82b366"], danger: ["#f8cecc", "#b85450"], warning: ["#ffe6cc", "#d79b00"],
  info: ["#dae8fc", "#6c8ebf"], neutral: ["#f5f5f5", "#666666"],
}
export function flowColours(n: Node): [string, string] {
  const tone = (n.tone ?? "default") as FlowTone
  return tone === "default" ? SHAPE_COLOURS[n.shape ?? "process"] : TONE_COLOURS[tone]
}

const YES = /^(yes|y|true|ok|valid|approved?|pass(ed)?|success(ful)?|accept(ed)?|found|available|in stock|match(ed)?)\b/i
const NO = /^(no|n|false|invalid|rejected?|fail(ed)?|denied|declined|not\b|none|timeout|error|missing|out of stock)/i
export function labelColour(label: string) {
  return YES.test(label.trim()) ? "#2e7d32" : NO.test(label.trim()) ? "#c62828" : "#5f6368"
}

export const FLOW_FONT = 12
export const FLOW_LINE = 15
const ceil20 = (v: number) => Math.ceil(v / 20) * 20
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function flowBox(shape: FlowShape, title: string): { w: number; h: number; lines: string[] } {
  if (!(FLOW_SHAPES as readonly string[]).includes(shape)) shape = "process"
  const wrapAt: Record<string, number> = { start: 180, end: 180, process: 170, decision: 116, data: 150, document: 160, database: 110, subprocess: 150 }
  const lines = wrapText(title, wrapAt[shape], FLOW_FONT, shape === "decision" ? 3 : 3)
  const tw = Math.max(...lines.map((l) => textWidth(l, FLOW_FONT)))
  const extra = 20 * (lines.length - 1)
  switch (shape) {
    case "decision": return { w: clamp(ceil20(tw * 1.7 + 30), 120, 260), h: 80 + extra, lines }
    case "start": case "end": return { w: clamp(ceil20(tw + 44), 120, 240), h: 40 + extra, lines }
    case "database": return { w: clamp(ceil20(tw + 36), 100, 200), h: 60 + extra, lines }
    case "document": return { w: clamp(ceil20(tw + 36), 120, 220), h: 60 + extra, lines }
    case "data": return { w: clamp(ceil20(tw + 56), 140, 240), h: 40 + extra, lines }
    case "subprocess": return { w: clamp(ceil20(tw + 52), 140, 240), h: 40 + extra, lines }
    default: return { w: clamp(ceil20(tw + 36), 120, 240), h: 40 + extra, lines }
  }
}

const LANE_HEAD = 40

export interface NodeBox { w: number; h: number; lines: string[]; sub?: string[]; stereo?: string; head?: number; fields?: string[]; methods?: string[] }
export const ROW = 20

export const stereotype = (shape?: string) =>
  shape === "interface" ? "«interface»" : shape === "enum" ? "«enumeration»" : shape === "abstract" ? "«abstract»" : ""

export function nodeBox(n: Node): NodeBox {
  const shape = n.shape ?? "process"
  if (isCompartment(shape)) {
    const stereo = stereotype(shape)
    const fit = (s: string) => wrapText(s, 330, FLOW_FONT, 1)[0]
    const fields = (n.fields ?? []).map(fit), methods = (n.methods ?? []).map(fit)
    const title = wrapText(n.title, 330, 13, 1)[0]
    const tw = Math.max(textWidth(title, 13) * 1.08, textWidth(stereo, 11), ...fields.map((f) => textWidth(f, FLOW_FONT)), ...methods.map((m) => textWidth(m, FLOW_FONT)))
    const head = stereo ? 40 : 30
    const body = Math.max(fields.length, 1) * ROW + (methods.length ? 8 + methods.length * ROW : 0) + 6
    return { w: clamp(ceil20(tw + 28), 160, 360), h: ceil20(head + body), lines: [title], stereo, head, fields, methods }
  }
  switch (shape) {
    case "initial": case "final": return { w: 40, h: 40, lines: [] }
    case "choice": return { w: 60, h: 60, lines: [] }
    case "state": {
      const lines = wrapText(n.title, 150, FLOW_FONT, 2)
      const sub = n.detail ? wrapText(n.detail, 180, 11, 3) : []
      const tw = Math.max(...lines.map((l) => textWidth(l, FLOW_FONT) * 1.08), ...sub.map((s) => textWidth(s, 11)))
      return { w: clamp(ceil20(tw + 40), 120, 260), h: ceil20(26 + lines.length * FLOW_LINE + (sub.length ? 8 + sub.length * 14 : 0)), lines, sub }
    }
    default: return flowBox(shape, n.title)
  }
}

export function layoutFlow(facts: Facts): Layout {
  const spec = facts.flow!
  const tb = spec.direction === "TB" || spec.direction === "BT"
  const nodes = facts.nodes
  const pos = new Map(nodes.map((n, i) => [n.id, i]))
  const out = new Map(nodes.map((n) => [n.id, [] as { to: string; label: string }[]]))
  const inc = new Map(nodes.map((n) => [n.id, [] as string[]]))
  for (const e of facts.interfaces) {
    if (!out.has(e.from) || !out.has(e.to)) continue
    const [a, b] = rankEdge(spec.family, e)
    out.get(a)!.push({ to: b, label: e.label })
    inc.get(b)!.push(a)
  }

  const state = new Map<string, number>()
  const back = new Set<string>()
  const dfs = (root: string) => {
    if (state.get(root)) return
    const stack: [string, number][] = [[root, 0]]
    state.set(root, 1)
    while (stack.length) {
      const top = stack[stack.length - 1]
      const kids = out.get(top[0])!
      if (top[1] >= kids.length) { state.set(top[0], 2); stack.pop(); continue }
      const v = kids[top[1]++].to
      const s = state.get(v) ?? 0
      if (s === 1) back.add(`${top[0]}>${v}`)
      else if (s === 0) { state.set(v, 1); stack.push([v, 0]) }
    }
  }
  for (const n of nodes) if (n.shape === "start" || n.shape === "initial") dfs(n.id)
  for (const n of nodes) if (!inc.get(n.id)!.length) dfs(n.id)
  for (const n of nodes) dfs(n.id)
  const fwd = (id: string) => out.get(id)!.filter((k) => !back.has(`${id}>${k.to}`))
  const parents = (id: string) => [...new Set(inc.get(id)!.filter((p) => !back.has(`${p}>${id}`)))]

  const indeg = new Map(nodes.map((n) => [n.id, parents(n.id).length]))
  const ready = nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id)
  const topo: string[] = []
  while (ready.length) {
    ready.sort((a, b) => pos.get(a)! - pos.get(b)!)
    const u = ready.shift()!
    topo.push(u)
    for (const v of new Set(fwd(u).map((k) => k.to))) {
      indeg.set(v, indeg.get(v)! - 1)
      if (!indeg.get(v)) ready.push(v)
    }
  }
  const rank = new Map(nodes.map((n) => [n.id, 0]))
  for (const u of topo) for (const k of fwd(u)) rank.set(k.to, Math.max(rank.get(k.to)!, rank.get(u)! + 1))
  // Steps that only loop back (rework, retry) sit beside the decision that sends work there.
  for (const id of topo) {
    const outs = out.get(id)!
    const ps = parents(id)
    if (outs.length && ps.length && outs.every((k) => back.has(`${id}>${k.to}`))) rank.set(id, Math.min(...ps.map((p) => rank.get(p)!)) + 1)
  }
  const height = new Map(nodes.map((n) => [n.id, 0]))
  for (const u of [...topo].reverse()) for (const k of fwd(u)) height.set(u, Math.max(height.get(u)!, height.get(k.to)! + 1))

  const primary = new Map<string, string>()
  for (const n of nodes) {
    const kids = fwd(n.id)
    if (!kids.length) continue
    let best = kids[0]
    for (const k of kids) {
      const hk = height.get(k.to)!, hb = height.get(best.to)!
      if (hk > hb || (hk === hb && labelColour(k.label) === "#2e7d32" && labelColour(best.label) !== "#2e7d32")) best = k
    }
    primary.set(n.id, best.to)
  }

  const lanes: Group[] = [...spec.lanes]
  const usesLanes = lanes.length > 0 || nodes.some((n) => n.lane)
  const laneOf = new Map<string, string>()
  for (const id of topo) {
    const n = nodes[pos.get(id)!]
    let lane = usesLanes ? n.lane ?? "" : ""
    if (usesLanes && lane && !lanes.some((l) => l.id === lane)) lanes.push({ id: lane, title: lane.replace(/_/g, " ") })
    if (usesLanes && !lane) lane = laneOf.get(parents(id).find((p) => laneOf.has(p)) ?? "") ?? lanes[0]?.id ?? ""
    laneOf.set(id, lane)
  }

  const col = new Map<string, number>()
  const taken = new Set<string>()
  const sideCount = new Map<string, number>()
  const maxRank = Math.max(0, ...rank.values())
  for (let r = 0; r <= maxRank; r++) {
    const row = topo.filter((id) => rank.get(id) === r)
    const items = row.map((id) => {
      const lane = laneOf.get(id)!
      const ps = parents(id).filter((p) => col.has(p) && laneOf.get(p) === lane)
      const claim = ps.filter((p) => primary.get(p) === id).map((p) => col.get(p)!).sort((a, b) => a - b)
      if (claim.length) return { id, lane, want: claim[(claim.length - 1) >> 1], pref: 1, kind: 0 }
      if (ps.length) {
        const p = ps.reduce((a, b) => (rank.get(b)! > rank.get(a)! ? b : a))
        const i = sideCount.get(p) ?? 0
        sideCount.set(p, i + 1)
        const sign = i % 2 === 0 ? 1 : -1
        return { id, lane, want: col.get(p)! + sign * (Math.floor(i / 2) + 1), pref: sign, kind: 1 }
      }
      return { id, lane, want: 0, pref: 1, kind: 2 }
    }).sort((a, b) => a.kind - b.kind || pos.get(a.id)! - pos.get(b.id)!)
    for (const it of items) {
      const free = (c: number) => !taken.has(`${it.lane}|${r}|${c}`)
      let c = it.want
      for (let d = 1; !free(c) && d < 100; d++) {
        if (free(it.want + it.pref * d)) c = it.want + it.pref * d
        else if (it.kind !== 2 && free(it.want - it.pref * d)) c = it.want - it.pref * d
      }
      taken.add(`${it.lane}|${r}|${c}`)
      col.set(it.id, c)
    }
    // Crossing reduction: move or swap steps within the row; main lines weigh triple so they stay straight.
    const incoming = (ids: string[]) => ids.flatMap((id) => parents(id)
      .filter((p) => col.has(p) && laneOf.get(p) === laneOf.get(id)).map((p) => [p, id] as const))
    const cost = (ids: string[]) => {
      const es = incoming(ids)
      let c = 0
      for (let i = 0; i < es.length; i++) {
        const [p, k] = es[i]
        c += Math.abs(col.get(k)! - col.get(p)!) * (primary.get(p) === k ? 3 : 1)
        for (let j = i + 1; j < es.length; j++) {
          const [q, m] = es[j]
          if (p !== q && k !== m && laneOf.get(k) === laneOf.get(m) &&
            Math.sign(col.get(p)! - col.get(q)!) * Math.sign(col.get(k)! - col.get(m)!) < 0) c += 10
        }
      }
      return c
    }
    for (let pass = 0; pass < 4; pass++) {
      let moved = false
      for (const id of row) {
        const lane = laneOf.get(id)!
        const peers = row.filter((o) => laneOf.get(o) === lane)
        const known = topo.filter((o) => col.has(o) && laneOf.get(o) === lane && rank.get(o)! <= r).map((o) => col.get(o)!)
        const lo = Math.min(...known) - 1, hi = Math.max(...known) + 1
        const here = col.get(id)!
        let best = cost(peers), bestCol = here
        for (let c = lo; c <= hi; c++) {
          if (c === here) continue
          const other = peers.find((o) => col.get(o) === c)
          col.set(id, c)
          if (other) col.set(other, here)
          const k = cost(peers)
          if (k < best - 0.5) { best = k; bestCol = c }
          col.set(id, here)
          if (other) col.set(other, c)
        }
        if (bestCol !== here) {
          const other = peers.find((o) => col.get(o) === bestCol)
          taken.delete(`${lane}|${r}|${here}`)
          col.set(id, bestCol)
          if (other) col.set(other, here)
          else taken.add(`${lane}|${r}|${bestCol}`)
          if (other) taken.add(`${lane}|${r}|${here}`)
          moved = true
        }
      }
      if (!moved) break
    }
  }

  const box = new Map(nodes.map((n) => [n.id, nodeBox(n)]))
  const along = (id: string) => (tb ? box.get(id)!.h : box.get(id)!.w)
  const across = (id: string) => (tb ? box.get(id)!.w : box.get(id)!.h)
  const GAPS: Record<Family, [rowTB: number, colTB: number, rowLR: number, colLR: number]> = {
    flowchart: [50, 60, 70, 40], state: [70, 80, 120, 50], class: [80, 80, 110, 60], er: [80, 90, 110, 60],
  }
  const [rTB, cTB, rLR, cLR] = GAPS[spec.family]
  const rankGap = tb ? rTB : rLR, colGap = tb ? cTB : cLR
  const laneOrder = usesLanes ? lanes.map((l) => l.id).filter((id) => topo.some((n) => laneOf.get(n) === id)) : [""]
  const padStart = usesLanes ? (tb ? 30 : LANE_HEAD + 10) : 0
  const padEnd = usesLanes ? (tb ? 30 : 20) : 0
  const centre = new Map<string, number>()
  const laneSpan = new Map<string, [number, number]>()
  let cursor = tb ? 40 : 140
  for (const lane of laneOrder) {
    const members = topo.filter((id) => laneOf.get(id) === lane)
    const min = Math.min(...members.map((id) => col.get(id)!))
    const cols = [...new Set(members.map((id) => col.get(id)! - min))].sort((a, b) => a - b)
    const start = cursor
    cursor += padStart
    for (const c of cols) {
      const ext = Math.max(...members.filter((id) => col.get(id)! - min === c).map(across))
      centre.set(`${lane}|${c + min}`, cursor + ext / 2)
      cursor += ext + colGap
    }
    cursor += padEnd - colGap
    laneSpan.set(lane, [start, cursor])
    cursor += usesLanes ? 20 : colGap
  }
  const primaryStart = (tb ? 140 : 40) + (usesLanes ? (tb ? LANE_HEAD + 10 : 30) : 0)
  const gapAfter = (r: number) => {
    if (tb) return rankGap
    let need = 0
    for (const e of facts.interfaces) {
      if (!e.label) continue
      const [a, b] = rankEdge(spec.family, e)
      const ra = rank.get(a), rb = rank.get(b)
      if (ra === undefined || rb === undefined) continue
      if (Math.min(ra, rb) === r && Math.max(ra, rb) === r + 1) need = Math.max(need, textWidth(e.label, 11) + 50)
    }
    return Math.max(rankGap, Math.ceil(need / 10) * 10)
  }
  const rankCentre: number[] = []
  let p = primaryStart
  for (let r = 0; r <= maxRank; r++) {
    const ext = Math.max(40, ...topo.filter((id) => rank.get(id) === r).map(along))
    rankCentre[r] = p + ext / 2
    p += ext + gapAfter(r)
  }
  const primaryEnd = p - gapAfter(maxRank)

  const cards = new Map<string, Box>()
  const place = new Map<string, Placement>()
  for (const id of topo) {
    const { w, h } = box.get(id)!
    const c = centre.get(`${laneOf.get(id)}|${col.get(id)}`)!, rc = rankCentre[rank.get(id)!]
    cards.set(id, tb ? [c - w / 2, rc - h / 2, w, h] : [rc - w / 2, c - h / 2, w, h])
    place.set(id, { zone: "external", zoneId: usesLanes ? `lane_${laneOf.get(id)}` : "", icon: "", platform: "neutral" })
  }
  const zones = new Map<string, LaidZone>()
  if (usesLanes) {
    laneOrder.forEach((lane, i) => {
      const [s, e] = laneSpan.get(lane)!
      const title = lanes.find((l) => l.id === lane)?.title ?? lane
      const fill = i % 2 ? "#ffffff" : "#f8f9fb"
      zones.set(`lane_${lane}`, {
        key: "external", platform: "neutral", title, fill, stroke: "#c9cdd2",
        box: tb ? [s, 140, e - s, primaryEnd - 140 + 20] : [40, s, primaryEnd - 40 + 30, e - s],
      })
    })
  }
  // RL and BT mirror the forward layout; routing runs afterwards.
  if (spec.direction === "RL" || spec.direction === "BT") {
    const boxes = [...cards.values(), ...[...zones.values()].map((z) => z.box)]
    const i = spec.direction === "RL" ? 0 : 1
    const lo = Math.min(...boxes.map((b) => b[i])), hi = Math.max(...boxes.map((b) => b[i] + b[i + 2]))
    const flip = (b: Box): Box => { const m = [...b] as Box; m[i] = lo + hi - (b[i] + b[i + 2]); return m }
    for (const [id, b] of cards) cards.set(id, flip(b))
    for (const z of zones.values()) z.box = flip(z.box)
  }
  return { zones, cards, frames: [], place }
}

export function labelNear(points: [number, number][], dist: number) {
  const total = points.slice(1).reduce((s, b, i) => s + Math.abs(b[0] - points[i][0]) + Math.abs(b[1] - points[i][1]), 0) || 1
  return Math.min(0, (2 * Math.min(dist, total / 2)) / total - 1)
}
