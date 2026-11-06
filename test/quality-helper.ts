import type { Scene } from "../src/engine/index.js"

export function quality(scene: Scene) {
  const segs = scene.edges.flatMap((e) => e.points.slice(1).map((b, i) => ({ id: e.id, from: e.from, to: e.to, a: e.points[i], b })))
  let crossings = 0
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const s = segs[i], t = segs[j]
    if (s.id === t.id || (s.a[1] === s.b[1]) === (t.a[1] === t.b[1])) continue
    const [h, v] = s.a[1] === s.b[1] ? [s, t] : [t, s]
    if (v.a[0] > Math.min(h.a[0], h.b[0]) && v.a[0] < Math.max(h.a[0], h.b[0]) &&
      h.a[1] > Math.min(v.a[1], v.b[1]) && h.a[1] < Math.max(v.a[1], v.b[1])) crossings++
  }
  let through = 0
  for (const s of segs) for (const c of scene.cards) {
    const [x, y, w, h] = c.box
    if (Math.min(s.a[0], s.b[0]) < x + w - 1 && Math.max(s.a[0], s.b[0]) > x + 1 &&
      Math.min(s.a[1], s.b[1]) < y + h - 1 && Math.max(s.a[1], s.b[1]) > y + 1) through++
  }
  return { crossings, through, bends: scene.edges.reduce((n, e) => n + e.points.length - 2, 0) }
}

