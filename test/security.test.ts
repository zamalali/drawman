import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { request } from "node:http"
import path from "node:path"
import { addKindHints, normaliseKind } from "../src/engine/index.js"
import { config } from "../src/config.js"
import { redact, scanRepository } from "../src/repo/scan.js"
import { gitEnv, localFolder, resolveRepository, toUrl } from "../src/repo/source.js"
import { isBroad } from "../src/config.js"
import { httpApp } from "../src/mcp/http.js"

test("credentials are masked before anything leaves the machine", () => {
  const masked = redact([
    "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx",
    'password: "hunter2hunter2"',
    "token = ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----",
    "api_key: ${API_KEY}",
  ].join("\n"))
  for (const leaked of ["sk-proj-abc", "hunter2", "ghp_abc", "MIIEvQ"]) assert.ok(!masked.includes(leaked), `${leaked} leaked: ${masked}`)
  assert.ok(masked.includes("${API_KEY}"), "placeholders stay readable")
})

test("secret files are never read by the scanner", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "drawio-secrets-"))
  try {
    writeFileSync(path.join(dir, ".env"), "DATABASE_URL=postgres://u:supersecretvalue@db.internal/app\n")
    writeFileSync(path.join(dir, "key.pem"), "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n")
    writeFileSync(path.join(dir, ".env.example"), "DATABASE_URL=postgres://user:pass@host/db\n")
    writeFileSync(path.join(dir, "README.md"), "# demo\n")
    const scan = scanRepository(dir)
    assert.ok(!scan.context.includes("supersecretvalue"))
    assert.ok(!scan.context.includes("BEGIN PRIVATE KEY"))
    assert.ok(scan.read.includes(".env.example") && !scan.read.includes(".env") && !scan.read.includes("key.pem"))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("only folders inside the workspace roots can be analysed", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "drawio-root-"))
  const outside = mkdtempSync(path.join(tmpdir(), "drawio-outside-"))
  const saved = config.workspaceRoots
  try {
    mkdirSync(path.join(root, "svc"))
    config.workspaceRoots = [root]
    assert.ok(localFolder("svc")?.endsWith("svc"))
    assert.ok(localFolder(".")?.length)
    assert.throws(() => localFolder(outside), /outside the allowed workspace roots/)
    assert.throws(() => localFolder("../" + path.basename(outside)), /outside the allowed workspace roots/)
    await assert.rejects(resolveRepository("svc", "--upload-pack=evil"), /invalid ref/)
  } finally {
    config.workspaceRoots = saved
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test("only https and ssh git remotes are accepted", () => {
  assert.equal(toUrl("octo/repo"), `https://${config.githubHost}/octo/repo.git`)
  assert.equal(toUrl("https://github.com/octo/repo/tree/main/src"), "https://github.com/octo/repo.git")
  assert.equal(toUrl("git@github.com:octo/repo"), "git@github.com:octo/repo.git")
  for (const bad of ["ext::sh -c touch% /tmp/pwned", "file:///etc", "http://github.com/a/b", "https://user:pw@github.com/a/b", "../a", "-u/x"]) {
    assert.equal(toUrl(bad), null, bad)
  }
})

test("organisation profiles teach the vocabulary internal names", () => {
  assert.equal(normaliseKind("acme brain", "ACME Brain"), "external_source")
  addKindHints([[["acme brain"], "llm_gateway"], [["ignored"], "not_a_kind"]])
  assert.equal(normaliseKind("acme brain", "ACME Brain"), "llm_gateway")
})

test("connection strings, URL credentials, kubeconfig keys and auth headers are masked", () => {
  const masked = redact([
    "DATABASE_URL: postgres://app:Sup3rS3cret@db.internal:5432/app",
    "AzureWebJobsStorage=DefaultEndpointsProtocol=https;AccountName=x;AccountKey=abcDEF123456+/=;EndpointSuffix=core.windows.net",
    "DB_PASS=hunter2hunter2",
    "    client-key-data: LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQ==",
    "headers: { auth: 'Basic dXNlcjpwYXNzd29yZDEyMw==' }",
  ].join("\n"))
  for (const leaked of ["Sup3rS3cret", "abcDEF123456", "hunter2", "LS0tLS1CRUdJTi", "dXNlcjpwYXNzd29yZDEyMw"]) assert.ok(!masked.includes(leaked), `${leaked} leaked: ${masked}`)
  assert.ok(masked.includes("postgres://app:***@db.internal"), "URL stays readable")
})

test("git never inherits GIT_* or arbitrary variables from the environment", () => {
  const saved = { ...process.env }
  try {
    Object.assign(process.env, { GIT_SSH_COMMAND: "calc.exe", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", SOME_SECRET: "x", NODE_TLS_REJECT_UNAUTHORIZED: "0" })
    const env = gitEnv()
    for (const k of ["GIT_SSH_COMMAND", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "SOME_SECRET", "NODE_TLS_REJECT_UNAUTHORIZED"]) assert.equal(env[k], undefined, k)
    assert.equal(env.GIT_ALLOW_PROTOCOL, "https:ssh")
    assert.ok(env.PATH || env.Path, "PATH is kept")
  } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved) }
})

test("the scanner does not follow symlinks out of the workspace", (t) => {
  const outside = mkdtempSync(path.join(tmpdir(), "drawio-outside-secret-"))
  const root = mkdtempSync(path.join(tmpdir(), "drawio-symlink-"))
  try {
    writeFileSync(path.join(outside, "config"), "apiVersion: v1\nkind: Config\nusers: [{ name: TOPSECRETUSER }]\n")
    writeFileSync(path.join(root, "README.md"), "# demo\n")
    try { symlinkSync(path.join(outside, "config"), path.join(root, "deploy.yaml"), "file") } catch { t.skip("symlinks need privileges on this OS"); return }
    const scan = scanRepository(root)
    assert.ok(!scan.files.includes("deploy.yaml"))
    assert.ok(!scan.context.includes("TOPSECRETUSER"))
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }) }
})

test("paths are checked before the filesystem is touched; network paths are refused", () => {
  const root = mkdtempSync(path.join(tmpdir(), "drawio-root2-"))
  const saved = config.workspaceRoots
  try {
    config.workspaceRoots = [root]
    assert.throws(() => localFolder("\\\\attacker.example\\share"), /Network paths/)
    assert.throws(() => localFolder("//attacker.example/share"), /Network paths/)
    assert.throws(() => localFolder(path.join(tmpdir(), "definitely-not-here-" + Date.now())), /outside the allowed workspace roots/)
    config.workspaceRoots = []
    assert.throws(() => localFolder("."), /No workspace folder is known/)
  } finally { config.workspaceRoots = saved; rmSync(root, { recursive: true, force: true }) }
})

test("a filesystem root or the home directory is never an implicit workspace", () => {
  assert.ok(isBroad(path.parse(process.cwd()).root))
  assert.ok(isBroad(homedir()))
  assert.ok(!isBroad(tmpdir()))
})

test("local HTTP servers reject foreign Host and Origin headers (DNS rebinding)", async () => {
  const server = httpApp().listen(0, "127.0.0.1")
  await new Promise((r) => server.once("listening", r))
  const port = (server.address() as import("node:net").AddressInfo).port
  const call = (headers: Record<string, string>) => new Promise<number>((resolve, reject) => {
    // raw request: fetch() refuses to set a custom Host header
    const req = request({ host: "127.0.0.1", port, path: "/healthz", headers }, (res) => { res.resume(); resolve(res.statusCode ?? 0) })
    req.on("error", reject)
    req.end()
  })
  try {
    assert.equal(await call({}), 200)
    assert.equal(await call({ Origin: `http://localhost:${port}` }), 200)
    assert.equal(await call({ Origin: "http://evil.example" }), 403)
    assert.equal(await call({ Host: "evil.example" }), 403)
  } finally { server.close() }
})
