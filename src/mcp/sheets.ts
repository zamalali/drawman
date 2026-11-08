// Diagrams drawn earlier, so a follow-up can send only what changes instead of the whole diagram again.
// Ids are random: on a shared HTTP server one user cannot reach another user's diagram by guessing.
import { randomBytes } from "node:crypto"
import { INPUT_KEYS, diagramKind, type DiagramInput } from "../engine/index.js"
import type { Memo } from "./output.js"

type Item = Record<string, unknown>
// view: the server's layout of the latest drawing (positions, routes), so the live view can show it while an edit streams.
interface Sheet { tool: string; args: Item; view: Item; memo?: Memo }
const sheets = new Map<string, Sheet>()
const LIMIT = 50

export function keepSheet(tool: string, args: Item, id?: string, view: Item = {}, memo?: Memo) {
  const key = id ?? randomBytes(4).toString("hex")
  sheets.delete(key)
  sheets.set(key, { tool, args: structuredClone(args), view, memo })
  while (sheets.size > LIMIT) sheets.delete(sheets.keys().next().value!)
  return key
}

export const findSheet = (id: string) => sheets.get(id.trim())

export interface Change {
  title?: string
  subtitle?: string
  direction?: string
  add_nodes?: Item[]
  add_connections?: Item[]
  add_groups?: Item[]
  update?: Item[]
  remove?: string[]
}

// Groups are named by the tool that drew the diagram (an architecture diagram with containers counts as grouped).
const GROUPS_OF: Record<string, [groups: string, member: string]> = {
  create_architecture_diagram: ["containers", "group"], create_diagram: ["groups", "group"], create_flowchart: ["lanes", "lane"],
}

// Applies a change to a diagram's arguments. Kept nodes and connections stay first and in order, so `kept` counts the
// part the user has already seen; everything added comes after it.
export function applyChange(base: Item, change: Change, tool = "") {
  const args = structuredClone(base)
  const kind = diagramKind(args as DiagramInput)
  const [nodeKey, edgeKey] = INPUT_KEYS[kind]
  const [groupKey, memberKey] = GROUPS_OF[tool] ?? (kind === "general" ? GROUPS_OF.create_diagram : kind === "flowchart" ? GROUPS_OF.create_flowchart : [])
  const list = (k: string) => (Array.isArray(args[k]) ? args[k] : []) as Item[]
  for (const k of ["title", "subtitle", "direction"] as const) if (change[k] !== undefined) args[k] = change[k]

  const nodeIds = () => new Set(list(nodeKey).map((n) => String(n.id)))
  const groupIds = () => new Set(groupKey ? list(groupKey).map((g) => String(g.id)) : [])
  const known = () => [...nodeIds(), ...groupIds()].slice(0, 60).join(", ")
  const edgeKeyOf = (e: Item) => `${e.from}>${e.to}`

  const remove = new Set((change.remove ?? []).map((r) => r.replace(/\s*(->|→|>)\s*/, ">").trim()))
  for (const r of remove) {
    if (r.includes(">") ? !list(edgeKey).some((e) => edgeKeyOf(e) === r) : !nodeIds().has(r) && !groupIds().has(r)) {
      throw new Error(`Cannot remove "${r}": it is not in this diagram. Ids here: ${known()}`)
    }
  }
  const goneNodes = new Set([...nodeIds()].filter((id) => remove.has(id)))
  const goneGroups = new Set([...groupIds()].filter((id) => remove.has(id)))
  args[nodeKey] = list(nodeKey).filter((n) => !goneNodes.has(String(n.id)))
  if (groupKey && Array.isArray(args[groupKey])) {
    args[groupKey] = list(groupKey).filter((g) => !goneGroups.has(String(g.id)))
    // Members of a removed group move out of it; a removed parent leaves its child groups at the top level.
    for (const g of list(groupKey)) if (goneGroups.has(String(g.parent))) delete g.parent
    for (const n of list(nodeKey)) if (memberKey && goneGroups.has(String(n[memberKey]))) delete n[memberKey]
  }
  args[edgeKey] = list(edgeKey).filter((e) => !remove.has(edgeKeyOf(e)) && !goneNodes.has(String(e.from)) && !goneNodes.has(String(e.to)))
  const kept = { nodes: list(nodeKey).length, edges: list(edgeKey).length }

  for (const u of change.update ?? []) {
    const id = String(u.id ?? "")
    const target = list(nodeKey).find((n) => String(n.id) === id) ?? (groupKey ? list(groupKey).find((g) => String(g.id) === id) : undefined)
    if (!target) throw new Error(`Cannot update "${id}": it is not in this diagram. Ids here: ${known()}`)
    Object.assign(target, u, { id: target.id })
  }
  const upsert = (key: string, items: Item[] | undefined) => {
    if (!items?.length) return
    if (!Array.isArray(args[key])) args[key] = []
    const all = args[key] as Item[]
    for (const item of items) {
      const same = item.id !== undefined ? all.find((x) => String(x.id) === String(item.id)) : undefined
      if (same) Object.assign(same, item)
      else all.push(structuredClone(item))
    }
  }
  if (change.add_groups?.length && !groupKey) throw new Error(`A ${kind} diagram has no groups; add nodes and connections instead.`)
  if (groupKey) upsert(groupKey, change.add_groups)
  upsert(nodeKey, change.add_nodes)
  if (change.add_connections?.length) args[edgeKey] = [...list(edgeKey), ...change.add_connections.map((c) => structuredClone(c))]

  const parts = [
    change.add_nodes?.length ? `+${change.add_nodes.length} ${nodeKey}` : "",
    change.add_connections?.length ? `+${change.add_connections.length} ${edgeKey}` : "",
    change.add_groups?.length ? `+${change.add_groups.length} ${groupKey}` : "",
    change.update?.length ? `${change.update.length} updated` : "",
    remove.size ? `${remove.size} removed` : "",
  ].filter(Boolean)
  return { args, kept, summary: parts.length ? `Edited (${parts.join(", ")}).` : "Edited." }
}
