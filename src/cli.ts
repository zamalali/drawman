#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { VERSION } from "./version.js"

const HELP = `drawman ${VERSION} - draw.io on steroids: fast, editable diagrams for AI coding agents

Setup:
  drawman install [--dry-run]          add the MCP server to every detected AI tool and IDE
  drawman uninstall                    remove it again
  drawman doctor                       check Node, the MCP server, rendering and each tool's config

Usage:
  drawman [mcp]                        MCP server over stdio (VS Code, Claude, Copilot CLI, Cursor...)
  drawman serve [--port 3001] [--host 127.0.0.1]
                                           MCP server over Streamable HTTP at /mcp
  drawman web [--port 5179]            standalone chat UI (needs an OpenAI-compatible LLM, see below)
  drawman render <diagram.json> [-o out.drawio]
                                           JSON graph -> .drawio, no model involved
  drawman analyze <repo|path> [-o out.drawio] [--focus "..."] [--ref main]
                                           repository -> architecture (needs an LLM; otherwise prints the evidence)

Environment:
  DRAWMAN_LLM_URL, DRAWMAN_LLM_KEY, DRAWMAN_LLM_MODEL, DRAWMAN_LLM_KEY_HEADER
  DRAWMAN_WORKSPACE_ROOTS   folders the server may read (default: current directory)
  DRAWMAN_GITHUB_HOST       host for owner/repo shorthands (default: github.com)
  DRAWMAN_PROFILE           organisation profile JSON (conventions, vocabulary hints, endpoints)
  DRAWMAN_OUTPUT_DIR        where .drawio files go for hosts without the live view (default: diagrams)
`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string" }, host: { type: "string" }, out: { type: "string", short: "o" },
    focus: { type: "string" }, ref: { type: "string" }, "dry-run": { type: "boolean" }, help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" },
  },
})
const [command = "mcp", target] = positionals

if (values.help) {
  process.stdout.write(HELP)
} else if (values.version) {
  process.stdout.write(`${VERSION}\n`)
} else if (command === "install" || command === "uninstall") {
  const { configure, defaultEnv, report } = await import("./install.js")
  const install = command === "install"
  if (values["dry-run"]) console.log("Dry run, nothing is written:\n")
  process.stdout.write(report(configure(defaultEnv(values["dry-run"]), install), install, values["dry-run"]))
} else if (command === "doctor") {
  const { doctor } = await import("./doctor.js")
  process.exitCode = await doctor()
} else if (command === "mcp") {
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js")
  const { createServer } = await import("./mcp/server.js")
  await createServer().connect(new StdioServerTransport())
} else if (command === "serve") {
  const { serveHttp } = await import("./mcp/http.js")
  await serveHttp(Number(values.port ?? process.env.PORT ?? 3001), values.host ?? "127.0.0.1")
} else if (command === "web") {
  const { startWeb } = await import("./host/server.js")
  await startWeb(Number(values.port ?? process.env.PORT ?? 5179))
} else if (command === "render") {
  if (!target) fail("render needs a JSON file")
  await import("./engine/server-setup.js")
  const { renderDiagram } = await import("./engine/index.js")
  const input = JSON.parse(readFileSync(target, "utf8").replace(/^\uFEFF/, ""))
  const { xml, stats, facts } = renderDiagram(input)
  const out = values.out ?? `${path.basename(target, path.extname(target))}.drawio`
  writeFileSync(out, xml)
  console.error(`${facts.title}: ${stats.cards} components, ${stats.zones} zones, ${stats.edges} interfaces -> ${out}`)
} else if (command === "analyze") {
  if (!target) fail("analyze needs a repository or folder")
  await import("./config.js")
  const { analyzeRepository } = await import("./repo/analyze.js")
  const { httpCompleter } = await import("./llm.js")
  await import("./engine/server-setup.js")
  const { renderDiagram } = await import("./engine/index.js")
  const r = await analyzeRepository(target, { ref: values.ref, focus: values.focus, complete: httpCompleter() })
  if (r.mode === "handoff") {
    process.stdout.write(r.brief + "\n")
    console.error("\nNo LLM configured (DRAWMAN_LLM_URL/_KEY): printed the evidence instead of a diagram.")
  } else {
    const { xml, stats } = renderDiagram(r.diagram)
    const out = values.out ?? `${r.analysis.repository.split("/").pop()}-architecture.drawio`
    writeFileSync(out, xml)
    for (const f of r.analysis.findings) console.error(`  - ${f}`)
    console.error(`${r.analysis.repository}: ${stats.cards} components, ${stats.edges} interfaces, ` +
      `${r.analysis.coverage.represented}/${r.analysis.coverage.total} signals drawn, ${r.analysis.model} -> ${out}`)
  }
} else {
  fail(`unknown command "${command}"\n\n${HELP}`)
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
