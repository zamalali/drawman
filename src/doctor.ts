import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { renderDiagram } from "./engine/index.js"
import { defaultEnv, status } from "./install.js"
import { createServer } from "./mcp/server.js"
import { VERSION } from "./version.js"

const SAMPLE = {
  title: "Doctor",
  nodes: [
    { id: "start", title: "Request", shape: "start" },
    { id: "check", title: "Valid?", shape: "decision" },
    { id: "done", title: "Done", shape: "end" },
  ],
  interfaces: [{ from: "start", to: "check" }, { from: "check", to: "done", label: "Yes" }],
}

async function check(name: string, run: () => Promise<string> | string) {
  try {
    console.log(`  ✔ ${name}: ${await run()}`)
    return true
  } catch (error) {
    console.log(`  ✖ ${name}: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

export async function doctor(): Promise<number> {
  console.log(`drawman ${VERSION}\n`)
  const results = [
    await check("Node.js", () => {
      const [major, minor] = process.versions.node.split(".").map(Number)
      if (major < 20 || (major === 20 && minor < 11)) throw new Error(`${process.versions.node} is too old, 20.11 or newer is required`)
      return process.versions.node
    }),
    await check("MCP server", async () => {
      const [a, b] = InMemoryTransport.createLinkedPair()
      const client = new Client({ name: "doctor", version: VERSION })
      await Promise.all([createServer().connect(a), client.connect(b)])
      const { tools } = await client.listTools()
      await client.close()
      return `${tools.length} tools (${tools.map((t) => t.name).join(", ")})`
    }),
    await check("Rendering", () => {
      const { xml, stats } = renderDiagram(SAMPLE)
      if (!xml.includes("<mxGraphModel")) throw new Error("no draw.io XML produced")
      return `${stats.cards} shapes, ${stats.edges} connectors`
    }),
  ]
  console.log("\nAI tools and IDEs:")
  for (const o of status(defaultEnv())) {
    const mark = o.status === "configured" ? "✔" : o.status === "skipped" ? "·" : "!"
    console.log(`  ${mark} ${o.client}: ${o.status === "configured" ? `configured (${o.detail})` : o.detail}`)
  }
  const ok = results.every(Boolean)
  console.log(ok ? "\nEverything works." : "\nSome checks failed; see above.")
  return ok ? 0 : 1
}
