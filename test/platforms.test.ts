import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { buildScene, normaliseFacts } from "../src/engine/index.js"
import { platformGuard } from "../src/repo/analyze.js"
import { scanRepository } from "../src/repo/scan.js"

function fixture(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "drawio-platform-"))
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), text)
  }
  return dir
}
const withScan = <T>(files: Record<string, string>, fn: (scan: ReturnType<typeof scanRepository>) => T) => {
  const dir = fixture(files)
  try { return fn(scanRepository(dir)) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test("scanner: AWS serverless app (SAM / CloudFormation, CDK, SDKs, workflow)", () => withScan({
  "template.yaml": "Resources:\n  Api:\n    Type: AWS::Serverless::Api\n  Fn:\n    Type: AWS::Serverless::Function\n  Table:\n    Type: AWS::DynamoDB::Table\n  Bucket:\n    Type: AWS::S3::Bucket\n  Pool:\n    Type: AWS::Cognito::UserPool\n",
  "cdk/lib/app-stack.ts": "import * as sqs from 'aws-cdk-lib/aws-sqs'\nnew sqs.Queue(this, 'q')\n",
  "package.json": '{ "dependencies": { "@aws-sdk/client-sns": "3" } }',
  ".github/workflows/deploy.yml": "steps:\n  - uses: aws-actions/configure-aws-credentials@v4\n  - run: sam deploy\n",
}, (scan) => {
  const k = new Set(scan.signals.map((s) => s.kind))
  for (const want of ["aws_api_gateway", "aws_lambda", "aws_dynamodb", "aws_s3", "aws_cognito", "aws_sqs", "aws_sns", "aws_iam", "aws_cloudformation"]) {
    assert.ok(k.has(want), `missing ${want}: ${[...k].join(", ")}`)
  }
  assert.ok(scan.platforms.includes("aws") && !scan.platforms.includes("gcp"))
}))

test("scanner: docker-compose stack becomes self-hosted building blocks", () => withScan({
  "docker-compose.yml": "services:\n  vote:\n    build: ./vote\n  result:\n    build: ./result\n  worker:\n    build: ./worker\n  redis:\n    image: redis:alpine\n  db:\n    image: postgres:15-alpine\n  proxy:\n    image: traefik:3\n",
}, (scan) => {
  const k = new Set(scan.signals.map((s) => s.kind))
  for (const want of ["container_service", "background_worker", "redis", "postgres", "traefik"]) assert.ok(k.has(want), `missing ${want}`)
  assert.deepEqual(scan.platforms, ["selfhosted"])
}))

test("scanner: Kubernetes manifests and Helm", () => withScan({
  "k8s/api.yaml": "apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n        - image: ghcr.io/acme/api:1\n        - image: bitnami/postgresql:16\n",
  "charts/app/Chart.yaml": "name: app\n",
}, (scan) => {
  const k = new Set(scan.signals.map((s) => s.kind))
  for (const want of ["k8s_workload", "postgres", "helm_chart"]) assert.ok(k.has(want), `missing ${want}`)
}))

test("platform guard: cloud kinds without evidence become open-source kinds, proven clouds stay", () => {
  const model = {
    title: "Voting app",
    nodes: [
      { id: "api", kind: "cloud_run", title: "Vote API" }, { id: "db", kind: "cloud_sql", title: "Postgres" },
      { id: "cache", kind: "memorystore", title: "Redis" }, { id: "fn", kind: "aws_lambda", title: "Lambda" },
    ],
    interfaces: [{ from: "api", to: "db" }, { from: "api", to: "cache" }],
  }
  withScan({ "docker-compose.yml": "services:\n  db:\n    image: postgres\n" }, (scan) => {
    const { diagram, changes } = platformGuard(model, scan)
    assert.deepEqual(normaliseFacts(diagram).nodes.map((n) => n.kind), ["container_service", "postgres", "redis", "background_worker"])
    assert.equal(changes.length, 4)
    const scene = buildScene(normaliseFacts(diagram))
    assert.deepEqual(scene.frames.map((f) => f.platform), ["selfhosted"])
    assert.equal(scene.frames[0].title, "Containers · Self-hosted")
  })
  withScan({ "main.tf": 'resource "google_cloud_run_v2_service" "api" {}\nresource "aws_lambda_function" "fn" {}\n' }, (scan) => {
    const { changes } = platformGuard(model, scan)
    assert.equal(changes.length, 0, changes.join("; "))
  })
})

test("platform guard: a pick on the wrong cloud moves to the same service on the proven cloud", () => {
  withScan({ "infra/main.bicep": "resource app 'Microsoft.Web/sites@2023-01-01' = {}\nresource kv 'Microsoft.KeyVault/vaults@2023-02-01' = {}\n" }, (scan) => {
    const { diagram } = platformGuard({
      title: "Todo", nodes: [{ id: "wif", kind: "workload_identity", title: "Federated login" }, { id: "s", kind: "cloud_storage", title: "Files" }], interfaces: [],
    }, scan)
    assert.deepEqual(normaliseFacts(diagram).nodes.map((n) => n.kind), ["az_managed_identity", "az_storage"])
  })
})

test("AWS and self-hosted frames sit next to GCP with their own titles and every interface routed", () => {
  const facts = normaliseFacts({
    title: "Multi-cloud",
    nodes: [
      { id: "u", kind: "user", title: "Users" }, { id: "cf", kind: "aws_cloudfront", title: "CloudFront" },
      { id: "fn", kind: "aws_lambda", title: "API" }, { id: "ddb", kind: "aws_dynamodb", title: "Orders" },
      { id: "k", kind: "k8s_workload", title: "Worker" }, { id: "pg", kind: "postgres", title: "Postgres" },
      { id: "bq", kind: "bigquery", title: "Analytics" },
    ],
    interfaces: [{ from: "u", to: "cf" }, { from: "cf", to: "fn" }, { from: "fn", to: "ddb" }, { from: "fn", to: "k" }, { from: "k", to: "pg" }, { from: "k", to: "bq" }],
  })
  const scene = buildScene(facts)
  assert.deepEqual(scene.frames.map((f) => [f.platform, f.title]), [["gcp", "Google Cloud"], ["aws", "Amazon Web Services"], ["selfhosted", "Kubernetes"]])
  assert.equal(scene.unrouted.length, 0)
})
