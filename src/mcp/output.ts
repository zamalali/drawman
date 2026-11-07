// Turns a rendered diagram into the tool result, and optionally saves it as .drawio plus a draw.io web link.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { deflateRawSync } from "node:zlib"
import { config } from "../config.js"
import { diagramKind, normaliseFacts, renderDiagram, type DiagramInput, type Positions, type Pt, type Reroute } from "../engine/index.js"
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

// Edits keep the diagram steady: the server remembers the last layouts it drew, and when a call reuses most of an
// earlier diagram's node ids, those nodes (and their groups) stay where they were; only new nodes are placed.
interface Drawn { kind: string; ids: Set<string>; positions: Positions; routes: Map<string, Pt[]> }
const drawn: Drawn[] = []
// Connections are matched by their ends (from>to, numbered when repeated), since ids are positional.
const routeKeys = (edges: { id: string; from: string; to: string }[]) => {
  const seen = new Map<string, number>()
  return edges.map((e) => { const k = `${e.from}>${e.to}`; const n = seen.get(k) ?? 0; seen.set(k, n + 1); return [e.id, `${k}#${n}`] as const })
}
function previousLayout(args: DiagramInput): { positions: Positions; keep: Reroute } | undefined {
  const kind = diagramKind(args)
  if (kind === "sequence") return undefined
  const facts = normaliseFacts(args)
  const ids = new Set(facts.nodes.map((n) => n.id))
  let best: Drawn | undefined, score = 0
  for (const d of drawn) {
    if (d.kind !== kind) continue
    const kept = [...d.ids].filter((id) => ids.has(id)).length
    const s = kept / Math.max(d.ids.size, 1)
    if (kept && s >= 0.5 && s > score) { best = d; score = s }
  }
  if (!best) return undefined
  const positions = Object.fromEntries(Object.entries(best.positions).filter(([k]) => k.startsWith("zone:") || ids.has(k)))
  const previous = new Map<string, Pt[]>()
  for (const [id, key] of routeKeys(facts.interfaces)) { const r = best.routes.get(key); if (r) previous.set(id, r) }
  return { positions, keep: { moved: new Set([...ids].filter((id) => !best!.ids.has(id))), previous } }
}
function remember(facts: ReturnType<typeof renderDiagram>["facts"], scene: ReturnType<typeof renderDiagram>["scene"]) {
  const kind = diagramKind(facts.sequence ? { participants: [] } : facts.flow ? { connections: [] } : facts.groups ? { groups: [] } : {})
  const positions: Positions = {}
  for (const c of scene.cards) positions[c.node.id] = [c.box[0], c.box[1]]
  for (const z of scene.zones) positions[`zone:${z.id}`] = [z.box[0], z.box[1]]
  const byId = new Map(scene.edges.map((e) => [e.id, e.points]))
  const routes = new Map(routeKeys(scene.edges).map(([id, key]) => [key, byId.get(id)!]))
  const entry = { kind: facts.flow ? facts.flow.family : kind, ids: new Set(scene.cards.map((c) => c.node.id)), positions, routes }
  const same = drawn.findIndex((d) => d.kind === entry.kind && [...d.ids].every((id) => entry.ids.has(id)))
  if (same >= 0) drawn.splice(same, 1)
  drawn.unshift(entry)
  drawn.length = Math.min(drawn.length, 12)
}

function saveDrawio(title: string, xml: string): { file?: string; open?: string; note?: string } {
  const root = config.workspaceRoots[0]
  if (!root) return { note: "Not saved: no workspace folder is configured (set DRAWMAN_WORKSPACE_ROOTS)." }
  const dir = path.resolve(root, config.outputDir)
  const rel = path.relative(root, dir)
  if (rel.startsWith("..") || path.isAbsolute(rel)) return { note: `Not saved: the output folder ${config.outputDir} is outside the workspace.` }
  try {
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${slug(title)}.drawio`)
    writeFileSync(file, xml)
    const open = path.join(dir, `${slug(title)}.drawio.html`)
    writeFileSync(open, opener(title, diagramsNetLink(title, xml)))
    return { file, open }
  } catch (error) {
    return { note: `Not saved (${(error as NodeJS.ErrnoException).code ?? (error as Error).message}); the diagram is in the tool result.` }
  }
}

export function summarise(args: DiagramInput, save: boolean, withXml = true) {
  const prev = previousLayout(args)
  const pinned = prev?.positions
  const { facts, xml, stats, scene } = renderDiagram(args, false, pinned, prev?.keep)
  remember(facts, scene)
  const frames = scene.frames.map((f) => f.title).join(", ")
  const zones = scene.zones.map((z) => `${z.title} (${scene.cards.filter((c) => c.zoneId === z.id).length})`).join(", ")
  const titles = new Map(facts.nodes.map((n) => [n.id, n.title]))
  const ifs = scene.edges.map((e) => `${e.id} ${titles.get(e.from)} -> ${titles.get(e.to)}`).join("; ")
  const saved = save ? saveDrawio(facts.title, xml) : {}
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
    structuredContent: { title: facts.title, stats, ...(withXml || !file ? { xml } : {}), ...(file ? { file } : {}), ...(open ? { open } : {}), ...(withXml && scene.placed ? { layout: scene.placed } : {}), ...(withXml && pinned ? { positions: pinned, routes: Object.fromEntries(scene.edges.map((e) => [e.id, e.points])) } : {}) } as Record<string, unknown>,
  }
}

export const failure = (prefix: string, error: unknown) =>
  ({ isError: true, content: [{ type: "text" as const, text: `${prefix}: ${(error as Error).message}` }] })
