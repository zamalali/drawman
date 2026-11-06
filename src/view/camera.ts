// The viewBox camera: eased zoom / pan towards a target and fitting the whole scene.
import type { Scene } from "../engine/index.js"
import { canvas } from "./dom.js"
import { state } from "./state.js"

let raf = 0
export function applyCam() { canvas.setAttribute("viewBox", `${state.cam.x} ${state.cam.y} ${state.cam.w} ${state.cam.h}`) }
export function animateCam() {
  cancelAnimationFrame(raf)
  const step = () => {
    const t = 0.14
    state.cam = { x: state.cam.x + (state.target.x - state.cam.x) * t, y: state.cam.y + (state.target.y - state.cam.y) * t, w: state.cam.w + (state.target.w - state.cam.w) * t, h: state.cam.h + (state.target.h - state.cam.h) * t }
    applyCam()
    if (Math.abs(state.cam.w - state.target.w) + Math.abs(state.cam.x - state.target.x) + Math.abs(state.cam.y - state.target.y) > 0.5) raf = requestAnimationFrame(step)
    else { state.cam = { ...state.target }; applyCam() }
  }
  raf = requestAnimationFrame(step)
}
export function fitTo(scene: Scene | null, instant = false) {
  const w = scene ? scene.width : 1400, h = scene ? scene.height : 800
  const r = canvas.getBoundingClientRect()
  const aspect = r.width && r.height ? r.width / r.height : 16 / 9
  let vw = w + 40, vh = h + 10
  if (vw / vh < aspect) vw = vh * aspect
  else vh = vw / aspect
  state.target = { x: (w - vw) / 2, y: 10 + (h - vh) / 2, w: vw, h: vh }
  if (instant) { state.cam = { ...state.target }; applyCam() } else animateCam()
}
export function toWorld(cx: number, cy: number) {
  const p = canvas.createSVGPoint()
  p.x = cx; p.y = cy
  return p.matrixTransform(canvas.getScreenCTM()!.inverse())
}
