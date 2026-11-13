import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export const SERVER_NAME = "drawman"

export type Outcome = { client: string; status: "configured" | "removed" | "skipped" | "failed"; detail: string }
export interface Env { home: string; platform: NodeJS.Platform; appData: string; spec: string; dryRun: boolean; which: (cmd: string) => boolean; run: (cmd: string, args: string[]) => { ok: boolean; output: string } }

export function defaultEnv(dryRun = false): Env {
  const platform = process.platform
  const home = os.homedir()
  return {
    home, platform, dryRun,
    appData: process.env.APPDATA ?? (platform === "darwin" ? path.join(home, "Library", "Application Support") : path.join(home, ".config")),
    spec: process.env.DRAWMAN_PACKAGE ?? SERVER_NAME,
    which: (cmd) => spawnSync(platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }).status === 0,
    run: (cmd, args) => {
      const r = platform === "win32"
        ? spawnSync("cmd.exe", ["/d", "/s", "/c", [cmd, ...args].map(quote).join(" ")], { encoding: "utf8", timeout: 60_000, windowsVerbatimArguments: true })
        : spawnSync(cmd, args, { encoding: "utf8", timeout: 60_000 })
      return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() }
    },
  }
}

const quote = (a: string) => (/^[\w./:=@-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`)

/** npx invocation of the published package, or of DRAWMAN_PACKAGE (a tarball or version) when testing. */
export function npxArgs(spec: string) {
  return spec === SERVER_NAME ? ["-y", SERVER_NAME] : ["-y", `--package=${spec}`, SERVER_NAME]
}

// Most file-configured hosts spawn without a shell, and npx is a .cmd script on Windows.
export function stdioEntry(env: Env) {
  return env.platform === "win32"
    ? { command: "cmd", args: ["/c", "npx", ...npxArgs(env.spec)] }
    : { command: "npx", args: npxArgs(env.spec) }
}

interface FileTarget { client: string; file: string; key: "mcpServers" | "servers"; detect: string; entry?: Record<string, unknown>; cli?: string }

export function fileTargets(env: Env): FileTarget[] {
  const h = env.home
  const vscodeEntry = { type: "stdio", command: "npx", args: npxArgs(env.spec) }
  return [
    { client: "VS Code", file: path.join(env.appData, "Code", "User", "mcp.json"), key: "servers", detect: path.join(env.appData, "Code", "User"), entry: vscodeEntry, cli: "code" },
    { client: "VS Code Insiders", file: path.join(env.appData, "Code - Insiders", "User", "mcp.json"), key: "servers", detect: path.join(env.appData, "Code - Insiders", "User"), entry: vscodeEntry, cli: "code-insiders" },
    { client: "Cursor", file: path.join(h, ".cursor", "mcp.json"), key: "mcpServers", detect: path.join(h, ".cursor") },
    { client: "Windsurf", file: path.join(h, ".codeium", "windsurf", "mcp_config.json"), key: "mcpServers", detect: path.join(h, ".codeium", "windsurf") },
    { client: "Antigravity", file: path.join(h, ".gemini", "antigravity", "mcp_config.json"), key: "mcpServers", detect: path.join(h, ".gemini", "antigravity") },
    { client: "Gemini CLI", file: path.join(h, ".gemini", "settings.json"), key: "mcpServers", detect: path.join(h, ".gemini", "settings.json") },
    {
      client: "Claude Desktop", key: "mcpServers",
      file: path.join(env.appData, "Claude", "claude_desktop_config.json"), detect: path.join(env.appData, "Claude"),
    },
  ]
}

interface CliTarget { client: string; bin: string; add: string[]; remove: string[]; get: string[] }

export function cliTargets(env: Env): CliTarget[] {
  const cmd = env.platform === "win32" ? ["cmd", "/c", "npx", ...npxArgs(env.spec)] : ["npx", ...npxArgs(env.spec)]
  return [
    { client: "Claude Code", bin: "claude", add: ["mcp", "add", "-s", "user", SERVER_NAME, "--", "npx", ...npxArgs(env.spec)], remove: ["mcp", "remove", "-s", "user", SERVER_NAME], get: ["mcp", "get", SERVER_NAME] },
    { client: "GitHub Copilot CLI", bin: "copilot", add: ["mcp", "add", SERVER_NAME, "--", "npx", ...npxArgs(env.spec)], remove: ["mcp", "remove", SERVER_NAME], get: ["mcp", "get", SERVER_NAME] },
    { client: "Codex CLI", bin: "codex", add: ["mcp", "add", SERVER_NAME, "--", ...cmd], remove: ["mcp", "remove", SERVER_NAME], get: ["mcp", "get", SERVER_NAME] },
    { client: "Devin / Windsurf CLI", bin: "devin", add: ["mcp", "add", "-s", "user", SERVER_NAME, "--", ...cmd], remove: ["mcp", "remove", "-s", "user", SERVER_NAME], get: ["mcp", "get", SERVER_NAME] },
  ]
}

/** Parses a JSON config; refuses files with comments or trailing commas rather than rewriting them without. */
function readConfig(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return {}
  const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "")
  if (!text.trim()) return {}
  try {
    const value = JSON.parse(text)
    return value && typeof value === "object" && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

const indentOf = (file: string) => (existsSync(file) ? /^[{[]\r?\n([ \t]+)/.exec(readFileSync(file, "utf8").replace(/^\uFEFF/, ""))?.[1] : undefined) ?? 2

function updateFile(t: FileTarget, env: Env, install: boolean): Outcome {
  if (!existsSync(t.detect)) return { client: t.client, status: "skipped", detail: "not installed" }
  // The editor's own CLI understands JSONC and profiles, so it is preferred over editing mcp.json.
  if (install && t.cli && env.which(t.cli)) {
    if (env.dryRun) return { client: t.client, status: "configured", detail: `${t.cli} --add-mcp` }
    if (env.run(t.cli, ["--add-mcp", JSON.stringify({ name: SERVER_NAME, ...t.entry })]).ok) {
      return { client: t.client, status: "configured", detail: `${t.cli} --add-mcp` }
    }
  }
  const config = readConfig(t.file)
  if (!config) return { client: t.client, status: "failed", detail: `${t.file} is not plain JSON; ${install ? "add" : "remove"} the server by hand` }
  const servers = { ...((config[t.key] as Record<string, unknown>) ?? {}) }
  if (install) servers[SERVER_NAME] = t.entry ?? stdioEntry(env)
  else if (SERVER_NAME in servers) delete servers[SERVER_NAME]
  else return { client: t.client, status: "skipped", detail: "not configured" }
  if (!env.dryRun) {
    const indent = indentOf(t.file)
    mkdirSync(path.dirname(t.file), { recursive: true })
    writeFileSync(t.file, `${JSON.stringify({ ...config, [t.key]: servers }, null, indent)}\n`)
  }
  return { client: t.client, status: install ? "configured" : "removed", detail: t.file }
}

function updateCli(t: CliTarget, env: Env, install: boolean): Outcome {
  if (!env.which(t.bin)) return { client: t.client, status: "skipped", detail: "not installed" }
  if (env.dryRun) return { client: t.client, status: install ? "configured" : "removed", detail: `${t.bin} ${(install ? t.add : t.remove).join(" ")}` }
  const removed = env.run(t.bin, t.remove)
  if (!install) return { client: t.client, status: removed.ok ? "removed" : "skipped", detail: removed.ok ? `${t.bin} mcp` : "not configured" }
  const added = env.run(t.bin, t.add)
  return added.ok
    ? { client: t.client, status: "configured", detail: `${t.bin} mcp (user scope)` }
    : { client: t.client, status: "failed", detail: added.output.split("\n").slice(-2).join(" ").slice(0, 200) }
}

export function configure(env: Env, install = true): Outcome[] {
  return [...cliTargets(env).map((t) => updateCli(t, env, install)), ...fileTargets(env).map((t) => updateFile(t, env, install))]
}

export function status(env: Env): Outcome[] {
  const cli = cliTargets(env).map((t): Outcome => {
    if (!env.which(t.bin)) return { client: t.client, status: "skipped", detail: "not installed" }
    return env.run(t.bin, t.get).ok
      ? { client: t.client, status: "configured", detail: `${t.bin} mcp` }
      : { client: t.client, status: "failed", detail: `not configured (run: npx -y ${SERVER_NAME} install)` }
  })
  const files = fileTargets(env).map((t): Outcome => {
    if (!existsSync(t.detect)) return { client: t.client, status: "skipped", detail: "not installed" }
    const servers = readConfig(t.file)?.[t.key] as Record<string, unknown> | undefined
    return servers && SERVER_NAME in servers
      ? { client: t.client, status: "configured", detail: t.file }
      : { client: t.client, status: "failed", detail: `not configured (run: npx -y ${SERVER_NAME} install)` }
  })
  return [...cli, ...files]
}

export function report(outcomes: Outcome[], install: boolean, dryRun = false) {
  const mark = { configured: "✔", removed: "✔", skipped: "·", failed: "✖" }
  const width = Math.max(...outcomes.map((o) => o.client.length))
  const lines = outcomes.map((o) => `  ${mark[o.status]} ${o.client.padEnd(width)}  ${o.status === "skipped" ? o.detail : `${dryRun ? `would be ${o.status}` : o.status}: ${o.detail}`}`)
  const done = outcomes.filter((o) => o.status === "configured" || o.status === "removed").length
  const tail = install
    ? done ? `\n${SERVER_NAME} is ready in ${done} tool${done === 1 ? "" : "s"}. Restart them (or reload the window) and ask for a diagram.`
      : `\nNo supported tool found. Any MCP host works with: npx -y ${SERVER_NAME}`
    : `\nRemoved from ${done} tool${done === 1 ? "" : "s"}.`
  return `${lines.join("\n")}\n${tail}\n`
}
