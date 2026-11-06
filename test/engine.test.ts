import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { renderDiagram, normaliseFacts, buildScene } from "../src/engine/index.js"

const sample = JSON.parse(readFileSync(new URL("./sample.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""))
const reference = JSON.parse(readFileSync(new URL("./golden-layout.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""))

test("card positions match the golden layout", () => {
  const scene = buildScene(normaliseFacts(sample))
  for (const c of scene.cards) assert.deepEqual(c.box, reference.cards[c.node.id], c.node.id)
  assert.deepEqual(scene.frames[0].box, reference.gcp)
})

test("edge routes match the golden layout", () => {
  const scene = buildScene(normaliseFacts(sample))
  assert.equal(scene.unrouted.length, 0)
  let same = 0
  for (const e of scene.edges) {
    const ref = reference.routes[e.id]
    assert.ok(ref, `golden layout routes ${e.id}`)
    if (JSON.stringify(e.points) === JSON.stringify(ref)) same++
    else console.log(`  ${e.id} differs\n    ts ${JSON.stringify(e.points)}\n    py ${JSON.stringify(ref)}`)
  }
  assert.equal(same, scene.edges.length)
})

test("draw.io XML is well formed and every edge endpoint exists", () => {
  const { xml, stats } = renderDiagram(sample)
  assert.match(xml, /^<mxfile host="drawman"/)
  const ids = new Set([...xml.matchAll(/<mxCell id="([^"]+)"/g)].map((m) => m[1]))
  for (const m of xml.matchAll(/source="([^"]+)" target="([^"]+)"/g)) {
    assert.ok(ids.has(m[1]) && ids.has(m[2]), `${m[1]} -> ${m[2]}`)
  }
  assert.equal(stats.cards, 14)
  assert.equal(stats.edges, 12)
})

test("unknown kinds fall back through hints, duplicates and dangling edges are dropped", () => {
  const facts = normaliseFacts({
    nodes: [
      { id: "Web LB", kind: "global load balancer", title: "Global LB" },
      { id: "db", kind: "postgres", title: "Orders DB" },
      { id: "db", kind: "cloud_sql", title: "dup" },
      { id: "cache", kind: "redis", title: "Session cache" },
    ],
    interfaces: [{ from: "web_lb", to: "db" }, { from: "web_lb", to: "ghost" }],
  })
  assert.deepEqual(facts.nodes.map((n) => n.kind), ["reverse_proxy", "postgres", "redis"])
  assert.equal(facts.interfaces.length, 1)
  assert.equal(facts.interfaces[0].id, "IF-01")
  assert.equal(facts.dropped.length, 2)
})

test("streaming: a half-written trailing node is held back until its kind is complete", () => {
  const partial = { nodes: [{ id: "run", kind: "cloud_run", title: "API" }, { id: "bq", kind: "bigq" }] }
  assert.equal(normaliseFacts(partial, true).nodes.length, 1)
  assert.equal(normaliseFacts({ ...partial, nodes: [...partial.nodes.slice(0, 1), { id: "bq", kind: "bigquery" }] }, true).nodes.length, 2)
})

test("a diagram without CI/CD starts at the left margin (no empty columns)", () => {
  const scene = buildScene(normaliseFacts({ nodes: [{ id: "a", kind: "cloud_run" }, { id: "b", kind: "bigquery" }] }))
  assert.equal(scene.frames[0].box[0], 40)
})

test("hybrid SAP BTP + GCP + Azure + on-prem: one frame per platform, no overlaps, every interface routed", () => {
  const facts = normaliseFacts({
    title: "Hybrid landscape",
    nodes: [
      { id: "users", kind: "user", title: "Lawyers" },
      { id: "repo", kind: "github_repo", title: "Repo" },
      { id: "cicd", kind: "sap_cicd", title: "SAP CI/CD" },
      { id: "wz", kind: "sap_work_zone", title: "Work Zone" },
      { id: "ar", kind: "sap_approuter", title: "Approuter" },
      { id: "cap", kind: "sap_cap", title: "CAP service" },
      { id: "hana", kind: "sap_hana_cloud", title: "HANA Cloud" },
      { id: "xsuaa", kind: "sap_xsuaa", title: "XSUAA" },
      { id: "dest", kind: "sap_destination", title: "Destination" },
      { id: "conn", kind: "sap_connectivity", title: "Connectivity" },
      { id: "cpi", kind: "sap_cloud_integration", title: "Cloud Integration" },
      { id: "run", kind: "cloud_run", title: "Generator API" },
      { id: "llm", kind: "llm_gateway", title: "LLM gateway" },
      { id: "gcs", kind: "cloud_storage", title: "Templates" },
      { id: "entra", kind: "az_entra_id", title: "Entra ID" },
      { id: "graph", kind: "az_app_service", title: "Graph mail" },
      { id: "cc", kind: "sap_cloud_connector", title: "Cloud Connector" },
      { id: "s4", kind: "sap_s4hana", title: "S/4HANA" },
    ],
    interfaces: [
      { from: "users", to: "wz" }, { from: "wz", to: "ar" }, { from: "ar", to: "cap" }, { from: "cap", to: "hana" },
      { from: "cap", to: "xsuaa" }, { from: "cap", to: "dest" }, { from: "dest", to: "conn" }, { from: "conn", to: "cc" },
      { from: "cc", to: "s4" }, { from: "cap", to: "run" }, { from: "run", to: "llm" }, { from: "run", to: "gcs" },
      { from: "cap", to: "graph" }, { from: "graph", to: "entra" }, { from: "cpi", to: "s4" }, { from: "repo", to: "cicd" },
      { from: "cicd", to: "cap" },
    ],
  })
  const scene = buildScene(facts)
  assert.deepEqual(scene.frames.map((f) => f.platform), ["gcp", "azure", "sap_btp", "onprem"])
  assert.equal(scene.unrouted.length, 0)
  assert.equal(scene.edges.length, 17)
  const { xml } = renderDiagram({ title: "Hybrid", nodes: facts.nodes, interfaces: facts.interfaces })
  assert.match(xml, /frame_sap_btp/)
  assert.match(xml, /SAP Business Technology Platform/)
})

test("kind hints understand Azure and SAP wording", () => {
  const f = normaliseFacts({
    nodes: [
      { id: "a", kind: "Azure Kubernetes Service", title: "Cluster" },
      { id: "b", kind: "S/4HANA", title: "ERP" },
      { id: "c", kind: "xsuaa", title: "Auth" },
      { id: "d", kind: "Key Vault", title: "Secrets" },
      { id: "e", kind: "SAP Cloud Connector", title: "CC" },
    ],
    interfaces: [],
  })
  assert.deepEqual(f.nodes.map((n) => n.kind), ["az_aks", "sap_s4hana", "sap_xsuaa", "az_key_vault", "sap_cloud_connector"])
})
