import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/^\uFEFF/, "")
const json = (p: string) => JSON.parse(read(p))
const version = json("package.json").version as string

test("every plugin manifest, marketplace and the launcher pin the package version", () => {
  assert.equal(json("plugins/drawman/plugin.json").version, version, "Copilot plugin.json")
  assert.equal(json("plugins/drawman/.claude-plugin/plugin.json").version, version, "Claude plugin.json")
  assert.equal(json(".github/plugin/marketplace.json").plugins[0].version, version, "Copilot marketplace")
  assert.equal(json(".github/plugin/marketplace.json").metadata.version, version, "Copilot marketplace metadata")
  assert.equal(json("vscode/package.json").version, version, "VS Code extension")
  assert.match(read("plugins/drawman/launch.mjs"), new RegExp(`const VERSION = "${version.replace(/\./g, "\\.")}"`), "launcher")
  assert.match(read("src/version.ts"), new RegExp(`"${version.replace(/\./g, "\\.")}"`), "src/version.ts")
})

test("plugin MCP configs start the launcher with the right root variable per client", () => {
  const copilot = json("plugins/drawman/mcp.json").mcpServers["drawman"]
  assert.deepEqual([copilot.type, copilot.command, copilot.args], ["stdio", "node", ["${PLUGIN_ROOT}/launch.mjs"]])
  const claude = json("plugins/drawman/.mcp.json").mcpServers["drawman"]
  assert.deepEqual([claude.command, claude.args], ["node", ["${CLAUDE_PLUGIN_ROOT}/launch.mjs"]])
  assert.equal(json(".claude-plugin/marketplace.json").plugins[0].source, "./plugins/drawman")
  assert.match(read("plugins/drawman/skills/architecture-diagrams/SKILL.md"), /^---\r?\nname: architecture-diagrams\r?\ndescription: /)
})
