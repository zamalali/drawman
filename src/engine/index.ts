export * from "./kinds.js"
export * from "./facts.js"
export * from "./flow.js"
export * from "./sequence.js"
export * from "./text.js"
export * from "./scene.js"
export * from "./drawio.js"
import { normaliseFacts, type DiagramInput } from "./facts.js"
import { buildScene, checkLayout, type Positions, type Reroute } from "./scene.js"
import { buildDrawio } from "./drawio.js"

export function renderDiagram(input: DiagramInput, streaming = false, positions?: Positions, keep?: Reroute) {
  const facts = normaliseFacts(input, streaming)
  const scene = buildScene(facts, positions, keep)
  if (!streaming) checkLayout(scene)
  return { facts, scene, ...buildDrawio(scene) }
}
