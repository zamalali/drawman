// Turns a rendered diagram into the tool result, and optionally saves it as .drawio plus a draw.io web link.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { AsyncLocalStorage } from "node:async_hooks"
import { deflateRawSync } from "node:zlib"
import { config } from "../config.js"
import { diagramKind, normaliseFacts, renderDiagram, sceneLayout, type DiagramInput, type Positions, type Pt, type Reroute } from "../engine/index.js"
import "../engine/server-setup.js"

export function diagramsNetLink(title: string, xml: string): string {
  const data = deflateRawSync(Buffer.from(encodeURIComponent(xml), "utf8")).toString("base64")
  return `https://app.diagrams.net/?title=${encodeURIComponent(`${slug(title)}.drawio`)}#R${encodeURIComponent(data)}`
}

// Agents won't paste a multi-KB link, so a small page carries it; the diagram stays in the URL fragment, never sent to a server.
const opener = (title: string, url: string) => `<!doctype html><meta charset="utf-8"><title>${title.replace(/[<&"]/g, "")}</title>
<script>location.replace(${JSON.stringify(url).replace(/</g, "\\u003c")})</script>
<p>Opening the diagram in draw.io… <a href="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">Click here</a> if nothing happens.</p>
`

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "architecture"

const placedAt = (scene: ReturnType<typeof renderDiagram>["scene"]): Positions => Object.fromEntries([
  ...scene.cards.map((c) => [c.node.id, [c.box[0], c.box[1]]]),
  ...scene.zones.map((z) => [`zone:${z.id}`, [z.box[0], z.box[1]]]),
])

// Edits keep the diagram steady: each drawing's layout (positions and routes) is kept with it, and an edit starts from
// it, so existing nodes (and their groups) stay where they were and only new nodes are placed. The tool call says which
// layout to use (layoutContext): an edit names its diagram; a plain redraw may match a recent drawing of the same
// connection by its node ids, which is never done on the shared HTTP server.
export interface Memo { kind: string; ids: Set<string>; positions: Positions; routes: Map<string, Pt[]>; file?: string }
export interface LayoutContext { base?: Memo; recent?: Memo[]; memo?: Memo; fresh?: boolean }
export const layoutContext = new AsyncLocalStorage<LayoutContext>()
// Connections are matched by their ends (from>to, numbered when repeated), since ids are positional.
const routeKeys = (edges: { id: string; from: string; to: string }[]) => {
  const seen = new Map<string, number>()
  return edges.map((e) => { const k = `${e.from}>${e.to}`; const n = seen.get(k) ?? 0; seen.set(k, n + 1); return [e.id, `${k}#${n}`] as const })
}
const memoKind = (facts: ReturnType<typeof renderDiagram>["facts"]) =>
  facts.sequence ? "sequence" : facts.flow ? facts.flow.family : facts.groups ? "general" : "architecture"
const kindOf = (args: DiagramInput): string => diagramKind(args)

function closest(args: DiagramInput, recent: Memo[]) {
  const kind = kindOf(args)
  const ids = new Set(normaliseFacts(args).nodes.map((n) => n.id))
  let best: Memo | undefined, score = 0
  for (const d of recent) {
    if (d.kind !== kind) continue
    const kept = [...d.ids].filter((id) => ids.has(id)).length
    const s = kept / Math.max(d.ids.size, 1)
    if (kept && s >= 0.5 && s > score) { best = d; score = s }
  }
  return best
}
function previousLayout(args: DiagramInput, ctx: LayoutContext | undefined): { positions: Positions; keep: Reroute } | undefined {
  if (!ctx || ctx.fresh || diagramKind(args) === "sequence") return undefined
  const best = ctx.base && ctx.base.kind === kindOf(args) ? ctx.base : ctx.recent ? closest(args, ctx.recent) : undefined
  if (!best || !Object.keys(best.positions).length) return undefined
  const facts = normaliseFacts(args)
  const ids = new Set(facts.nodes.map((n) => n.id))
  const positions = Object.fromEntries(Object.entries(best.positions).filter(([k]) => k.startsWith("zone:") || ids.has(k)))
  if (!Object.keys(positions).some((k) => ids.has(k))) return undefined
  const previous = new Map<string, Pt[]>()
  for (const [id, key] of routeKeys(facts.interfaces)) { const r = best.routes.get(key); if (r) previous.set(id, r) }
  return { positions, keep: { moved: new Set([...ids].filter((id) => !best.ids.has(id))), previous } }
}
function remember(ctx: LayoutContext | undefined, facts: ReturnType<typeof renderDiagram>["facts"], scene: ReturnType<typeof renderDiagram>["scene"]) {
  if (!ctx) return
  const byId = new Map(scene.edges.map((e) => [e.id, e.points]))
  const memo: Memo = {
    kind: memoKind(facts), ids: new Set(scene.cards.map((c) => c.node.id)), positions: placedAt(scene),
    routes: new Map(routeKeys(scene.edges).map(([id, key]) => [key, byId.get(id)!])),
  }
  ctx.memo = memo
  const recent = ctx.recent
  if (!recent) return
  const same = recent.findIndex((d) => d.kind === memo.kind && [...d.ids].every((id) => memo.ids.has(id)))
  if (same >= 0) recent.splice(same, 1)
  recent.unshift(memo)
  recent.length = Math.min(recent.length, 12)
}

// Shapes the user dragged in the view: the next edit starts from them. Their lines are routed afresh; null (the view's
// reset) forgets the arrangement, so the next edit is laid out automatically like the view now shows it.
export function adjustLayout(memo: Memo, moved: Positions | null) {
  if (!moved) { memo.positions = {}; memo.routes.clear(); return }
  Object.assign(memo.positions, moved)
  for (const key of [...memo.routes.keys()]) {
    const [from, to] = key.replace(/#\d+$/, "").split(">")
    if (from in moved || to in moved) memo.routes.delete(key)
  }
}

// Files written by this server, so a different diagram that happens to share a title gets its own file instead of
// overwriting one drawn earlier; an edit writes to its diagram's own file.
const claimed = new Set<string>()
function saveDrawio(title: string, xml: string, own?: string): { file?: string; open?: string; note?: string } {
  const root = config.workspaceRoots[0]
  if (!root) return { note: "Not saved: no workspace folder is configured (set DRAWMAN_WORKSPACE_ROOTS)." }
  const dir = path.resolve(root, config.outputDir)
  const rel = path.relative(root, dir)
  if (rel.startsWith("..") || path.isAbsolute(rel)) return { note: `Not saved: the output folder ${config.outputDir} is outside the workspace.` }
  try {
    mkdirSync(dir, { recursive: true })
    let file = own && path.dirname(own) === dir ? own : path.join(dir, `${slug(title)}.drawio`)
    for (let n = 2; file !== own && claimed.has(file); n++) file = path.join(dir, `${slug(title)}-${n}.drawio`)
    claimed.add(file)
    writeFileSync(file, xml)
    const open = `${file}.html`
    writeFileSync(open, opener(title, diagramsNetLink(title, xml)))
    return { file, open }
  } catch (error) {
    return { note: `Not saved (${(error as NodeJS.ErrnoException).code ?? (error as Error).message}); the diagram is in the tool result.` }
  }
}

export function summarise(args: DiagramInput, save: boolean, withXml = true) {
  const ctx = layoutContext.getStore()
  const prev = previousLayout(args, ctx)
  let pinned = prev?.positions
  let rendered: ReturnType<typeof renderDiagram>
  try {
    rendered = renderDiagram(args, false, pinned, prev?.keep)
  } catch (error) {
    // Keeping the earlier arrangement is a nicety: if it cannot hold the changed diagram, lay it out afresh rather
    // than fail the change.
    if (!pinned) throw error
    pinned = undefined
    rendered = renderDiagram(args, false)
  }
  const { facts, xml, stats, scene } = rendered
  remember(ctx, facts, scene)
  // What the live view needs to show and export the final diagram. Results for hosts without the view leave it out to
  // save tokens; it stays with the drawing (see VIEW_DATA) so a view that is shown anyway can still fetch it.
  const viewData: ViewData = {
    xml,
    ...(scene.placed ? { layout: scene.placed } : {}),
    // The exact boxes and lines as drawn, so the view finishes with the file's diagram without routing anything itself
    // (routing a large diagram takes seconds, and a host may open a fresh copy of the view after the call).
    ...(facts.sequence ? {} : { final: sceneLayout(scene) }),
    ...(pinned ? { positions: placedAt(scene), routes: Object.fromEntries(scene.edges.map((e) => [e.id, e.points])) } : {}),
  }
  const frames = scene.frames.map((f) => f.title).join(", ")
  const zones = scene.zones.map((z) => `${z.title} (${scene.cards.filter((c) => c.zoneId === z.id).length})`).join(", ")
  const titles = new Map(facts.nodes.map((n) => [n.id, n.title]))
  const ifs = scene.edges.map((e) => `${e.id} ${titles.get(e.from)} -> ${titles.get(e.to)}`).join("; ")
  const saved = save ? saveDrawio(facts.title, xml, ctx?.base?.file) : {}
  if (ctx?.memo && saved.file) ctx.memo.file = saved.file
  const file = saved.file ?? null
  const open = saved.open ? pathToFileURL(saved.open).href : null
  const notes = [
    facts.dropped.length ? `Dropped: ${facts.dropped.join("; ")}.` : "",
    scene.unrouted.length ? `No clear route for ${scene.unrouted.join(", ")}.` : "",
    file ? `Saved to ${file} (opens in draw.io desktop or the VS Code Draw.io extension).` : saved.note ?? "",
    open ? `Show the user this link, which opens it in the draw.io web editor: ${open}` : "",
  ].filter(Boolean).join(" ")
  const steps = facts.flow || facts.sequence
    ? scene.edges.map((e) => `${titles.get(e.from)} -> ${titles.get(e.to)}${e.rel && !facts.sequence ? ` ${e.rel}` : ""}${e.label ? ` (${e.label})` : ""}`).join("; ")
    : ""
  const kind = facts.sequence ? ["sequence diagram", "participants", "messages"] : facts.flow
    ? ({ flowchart: ["flowchart", "steps", "connections"], state: ["state diagram", "states", "transitions"],
      class: ["class diagram", "classes", "relationships"], er: ["ER diagram", "tables", "relationships"] } as const)[facts.flow.family]
    : null
  return {
    content: [{
      type: "text" as const,
      text: (kind
        ? `Rendered ${kind[0]} "${facts.title}"${file ? "" : " live for the user"}: ${stats.cards} ${kind[1]}${facts.flow?.lanes.length ? ` in ${zones}` : ""}, ` +
          `${stats.edges} ${kind[2]} [${steps}]. draw.io file: ${(stats.bytes / 1024).toFixed(0)} KB. ${notes}`
        : `Rendered "${facts.title}"${file ? "" : " live for the user"}: ${stats.cards} components in ${stats.zones} zones` +
          `${frames ? ` across ${frames}` : ""} [${zones}], ${stats.edges} routed interfaces [${ifs}]. ` +
          `draw.io file: ${(stats.bytes / 1024).toFixed(0)} KB. ${notes}`).trim(),
    }],
    structuredContent: {
      title: facts.title, stats, ...(file ? { file } : {}), ...(open ? { open } : {}),
      ...(withXml ? viewData : file ? {} : { xml }),
      [VIEW_DATA]: viewData,
    } as Record<string, unknown>,
  }
}

// Symbol-keyed, so object spreads carry it to the server's diagram store but it is never serialised into the result.
export const VIEW_DATA: unique symbol = Symbol("drawman.viewData")
export type ViewData = { xml: string; layout?: unknown; final?: unknown; positions?: Positions; routes?: Record<string, Pt[]> }

export const failure = (prefix: string, error: unknown) =>
  ({ isError: true, content: [{ type: "text" as const, text: `${prefix}: ${(error as Error).message}` }] })
