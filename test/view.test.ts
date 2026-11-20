import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const stream = readFileSync(new URL("../src/view/stream.ts", import.meta.url), "utf8")
const onPartial = stream.slice(stream.indexOf("app.ontoolinputpartial"), stream.indexOf("app.ontoolinput ="))
const onResult = stream.slice(stream.indexOf("app.ontoolresult"), stream.indexOf("function showWhole"))
const tail = onResult.slice(onResult.lastIndexOf("resultReady = true"))
const whole = stream.slice(stream.indexOf("function showWhole"), stream.indexOf("function revealAll"))

test("a diagram streamed live keeps drawing at its pace after the result arrives", () => {
  assert.match(onPartial, /streamed = true/, "partial input marks the call as streamed live")
  assert.match(tail, /if \(streamed\) \{\s+if \(!beat\) step\(\)\s+return\s+\}/)
})

test("a finished diagram that never streamed (a reload) shows whole instead of replaying", () => {
  assert.match(tail, /\}\s+showWhole\(\)\s+\}/)
  assert.match(whole, /revealAll\(\)[\s\S]*if \(!state\.done\) finish\(resultStats\)/)
  const reveal = stream.slice(stream.indexOf("function revealAll"))
  assert.match(reveal, /window\.clearTimeout\(beat\)/, "a pending reveal beat is cancelled")
  assert.match(reveal, /shownNodes = Math\.max\(shownNodes, a\.nodes\)/)
  assert.match(reveal, /shownEdges = Math\.max\(shownEdges, a\.edges\)/)
})

// A host's fullscreen can open a fresh copy of the View after the call: it must show the diagram still, edits included.
test("a view that never streamed plays no entrance animation and no edit replay", () => {
  assert.match(whole, /querySelectorAll\("\.enter"\)\)\) node\.classList\.remove\("enter"\)/)
  assert.match(whole, /path\.style\.strokeDasharray = path\.dataset\.dash \?\? ""/)
  assert.match(whole, /fitTo\(state\.current, true\)/, "the camera does not glide")
  const edit = onResult.slice(onResult.indexOf("if (sc?.edit && sc.diagram)"))
  assert.match(edit, /quietly\(\(\) => receive\(sc\.diagram!, true\)\)\s+if \(!streamed\) return showWhole\(\)/)
  const restored = onResult.slice(onResult.indexOf("if (sc?.diagram && (!latest || sc.analysis))"))
  assert.match(restored, /receive\(sc\.diagram, true\)\s+if \(!streamed && !sc\.analysis\) showWhole\(\)/)
})

test("a failed call stops the busy placeholder and says why", () => {
  const dom = readFileSync(new URL("../src/view/dom.ts", import.meta.url), "utf8")
  const status = dom.slice(dom.indexOf("export function setStatus"))
  assert.match(status, /ui\.empty\.classList\.toggle\("failed", kind === "error"\)/)
  assert.match(status, /if \(kind === "error"\) \$<HTMLElement>\("#empty-text"\)\.textContent = text/)
  const css = readFileSync(new URL("../src/view/styles.css", import.meta.url), "utf8")
  assert.match(css, /\.empty\.failed \.pulse \{ animation: none;/)
})

test("an error is final: no pending reveal or edit fetch turns the status back to building", () => {
  const onError = onResult.slice(0, onResult.indexOf("const sc ="))
  assert.match(onError, /if \(result\.isError\) \{\s+[^\n]*\n\s+if \(beat\) window\.clearTimeout\(beat\)\s+beat = 0\s+resultReady = true\s+setStatus\("error"/)
  const fetch = stream.slice(stream.indexOf("function awaitEdit"), stream.indexOf("// Existing items appear"))
  assert.match(fetch, /if \(r\.isError \|\| !sc\?\.diagram \|\| resultReady\) return/, "the edit fetch stops once a result, even an error, is in")
})

test("dashed sequence messages stay dashed when a view shows the diagram whole", () => {
  const seq = readFileSync(new URL("../src/view/render-sequence.ts", import.meta.url), "utf8")
  assert.match(seq, /path\.dataset\.dash = e\.rel === "return" \|\| e\.rel === "create" \? "5 4" : ""\s+path\.style\.strokeDasharray = path\.dataset\.dash/)
})
test("only a drag pins the cards on screen; zooming or panning during a stream changes no layout", () => {
  const ui = readFileSync(new URL("../src/view/interaction.ts", import.meta.url), "utf8")
  const drawFn = stream.slice(stream.indexOf("export function draw("), stream.indexOf("state.current = scene"))
  assert.match(drawFn, /const positions = state\.cardsMoved && state\.current/)
  assert.doesNotMatch(drawFn, /state\.userMoved && state\.current/)
  assert.match(ui, /d\.moved = true\s+state\.userMoved = true\s+state\.cardsMoved = true/, "set when a card or zone drag starts")
  assert.equal((ui.match(/state\.cardsMoved = true/g) ?? []).length, 1, "nothing else sets it (wheel and pan only move the camera)")
  const reset = ui.slice(ui.indexOf("ui.reset.onclick"))
  assert.match(reset, /state\.cardsMoved = false\s+draw\(\)/, "Reset clears it before redrawing")
})
test("a result the view cannot draw from never leaves it busy", () => {
  const tailNoLatest = onResult.slice(onResult.lastIndexOf("resultReady = true"))
  assert.match(tailNoLatest, /if \(!latest\) \{[\s\S]*if \(state\.xml\) \{[\s\S]*setStatus\("done", "Updated · open it in draw\.io"\)[\s\S]*ui\.download\.disabled = ui\.open\.disabled = false/)
})