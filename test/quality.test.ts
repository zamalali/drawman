import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ICONS, KIND, NODE_KINDS, brandKind, buildScene, checkLayout, normaliseFacts, normaliseKind, renderDiagram } from "../src/engine/index.js"
import { scanRepository } from "../src/repo/scan.js"
import { enforceSupplyChain } from "../src/repo/supply-chain.js"

test("every kind has a real embedded icon", () => {
  for (const [kind, [, icon]] of Object.entries(KIND)) {
    const ic = ICONS[icon]
    assert.ok(ic, `${kind} -> ${icon} missing`)
    assert.match(ic.image, /^data:image\/(svg\+xml|png),[A-Za-z0-9+/=]{100,}$/, `${kind} icon is not a data URI`)
  }
  assert.ok(NODE_KINDS.length >= 140)
})

test("Docker and JFrog are never drawn with a generic CI icon", () => {
  for (const [k, t] of [["docker", "Docker build"], ["docker_image", "Docker Image Build"], ["container_build", "Docker build & push"], ["kaniko", "Image build"]]) {
    assert.equal(normaliseKind(k, t), "docker_build", `${k} / ${t}`)
  }
  for (const [k, t] of [["jfrog", "JFrog"], ["artifactory", "Company Artifactory"], ["image_registry", "JFrog Docker registry"]]) {
    assert.equal(normaliseKind(k, t), "jfrog_artifactory", `${k} / ${t}`)
  }
  assert.equal(brandKind("github_actions", "Docker Image Build"), "docker_build")
  assert.equal(brandKind("external_source", "JFrog Artifactory"), "jfrog_artifactory")
  assert.equal(brandKind("cloud_run", "Dockerized API"), "cloud_run", "runtimes keep their kind")
  assert.equal(brandKind("artifact_registry", "Artifact Registry (docker)"), "artifact_registry")
  const f = normaliseFacts({ nodes: [{ id: "b", kind: "github_actions", title: "Docker build" }, { id: "j", kind: "saas", title: "JFrog Artifactory" }], interfaces: [] })
  assert.deepEqual(f.nodes.map((n) => n.kind), ["docker_build", "jfrog_artifactory"])
})

const sig = (kind: string, at = "w.yaml:1") => ({ kind, source: "workflow", evidence: [{ at, line: kind }] })

test("release path: missing Docker/JFrog stages are added and the chain is wired in release order", () => {
  const model = {
    title: "Svc",
    nodes: [
      { id: "repo", kind: "github_repo", title: "Repo" },
      { id: "gha", kind: "github_actions", title: "GitHub Actions" },
      { id: "gar", kind: "artifact_registry", title: "Artifact Registry" },
      { id: "api", kind: "cloud_run", title: "API" },
      { id: "db", kind: "cloud_sql", title: "DB" },
    ],
    interfaces: [
      { from: "repo", to: "gha" }, { from: "gha", to: "api", label: "deploy" }, { from: "gha", to: "gar" }, { from: "api", to: "db" },
    ],
  }
  const signals = ["github_repo", "github_actions", "docker_build", "jfrog_artifactory", "artifact_registry", "cloud_run"].map((k) => sig(k))
  const { diagram, changes } = enforceSupplyChain(model, signals)
  const facts = normaliseFacts(diagram)
  const kinds = facts.nodes.map((n) => n.kind)
  assert.ok(kinds.includes("docker_build") && kinds.includes("jfrog_artifactory"))
  const pairs = facts.interfaces.map((i) => `${facts.nodes.find((n) => n.id === i.from)!.kind}>${facts.nodes.find((n) => n.id === i.to)!.kind}`)
  for (const p of ["github_repo>github_actions", "github_actions>docker_build", "docker_build>jfrog_artifactory", "jfrog_artifactory>artifact_registry", "artifact_registry>cloud_run", "cloud_run>cloud_sql"]) {
    assert.ok(pairs.includes(p), `missing ${p} in ${pairs.join(", ")}`)
  }
  assert.ok(!pairs.includes("github_actions>cloud_run"), "CI -> runtime shortcut replaced by the release chain")
  assert.ok(!pairs.includes("github_actions>artifact_registry"))
  assert.equal(new Set(pairs).size, pairs.length, "no duplicate interfaces")
  assert.ok(changes.some((c) => c.includes("Docker")) && changes.some((c) => c.includes("JFrog")))
  assert.equal(buildScene(facts).unrouted.length, 0)
})

test("release path: nothing is invented without evidence", () => {
  const model = { title: "S", nodes: [{ id: "a", kind: "cloud_run", title: "API" }, { id: "b", kind: "bigquery", title: "BQ" }], interfaces: [{ from: "a", to: "b" }] }
  const { diagram, changes } = enforceSupplyChain(model, [sig("cloud_run"), sig("bigquery")])
  assert.equal(changes.length, 0)
  assert.equal((diagram.nodes as unknown[]).length, 2)
})

test("release path: without container evidence the chain is published, never 'image'", () => {
  const model = {
    title: "Package", nodes: [
      { id: "repo", kind: "github_repo", title: "Repo" }, { id: "ci", kind: "github_actions", title: "CI" },
      { id: "npm", kind: "jfrog_artifactory", title: "Package registry" }, { id: "app", kind: "container_service", title: "App" },
    ], interfaces: [{ from: "repo", to: "ci" }, { from: "ci", to: "npm" }, { from: "npm", to: "app" }],
  }
  const { diagram } = enforceSupplyChain(model, [sig("github_repo"), sig("github_actions")])
  const text = JSON.stringify(diagram.interfaces)
  assert.ok(!/image/i.test(text), `image wording without container evidence: ${text}`)
  assert.match(text, /"label":"publish"/)
})

function fixture(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "drawio-fixture-"))
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), text)
  }
  return dir
}
const kindsOf = (dir: string) => new Set(scanRepository(dir).signals.map((s) => s.kind))

test("scanner: GCP service (Artifactory first, then Artifact Registry, Cloud Run, WIF)", () => {
  const dir = fixture({
    ".github/workflows/release.yaml": [
      "on: { release: { types: [published] } }",
      "jobs:", "  release:", "    steps:",
      "      - uses: acme/platform-actions/docker-artifactory@v1",
      "      - uses: acme/platform-actions/docker-gcp-push@v1",
      "        with: { gcp_artifact_registry: team-docker, wif_provider: x }",
      "      - run: gcloud run deploy svc --image europe-west3-docker.pkg.dev/p/team-docker/svc",
    ].join("\n"),
    Dockerfile: "FROM python:3.12-slim\n",
    "requirements.txt": "google-cloud-bigquery==3\ngoogle-cloud-storage\n",
    "app.py": "LLM = 'https://api.openai.com/v1'\n",
  })
  try {
    const k = kindsOf(dir)
    for (const want of ["github_repo", "github_actions", "docker_build", "jfrog_artifactory", "artifact_registry", "workload_identity", "cloud_run", "bigquery", "cloud_storage", "llm_gateway"]) {
      assert.ok(k.has(want), `missing ${want}: ${[...k].join(", ")}`)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("scanner: Azure service (Bicep, Terraform azurerm, Azure Pipelines, SDKs)", () => {
  const dir = fixture({
    "azure-pipelines.yml": "trigger: [main]\n",
    "infra/main.bicep": "resource app 'Microsoft.Web/sites@2023-01-01' = {}\nresource kv 'Microsoft.KeyVault/vaults@2023-02-01' = {}\nresource sb 'Microsoft.ServiceBus/namespaces@2022-10-01' = {}\n",
    "infra/aks.tf": 'resource "azurerm_kubernetes_cluster" "aks" {}\nresource "azurerm_cosmosdb_account" "db" {}\nresource "azurerm_container_registry" "acr" {}\n',
    "package.json": '{ "dependencies": { "@azure/identity": "4", "@azure/openai": "1" } }',
  })
  try {
    const k = kindsOf(dir)
    for (const want of ["az_devops", "az_app_service", "az_key_vault", "az_service_bus", "az_aks", "az_cosmos_db", "az_acr", "az_entra_id", "az_openai"]) {
      assert.ok(k.has(want), `missing ${want}: ${[...k].join(", ")}`)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("scanner: SAP BTP MTA app with on-premises destination", () => {
  const dir = fixture({
    "mta.yaml": [
      "_schema-version: '3.1'", "ID: demo", "version: 1.0.0", "modules:",
      "  - name: demo-srv", "    type: nodejs", "    path: gen/srv",
      "  - name: demo-router", "    type: approuter.nodejs",
      "  - name: demo-db", "    type: hdb",
      "resources:",
      "  - name: demo-uaa", "    type: org.cloudfoundry.managed-service", "    parameters: { service: xsuaa }",
      "  - name: demo-dest", "    type: org.cloudfoundry.managed-service", "    parameters: { service: destination }",
      "  - name: demo-conn", "    type: org.cloudfoundry.managed-service", "    parameters: { service: connectivity }",
      "  - name: demo-log", "    type: org.cloudfoundry.managed-service", "    parameters: { service: application-logs }",
      "  # destination S4 ProxyType: OnPremise",
    ].join("\n"),
    "xs-security.json": "{}",
    "app/xs-app.json": '{ "routes": [ { "source": "^/sap/(.*)$", "destination": "S4" } ] }',
    "srv/service.cds": "service Demo {}",
    "package.json": '{ "dependencies": { "@sap/cds": "8", "@sap/xssec": "4" } }',
  })
  try {
    const k = kindsOf(dir)
    for (const want of ["sap_cap", "sap_approuter", "sap_hana_cloud", "sap_xsuaa", "sap_destination", "sap_connectivity", "sap_app_logging", "sap_cloud_connector"]) {
      assert.ok(k.has(want), `missing ${want}: ${[...k].join(", ")}`)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("stress: 25 random multi-platform diagrams lay out without overlaps and route every interface", () => {
  let seed = 42
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  for (let round = 0; round < 25; round++) {
    const n = 8 + Math.floor(rnd() * 18)
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, kind: NODE_KINDS[Math.floor(rnd() * NODE_KINDS.length)], title: `Node ${i}` }))
    const interfaces = Array.from({ length: n + Math.floor(rnd() * 6) }, () => {
      const a = Math.floor(rnd() * n), b = Math.floor(rnd() * n)
      return { from: `n${a}`, to: `n${(a === b ? b + 1 : b) % n}` }
    })
    const facts = normaliseFacts({ title: `r${round}`, nodes, interfaces })
    const scene = buildScene(facts)
    checkLayout(scene)
    assert.equal(scene.unrouted.length, 0, `round ${round}: unrouted ${scene.unrouted.join(",")}`)
    const { xml } = renderDiagram({ title: `r${round}`, nodes, interfaces })
    assert.match(xml, /<\/mxGraphModel><\/diagram><\/mxfile>$/)
  }
})
