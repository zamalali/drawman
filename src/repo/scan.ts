import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { config } from "../config.js"
import { KIND, PLATFORMS, platformOf } from "../engine/kinds.js"
import { ARM, CFN, DEPS, HOSTS, IMAGES, MTA_SERVICE, PRIORITY, TF, WORKFLOW } from "./rules.js"
import { SECRET_FILE, redact } from "./secrets.js"

export { redact } from "./secrets.js"

export interface Evidence { at: string; line: string }
export interface Signal { kind: string; source: string; evidence: Evidence[] }
export interface Scan {
  files: string[]
  signals: Signal[]
  platforms: string[]
  hosts: string[]
  context: string
  read: string[]
}

const SKIP_DIRS = new Set([".git", "node_modules", "vendor", "dist", "build", "__pycache__", ".venv", "venv", "target",
  ".next", "coverage", ".terraform", ".idea", ".vscode", "out", "bin", "obj", ".gradle", "mta_archives"])
const TEXT_EXT = /\.(ya?ml|json|tf|tfvars|bicep|cds|ts|tsx|js|mjs|cjs|py|go|java|kt|cs|xml|toml|properties|env|example|md|sh|ps1|sql|hdbtable|hdbview|abap)$/i
const MAX_FILES = 6000

function walk(root: string): string[] {
  const out: string[] = []
  const stack = [""]
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop()!
    let entries: import("node:fs").Dirent[] = []
    try { entries = readdirSync(path.join(root, rel), { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      // Symlinks are never followed: they could point outside the workspace (e.g. at ~/.kube/config).
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !(e.name.startsWith(".") && e.name !== ".github")) stack.push(r) }
      else if (e.isFile()) out.push(r)
    }
  }
  return out.sort()
}

export function scanRepository(root: string): Scan {
  const files = walk(root)
  const signals = new Map<string, Signal>()
  const hosts = new Set<string>()
  const texts = new Map<string, string>()
  const read = (rel: string, max = 400_000): string => {
    if (texts.has(rel)) return texts.get(rel)!
    let t = ""
    try {
      const p = path.join(root, rel)
      if (!SECRET_FILE.test(rel) && statSync(p).size <= max) t = readFileSync(p, "utf8")
    } catch { /* unreadable / cloud placeholder */ }
    texts.set(rel, t)
    return t
  }
  const add = (kind: string, source: string, at: string, line: string) => {
    if (!(kind in KIND)) return
    const s = signals.get(kind) ?? { kind, source, evidence: [] }
    if (s.evidence.length < 3) s.evidence.push({ at, line: redact(line.trim()).slice(0, 140) })
    signals.set(kind, s)
  }
  const lines = (rel: string) => read(rel).split(/\r?\n/)

  if (files.some((f) => f.startsWith(".github/workflows/"))) add("github_repo", "repository", ".github/", "GitHub repository with Actions workflows")
  for (const f of files) {
    const base = path.basename(f).toLowerCase()
    const lower = f.toLowerCase()
    if (lower.startsWith(".github/workflows/") && /\.ya?ml$/.test(lower)) {
      add("github_actions", "workflow", f, `workflow ${base}`)
      lines(f).forEach((l, i) => { if (!l.trim().startsWith("#")) for (const [re, k] of WORKFLOW) if (re.test(l)) add(k, "workflow", `${f}:${i + 1}`, l) })
    } else if (base === "azure-pipelines.yml" || base === "azure-pipelines.yaml") add("az_devops", "pipeline", f, "Azure Pipelines definition")
    else if (base === "cloudbuild.yaml" || base === "cloudbuild.yml") add("cloud_build", "pipeline", f, "Cloud Build definition")
    else if (/^dockerfile/.test(base)) add("docker_build", "dockerfile", f, lines(f).find((l) => /^FROM /i.test(l)) ?? "Dockerfile")
    else if (base === ".gitlab-ci.yml") add("gitlab_ci", "pipeline", f, "GitLab CI pipeline")
    if (/(^|\/)(docker-)?compose[\w.-]*\.ya?ml$/.test(lower)) scanCompose(f, read(f), add)
    if (/\.ya?ml$/.test(lower) && /^\s*kind:\s*(Deployment|StatefulSet|DaemonSet|CronJob|Job|Service|Ingress)\s*$/m.test(read(f))) {
      const l = lines(f), i = l.findIndex((x) => /^\s*kind:\s*(Deployment|StatefulSet|DaemonSet|CronJob|Job)\s*$/.test(x))
      if (i >= 0) add("k8s_workload", "kubernetes", `${f}:${i + 1}`, l[i])
      l.forEach((x, j) => { const m = x.match(/^\s*(?:-\s*)?image:\s*["']?([^\s"']+)/); if (m) for (const [re, k] of IMAGES) if (re.test(m[1])) add(k, "kubernetes", `${f}:${j + 1}`, x) })
      if (/^\s*kind:\s*Ingress\s*$/m.test(read(f))) add("reverse_proxy", "kubernetes", f, "Kubernetes Ingress")
    }
    if (base === "chart.yaml") add("helm_chart", "helm", f, "Helm chart")
    if (base === "serverless.yml" || base === "serverless.yaml") {
      if (/provider:\s*\n?\s*name:\s*aws|provider:\s*aws/m.test(read(f))) add("aws_lambda", "serverless", f, "Serverless Framework on AWS")
    }
    if (/\.(ya?ml|json|template|ts|py|js)$/.test(lower) && /AWS::|aws-cdk-lib|@aws-cdk\/|aws_cdk/.test(read(f))) {
      lines(f).forEach((l, i) => { for (const [re, k] of CFN) if (re.test(l)) { add(k, /AWS::/.test(l) ? "cloudformation" : "cdk", `${f}:${i + 1}`, l); break } })
      add("aws_cloudformation", "cloudformation", f, /aws-cdk-lib|@aws-cdk|aws_cdk/.test(read(f)) ? "AWS CDK app" : "CloudFormation template")
    }
    if (/\.tf$/.test(lower)) {
      if (!signals.has("terraform")) add("terraform", "terraform", f, "Terraform configuration")
      lines(f).forEach((l, i) => {
        if (!/^\s*(resource|data|module)\s/.test(l) && !/source\s*=/.test(l)) return
        for (const [re, k] of TF) if (re.test(l)) { add(k, "terraform", `${f}:${i + 1}`, l); break }
        const btp = l.match(/"btp_[\w]+"/)
        if (btp) add("sap_cf_app", "terraform", `${f}:${i + 1}`, l)
      })
    }
    if (/\.bicep$/.test(lower) || (/\.json$/.test(lower) && /deploymentTemplate/.test(read(f, 600_000).slice(0, 400)))) {
      lines(f).forEach((l, i) => { for (const [re, k] of ARM) if (re.test(l)) { add(k, "bicep/arm", `${f}:${i + 1}`, l); break } })
    }
    if (base === "mta.yaml" || base === "mta.yml") scanMta(f, read(f), add)
    if (base === "xs-security.json") add("sap_xsuaa", "sap", f, "XSUAA security descriptor")
    if (base === "xs-app.json") {
      add("sap_approuter", "sap", f, "approuter routes")
      lines(f).forEach((l, i) => { const m = l.match(/"destination"\s*:\s*"([^"]+)"/); if (m) add("sap_destination", "sap", `${f}:${i + 1}`, l) })
    }
    if (base === "ui5.yaml") add("sap_html5_repo", "sap", f, "SAPUI5 / Fiori application")
    if (/\.cds$/.test(lower)) add("sap_cap", "sap", f, "CDS model")
    if (/\.abap$/.test(lower) || base === ".abapgit.xml") add("sap_abap_env", "sap", f, "ABAP sources")
    if (base === "manifest.yml" && /^\s*applications:/m.test(read(f))) add("sap_cf_app", "cloud foundry", f, "Cloud Foundry manifest")
    if (/(^|\/)(package\.json|requirements[\w-]*\.txt|pyproject\.toml|go\.mod|pom\.xml|build\.gradle)$/.test(lower)) {
      lines(f).forEach((l, i) => { for (const [re, k] of DEPS) if (re.test(l)) add(k, "dependency", `${f}:${i + 1}`, l) })
    }
    if (TEXT_EXT.test(lower) && !/lock|\.min\./.test(lower)) {
      const t = read(f, 200_000)
      for (const m of t.matchAll(/https?:\/\/([a-z0-9][\w.-]+\.[a-z]{2,})/gi)) {
        const h = m[1].toLowerCase()
        if (!/(localhost|example\.|schemas?\.|w3\.org|json-schema|github\.com\/[\w-]+\/[\w-]+\/(blob|tree)|npmjs|pypi|shields\.io|xmlsoap|openapis|swagger)/.test(h)) hosts.add(h)
      }
      if (/\.(ya?ml|json|env|example|ts|js|py|go|properties|toml)$/.test(lower)) {
        lines(f).forEach((l, i) => { for (const [re, k] of HOSTS) if (re.test(l)) add(k, "endpoint", `${f}:${i + 1}`, l) })
      }
    }
  }
  const list = [...signals.values()]
  const platforms = [...new Set(list.map((s) => platformOf(s.kind)).filter((p) => p !== "neutral"))]
  const { context, readFiles } = collectContext(root, files, read, list)
  return { files, signals: list, platforms, hosts: [...hosts].slice(0, 60), context, read: readFiles }
}

function scanCompose(f: string, text: string, add: (k: string, s: string, at: string, l: string) => void) {
  let doc: { services?: Record<string, { image?: string; build?: unknown; command?: unknown }> } = {}
  try { doc = parseYaml(text) ?? {} } catch { return }
  const lines = text.split(/\r?\n/)
  const at = (name: string) => {
    const i = lines.findIndex((l) => new RegExp(`^\\s{2,4}${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*$`).test(l))
    return i >= 0 ? `${f}:${i + 1}` : f
  }
  for (const [name, svc] of Object.entries(doc.services ?? {})) {
    const image = String(svc?.image ?? "")
    const known = IMAGES.find(([re]) => re.test(image))
    if (known) add(known[1], "compose", at(name), `service ${name} (${image})`)
    else if (svc?.build || image) {
      const worker = /worker|consumer|scheduler|cron|celery|queue/i.test(`${name} ${JSON.stringify(svc?.command ?? "")}`)
      const web = /frontend|web|ui|client|app$/i.test(name) && !/api|backend|server/i.test(name)
      add(worker ? "background_worker" : web ? "web_app" : "container_service", "compose", at(name), `service ${name}${image ? ` (${image})` : " (built here)"}`)
    }
  }
}

function scanMta(f: string, text: string, add: (k: string, s: string, at: string, l: string) => void) {
  let doc: { modules?: { name?: string; type?: string; path?: string }[]; resources?: { name?: string; type?: string; parameters?: { service?: string } }[] } = {}
  try { doc = parseYaml(text) ?? {} } catch { return }
  const at = (needle?: string) => {
    const i = needle ? text.split(/\r?\n/).findIndex((l) => l.includes(needle)) : -1
    return i >= 0 ? `${f}:${i + 1}` : f
  }
  for (const m of doc.modules ?? []) {
    const t = (m.type ?? "").toLowerCase()
    const line = `module ${m.name} (${m.type})`
    if (t.includes("approuter")) add("sap_approuter", "mta", at(m.name), line)
    else if (t === "hdb" || t.includes("hdi")) add("sap_hana_cloud", "mta", at(m.name), line)
    else if (t.includes("html5") || t.includes("application-content")) add("sap_html5_repo", "mta", at(m.name), line)
    else if (/nodejs|java|python|go/.test(t)) add(/srv|cds|cap/i.test(`${m.name} ${m.path}`) ? "sap_cap" : "sap_cf_app", "mta", at(m.name), line)
  }
  for (const r of doc.resources ?? []) {
    const service = (r.parameters?.service ?? "").toLowerCase()
    const t = (r.type ?? "").toLowerCase()
    const kind = MTA_SERVICE[service] ?? (t.includes("hdi") ? "sap_hana_cloud" : t.includes("xsuaa") ? "sap_xsuaa" : undefined)
    if (kind) add(kind, "mta", at(r.name), `resource ${r.name} (${service || t})`)
  }
  if (/ProxyType:\s*OnPremise/i.test(text)) add("sap_cloud_connector", "mta", at("OnPremise"), "destination with ProxyType OnPremise")
}

function collectContext(root: string, files: string[], read: (f: string, max?: number) => string, signals: Signal[]) {
  const budget = 85_000
  const tree = files.slice(0, 500).join("\n") + (files.length > 500 ? `\n... ${files.length - 500} more files` : "")
  const sig = signals.map((s) => `- ${s.kind} [${s.source}] ${s.evidence.map((e) => `${e.at}: ${e.line}`).join(" | ")}`).join("\n")
  const parts = [`# FILE TREE (${files.length} files)\n${tree}`, `\n\n# DETERMINISTIC SIGNALS (file:line evidence)\n${sig || "(none)"}`]
  let used = parts.join("").length
  const rank = (f: string) => PRIORITY.find(([re]) => re.test(f))?.[1] ?? 99
  const picked = files.filter((f) => rank(f) < 99 && !/test|spec|__tests__|\.d\.ts$|lock|\.min\./i.test(f))
    .sort((a, b) => rank(a) - rank(b) || a.split("/").length - b.split("/").length || a.localeCompare(b))
  const readFiles: string[] = []
  for (const f of picked) {
    const limit = rank(f) <= 2 ? 12_000 : rank(f) <= 4 ? 5_000 : 3_500
    const text = redact(read(f).slice(0, limit))
    if (!text.trim()) continue
    const chunk = `\n\n# FILE: ${f}\n${text}`
    if (used + chunk.length > budget) continue
    parts.push(chunk)
    used += chunk.length
    readFiles.push(f)
  }
  void root
  return { context: parts.join(""), readFiles }
}

export const platformTitle = (p: string) => (p in PLATFORMS ? PLATFORMS[p as keyof typeof PLATFORMS].title : p)
