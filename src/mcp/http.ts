import express from "express"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { listen, localOnly } from "../local-guard.js"
import { createServer } from "./server.js"

export function httpApp() {
  const app = express()
  app.use(localOnly())
  app.use(express.json({ limit: "4mb" }))
  app.get("/healthz", (_req, res) => { res.json({ ok: true }) })
  app.post("/mcp", async (req, res) => {
    const server = createServer({ stateless: true })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on("close", () => { void transport.close(); void server.close() })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: (error as Error).message }, id: null })
    }
  })
  const notAllowed = (_req: express.Request, res: express.Response) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null })
  }
  app.get("/mcp", notAllowed)
  app.delete("/mcp", notAllowed)
  return app
}

export async function serveHttp(port: number, host: string) {
  await listen(httpApp(), port, host)
  console.error(`drawman MCP server on http://${host}:${port}/mcp`)
}
