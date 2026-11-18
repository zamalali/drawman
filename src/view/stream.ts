// Turns streamed tool input into a progressively built scene and finishes it when the result arrives.
import { INPUT_KEYS, buildScene, checkLayout, diagramKind, normaliseFacts, type Card, type Edge, type Positions, type Pt, type Scene, type SerialLayout } from "../engine/index.js"
import { escHtml, layers, setStatus, tick, ui, world } from "./dom.js"
import { fitTo } from "./camera.js"
import { app } from "./host.js"
import { showAnalysis, showScanning, showSuggestions, type Analysis } from "./panels.js"
import { drawCards, drawEdges, drawFlow, drawFrame, drawLegend, drawTitle, drawZones } from "./render.js"
import { drawSequence } from "./render-sequence.js"
import { state } from "./state.js"

// Arguments may arrive in bursts, so the view reveals one item per beat until it has caught up.
type Stats = { cards: number; zones: number; edges: number }
let latest: Record<string, unknown> | null = null
let inputFinal = false
let resultStats: Stats | undefined
let resultReady = false
// True once partial input arrived, i.e. the user is watching the model write this diagram.
let streamed = false
let shownNodes = 0
let shownEdges = 0
let beat = 0
// Connection routes the server kept from the previous version of this diagram (edits), drawn exactly as in the file.
let kept: Map<string, Pt[]> | null = null

function available(args: Record<string, unknown>) {
  const f = normaliseFacts(args, !inputFinal)
  const [, edgeKey] = INPUT_KEYS[diagramKind(args)]
  return {
    nodes: f.nodes.length ? Math.max(...f.nodes.map((n) => n.index)) + 1 : 0,
    edges: f.interfaces.length ? Math.max(...f.interfaces.map((i) => i.index)) + 1 : 0,
    edgesStarted: Array.isArray(args[edgeKey]),
  }
}

function nouns(scene: Scene): [string, string, string, string] {
  if (scene.seq) return ["participants", "messages", "Adding participants", "Sending messages"]
  switch (scene.facts.flow?.family) {
    case "state": return ["states", "transitions", "Placing states", "Adding transitions"]
    case "class": return ["classes", "relationships", "Placing classes", "Relating classes"]
    case "er": return ["tables", "relationships", "Placing tables", "Relating tables"]
    case "flowchart": return ["steps", "connections", "Placing steps", "Connecting steps"]
  }
  return ["components", "interfaces", "Placing components", "Wiring interfaces"]
}

function receive(args: Record<string, unknown>, final: boolean) {
  latest = args
  if (final) inputFinal = true
  draw()
  if (!beat) step()
}

function step() {
  beat = 0
  if (!latest) return
  const a = available(latest)
  const nodesDone = shownNodes >= a.nodes && (a.edgesStarted || inputFinal)
  let backlog = 0
  if (shownNodes < a.nodes) {
    shownNodes++
    backlog = a.nodes - shownNodes
  } else if (nodesDone && shownEdges < a.edges) {
    shownEdges++
    backlog = a.edges - shownEdges
  } else {
    if (inputFinal && resultReady && !state.done) finish(resultStats)
    return
  }
  draw()
  const edgesPhase = shownNodes >= a.nodes && nodesDone
  const delay = edgesPhase ? (backlog > 8 ? 90 : 150) : backlog > 8 ? 130 : backlog > 3 ? 190 : 260
  beat = window.setTimeout(step, delay)
}

export function draw(moved?: Set<string>) {
  if (!latest) return
  const [nodeKey, edgeKey] = INPUT_KEYS[diagramKind(latest)]
  const rawNodes = Array.isArray(latest[nodeKey]) ? latest[nodeKey] as unknown[] : []
  const rawIfs = Array.isArray(latest[edgeKey]) ? latest[edgeKey] as unknown[] : []
  const slice = { ...latest, [nodeKey]: rawNodes.slice(0, shownNodes), [edgeKey]: rawIfs.slice(0, shownEdges) }
  let scene: Scene
  try {
    const reroute = moved && state.current ? { moved, previous: new Map(state.current.edges.map((e) => [e.id, e.points] as [string, Pt[]])) }
      : kept ? { moved: new Set<string>(), previous: kept } : undefined
    scene = buildScene(normaliseFacts(slice, false), state.positions, reroute, state.layout ?? undefined)
    checkLayout(scene)
  } catch (error) {
    if (inputFinal) setStatus("error", (error as Error).message)
    return
  }
  state.current = scene
  ui.title.textContent = scene.facts.title
  ui.subtitle.textContent = scene.facts.subtitle || "draw.io · live"
  if (scene.cards.length) ui.empty.classList.add("gone")
  const addedCards: Card[] = [], addedEdges: Edge[] = []
  drawTitle(scene)
  drawFrame(scene)
  drawZones(scene)
  if (scene.seq) drawSequence(scene, addedCards, addedEdges)
  else {
    layers.seq.replaceChildren()
    drawCards(scene, addedCards)
    drawEdges(scene, addedEdges)
  }
  drawLegend(scene)
  const titles = new Map(scene.facts.nodes.map((n) => [n.id, n.title]))
  const [, , placing, linking] = nouns(scene)
  if (!quiet) for (const c of addedCards) tick(`＋ <b>${escHtml(c.node.title)}</b>${c.zoneTitle ? ` → ${escHtml(c.zoneTitle)}` : ""}`)
  if (!quiet) for (const e of addedEdges) tick(scene.facts.flow || scene.seq
    ? `↳ ${escHtml(titles.get(e.from) ?? "")} → ${escHtml(titles.get(e.to) ?? "")}${e.label ? ` · <b>${escHtml(e.label)}</b>` : ""}`
    : `↳ <b>${e.id}</b> ${escHtml(titles.get(e.from) ?? "")} → ${escHtml(titles.get(e.to) ?? "")}${e.protocol ? ` · ${escHtml(e.protocol)}` : ""}`)
  if (!state.done) {
    const total = latest ? available(latest) : { nodes: 0, edges: 0 }
    setStatus("building", shownEdges || (inputFinal && shownNodes >= total.nodes)
      ? `${linking} · ${scene.edges.length}/${Math.max(total.edges, scene.edges.length)}`
      : `${placing} · ${scene.cards.length}/${Math.max(total.nodes, scene.cards.length)}`)
  }
  if (!state.userMoved) fitTo(scene)
}

function finish(stats?: { cards: number; zones: number; edges: number }) {
  state.done = true
  // The server's routes were for revealing the result; from here on drags re-route from what is on screen.
  kept = null
  world.classList.add("editable")
  ui.download.disabled = ui.open.disabled = !(state.xml || state.current?.cards.length)
  ui.flow.disabled = false
  ui.flow.classList.toggle("on", state.flowOn)
  setStatus("done", state.current?.facts.flow || state.current?.seq
    ? `${state.current.cards.length} ${nouns(state.current)[0]} · ${state.current.edges.length} ${nouns(state.current)[1]}`
    : stats ? `${stats.cards} components · ${stats.zones} zones · ${stats.edges} interfaces` : "Done")
  tick(`✓ <b>Diagram ready</b> · routed with A* (no ${state.current?.facts.flow ? "line" : "edge"} crosses a ${state.current?.facts.flow ? "shape" : "card"})`)
  drawFlow()
  showSuggestions()
  if (!state.userMoved) fitTo(state.current)
}

// An edit (edit_diagram) streams only the change. As soon as its diagram id arrives, the view fetches the diagram as
// it is and shows it at once; when the result comes, only the added parts are revealed.
type Shown = { diagram?: Record<string, unknown>; layout?: SerialLayout; positions?: Positions; routes?: Record<string, Pt[]> }
const isEdit = (args: Record<string, unknown>) => typeof args.diagram === "string"
let editing = false
const APPLYING = "Applying the change…"
function awaitEdit(args: Record<string, unknown>) {
  setStatus("building", APPLYING)
  ui.empty.querySelector("div:last-child")!.textContent = "Applying the change to the diagram…"
  // The id may still be arriving; ask for the diagram once it is complete.
  const id = String(args.diagram)
  if (editing || !/^[0-9a-f]{8}$/.test(id)) return
  editing = true
  void app.callServerTool({ name: "show_diagram", arguments: { diagram: id } }).then((r) => {
    const sc = r.structuredContent as Shown | undefined
    if (r.isError || !sc?.diagram || resultReady) return
    useServerLayout(sc, true)
    const [nodeKey, edgeKey] = INPUT_KEYS[diagramKind(sc.diagram)]
    shownNodes = (sc.diagram[nodeKey] as unknown[] | undefined)?.length ?? 0
    shownEdges = (sc.diagram[edgeKey] as unknown[] | undefined)?.length ?? 0
    quietly(() => receive(sc.diagram!, true))
    setStatus("building", APPLYING)
  }).catch(() => undefined)
}
// Existing items appear without a line each in the activity feed; only what an edit adds is announced.
let quiet = false
function quietly(fn: () => void) { quiet = true; try { fn() } finally { quiet = false } }
function useServerLayout(sc: Shown, replace: boolean) {
  if (replace) { state.pinned = sc.positions ?? {}; state.positions = { ...state.pinned } }
  else if (sc.positions) { state.pinned = sc.positions; state.positions = { ...sc.positions, ...state.positions } }
  kept = sc.routes ? new Map(Object.entries(sc.routes)) : null
  if (sc.layout) state.layout = sc.layout
}
// The server's final drawing of a diagram it keeps (show_diagram is app-only, so this costs the model nothing). Gives up
// after a few seconds: the view then exports what it shows (see view.ts).
async function fetchDrawing(id: string): Promise<Pick<Shown, "layout" | "positions" | "routes"> & { xml?: string }> {
  const call = app.callServerTool({ name: "show_diagram", arguments: { diagram: id } })
  const r = await Promise.race([call, new Promise<null>((done) => setTimeout(() => done(null), 4000))]).catch(() => null)
  const v = r && !r.isError ? r.structuredContent as (Shown & { xml?: unknown }) | undefined : undefined
  if (typeof v?.xml !== "string" || !v.xml) return {}
  return { xml: v.xml, ...(v.layout ? { layout: v.layout } : {}), ...(v.positions ? { positions: v.positions } : {}), ...(v.routes ? { routes: v.routes } : {}) }
}

app.ontoolinputpartial = ({ arguments: args }) => {
  if (!args || inputFinal || "repository" in args) return
  streamed = true
  if (isEdit(args)) awaitEdit(args)
  else receive(args, false)
}
app.ontoolinput = ({ arguments: args }) => {
  if (!args) return
  if (typeof args.repository === "string") showScanning(args.repository)
  else if (isEdit(args)) awaitEdit(args)
  else receive(args, true)
}
app.ontoolresult = async (result) => {
  if (result.isError) {
    setStatus("error", result.content?.map((c) => ("text" in c ? c.text : "")).join(" ") || "Diagram failed")
    return
  }
  const sc = result.structuredContent as { xml?: string; stats?: Stats; diagram?: Record<string, unknown>; analysis?: Analysis; handoff?: boolean; layout?: SerialLayout; positions?: Positions; routes?: Record<string, Pt[]>; edit?: { nodes: number; edges: number }; sheet?: string; file?: string } | undefined
  // Hosts the server takes for a terminal (e.g. a Copilot CLI session shown in VS Code) get a result without the drawing,
  // which the server saved to the project instead. Fetch it, so the canvas shows the same final layout and can export it.
  if (sc && !sc.xml && sc.sheet) Object.assign(sc, await fetchDrawing(sc.sheet))
  if (sc?.file) tick(`💾 Saved <b>${escHtml(sc.file.split(/[\\/]/).pop() ?? sc.file)}</b> in the project`)
  state.xml = state.serverXml = sc?.xml ?? ""
  resultStats = sc?.stats
  if (sc?.sheet) state.sheet = sc.sheet
  // Edits: existing nodes keep their places (the server pinned them, and slid some down to make room), so the view
  // takes the server's positions and routes as they are.
  if (sc?.edit && sc.diagram) {
    resultReady = true
    useServerLayout(sc, true)
    shownNodes = sc.edit.nodes
    shownEdges = sc.edit.edges
    quietly(() => receive(sc.diagram!, true))
    if (!beat) step()
    return
  }
  if (sc?.positions || sc?.routes || sc?.layout) useServerLayout(sc, false)
  if (sc?.layout || sc?.positions) draw()
  if (sc?.analysis) showAnalysis(sc.analysis)
  if (sc?.handoff) {
    setStatus("done", "Evidence collected · the agent is drawing the diagram")
    ui.empty.querySelector("div:last-child")!.textContent = "Evidence handed to the agent; the diagram follows in its next step."
    return
  }
  if (sc?.diagram && (!latest || sc.analysis)) {
    resultReady = true
    receive(sc.diagram, true)
    return
  }
  resultReady = true
  if (!latest) return
  // Streamed live: keep revealing at the drawing pace. Never streamed (a View restored after a reload, or a host that
  // sends no partial input): the diagram is final, so show it whole instead of replaying it.
  if (streamed) {
    if (!beat) step()
    return
  }
  revealAll()
  if (!state.done) finish(resultStats)
}

function revealAll() {
  if (beat) window.clearTimeout(beat)
  beat = 0
  const a = available(latest!)
  shownNodes = Math.max(shownNodes, a.nodes)
  shownEdges = Math.max(shownEdges, a.edges)
  draw()
}
