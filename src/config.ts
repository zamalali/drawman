import dns from "node:dns"
import { existsSync, readFileSync } from "node:fs"
import net from "node:net"
import { homedir } from "node:os"
import path from "node:path"
import tls from "node:tls"
import { fileURLToPath } from "node:url"
import { addKindHints } from "./engine/kinds.js"

// Corporate TLS-inspecting proxies need the OS certificate store.
try {
  tls.setDefaultCACertificates([...tls.getCACertificates("default"), ...tls.getCACertificates("system")])
} catch { /* older Node: use NODE_EXTRA_CA_CERTS */ }

// Only DRAWMAN_* keys from this package's own .env when running from source; never the analysed project's .env.
const root = fileURLToPath(new URL("../", import.meta.url))
const devEnv = path.join(root, ".env")
if (existsSync(path.join(root, "src", "config.ts")) && existsSync(devEnv)) {
  for (const line of readFileSync(devEnv, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(DRAWMAN_[A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2")
  }
}
const env = (name: string, fallback = "") => process.env[name]?.trim() || fallback

if (env("DRAWMAN_IPV4_FIRST") === "1") {
  dns.setDefaultResultOrder("ipv4first")
  net.setDefaultAutoSelectFamily(false)
}

export interface Profile {
  name?: string
  conventions?: string[]
  hints?: [words: string[], kind: string][]
  endpoints?: [pattern: string, kind: string][]
  githubHost?: string
  defaults?: string
}

function loadProfile(): Profile {
  const file = env("DRAWMAN_PROFILE")
  if (!file) return {}
  try {
    const profile = JSON.parse(readFileSync(path.resolve(file), "utf8").replace(/^\uFEFF/, "")) as Profile
    if (profile.hints) addKindHints(profile.hints)
    return profile
  } catch (error) {
    console.error(`drawman: ignoring profile ${file}: ${(error as Error).message}`)
    return {}
  }
}
const profile = loadProfile()

export function isBroad(dir: string) {
  const p = path.resolve(dir)
  return p === path.parse(p).root || p.toLowerCase() === path.resolve(homedir()).toLowerCase()
}

const within = (child: string, parent: string) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

function defaultRoots(): string[] {
  const explicit = env("DRAWMAN_WORKSPACE_ROOTS")
  if (explicit) return explicit.split(path.delimiter).filter(Boolean).map((p) => path.resolve(p))
  const project = env("CLAUDE_PROJECT_DIR")
  if (project && existsSync(project) && !isBroad(project)) return [path.resolve(project)]
  const cwd = process.cwd()
  const pluginDirs = ["PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT", "COPILOT_PLUGIN_ROOT"].map((k) => env(k)).filter(Boolean)
  if (isBroad(cwd) || pluginDirs.some((d) => within(cwd, d))) return []
  return [path.resolve(cwd)]
}

export const config = {
  profile,
  llm: {
    baseUrl: env("DRAWMAN_LLM_URL").replace(/\/+$/, ""),
    apiKey: env("DRAWMAN_LLM_KEY"),
    model: env("DRAWMAN_LLM_MODEL", "gpt-4.1"),
    keyHeader: env("DRAWMAN_LLM_KEY_HEADER", "Authorization"),
  },
  githubHost: env("DRAWMAN_GITHUB_HOST", profile.githubHost || "github.com"),
  workspaceRoots: defaultRoots(),
  rootsSource: (env("DRAWMAN_WORKSPACE_ROOTS") ? "env" : defaultRoots().length ? "default" : "none") as "env" | "default" | "client" | "agent" | "none",
  /** Opt-in: headless agents may announce sampling and then never answer. */
  sampling: env("DRAWMAN_SAMPLING") === "1",
  outputDir: env("DRAWMAN_OUTPUT_DIR", "diagrams"),
  save: env("DRAWMAN_SAVE", "auto") as "auto" | "always" | "never",
  allowRemoteClone: env("DRAWMAN_ALLOW_CLONE", "1") !== "0",
}

export const llmConfigured = () => Boolean(config.llm.baseUrl && config.llm.apiKey)

export function llmHeaders(): Record<string, string> {
  const { keyHeader, apiKey } = config.llm
  return keyHeader.toLowerCase() === "authorization" ? { Authorization: `Bearer ${apiKey}` } : { [keyHeader]: apiKey }
}

export const conventions = () => (profile.conventions ?? []).map((c) => `- ${c}`).join("\n")
