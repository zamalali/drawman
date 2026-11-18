import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const stream = readFileSync(new URL("../src/view/stream.ts", import.meta.url), "utf8")

test("a finished diagram shows whole: a View restored after a reload does not replay the drawing", () => {
  const onResult = stream.slice(stream.indexOf("app.ontoolresult"))
  const tail = onResult.slice(onResult.lastIndexOf("resultReady = true"))
  assert.match(tail, /^resultReady = true\s+if \(!latest\) return\s+revealAll\(\)\s+if \(!state\.done\) finish\(resultStats\)/)
  assert.doesNotMatch(tail.slice(0, tail.indexOf("function revealAll")), /step\(\)/, "the result must not pace the reveal")
  const reveal = stream.slice(stream.indexOf("function revealAll"))
  assert.match(reveal, /window\.clearTimeout\(beat\)/, "a pending reveal beat is cancelled")
  assert.match(reveal, /shownNodes = Math\.max\(shownNodes, a\.nodes\)/)
  assert.match(reveal, /shownEdges = Math\.max\(shownEdges, a\.edges\)/)
})
