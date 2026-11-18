import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const stream = readFileSync(new URL("../src/view/stream.ts", import.meta.url), "utf8")
const onPartial = stream.slice(stream.indexOf("app.ontoolinputpartial"), stream.indexOf("app.ontoolinput ="))
const onResult = stream.slice(stream.indexOf("app.ontoolresult"), stream.indexOf("function revealAll"))
const tail = onResult.slice(onResult.lastIndexOf("resultReady = true"))

test("a diagram streamed live keeps drawing at its pace after the result arrives", () => {
  assert.match(onPartial, /streamed = true/, "partial input marks the call as streamed live")
  assert.match(tail, /if \(streamed\) \{\s+if \(!beat\) step\(\)\s+return\s+\}/)
})

test("a finished diagram that never streamed (a reload) shows whole instead of replaying", () => {
  assert.match(tail, /\}\s+revealAll\(\)\s+if \(!state\.done\) finish\(resultStats\)/)
  const reveal = stream.slice(stream.indexOf("function revealAll"))
  assert.match(reveal, /window\.clearTimeout\(beat\)/, "a pending reveal beat is cancelled")
  assert.match(reveal, /shownNodes = Math\.max\(shownNodes, a\.nodes\)/)
  assert.match(reveal, /shownEdges = Math\.max\(shownEdges, a\.edges\)/)
})
