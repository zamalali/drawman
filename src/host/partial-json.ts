export function parsePartialJson(src: string): Record<string, unknown> | undefined {
  let s = src.trimStart()
  if (!s.startsWith("{")) return undefined
  for (let attempt = 0; attempt < 12 && s.length; attempt++) {
    const { closed, cuts } = close(s)
    try {
      const value = JSON.parse(closed)
      return value && typeof value === "object" && !Array.isArray(value) ? value : undefined
    } catch {
      const cut = cuts.pop()
      if (cut === undefined) return undefined
      s = s[cut] === "," ? s.slice(0, cut) : s.slice(0, cut + 1)
    }
  }
  return undefined
}

function close(s: string) {
  const stack: string[] = []
  const cuts: number[] = []
  let inString = false
  let escaped = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === "\\") escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === "{" || c === "[") { stack.push(c === "{" ? "}" : "]"); cuts.push(i) }
    else if (c === "}" || c === "]") stack.pop()
    else if (c === ",") cuts.push(i)
  }
  let out = s
  if (inString) {
    if (escaped) out = out.slice(0, -1)
    out += '"'
  }
  out = out.replace(/[\s,:]+$/, "")
  return { closed: out + stack.reverse().join(""), cuts }
}
