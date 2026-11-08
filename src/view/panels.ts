// Side panels: the card inspector, follow-up suggestions and repository-analysis insights.
import { PLATFORMS } from "../engine/index.js"
import { escHtml, setStatus, tick, ui } from "./dom.js"
import { app } from "./host.js"
import { state } from "./state.js"

export function showInspector(id: string) {
  if (!state.current) return
  const card = state.current.cards.find((c) => c.node.id === id)
  if (!card) return
  const n = card.node
  const titles = new Map(state.current.facts.nodes.map((x) => [x.id, x.title]))
  const ifs = state.current.edges.filter((e) => e.from === id || e.to === id)
  ui.inspector.innerHTML = `
    <h4>${escHtml(n.title)}</h4>
    <div class="k">${state.current.facts.flow ? `${escHtml(n.shape ?? "step")}${card.zoneTitle ? ` · ${escHtml(card.zoneTitle)}` : ""}` : `${state.current.facts.groups ? "" : `${escHtml(n.kind)} · `}${escHtml(card.platform === "neutral" ? "" : `${PLATFORMS[card.platform].title} · `)}${escHtml(card.zoneTitle)}`}${n.status !== "active" ? ` · ${n.status}` : ""}</div>
    ${n.detail ? `<div>${escHtml(n.detail)}</div>` : ""}
    <ul>${ifs.map((e) => state.current!.facts.flow
      ? `<li>${escHtml(titles.get(e.from) ?? "")} → ${escHtml(titles.get(e.to) ?? "")}${e.label ? ` <span class="k">(${escHtml(e.label)})</span>` : ""}</li>`
      : `<li><b>${e.id}</b> ${escHtml(titles.get(e.from) ?? "")} → ${escHtml(titles.get(e.to) ?? "")}${e.protocol ? ` <span class="k">(${escHtml(e.protocol)})</span>` : ""}</li>`).join("") || "<li>No connections</li>"}</ul>
    <div class="row">
      <button data-ask="explain">Ask about it</button>
      <button data-ask="remove">Remove it</button>
    </div>`
  ui.inspector.hidden = false
  void app.updateModelContext({
    content: [{ type: "text", text: state.current.facts.flow
      ? `In the flowchart the user selected the step "${n.title}" (${n.shape}, id ${n.id}).`
      : `In the draw.io diagram the user selected "${n.title}" (${n.kind}, id ${n.id}) with interfaces ${ifs.map((e) => e.id).join(", ") || "none"}.` }],
  }).catch(() => undefined)
  ui.inspector.querySelector<HTMLButtonElement>('[data-ask="explain"]')!.onclick = () =>
    ask(state.current?.facts.flow
      ? `Explain the step "${n.title}" in this flowchart: what happens there and where each of its branches leads.`
      : `Explain the role of "${n.title}" in this architecture and walk through its interfaces ${ifs.map((e) => e.id).join(", ")}.`)
  ui.inspector.querySelector<HTMLButtonElement>('[data-ask="remove"]')!.onclick = () =>
    ask(`Remove "${n.title}" (${n.id}) from the diagram, rewiring or removing every interface it had.`)
}
export function hideInspector() { ui.inspector.hidden = true }

export async function ask(text: string) {
  hideInspector()
  try { await app.sendMessage({ role: "user", content: [{ type: "text", text }] }) }
  catch { tick("Host did not accept the follow-up message") }
}

export function showSuggestions() {
  const kinds = new Set(state.current?.facts.nodes.map((n) => n.kind))
  const ideas: [string, string][] = []
  const family = state.current?.seq ? "sequence" : state.current?.facts.flow?.family
  if (family === "sequence") {
    ideas.push(["Add error paths", "Add the error, timeout and retry paths to this sequence diagram (as alt fragments)."])
    ideas.push(["Add caching", "Add a cache in front of the slowest call in this sequence."])
    ideas.push(["Explain the flow", "Walk me through this sequence diagram message by message."])
  } else if (family === "state") {
    ideas.push(["Add error states", "Add the missing failure and timeout states and transitions to this state machine."])
    ideas.push(["Add guards", "Add guard conditions and actions to the transitions where they matter."])
    ideas.push(["Explain it", "Explain this state machine: the normal path and every way it can end."])
  } else if (family === "class") {
    ideas.push(["Apply a pattern", "Refactor this class diagram with a suitable design pattern (e.g. strategy or repository)."])
    ideas.push(["Add methods", "Add the key methods and their signatures to the classes."])
    ideas.push(["Generate the code", "Generate the code skeleton for these classes in TypeScript."])
  } else if (family === "er") {
    ideas.push(["Add indexes and audit", "Add audit columns (created_at, updated_at) and the important foreign key indexes."])
    ideas.push(["Generate the SQL", "Generate the PostgreSQL DDL for this schema."])
    ideas.push(["Normalise it", "Review this schema for normalisation issues and fix them in the diagram."])
  } else if (state.current?.facts.flow) {
    ideas.push(["Add error handling", "Add the missing error, timeout and exception paths to this flowchart."])
    ideas.push([state.current.facts.flow.lanes.length ? "Simplify it" : "Add swimlanes",
      state.current.facts.flow.lanes.length ? "Make a simpler version of this flowchart for a non-technical audience and redraw it."
        : "Split this flowchart into swimlanes by who performs each step."])
    ideas.push(["Explain it step by step", "Walk me through this flowchart step by step, including every decision and where each branch leads."])
  }
  if (state.current?.facts.groups) {
    ideas.push(["Explain it step by step", "Walk me through this diagram step by step using the F numbers."])
    ideas.push(["Add more detail", "Expand the most important group into its sub-steps."])
    ideas.push(["Simplify it", "Make a simpler version of this diagram for a non-technical audience and redraw it."])
  }
  const cloud = [...kinds].find((k) => k.startsWith("aws_")) ? "aws" : [...kinds].find((k) => k.startsWith("az_")) ? "azure" : "gcp"
  if (!state.current?.facts.groups && !state.current?.facts.flow && !state.current?.seq && !kinds.has("cloud_monitoring") && !kinds.has("aws_cloudwatch") && !kinds.has("az_monitor") && !kinds.has("prometheus")) {
    ideas.push(["Add observability", cloud === "aws" ? "Add CloudWatch and X-Ray with the right interfaces."
      : cloud === "azure" ? "Add Azure Monitor, Application Insights and Log Analytics."
      : "Add logging, monitoring and tracing with the right interfaces."])
  }
  if (!state.current?.facts.groups && !state.current?.facts.flow && !state.current?.seq) {
    ideas.push(["Harden security", "Add the missing security controls (WAF, identity, secrets, encryption) where they belong."])
    ideas.push(["Make it multi-region", "Make this architecture highly available across two regions."])
    ideas.push(["Explain the data flow", "Walk me through the end-to-end request and data flow using the IF numbers."])
  }
  ui.suggest.replaceChildren(...ideas.slice(0, 3).map(([label, prompt]) => {
    const b = document.createElement("button")
    b.textContent = label
    b.onclick = () => ask(prompt)
    return b
  }))
  ui.suggest.hidden = false
}

export type Analysis = {
  repository: string; commit?: string; files: number; read: number; platforms: string[]
  signals: { kind: string; source: string; at: string }[]; findings: string[]; model: string; ms: number
  coverage: { represented: number; total: number; missing: string[] }
}
let analysis: Analysis | null = null
let findingTimer = 0

export function showScanning(repository: string) {
  ui.empty.querySelector("div:last-child")!.textContent = `Reading ${repository} — workflows, IaC, SAP MTA, dependencies…`
  setStatus("building", "Analyzing repository")
  ui.title.textContent = repository
  ui.subtitle.textContent = "repository → architecture"
}

export function showAnalysis(a: Analysis) {
  analysis = a
  const chips = a.platforms.map((p) => (p in PLATFORMS ? PLATFORMS[p as keyof typeof PLATFORMS] : null))
    .filter(Boolean).map((p) => `<span class="chip" style="border-color:${p!.stroke};color:${p!.font}">${escHtml(p!.title)}</span>`).join("")
  ui.insights.innerHTML = `
    <div class="ins-head">
      <div><b>${escHtml(a.repository)}</b>${a.commit ? ` <span class="k">@ ${escHtml(a.commit)}</span>` : ""}</div>
      <button class="ins-toggle" title="Collapse">–</button>
    </div>
    <div class="ins-stats">${a.files} files · ${a.read} read · ${a.signals.length} signals · ${a.coverage.represented}/${a.coverage.total} drawn · ${(a.ms / 1000).toFixed(0)}s</div>
    <div class="chips">${chips}</div>
    <ol class="findings"></ol>
    <details><summary>Evidence (${a.signals.length})</summary><ul class="ev">${a.signals.map((s) => `<li><b>${escHtml(s.kind)}</b> <span class="k">${escHtml(s.at)}</span></li>`).join("")}</ul></details>`
  ui.insights.hidden = false
  ui.insights.querySelector<HTMLButtonElement>(".ins-toggle")!.onclick = () => ui.insights.classList.toggle("collapsed")
  const list = ui.insights.querySelector<HTMLOListElement>(".findings")!
  let i = 0
  clearInterval(findingTimer)
  findingTimer = window.setInterval(() => {
    if (i >= a.findings.length) return clearInterval(findingTimer)
    const li = document.createElement("li")
    li.textContent = a.findings[i++]
    list.appendChild(li)
    list.scrollTop = list.scrollHeight
  }, 650)
}
