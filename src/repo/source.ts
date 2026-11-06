import { execFile } from "node:child_process"
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { config } from "../config.js"

const run = promisify(execFile)
const CACHE = path.join(tmpdir(), "drawman-repos")
const FRESH_MS = 10 * 60_000
const REF = /^(?!-)[\w./-]{1,200}$/

export interface RepoSource { dir: string; label: string; url?: string; ref?: string; commit?: string; cloned: boolean }

// Allow-listed environment: inherited GIT_* variables (e.g. GIT_SSH_COMMAND) could make git run commands.
const PASS = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|USER|USERNAME|LOGNAME|LANG|LC_[A-Z]+|SSH_AUTH_SOCK|HTTPS?_PROXY|NO_PROXY|ALL_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|XDG_[A-Z_]+)$/i
export function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && PASS.test(k)) env[k] = v
  return {
    ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_LFS_SKIP_SMUDGE: "1",
    // Only network transports; never ext::, file:// or fd:: from untrusted input.
    GIT_ALLOW_PROTOCOL: "https:ssh",
  }
}

async function git(args: string[], cwd?: string, timeout = 90_000) {
  const { stdout } = await run("git", args, { cwd, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: gitEnv() })
  return stdout.trim()
}

export function toUrl(input: string): string | null {
  const s = input.trim().replace(/\.git$/, "")
  if (/^https:\/\//i.test(s)) {
    let u: URL
    try { u = new URL(s) } catch { return null }
    if (u.username || u.password) return null
    const parts = u.pathname.split("/").filter(Boolean)
    return parts.length >= 2 && parts.slice(0, 2).every((p) => /^[\w.-]+$/.test(p)) ? `${u.origin}/${parts[0]}/${parts[1]}.git` : null
  }
  if (/^git@[\w.-]+:[\w.-]+\/[\w.-]+$/.test(s)) return `${s}.git`
  const m = s.match(/^([\w.-]+)\/([\w.-]+)$/)
  return m && !/^[.-]/.test(m[1]) && !/^[.-]/.test(m[2]) ? `https://${config.githubHost}/${m[1]}/${m[2]}.git` : null
}

const inside = (child: string, parent: string) => {
  const rel = path.relative(parent, child)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

/** Checked lexically before touching the filesystem (no probing, no network shares), then again after resolving symlinks. */
export function localFolder(input: string): string | null {
  const raw = input.trim().replace(/^["']|["']$/g, "")
  if (/^(\\\\|\/\/)/.test(raw)) throw new Error("Network paths are not allowed")
  const lexRoots = config.workspaceRoots.map((r) => path.resolve(r))
  if (!lexRoots.length) {
    if (path.isAbsolute(raw) || raw === "." || !toUrl(raw)) throw new Error("No workspace folder is known: call again with `workspace` set to the absolute path of your current working directory (or set DRAWMAN_WORKSPACE_ROOTS)")
    return null
  }
  const candidates = path.isAbsolute(raw) ? [path.resolve(raw)] : lexRoots.map((r) => path.resolve(r, raw))
  for (const c of candidates) {
    if (!lexRoots.some((r) => inside(c, r))) {
      if (path.isAbsolute(raw) || raw.startsWith("..")) throw new Error(`${raw} is outside the allowed workspace roots; add it to DRAWMAN_WORKSPACE_ROOTS to allow it`)
      continue
    }
    if (!existsSync(c) || !statSync(c).isDirectory()) continue
    const real = realpathSync(c)
    const roots = lexRoots.filter((r) => existsSync(r)).map((r) => realpathSync(r))
    if (roots.some((r) => inside(real, r))) return real
    throw new Error(`${raw} is outside the allowed workspace roots; add it to DRAWMAN_WORKSPACE_ROOTS to allow it`)
  }
  return null
}

const inflight = new Map<string, Promise<void>>()
async function cloneInto(target: string, url: string, label: string, ref?: string) {
  if (existsSync(path.join(target, ".git")) && Date.now() - statSync(target).mtimeMs < FRESH_MS) return
  mkdirSync(CACHE, { recursive: true })
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  const args = ["clone", "--depth", "1", "--single-branch", "--no-tags", "--filter=blob:limit=512k", "-c", "core.symlinks=false"]
  if (ref) args.push("--branch", ref)
  try {
    await git([...args, "--", url, tmp])
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true })
    const msg = String((error as { stderr?: string }).stderr || (error as Error).message).split("\n").filter(Boolean).slice(-2).join(" ")
    throw new Error(`Could not clone ${label}: ${msg}`)
  }
  rmSync(target, { recursive: true, force: true })
  try { renameSync(tmp, target) } catch (error) { rmSync(tmp, { recursive: true, force: true }); throw error }
}

export async function resolveRepository(input: string, ref?: string): Promise<RepoSource> {
  if (ref && !REF.test(ref)) throw new Error(`invalid ref "${ref}"`)
  const dir = localFolder(input)
  if (dir) {
    let commit: string | undefined
    try { commit = await git(["rev-parse", "--short", "HEAD"], dir, 10_000) } catch { /* not a git checkout */ }
    return { dir, label: path.basename(dir), commit, cloned: false }
  }
  const url = toUrl(input)
  if (!url) throw new Error(`"${input}" is neither a folder in the workspace nor a repository (use owner/repo, an https git URL or a path)`)
  if (!config.allowRemoteClone) throw new Error("Cloning remote repositories is disabled (DRAWMAN_ALLOW_CLONE=0)")
  const slug = url.replace(/^(https:\/\/|git@)/, "").replace(/\.git$/, "").replace(/[^\w.-]+/g, "_") + (ref ? `@${ref.replace(/[^\w.-]+/g, "_")}` : "")
  const target = path.join(CACHE, slug)
  const label = url.replace(/^https:\/\/[^/]+\/|^git@[^:]+:/, "").replace(/\.git$/, "")
  let job = inflight.get(target)
  if (!job) {
    job = cloneInto(target, url, label, ref).finally(() => inflight.delete(target))
    inflight.set(target, job)
  }
  await job
  const commit = await git(["rev-parse", "--short", "HEAD"], target, 10_000).catch(() => undefined)
  return { dir: target, label, url, ref, commit, cloned: true }
}
