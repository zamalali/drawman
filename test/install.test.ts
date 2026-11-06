import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { configure, report, SERVER_NAME, status, type Env } from "../src/install.js"

function sandbox(platform: NodeJS.Platform, bins: string[] = []) {
  const home = mkdtempSync(path.join(os.tmpdir(), "dos-install-"))
  const calls: string[] = []
  const configured = new Set<string>()
  const env: Env = {
    home, platform, appData: path.join(home, "AppData"), spec: SERVER_NAME, dryRun: false,
    which: (cmd) => bins.includes(cmd),
    run: (cmd, args) => {
      calls.push(`${cmd} ${args.join(" ")}`)
      if (args[1] === "add") configured.add(cmd)
      if (args[1] === "remove") return { ok: configured.delete(cmd), output: "" }
      if (args[1] === "get") return { ok: configured.has(cmd), output: "" }
      return { ok: true, output: "" }
    },
  }
  return { env, home, calls, done: () => rmSync(home, { recursive: true, force: true }) }
}

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"))

test("merges into existing configs, keeps other servers and settings, and removes cleanly", () => {
  const { env, home, done } = sandbox("linux")
  try {
    const cursor = path.join(home, ".cursor", "mcp.json")
    const gemini = path.join(home, ".gemini", "settings.json")
    mkdirSync(path.dirname(cursor), { recursive: true })
    mkdirSync(path.dirname(gemini), { recursive: true })
    writeFileSync(cursor, JSON.stringify({ mcpServers: { other: { command: "x" } } }))
    writeFileSync(gemini, "\uFEFF" + JSON.stringify({ theme: "dark" }))

    const tabs = path.join(home, ".codeium", "windsurf", "mcp_config.json")
    mkdirSync(path.dirname(tabs), { recursive: true })
    writeFileSync(tabs, '{\n\t"mcpServers": {}\n}\n')
    configure(env)
    configure(env, false)
    assert.equal(readFileSync(tabs, "utf8"), '{\n\t"mcpServers": {}\n}\n')

    const first = configure(env)
    assert.equal(first.find((o) => o.client === "Cursor")?.status, "configured")
    assert.equal(first.find((o) => o.client === "Antigravity")?.status, "skipped")
    assert.deepEqual(read(cursor).mcpServers[SERVER_NAME], { command: "npx", args: ["-y", SERVER_NAME] })
    assert.equal(read(cursor).mcpServers.other.command, "x")
    assert.equal(read(gemini).theme, "dark")

    configure(env)
    assert.deepEqual(Object.keys(read(cursor).mcpServers), ["other", SERVER_NAME])
    assert.equal(status(env).find((o) => o.client === "Gemini CLI")?.status, "configured")

    const removed = configure(env, false)
    assert.equal(removed.find((o) => o.client === "Cursor")?.status, "removed")
    assert.deepEqual(Object.keys(read(cursor).mcpServers), ["other"])
    assert.equal(configure(env, false).find((o) => o.client === "Cursor")?.status, "skipped")
  } finally {
    done()
  }
})

test("uses cmd /c on Windows for file-configured hosts and the VS Code servers schema", () => {
  const { env, home, done } = sandbox("win32")
  try {
    mkdirSync(path.join(home, ".codeium", "windsurf"), { recursive: true })
    mkdirSync(path.join(env.appData, "Code", "User"), { recursive: true })
    configure(env)
    const windsurf = read(path.join(home, ".codeium", "windsurf", "mcp_config.json"))
    assert.deepEqual(windsurf.mcpServers[SERVER_NAME], { command: "cmd", args: ["/c", "npx", "-y", SERVER_NAME] })
    const vscode = read(path.join(env.appData, "Code", "User", "mcp.json"))
    assert.deepEqual(vscode.servers[SERVER_NAME], { type: "stdio", command: "npx", args: ["-y", SERVER_NAME] })
  } finally {
    done()
  }
})

test("never rewrites a config it cannot parse", () => {
  const { env, home, done } = sandbox("linux")
  try {
    const file = path.join(home, ".cursor", "mcp.json")
    mkdirSync(path.dirname(file), { recursive: true })
    const jsonc = '{\n  // personal servers\n  "mcpServers": {},\n}\n'
    writeFileSync(file, jsonc)
    assert.equal(configure(env).find((o) => o.client === "Cursor")?.status, "failed")
    assert.equal(readFileSync(file, "utf8"), jsonc)
  } finally {
    done()
  }
})

test("registers through agent CLIs, prefers the editor CLI, and dry runs touch nothing", () => {
  const { env, home, calls, done } = sandbox("linux", ["claude", "copilot", "code"])
  try {
    mkdirSync(path.join(env.appData, "Code", "User"), { recursive: true })
    configure({ ...env, dryRun: true })
    assert.equal(calls.length, 0)

    const outcomes = configure(env)
    assert.ok(calls.includes(`claude mcp add -s user ${SERVER_NAME} -- npx -y ${SERVER_NAME}`))
    assert.ok(calls.includes(`copilot mcp add ${SERVER_NAME} -- npx -y ${SERVER_NAME}`))
    assert.ok(calls.some((c) => c.startsWith("code --add-mcp") && c.includes(`"name":"${SERVER_NAME}"`)))
    assert.equal(outcomes.find((o) => o.client === "VS Code")?.detail, "code --add-mcp")
    assert.equal(status(env).find((o) => o.client === "Claude Code")?.status, "configured")
    assert.match(report(outcomes, true), /ready in 3 tools/)
    assert.match(report(configure({ ...env, home: path.join(home, "none"), appData: path.join(home, "none"), which: () => false }), true), /npx -y drawman/)
  } finally {
    done()
  }
})

test("can point every client at a local tarball before publishing", () => {
  const { env, home, done } = sandbox("linux")
  try {
    mkdirSync(path.join(home, ".cursor"), { recursive: true })
    configure({ ...env, spec: "/tmp/drawman-0.2.0.tgz" })
    assert.deepEqual(read(path.join(home, ".cursor", "mcp.json")).mcpServers[SERVER_NAME].args,
      ["-y", "--package=/tmp/drawman-0.2.0.tgz", SERVER_NAME])
  } finally {
    done()
  }
})
