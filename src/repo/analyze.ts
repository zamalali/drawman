import { conventions } from "../config.js"
import { CLOUD_TWINS, GENERIC_OF, KIND, PLATFORMS, ZONES, brandKind, normaliseFacts, normaliseKind, type DiagramInput, type FramePlatform, type InputNode } from "../engine/index.js"
import type { Complete } from "../llm.js"
import { platformTitle, scanRepository, type Scan } from "./scan.js"
import { resolveRepository, type RepoSource } from "./source.js"
import { enforceSupplyChain } from "./supply-chain.js"

const MARKER = "===JSON==="

export const vocabulary = () => {
  const groups = new Map<string, string[]>()
  for (const [kind, [zone, , platform]] of Object.entries(KIND)) {
    const g = `${platform === "neutral" ? "Outside any cloud" : PLATFORMS[platform as FramePlatform].title} / ${ZONES[zone][0]}`
    groups.set(g, [...(groups.get(g) ?? []), kind])
  }
  return [...groups].map(([g, ks]) => `${g}: ${ks.join(", ")}`).join("\n")
}

const RULES = `Diagram rules: 8-22 nodes, 7-24 interfaces. Show the build/deploy path (repo -> CI -> artifact -> runtime) and the runtime
data flow, including identity (IAM / Entra ID / Cognito / XSUAA / Keycloak) and the network hops to on-premises (destination -> connectivity ->
Cloud Connector -> backend) when present. Group many similar externals into one node. Pick the most specific kind; the
kind decides the platform frame, zone and official icon.
PLATFORM RULE: use cloud-specific kinds (gcp/aws/azure/sap) ONLY for a cloud the evidence proves. Code that runs in
docker-compose, Kubernetes or on a generic host uses the open-source kinds (postgres, mysql, mongodb, redis, kafka, rabbitmq,
nginx, traefik, container_service, web_app, background_worker, k8s_workload, database, object_storage, message_broker...).
A Postgres container is "postgres", not cloud_sql; a Node API in compose is "container_service", not cloud_run.
Use "workload_identity" for keyless CI -> cloud federation, "jfrog_artifactory" for Artifactory, "llm_gateway" for an LLM
proxy or model API. DETERMINISTIC SIGNALS are ground truth: every one of them must be represented unless it is clearly
irrelevant to the runtime architecture.`

const PROMPT = (repo: RepoSource, scan: Scan, focus?: string) => `You are the ARCHITECT agent of "Drawman".
Read the repository below (code, CI/CD, infrastructure-as-code, SAP MTA descriptors) and work out its architecture:
what runs where (Google Cloud, Microsoft Azure, SAP BTP, on-premises), how it is built and deployed, which data stores,
integrations, identity and external systems it uses, and who calls it.
Only use facts visible in the repository. Never invent hostnames, projects or systems. If a dependency is only implied
(e.g. an SAP destination name), draw it as the backend that the evidence names, with status "external" when it lives elsewhere.
${focus ? `\nUSER FOCUS: ${focus}\n` : ""}${conventions() ? `\nORGANISATION CONVENTIONS:\n${conventions()}\n` : ""}
FIRST write 6-14 short lines of working notes, one finding per line, each starting with "FOUND:" and citing the file,
e.g. "FOUND: mta.yaml binds the CAP service to XSUAA, destination and HANA HDI". No emojis, no markdown.
THEN write a line containing exactly ${MARKER} and after it ONE JSON object (no markdown fences):
{
  "title": "<service name> - Architecture",
  "subtitle": "<repository> · <main platform/region if known>",
  "nodes": [{"id": "short_snake_id", "kind": "<vocabulary>", "title": "max 4 words", "detail": "max 7 words, concrete", "status": "active|planned|bypassed|external", "evidence": "file[:line]"}],
  "interfaces": [{"from": "node id", "to": "node id", "label": "max 4 words", "protocol": "HTTPS/OData/JDBC/OIDC/...", "description": "one sentence", "evidence": "file[:line]"}]
}
${RULES}

VOCABULARY (kind values, grouped by platform / zone):
${vocabulary()}

REPOSITORY ${repo.label}${repo.commit ? ` @ ${repo.commit}` : ""} (platforms detected: ${scan.platforms.map(platformTitle).join(", ") || "none"}):
${scan.context}`

export interface Analysis {
  repository: string
  commit?: string
  url?: string
  files: number
  read: number
  platforms: string[]
  signals: { kind: string; source: string; at: string }[]
  findings: string[]
  model: string
  ms: number
  tokens?: { prompt: number; completion: number }
  coverage: { represented: number; total: number; missing: string[] }
}

const recent = new Map<string, { repo: RepoSource; scan: Scan; at: number }>()
const remember = (repo: RepoSource, scan: Scan) => {
  recent.set(repo.label.toLowerCase(), { repo, scan, at: Date.now() })
  for (const [k, v] of recent) if (Date.now() - v.at > 60 * 60_000) recent.delete(k)
}
export const recentScan = (repository: string) => {
  const key = repository.trim().toLowerCase().replace(/\.git$/, "")
  return [...recent].find(([k]) => k === key || key.endsWith(`/${k}`) || k.endsWith(`/${key}`))?.[1]
}

function split(text: string) {
  const notes = text.split(MARKER)[0]
  const blob = text.includes(MARKER) ? text.split(MARKER).slice(1).join(MARKER) : text
  const json = blob.slice(blob.indexOf("{"), blob.lastIndexOf("}") + 1)
  const findings = notes.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^FOUND:/i.test(l)).map((l) => l.replace(/^FOUND:\s*/i, ""))
  return { findings, json }
}

function describe(repo: RepoSource, scan: Scan, diagram: DiagramInput | null, extra: Partial<Analysis>): Analysis {
  const facts = diagram ? normaliseFacts(diagram) : null
  const present = new Set(facts?.nodes.map((n) => n.kind) ?? [])
  const represented = (kind: string) => present.has(kind) ||
    [...present].some((p) => GENERIC_OF[p] === kind || GENERIC_OF[kind] === p || (GENERIC_OF[p] !== undefined && GENERIC_OF[p] === GENERIC_OF[kind]))
  const relevant = scan.signals.filter((s) => s.kind !== "github_repo")
  const missing = relevant.filter((s) => !represented(s.kind)).map((s) => s.kind)
  return {
    repository: repo.label,
    commit: repo.commit,
    url: repo.url,
    files: scan.files.length,
    read: scan.read.length,
    platforms: [...new Set([...scan.platforms, ...(facts?.nodes.map((n) => KIND[n.kind][2]).filter((p) => p !== "neutral") ?? [])])],
    signals: scan.signals.map((s) => ({ kind: s.kind, source: s.source, at: s.evidence[0]?.at ?? "" })),
    findings: [],
    model: "",
    ms: 0,
    coverage: { represented: relevant.length - missing.length, total: relevant.length, missing },
    ...extra,
  }
}

export function provenClouds(scan: Scan) {
  const proven = new Set(scan.platforms.filter((p) => p !== "selfhosted" && p !== "onprem"))
  const MENTIONS: [string, RegExp][] = [
    ["gcp", /google cloud|\bgcp\b|cloud run|\bgke\b|bigquery|\bgcloud\b|firestore|pub\/sub/gi],
    ["aws", /\baws\b|amazon web services|\blambda\b|dynamodb|\bs3\b|cloudformation|\becs\b|\beks\b/gi],
    ["azure", /\bazure\b|\bazd\b|cosmos ?db|app service/gi],
  ]
  for (const [p, re] of MENTIONS) if ((scan.context.match(re)?.length ?? 0) >= 4) proven.add(p)
  return proven
}

export function platformGuard(diagram: DiagramInput, scan: Scan) {
  const proven = provenClouds(scan)
  const CLOUDS = ["gcp", "aws", "azure"] as const
  const changes: string[] = []
  const nodes = (Array.isArray(diagram.nodes) ? diagram.nodes : []).map((raw) => {
    const n = raw as InputNode
    const kind = brandKind(normaliseKind(String(n.kind ?? ""), String(n.title ?? ""), String(n.detail ?? "")), String(n.title ?? ""))
    const platform = KIND[kind]?.[2]
    if (!(platform === "gcp" || platform === "aws" || platform === "azure") || proven.has(platform)) return n
    const twins = CLOUD_TWINS.find((t) => t.includes(kind))
    const target = CLOUDS.filter((c) => proven.has(c)).map((c) => twins?.[CLOUDS.indexOf(c)]).find(Boolean) ?? GENERIC_OF[kind]
    if (!target) return n
    changes.push(`${n.title ?? n.id}: ${kind} -> ${target} (no ${PLATFORMS[platform].title} evidence)`)
    return { ...n, kind: target }
  })
  return { diagram: { ...diagram, nodes }, changes }
}

export function applyRecentEvidence(repository: string, diagram: DiagramInput) {
  const hit = recentScan(repository)
  if (!hit) return null
  const guarded = platformGuard(diagram, hit.scan)
  const enforced = enforceSupplyChain(guarded.diagram, hit.scan.signals)
  const analysis = describe(hit.repo, hit.scan, enforced.diagram, {
    findings: [...guarded.changes.map((c) => `Platform (deterministic): ${c}`), ...enforced.changes.map((c) => `Release path (deterministic): ${c}`)],
    model: "calling agent",
  })
  return { diagram: enforced.diagram, analysis }
}

export function compactEvidence(scan: Scan, budget: number) {
  const signals = scan.signals.map((s) => `- ${s.kind} [${s.source}] ${s.evidence.map((e) => `${e.at}: ${e.line}`).join(" | ")}`).join("\n")
  const tree = scan.files.slice(0, 120).join("\n") + (scan.files.length > 120 ? `\n... ${scan.files.length - 120} more files` : "")
  let out = `# DETERMINISTIC SIGNALS (file:line evidence)\n${signals || "(none)"}\n\n# FILE TREE (${scan.files.length} files)\n${tree}`
  for (const chunk of scan.context.split(/\n\n(?=# FILE: )/).filter((c) => c.startsWith("# FILE: "))) {
    const room = budget - out.length - 2
    if (room < 400) break
    out += `\n\n${chunk.length > room ? `${chunk.slice(0, room - 20)}\n...(truncated)` : chunk}`
  }
  return out.slice(0, budget)
}

export type AnalyzeResult =
  | { mode: "diagram"; diagram: DiagramInput; analysis: Analysis }
  | { mode: "handoff"; brief: string; analysis: Analysis }

export async function analyzeRepository(repository: string, opts: { ref?: string; focus?: string; complete?: Complete | null; remember?: boolean } = {}): Promise<AnalyzeResult> {
  const t0 = Date.now()
  const repo = await resolveRepository(repository, opts.ref)
  const scan = scanRepository(repo.dir)
  if (!scan.files.length) throw new Error(`${repo.label} contains no readable files`)
  if (opts.remember !== false) remember(repo, scan)

  if (!opts.complete) {
    const brief = `Repository evidence for ${repo.label}${repo.commit ? ` @ ${repo.commit}` : ""}. No server-side model is configured, so YOU are the architect:
read the evidence below, then call create_architecture_diagram with repository="${repo.label}" and the nodes/interfaces you derive
(the server re-applies the evidence-based release path). Only use facts visible here; cite them when you summarise.
${opts.focus ? `USER FOCUS: ${opts.focus}\n` : ""}${conventions() ? `ORGANISATION CONVENTIONS:\n${conventions()}\n` : ""}${RULES}

${compactEvidence(scan, 16_000)}`
    return { mode: "handoff", brief, analysis: describe(repo, scan, null, { model: "calling agent", ms: Date.now() - t0 }) }
  }

  const prompt = PROMPT(repo, scan, opts.focus)
  let ask = prompt
  let diagram: DiagramInput | null = null
  let findings: string[] = []
  let model = ""
  let tokens: Analysis["tokens"]
  for (let attempt = 1; attempt <= 2 && !diagram; attempt++) {
    const r = await opts.complete(ask, 10_000)
    model = r.model
    tokens = r.usage
    const s = split(r.text)
    findings = s.findings
    try {
      const parsed = JSON.parse(s.json) as DiagramInput
      if (normaliseFacts(parsed).nodes.length < 3) throw new Error("fewer than 3 valid nodes")
      diagram = parsed
    } catch (error) {
      ask = `${prompt}\n\nYOUR PREVIOUS ANSWER WAS INVALID (${(error as Error).message}). Return notes, then ${MARKER}, then ONE valid JSON object.`
    }
  }
  if (!diagram) throw new Error("The architect model did not return a valid diagram")
  const guarded = platformGuard(diagram, scan)
  const enforced = enforceSupplyChain(guarded.diagram, scan.signals)
  diagram = {
    ...enforced.diagram,
    title: (enforced.diagram.title as string) || `${repo.label} - Architecture`,
    subtitle: (enforced.diagram.subtitle as string) || `${repo.label}${repo.commit ? ` @ ${repo.commit}` : ""}`,
  }
  const analysis = describe(repo, scan, diagram, {
    findings: [...findings, ...guarded.changes.map((c) => `Platform (deterministic): ${c}`), ...enforced.changes.map((c) => `Release path (deterministic): ${c}`)],
    model, tokens, ms: Date.now() - t0,
  })
  return { mode: "diagram", diagram, analysis }
}
