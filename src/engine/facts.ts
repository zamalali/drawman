import { ICONS } from "./drawio.js"
import { classRelation, classShape, erCardinality, flowShape, flowTone, parseDirection, stateShape, type Family, type FlowShape, type FlowSpec } from "./flow.js"
import { sequenceSpec, type SequenceSpec } from "./sequence.js"
import { GLYPH_HINTS, KIND, brandKind, normaliseKind } from "./kinds.js"

export interface InputNode { id?: unknown; kind?: unknown; title?: unknown; detail?: unknown; status?: unknown; group?: unknown; icon?: unknown; type?: unknown; tone?: unknown; lane?: unknown; [k: string]: unknown }
export interface InputInterface {
  id?: unknown; from?: unknown; to?: unknown; label?: unknown; protocol?: unknown; description?: unknown; [k: string]: unknown
}
export interface DiagramInput {
  title?: unknown; subtitle?: unknown; nodes?: unknown; interfaces?: unknown; groups?: unknown
  direction?: unknown; lanes?: unknown; connections?: unknown; [k: string]: unknown
}

export type NodeStatus = "active" | "bypassed" | "planned" | "external"
export interface Node {
  id: string; kind: string; title: string; detail: string; status: NodeStatus; index: number; group?: string; icon?: string
  shape?: FlowShape; tone?: string; lane?: string; fields?: string[]; methods?: string[]
}
export interface Interface {
  id: string; from: string; to: string; label: string; protocol: string; description: string; index: number
  rel?: string
}
export interface Group { id: string; title: string; parent?: string }
export interface Facts {
  title: string; subtitle: string; nodes: Node[]; interfaces: Interface[]; dropped: string[]; groups?: Group[]; flow?: FlowSpec
  sequence?: SequenceSpec
}

export function isFlowInput(input: DiagramInput | undefined) {
  if (!input || typeof input !== "object") return false
  if (typeof input.direction === "string" || Array.isArray(input.connections) || Array.isArray(input.lanes)) return true
  return Array.isArray(input.nodes) && (input.nodes as unknown[]).some((n) => !!n && typeof n === "object" && "type" in n && !("kind" in n))
}

export function resolveIcon(icon: string, title: string, detail = "") {
  const key = icon.trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (key in KIND) return KIND[key][1]
  if (key in ICONS) return key
  const words = ` ${icon} ${title} ${detail} `.toLowerCase().replace(/[^a-z0-9/.-]+/g, " ")
  return GLYPH_HINTS.find(([ws]) => ws.some((w) => words.includes(w)))?.[1] ?? "g_process"
}

const text = (v: unknown): string => {
  if (v == null) return ""
  if (typeof v === "string") return v.trim()
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join("; ")
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${text(x)}`).join("; ")
  return String(v)
}

export const slug = (v: unknown): string => text(v).toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "")

export type DiagramKind = "architecture" | "general" | Family | "sequence"
export const INPUT_KEYS: Record<DiagramKind, [nodes: string, edges: string]> = {
  architecture: ["nodes", "interfaces"], general: ["nodes", "interfaces"], flowchart: ["nodes", "connections"],
  state: ["states", "transitions"], class: ["classes", "relationships"], er: ["entities", "relationships"],
  sequence: ["participants", "messages"],
}
// The architecture tool calls user-named groups "containers"; with any, it is drawn as a grouped diagram.
const withContainers = (input: DiagramInput): DiagramInput =>
  Array.isArray(input.containers) && input.containers.length && !Array.isArray(input.groups) ? { ...input, groups: input.containers } : input

export function diagramKind(input: DiagramInput | undefined): DiagramKind {
  if (!input || typeof input !== "object") return "architecture"
  input = withContainers(input)
  const has = (k: string) => Array.isArray((input as Record<string, unknown>)[k])
  if (has("participants") || has("messages")) return "sequence"
  if (has("states") || has("transitions")) return "state"
  if (has("classes")) return "class"
  if (has("entities")) return "er"
  if (isFlowInput(input)) return "flowchart"
  if (has("groups")) return "general"
  return "architecture"
}

const VISIBILITY: Record<string, string> = { public: "+", private: "-", protected: "#", package: "~", internal: "~" }
function rows(v: unknown, er: boolean): string[] {
  if (!Array.isArray(v)) return []
  return v.map((r) => {
    if (r == null) return ""
    if (typeof r !== "object") return text(r)
    const o = r as Record<string, unknown>
    const name = text(o.name ?? o.field ?? o.column ?? o.signature)
    const type = text(o.type ?? o.returns ?? o.dataType)
    if (er) {
      const key = o.pk || o.primary || o.primaryKey ? "PK " : o.fk || o.foreign || o.foreignKey || o.references ? "FK " : ""
      return `${key}${name}${type ? `: ${type}` : ""}`
    }
    const vis = VISIBILITY[text(o.visibility).toLowerCase()] ?? text(o.visibility).slice(0, 1)
    const params = o.params ?? o.parameters
    const args = Array.isArray(params) ? `(${params.map(text).join(", ")})` : ""
    return `${vis}${vis ? " " : ""}${name}${args}${type ? `: ${type}` : ""}`
  }).filter(Boolean)
}

export function normaliseFacts(input: DiagramInput, streaming = false): Facts {
  if (input && typeof input === "object") input = withContainers(input)
  const kind = diagramKind(input)
  const layered = kind === "flowchart" || kind === "state" || kind === "class" || kind === "er"
  const raw = (input ?? {}) as Record<string, unknown>
  const [nodeKey, edgeKey] = INPUT_KEYS[kind]
  const rawNodes = Array.isArray(raw[nodeKey]) ? (raw[nodeKey] as InputNode[]) : []
  const rawIfs = Array.isArray(raw[edgeKey]) ? (raw[edgeKey] as InputInterface[]) : []
  const interfacesStarted = raw[edgeKey] !== undefined
  const general = kind === "general"
  const dropped: string[] = []
  const nodes: Node[] = []
  const seen = new Set<string>()
  rawNodes.forEach((n, index) => {
    if (!n || typeof n !== "object") return
    const o = n as Record<string, unknown>
    const id = slug(n.id ?? o.name)
    const rawKind = text(n.kind).toLowerCase()
    const trailing = streaming && !interfacesStarted && index === rawNodes.length - 1
    // While streaming, the last item may still be half-written.
    if (!id || (trailing && (kind !== "architecture" || !(rawKind in KIND)))) return
    if (seen.has(id)) { dropped.push(`duplicate node ${id}`); return }
    seen.add(id)
    const s = text(n.status).toLowerCase()
    const title = text(n.title ?? o.name) || id.replace(/_/g, " ")
    const status = (["active", "bypassed", "planned", "external"].includes(s) ? s : "active") as NodeStatus
    if (layered) {
      const shape = kind === "state" ? stateShape(text(n.type)) : kind === "class" ? classShape(text(n.type))
        : kind === "er" ? "entity" : flowShape(text(n.type), title)
      const detail = text(n.detail ?? o.activities ?? o.description)
      nodes.push({
        id, kind, title, detail, status, index, shape, tone: flowTone(text(n.tone), shape, title),
        ...(slug(n.lane) ? { lane: slug(n.lane) } : {}),
        ...(kind === "class" ? { fields: rows(o.attributes ?? o.fields ?? o.values, false), methods: rows(o.methods ?? o.operations, false) } : {}),
        ...(kind === "er" ? { fields: rows(o.fields ?? o.columns ?? o.attributes, true) } : {}),
      })
      return
    }
    if (kind === "sequence") {
      nodes.push({ id, kind, title, detail: text(n.detail), status, index, shape: text(n.type).toLowerCase() as FlowShape })
      return
    }
    if (general) {
      const icon = text(n.icon) || rawKind
      const key = icon.toLowerCase().replace(/[\s-]+/g, "_")
      // A node without a group stays outside every container, as requested.
      nodes.push({
        id, kind: key in KIND ? key : "general", title, detail: text(n.detail), status, index,
        ...(slug(n.group) ? { group: slug(n.group) } : {}), icon: resolveIcon(icon, title, text(n.detail)),
      })
      return
    }
    nodes.push({
      id,
      kind: brandKind(normaliseKind(rawKind, text(n.title), text(n.detail)), title),
      title,
      detail: text(n.detail),
      status,
      index,
    })
  })
  const interfaces: Interface[] = []
  rawIfs.forEach((i, index) => {
    if (!i || typeof i !== "object") return
    const o = i as Record<string, unknown>
    const from = slug(i.from)
    const to = slug(i.to)
    if (!seen.has(from) || !seen.has(to)) {
      if (!(streaming && index === rawIfs.length - 1)) dropped.push(`interface ${from || "?"} -> ${to || "?"}`)
      return
    }
    let label = text(i.label)
    let rel: string | undefined
    if (kind === "state") {
      const guard = text(o.guard), action = text(o.action)
      label = label || [text(o.event ?? o.trigger), guard ? `[${guard}]` : "", action ? `/ ${action}` : ""].filter(Boolean).join(" ")
    } else if (kind === "class") {
      rel = classRelation(text(o.type ?? o.kind ?? o.relation))
      label = label || text(o.multiplicity ?? o.role)
    } else if (kind === "er") {
      rel = erCardinality(text(o.cardinality ?? o.type))
    } else if (kind === "sequence") {
      rel = text(o.type ?? o.kind).toLowerCase() || "sync"
    }
    interfaces.push({
      id: "", from, to, label, protocol: text(i.protocol), description: text(i.description), index, ...(rel ? { rel } : {}),
    })
  })
  interfaces.forEach((itf, n) => { itf.id = `${kind === "architecture" ? "IF" : "F"}-${String(n + 1).padStart(2, "0")}` })
  let groups: Group[] | undefined
  if (general) {
    const raw = (Array.isArray(input.groups) ? input.groups as unknown[] : [])
      .map((g) => (typeof g === "object" && g ? g as Record<string, unknown> : { id: g, title: g }))
      .map((g) => ({ id: slug(g.id ?? g.title), title: text(g.title ?? g.id), parent: slug(g.parent ?? g.in ?? g.within) }))
      .filter((g) => g.id)
    const ids = new Set<string>()
    groups = raw.filter((g) => !ids.has(g.id) && ids.add(g.id))
    // Nesting must form a tree: unknown parents and cycles are dropped (the group then sits at the top level).
    const parentOf = new Map(groups.map((g) => [g.id, g.parent]))
    for (const g of groups) {
      if (!g.parent || !ids.has(g.parent) || g.parent === g.id) { delete (g as Group).parent; continue }
      const seen = new Set([g.id])
      let p: string | undefined = g.parent
      while (p && !seen.has(p)) { seen.add(p); p = parentOf.get(p) || undefined }
      if (p) { delete (g as Group).parent; parentOf.set(g.id, "") }
    }
    for (const g of groups) if (!g.parent) delete (g as Group).parent
  }
  const lanes = layered && Array.isArray(input.lanes)
    ? (input.lanes as unknown[]).map((g) => (typeof g === "object" && g ? g as Record<string, unknown> : { id: g, title: g }))
      .map((g) => ({ id: slug(g.id ?? g.title), title: text(g.title ?? g.id) })).filter((g) => g.id)
    : []
  const direction = parseDirection(text(input?.direction))
  const spec: FlowSpec | undefined = layered ? { family: kind, direction, lanes } : undefined
  const fallback: Record<DiagramKind, string> = {
    architecture: "Architecture", general: "Diagram", flowchart: "Flowchart", state: "State machine", class: "Class diagram",
    er: "Entity relationship diagram", sequence: "Sequence diagram",
  }
  return {
    title: text(input?.title) || fallback[kind], subtitle: text(input?.subtitle), nodes, interfaces, dropped,
    ...(groups ? { groups } : {}), ...(spec ? { flow: spec } : {}),
    ...(kind === "sequence" ? { sequence: sequenceSpec(raw, streaming) } : {}),
  }
}