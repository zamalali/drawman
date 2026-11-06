// Blocks DNS rebinding: only localhost hosts and origins, unless DRAWMAN_ALLOWED_HOSTS says otherwise ("*" disables).
import type { NextFunction, Request, Response } from "express"

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

function hostnameOf(value: string) {
  const v = value.trim().toLowerCase()
  if (v.startsWith("[")) return v.slice(0, v.indexOf("]") + 1)
  return v.split(":")[0]
}

export function allowedHosts() {
  return (process.env.DRAWMAN_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)
}

export function localOnly() {
  const extra = allowedHosts()
  const any = extra.includes("*")
  const ok = (host: string) => any || LOCAL.has(host) || extra.includes(host)
  return (req: Request, res: Response, next: NextFunction) => {
    const host = hostnameOf(req.headers.host ?? "")
    if (!ok(host)) return res.status(403).json({ error: `Host "${host}" is not allowed (set DRAWMAN_ALLOWED_HOSTS)` })
    const origin = req.headers.origin
    if (origin && origin !== "null") {
      let originHost = ""
      try { originHost = new URL(origin).hostname.toLowerCase() } catch { /* malformed */ }
      if (!ok(originHost.includes(":") && !originHost.startsWith("[") ? `[${originHost}]` : originHost)) {
        return res.status(403).json({ error: `Origin "${origin}" is not allowed` })
      }
    }
    next()
  }
}

/** Express 5 reports listen errors to the callback, so a taken port rejects here. */
export function listen(app: { listen: (port: number, host: string, cb: (error?: Error) => void) => unknown }, port: number, host: string) {
  return new Promise<void>((resolve, reject) => { app.listen(port, host, (error?: Error) => (error ? reject(error) : resolve())) })
}
