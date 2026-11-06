const NARROW = "iljI.,:;'!|`"
const SLIM = "ftr()[]{}/\\- "
const WIDE = "mwMW@%"

export function textWidth(s: string, size = 12) {
  let em = 0
  for (const ch of s) {
    if (NARROW.includes(ch)) em += 0.27
    else if (SLIM.includes(ch)) em += 0.36
    else if (WIDE.includes(ch)) em += 0.86
    else if (ch >= "A" && ch <= "Z") em += 0.66
    else if (ch >= "0" && ch <= "9") em += 0.56
    else em += 0.53
  }
  return em * size
}

export function wrapText(s: string, maxW: number, size = 12, maxLines = 3): string[] {
  const words = s.replace(/\s+/g, " ").trim().split(" ").filter(Boolean)
  const lines: string[] = []
  let line = ""
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (!line || textWidth(next, size) <= maxW) line = next
    else { lines.push(line); line = w }
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines.length ? lines : [""]
  const kept = lines.slice(0, maxLines)
  let last = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`
  while (last.length > 1 && textWidth(`${last}…`, size) > maxW) last = last.slice(0, -1).trimEnd()
  kept[maxLines - 1] = `${last}…`
  return kept
}
