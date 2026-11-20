// Entry point of the MCP App: wires the toolbar and connects to the host.
import "./styles.css"
import { ICONS, buildDrawio } from "../engine/index.js"
import { escHtml, setStatus, tick, ui } from "./dom.js"
import { fitTo } from "./camera.js"
import { app, applyContext } from "./host.js"
import { drawFlow } from "./render.js"
import { state } from "./state.js"
import "./interaction.js"
import "./stream.js"

app.ontoolcancelled = ({ reason }) => setStatus("error", `Cancelled${reason ? `: ${reason}` : ""}`)
app.onhostcontextchanged = (ctx) => applyContext({ ...app.getHostContext(), ...ctx })
app.onteardown = async () => ({})

ui.fit.onclick = () => { state.userMoved = false; fitTo(state.current) }
ui.flow.onclick = () => { state.flowOn = !state.flowOn; ui.flow.classList.toggle("on", state.flowOn); drawFlow() }
ui.fullscreen.onclick = async () => {
  const mode = document.documentElement.dataset.display === "fullscreen" ? "inline" : "fullscreen"
  try {
    const res = await app.requestDisplayMode({ mode })
    document.documentElement.dataset.display = res.mode
    ui.fullscreen.textContent = res.mode === "fullscreen" ? "⤡" : "⤢"
    setTimeout(() => { state.userMoved = false; fitTo(state.current) }, 120)
  } catch { /* host refused */ }
}
const fileName = () => (state.current?.facts.title || "architecture").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".drawio"
// The server's draw.io file (or, after a drag, the view's own); if neither arrived, the diagram exactly as it is shown.
const exportXml = () => state.xml || (state.current?.cards.length ? buildDrawio(state.current).xml : "")
async function openInDrawio(xml: string) {
  const bytes = new TextEncoder().encode(encodeURIComponent(xml))
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))
  const buf = new Uint8Array(await new Response(stream).arrayBuffer())
  let bin = ""
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  const url = `https://app.diagrams.net/?title=${encodeURIComponent(fileName())}#R${encodeURIComponent(btoa(bin))}`
  try { await app.openLink({ url }); return true } catch { tick("Host blocked opening the link"); return false }
}
ui.download.onclick = async () => {
  const xml = exportXml()
  if (!xml) return
  if (app.getHostCapabilities()?.downloadFile) {
    const res = await app.downloadFile({ contents: [{ type: "resource", resource: { uri: `file:///${fileName()}`, mimeType: "application/vnd.jgraph.mxfile", text: xml } }] }).catch(() => ({ isError: true }))
    if (!res.isError) tick(`⬇ <b>${escHtml(fileName())}</b> downloaded`)
    return
  }
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([xml], { type: "application/xml" }))
  a.download = fileName()
  a.click()
}
ui.open.onclick = async () => {
  const xml = exportXml()
  if (xml) await openInDrawio(xml)
}
// A host that embeds the view without file downloads sandboxes it, where a download link does nothing: there the only
// export is draw.io (which saves .drawio, PNG, SVG and PDF), so it becomes the main button.
function exportButtons() {
  const canSave = !!app.getHostCapabilities()?.downloadFile || window.parent === window
  ui.download.hidden = !canSave
  ui.open.classList.toggle("primary", !canSave)
  if (!canSave) ui.open.title = "Open in draw.io to edit it, or save it there as .drawio, PNG, SVG or PDF"
}

fitTo(null, true)
void ICONS
app.connect().then(() => { applyContext(app.getHostContext()); exportButtons() }).catch(() => setStatus("error", "No MCP Apps host connection"))
