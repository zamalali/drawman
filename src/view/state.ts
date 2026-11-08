import type { Positions, Scene, SerialLayout } from "../engine/index.js"

export type Cam = { x: number; y: number; w: number; h: number }

// Mutable state shared between the view's modules.
export const state = {
  cam: { x: 0, y: 0, w: 1400, h: 800 } as Cam,
  target: { x: 0, y: 0, w: 1400, h: 800 } as Cam,
  userMoved: false,
  positions: {} as Positions,
  serverXml: "",
  current: null as Scene | null,
  xml: "",
  done: false,
  flowOn: true,
  // Final layout computed by the server (grouped diagrams); used once the tool result has arrived.
  layout: null as SerialLayout | null,
  // The server's id for this diagram and the positions it placed, so hand-made moves can be reported back for edits.
  sheet: "",
  pinned: {} as Positions,
}

// Items already shown once, so they only play their entrance animation the first time.
export const seenCards = new Set<number>()
export const seenEdges = new Set<number>()
export const seenZones = new Set<string>()
