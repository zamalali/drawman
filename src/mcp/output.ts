// Turns a rendered diagram into the tool result, and optionally saves it as .drawio plus a draw.io web link.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { deflateRawSync } from "node:zlib"
import { config } from "../config.js"
import { renderDiagram, type DiagramInput } from "../engine/index.js"
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
  const { facts, xml, stats, scene } = renderDiagram(args)
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
    structuredContent: { title: facts.title, stats, ...(withXml || !file ? { xml } : {}), ...(file ? { file } : {}), ...(open ? { open } : {}), ...(withXml && scene.placed ? { layout: scene.placed } : {}) } as Record<string, unknown>,
  }
}

export const failure = (prefix: string, error: unknown) =>
  ({ isError: true, content: [{ type: "text" as const, text: `${prefix}: ${(error as Error).message}` }] })
