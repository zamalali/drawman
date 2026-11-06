import type { Facts, Node } from "./facts.js"
import type { Box, Pt, Scene } from "./scene.js"
import { textWidth, wrapText } from "./text.js"

export type SeqEvent =
  | { kind: "msg"; index: number }
  | { kind: "fragment"; type: string; label: string }
  | { kind: "else"; label: string }
  | { kind: "end" }
  | { kind: "note"; text: string; over: string[] }
export interface SequenceSpec { events: SeqEvent[] }

export const PARTICIPANT_TYPES = ["actor", "service", "database", "queue", "external", "boundary", "control", "entity"] as const
export const MESSAGE_TYPES = ["sync", "async", "return", "create"] as const
export const FRAGMENT_TYPES = ["alt", "opt", "loop", "par", "critical", "break"] as const

const str = (v: unknown) => (v == null ? "" : typeof v === "string" ? v.trim() : String(v))
const ids = (v: unknown) => (Array.isArray(v) ? v : [v]).map((x) => str(x).toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "")).filter(Boolean)

export function sequenceSpec(raw: Record<string, unknown>, streaming = false): SequenceSpec {
  const items = Array.isArray(raw.messages) ? raw.messages as unknown[] : []
  const events: SeqEvent[] = []
  items.forEach((it, index) => {
    if (!it || typeof it !== "object") return
    const o = it as Record<string, unknown>
    const last = streaming && index === items.length - 1
    if ("fragment" in o || "group" in o) {
      if (!last) events.push({ kind: "fragment", type: str(o.fragment ?? o.group).toLowerCase() || "alt", label: str(o.label ?? o.condition) })
    } else if ("else" in o) {
      if (!last) events.push({ kind: "else", label: str(o.else ?? o.label) })
    } else if ("end" in o) {
      events.push({ kind: "end" })
    } else if ("note" in o) {
      if (!last) events.push({ kind: "note", text: str(o.note), over: ids(o.over ?? o.participant ?? o.from) })
    } else {
      events.push({ kind: "msg", index })
    }
  })
  return { events }
}

export function participantType(n: Node) {
  const t = str(n.shape).replace(/[^a-z]/g, "")
  if (["actor", "user", "person", "human", "customer"].includes(t)) return "actor"
  if (["database", "db", "store", "datastore", "storage", "cache", "table"].includes(t)) return "database"
  if (["queue", "topic", "stream", "bus", "broker", "eventbus"].includes(t)) return "queue"
  if (["external", "thirdparty", "partner", "saas"].includes(t)) return "external"
  if (["boundary", "control", "entity"].includes(t)) return t
  return "service"
}

export interface SeqLayout {
  lifelines: { id: string; x: number; top: number; bottom: number }[]
  activations: { id: string; box: Box }[]
  fragments: { type: string; label: string; box: Box; elses: { y: number; label: string }[] }[]
  notes: { text: string[]; box: Box }[]
}

const HEAD_H = 40, ROW = 44, SELF = 30, TOP = 140

export function layoutSequence(facts: Facts): Scene {
  const parts = facts.nodes
  const width = new Map(parts.map((p) => [p.id, Math.max(110, Math.ceil((textWidth(p.title, 12) * 1.08 + 32) / 20) * 20)]))
  const col = new Map(parts.map((p, i) => [p.id, i]))
  const msgs = new Map(facts.interfaces.map((e) => [e.index, e]))
  const gap = parts.slice(1).map((p, i) => (width.get(parts[i].id)! + width.get(p.id)!) / 2 + 40)
  for (const e of facts.interfaces) {
    const a = col.get(e.from)!, b = col.get(e.to)!
    const need = textWidth(e.label, 11) + 50
    if (a === b) { if (a < gap.length) gap[a] = Math.max(gap[a], need * 0.75 + 30); continue }
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const have = gap.slice(lo, hi).reduce((s, g) => s + g, 0)
    if (have < need) for (let i = lo; i < hi; i++) gap[i] += (need - have) / (hi - lo)
  }
  const x0 = 60 + Math.max(...parts.map((p) => width.get(p.id)!), 110) / 2
  const xs = new Map<string, number>()
  parts.forEach((p, i) => xs.set(p.id, Math.round((x0 + gap.slice(0, i).reduce((s, g) => s + g, 0)) / 10) * 10))

  const cards = parts.map((p) => {
    const w = width.get(p.id)!, x = xs.get(p.id)!
    const box: Box = participantType(p) === "actor" ? [x - 15, TOP, 30, HEAD_H] : [x - w / 2, TOP, w, HEAD_H]
    return { node: p, box, zone: "external" as const, zoneId: "", zoneTitle: "", platform: "neutral" as const, icon: "" }
  })

  let y = TOP + HEAD_H + 40
  const edges: Scene["edges"] = []
  const activations: SeqLayout["activations"] = []
  const open = new Map<string, number[]>()
  const depth = (id: string) => open.get(id)?.length ?? 0
  const edgeX = (id: string, dir: number) => { const d = depth(id); return d ? xs.get(id)! + 5 * (d - 1) + dir * 5 : xs.get(id)! }
  const close = (id: string, at: number) => {
    const stack = open.get(id)
    const start = stack?.pop()
    if (start !== undefined) activations.push({ id, box: [xs.get(id)! - 5 + stack!.length * 5, start, 10, Math.max(16, at - start)] })
  }
  const frames: { type: string; label: string; start: number; elses: { y: number; label: string }[]; who: Set<string> }[] = []
  const fragments: SeqLayout["fragments"] = []
  const notes: SeqLayout["notes"] = []
  const involve = (id: string) => { for (const f of frames) f.who.add(id) }
  const closeFrame = () => {
    const f = frames.pop()!
    const xsIn = [...f.who].map((id) => xs.get(id)!)
    const lo = xsIn.length ? Math.min(...xsIn) : x0, hi = xsIn.length ? Math.max(...xsIn) : x0
    const pad = Math.max(30, 70 - 12 * frames.length)
    fragments.push({ type: f.type, label: f.label, box: [lo - pad, f.start - 8, hi - lo + 2 * pad, y - f.start + 4], elses: f.elses })
    y += 16
  }
  const spec = facts.sequence ?? { events: facts.interfaces.map((e) => ({ kind: "msg" as const, index: e.index })) }
  for (const ev of spec.events) {
    if (ev.kind === "fragment") {
      frames.push({ type: ev.type, label: ev.label, start: y, elses: [], who: new Set() })
      y += 34
    } else if (ev.kind === "else") {
      const f = frames[frames.length - 1]
      if (f) { f.elses.push({ y: y - 6, label: ev.label }); y += 26 }
    } else if (ev.kind === "end") {
      if (frames.length) closeFrame()
    } else if (ev.kind === "note") {
      const over = ev.over.filter((id) => xs.has(id))
      if (!over.length) continue
      const xsIn = over.map((id) => xs.get(id)!)
      const lines = wrapText(ev.text, Math.max(140, Math.max(...xsIn) - Math.min(...xsIn) + 80) - 20, 11, 4)
      const w = Math.max(...lines.map((l) => textWidth(l, 11))) + 24
      const span = Math.max(w, Math.max(...xsIn) - Math.min(...xsIn) + 60)
      const cx = (Math.min(...xsIn) + Math.max(...xsIn)) / 2
      const h = 12 + lines.length * 14
      notes.push({ text: lines, box: [cx - span / 2, y - 8, span, h] })
      for (const id of over) involve(id)
      y += h + 14
    } else {
      const e = msgs.get(ev.index)
      if (!e) continue
      involve(e.from)
      involve(e.to)
      const type = (MESSAGE_TYPES as readonly string[]).includes(e.rel ?? "") ? e.rel! : "sync"
      if (e.from === e.to) {
        const sx = edgeX(e.from, 1)
        edges.push({ ...e, rel: type, points: [[sx, y], [sx + 40, y], [sx + 40, y + SELF], [sx, y + SELF]], labelPos: -0.55 })
        y += SELF + ROW - 10
        continue
      }
      const dir = Math.sign(xs.get(e.to)! - xs.get(e.from)!)
      const start = edgeX(e.from, dir)
      if (type === "return") close(e.from, y)
      let end = edgeX(e.to, -dir)
      if ((type === "sync" || type === "create") && participantType(parts[col.get(e.to)!]) !== "actor") {
        const stack = open.get(e.to) ?? []
        stack.push(y - 4)
        open.set(e.to, stack)
        end = edgeX(e.to, -dir)
      }
      edges.push({ ...e, rel: type, points: [[start, y], [end, y]], labelPos: 0 })
      y += ROW
    }
  }
  while (frames.length) closeFrame()
  for (const [id, stack] of open) while (stack.length) close(id, y)
  const bottom = y + 20
  const lifelines = parts.map((p) => ({ id: p.id, x: xs.get(p.id)!, top: TOP + HEAD_H, bottom }))
  const right = Math.max(...cards.map((c) => c.box[0] + c.box[2]), ...fragments.map((f) => f.box[0] + f.box[2]), ...notes.map((n) => n.box[0] + n.box[2]))
  const w = right + 60
  return {
    facts, zones: [], frames: [], cards, edges, width: w, height: bottom + 40, legend: [40, bottom + 40, w - 80, 0], unrouted: [],
    seq: { lifelines, activations, fragments, notes },
  }
}
