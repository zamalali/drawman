// Runs ELK's layered algorithm synchronously through its in-process worker (no threads, no promises), so the engine can
// stay synchronous. The worker is created once and reused.
import { createRequire } from "node:module"
import * as ElkWorker from "elkjs/lib/elk-worker.min.js"

export interface ElkNode {
  id: string
  x?: number; y?: number; width?: number; height?: number
  layoutOptions?: Record<string, string>
  children?: ElkNode[]
  edges?: ElkEdge[]
  labels?: { text: string; width: number; height: number }[]
}
export interface ElkEdge {
  id: string; sources: string[]; targets: string[]
  labels?: { text: string; width: number; height: number; x?: number; y?: number }[]
  sections?: { startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: { x: number; y: number }[] }[]
}

type Worker = { onmessage: (m: { data: { data?: unknown; error?: unknown } }) => void; dispatcher: { saveDispatch(m: { data: unknown }): void } }
type WorkerModule = { Worker?: new () => Worker; default?: { Worker?: new () => Worker } | (new () => Worker) }
let worker: Worker | null = null

const ctorOf = (mod: WorkerModule | undefined) => mod?.Worker ?? (typeof mod?.default === "function" ? mod.default : mod?.default?.Worker)

// elkjs exports its worker only where `self` is undefined (Node). Bun and Deno define `self`, so the import above exports
// nothing there: load the file again, uncached, with `self` hidden.
function workerWithoutSelf(): (new () => Worker) | undefined {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "self")
  if (!saved?.configurable) return undefined
  const require = createRequire(import.meta.url)
  const id = require.resolve("elkjs/lib/elk-worker.min.js")
  delete require.cache[id]
  delete (globalThis as { self?: unknown }).self
  try { return ctorOf(require(id) as WorkerModule) } finally { Object.defineProperty(globalThis, "self", saved) }
}

function call(msg: Record<string, unknown>): unknown {
  if (!worker) {
    const Ctor = ctorOf(ElkWorker as unknown as WorkerModule) ?? workerWithoutSelf()
    if (!Ctor) throw new Error("ELK worker not available")
    worker = new Ctor()
    let ok = false
    worker.onmessage = (m) => { ok = !m.data.error }
    worker.dispatcher.saveDispatch({ data: { id: 0, cmd: "register", algorithms: ["layered"] } })
    if (!ok) throw new Error("ELK could not register the layered algorithm")
  }
  let reply: { data?: unknown; error?: unknown } | null = null
  worker.onmessage = (m) => { reply = m.data }
  worker.dispatcher.saveDispatch({ data: { id: 1, ...msg } })
  const r = reply as { data?: unknown; error?: unknown } | null
  if (!r) throw new Error("ELK did not answer")
  if (r.error) throw new Error(`ELK: ${(r.error as Error)?.message ?? String(r.error)}`)
  return r.data
}

export function elkLayout(graph: ElkNode): ElkNode {
  return call({ cmd: "layout", graph, layoutOptions: {}, options: {} }) as ElkNode
}
