import { createHash } from "node:crypto"
import { existsSync, writeFileSync } from "node:fs"
import tls from "node:tls"
import { inflateRawSync } from "node:zlib"
import { GENERAL_ICONS, KIND } from "../src/engine/kinds.js"

try { tls.setDefaultCACertificates([...tls.getCACertificates("default"), ...tls.getCACertificates("system")]) } catch { /* NODE_EXTRA_CA_CERTS */ }

const OUT = new URL("../src/engine/icons.json", import.meta.url)
const SOURCES = new URL("../src/engine/icons.sources.json", import.meta.url)
if (process.argv.includes("--if-missing") && existsSync(OUT)) process.exit(0)

const GOOGLE_ZIP = "https://cloud.google.com/static/icons/files/google-cloud-icons.zip"
const DRAWIO = "https://raw.githubusercontent.com/jgraph/drawio/dev/src/main/webapp/img/lib/"
const SIMPLE = "https://cdn.jsdelivr.net/npm/simple-icons@15/icons/"

const GCP: Record<string, string> = {
  alloydb: "cloud_sql", api: "api", api_gateway: "cloud_api_gateway", apigee: "apigee_api_platform", app_engine: "app_engine",
  artifact_registry: "artifact_registry", bigquery: "bigquery", bigtable: "bigtable", binary_authorization: "binary_authorization",
  certificate_manager: "certificate_manager", cloud_armor: "cloud_armor", cloud_build: "cloud_build", cloud_cdn: "cloud_cdn",
  cloud_deploy: "cloud_deploy", cloud_dns: "cloud_dns", cloud_functions: "cloud_functions", cloud_logging: "cloud_logging",
  cloud_monitoring: "cloud_monitoring", cloud_nat: "cloud_nat", cloud_run: "cloud_run", cloud_scheduler: "cloud_scheduler",
  cloud_sql: "cloud_sql", cloud_storage: "cloud_storage", cloud_tasks: "cloud_tasks", cloud_trace: "trace", cloud_vpn: "cloud_vpn",
  composer: "cloud_composer", compute_engine: "compute_engine", data_loss_prevention: "data_loss_prevention_api",
  dataflow: "dataflow", dataplex: "dataplex", dataproc: "dataproc", dialogflow: "dialogflow", document_ai: "document_ai",
  error_reporting: "error_reporting", eventarc: "eventarc", filestore: "filestore", firestore: "firestore",
  gke: "google_kubernetes_engine", iam: "identity_and_access_management", iap: "identity-aware_proxy",
  interconnect: "cloud_interconnect", kms: "key_management_service", load_balancing: "cloud_load_balancing", looker: "looker",
  memorystore: "memorystore", private_service_connect: "private_service_connect", pubsub: "pubsub",
  secret_manager: "secret_manager", security_command_center: "security_command_center", spanner: "cloud_spanner",
  vertex_ai: "vertexai", vpc: "virtual_private_cloud", vpc_connector: "virtual_private_cloud", workflows: "workflows",
}
const AZURE: Record<string, string> = {
  az_app_service: "app_services/App_Services.svg", az_functions: "compute/Function_Apps.svg", az_aks: "containers/Kubernetes_Services.svg",
  az_container_instances: "containers/Container_Instances.svg", az_vm: "compute/Virtual_Machine.svg", az_static_web_apps: "preview/Static_Apps.svg",
  az_batch: "compute/Batch_Accounts.svg", az_sql: "databases/SQL_Database.svg", az_cosmos_db: "databases/Azure_Cosmos_DB.svg",
  az_storage: "storage/Storage_Accounts.svg", az_redis: "databases/Cache_Redis.svg", az_synapse: "analytics/Azure_Synapse_Analytics.svg",
  az_databricks: "analytics/Azure_Databricks.svg", az_service_bus: "integration/Service_Bus.svg", az_event_hubs: "analytics/Event_Hubs.svg",
  az_event_grid: "integration/Event_Grid_Topics.svg", az_logic_apps: "integration/Logic_Apps.svg", az_apim: "integration/API_Management_Services.svg",
  az_openai: "ai_machine_learning/Azure_OpenAI.svg", az_ai_search: "app_services/Search_Services.svg", az_ml: "ai_machine_learning/Machine_Learning.svg",
  az_key_vault: "security/Key_Vaults.svg", az_entra_id: "identity/Azure_Active_Directory.svg", az_managed_identity: "identity/Managed_Identities.svg",
  az_monitor: "management_governance/Monitor.svg", az_app_insights: "devops/Application_Insights.svg", az_log_analytics: "analytics/Log_Analytics_Workspaces.svg",
  az_sentinel: "security/Azure_Sentinel.svg", az_defender: "security/Azure_Defender.svg", az_front_door: "networking/Front_Doors.svg",
  az_app_gateway: "networking/Application_Gateways.svg", az_load_balancer: "networking/Load_Balancers.svg", az_dns: "networking/DNS_Zones.svg",
  az_vnet: "networking/Virtual_Networks.svg", az_firewall: "networking/Firewalls.svg", az_private_link: "networking/Private_Link.svg",
  az_expressroute: "networking/ExpressRoute_Circuits.svg", az_nat: "networking/NAT.svg", az_devops: "devops/Azure_DevOps.svg",
  az_acr: "containers/Container_Registries.svg", az_power_bi: "analytics/Power_BI_Embedded.svg",
}
const SAP: Record<string, string> = {
  sap_cf: "SAP_BTP,_Cloud_Foundry_runtime.svg", sap_kyma: "SAP_BTP,_Kyma_runtime.svg", sap_abap_env: "SAP_BTP,_ABAP_environment.svg",
  sap_cap: "SAP_Cloud_Application_Programming_Model.svg", sap_html5_repo: "HTML5_App_Repository.svg", sap_app_frontend: "Application_Frontend_Service.svg",
  sap_work_zone: "SAP_Build_Work_Zone_-_Standard_Edition.svg", sap_hana_cloud: "SAP_HANA_Cloud.svg", sap_datasphere: "SAP_Datasphere.svg",
  sap_object_store: "Object_Store_on_SAP_BTP.svg", sap_analytics_cloud: "SAP_Analytics_Cloud.svg", sap_integration_suite: "SAP_Integration_Suite.svg",
  sap_cloud_integration: "SAP_Integration_Suite_-_Cloud_Integration.svg", sap_api_management: "SAP_Integration_Suite_-_API_Managment.svg",
  sap_event_mesh: "SAP_Integration_Suite_-_Event_Mesh.svg", sap_ai_core: "SAP_AI_Core.svg", sap_document_ai: "Document_Information_Extraction.svg",
  sap_xsuaa: "SAP_Authorization_and_Trust_Management_service.svg", sap_ias: "SAP_Cloud_Identity_Service.svg", sap_audit_log: "SAP_Audit_Log_Service.svg",
  sap_cloud_logging: "SAP_Cloud_Logging.svg", sap_app_logging: "SAP_Application_Logging_service_for_SAP_BTP.svg",
  sap_alert_notification: "SAP_Alert_Notification_service_for_SAP_BTP.svg", sap_credential_store: "SAP_Credential_Store.svg",
  sap_destination: "SAP_Destination_service.svg", sap_connectivity: "SAP_Connectivity_Service.svg", sap_private_link: "SAP_Private_Link_service.svg",
  sap_job_scheduler: "SAP_Job_Scheduling_service.svg", sap_cicd: "SAP_Continuous_Integration_and_Delivery.svg",
  sap_transport: "SAP_Cloud_Transport_Management.svg", sap_cloud_connector: "Cloud_Connector.svg", sap_on_premise: "On-Premise.svg",
  sap_logo: "SAP_Logo.svg", sap_mdg: "SAP_Master_Data_Governance.svg", sap_build_apps: "SAP_Build_Apps.svg", sap_bpa: "SAP_Build_Process_Automation.svg",
}
const BRANDS: Record<string, [slug: string, colour: string]> = {
  github: ["github", "#181717"], github_actions: ["githubactions", "#2088FF"], docker: ["docker", "#2496ED"], jfrog: ["jfrog", "#40BE46"],
  gitlab: ["gitlab", "#FC6D26"], helm: ["helm", "#0F1689"], kubernetes: ["kubernetes", "#326CE5"], postgresql: ["postgresql", "#4169E1"],
  mysql: ["mysql", "#4479A1"], mongodb: ["mongodb", "#47A248"], redis: ["redis", "#FF4438"], elasticsearch: ["elasticsearch", "#005571"],
  minio: ["minio", "#C72E49"], supabase: ["supabase", "#3FCF8E"], kafka: ["apachekafka", "#231F20"], rabbitmq: ["rabbitmq", "#FF6600"],
  nginx: ["nginx", "#009639"], traefik: ["traefikproxy", "#24A1C1"], cloudflare: ["cloudflare", "#F38020"], vercel: ["vercel", "#000000"],
  netlify: ["netlify", "#00C7B7"], keycloak: ["keycloak", "#4D4D4D"], vault: ["vault", "#000000"], prometheus: ["prometheus", "#E6522C"],
  grafana: ["grafana", "#F46800"], terraform: ["terraform", "#844FBA"],
}
// AWS publishes a new package URL with every release.
const AWS_PAGE = "https://aws.amazon.com/architecture/icons/"
const AWS_FALLBACK_ZIP = "https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/Icon-package_07312026.5846e92413caa21490223536cc97f1269e44fa92.zip"
const AWS: Record<string, string> = {
  aws_cloudfront: "Amazon-CloudFront", aws_route53: "Amazon-Route-53", aws_elb: "Elastic-Load-Balancing", aws_waf: "AWS-WAF",
  aws_api_gateway: "Amazon-API-Gateway", aws_appsync: "AWS-AppSync", aws_lambda: "AWS-Lambda", aws_ecs: "Amazon-Elastic-Container-Service",
  aws_fargate: "AWS-Fargate", aws_eks: "Amazon-Elastic-Kubernetes-Service", aws_ec2: "Amazon-EC2", aws_app_runner: "AWS-App-Runner",
  aws_beanstalk: "AWS-Elastic-Beanstalk", aws_amplify: "AWS-Amplify", aws_batch: "AWS-Batch", aws_step_functions: "AWS-Step-Functions",
  aws_s3: "Amazon-Simple-Storage-Service", aws_dynamodb: "Amazon-DynamoDB", aws_rds: "Amazon-RDS", aws_aurora: "Amazon-Aurora",
  aws_elasticache: "Amazon-ElastiCache", aws_documentdb: "Amazon-DocumentDB", aws_neptune: "Amazon-Neptune", aws_efs: "Amazon-EFS",
  aws_redshift: "Amazon-Redshift", aws_athena: "Amazon-Athena", aws_glue: "AWS-Glue", aws_opensearch: "Amazon-OpenSearch-Service",
  aws_sqs: "Amazon-Simple-Queue-Service", aws_sns: "Amazon-Simple-Notification-Service", aws_eventbridge: "Amazon-EventBridge",
  aws_kinesis: "Amazon-Kinesis-Data-Streams|Amazon-Kinesis", aws_msk: "Amazon-Managed-Streaming-for-Apache-Kafka",
  aws_bedrock: "Amazon-Bedrock", aws_sagemaker: "Amazon-SageMaker-AI|Amazon-SageMaker", aws_textract: "Amazon-Textract",
  aws_comprehend: "Amazon-Comprehend", aws_cognito: "Amazon-Cognito", aws_iam: "AWS-Identity-and-Access-Management",
  aws_secrets_manager: "AWS-Secrets-Manager", aws_kms: "AWS-Key-Management-Service", aws_cloudwatch: "Amazon-CloudWatch",
  aws_xray: "AWS-X-Ray", aws_vpc: "Amazon-Virtual-Private-Cloud", aws_ecr: "Amazon-Elastic-Container-Registry",
  aws_codepipeline: "AWS-CodePipeline", aws_codebuild: "AWS-CodeBuild", aws_cloudformation: "AWS-CloudFormation",
}
const glyph = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#5f6368" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const OWN: Record<string, string> = {
  user: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="7.5" r="4.5" fill="#5f6368"/><path d="M3 21c0-4.4 4-7.5 9-7.5s9 3.1 9 7.5z" fill="#5f6368"/></svg>`,
  external_source: glyph(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01M8 14h8M8 17h5"/>`),
  container: glyph(`<path d="M12 2.8 20 7v10l-8 4.2L4 17V7z"/><path d="M4 7l8 4.2L20 7M12 11.2v10"/>`),
  web_app: glyph(`<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M2.5 8.5h19M6 6.3h.01M8.5 6.3h.01M7 13h6M7 16h10"/>`),
  worker: glyph(`<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>`),
  proxy: glyph(`<circle cx="12" cy="12" r="3"/><path d="M2.5 12h6.5M15 12h6.5M17 7.5l4.5 4.5-4.5 4.5M12 3v6M12 15v6"/>`),
  database: glyph(`<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>`),
  object_storage: glyph(`<path d="M3.5 6h17l-2 14.5h-13z"/><ellipse cx="12" cy="6" rx="8.5" ry="2.5"/><path d="M8 12h8"/>`),
  queue: glyph(`<rect x="3" y="5" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="15" width="18" height="4" rx="1"/>`),
  g_process: glyph(`<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M9 12h6M13 9.5l2.5 2.5-2.5 2.5"/>`),
  g_model: glyph(`<circle cx="5" cy="7" r="2"/><circle cx="5" cy="17" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 7.5l3 3.5M7 7l3-1.5M7 16.5l3-3.5M7 17l3 1.5M14 12h3M14 5.8l3.4 4.8M14 18.2l3.4-4.8"/>`),
  g_layer: glyph(`<path d="M12 3 21 8l-9 5-9-5z"/><path d="M3 12.5l9 5 9-5M3 16.5l9 5 9-5"/>`),
  g_math: glyph(`<path d="M17 4H7l6 8-6 8h10"/>`),
  g_decision: glyph(`<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/><path d="M10 9.5a2 2 0 1 1 2.8 1.8c-.6.3-.8.8-.8 1.4M12 15.5h.01"/>`),
  g_data: glyph(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/>`),
  g_document: glyph(`<path d="M6 2.5h8l4.5 4.5v14.5H6z"/><path d="M14 2.5V7h4.5M9 12h6M9 15.5h6"/>`),
  g_event: glyph(`<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>`),
}

type Icon = { w: number; h: number; image: string }
const icons: Record<string, Icon> = {}
const sources: Record<string, { source: string; license: string; sha256: string }> = {}

async function get(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": "drawman-icon-builder" }, signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return Buffer.from(await res.arrayBuffer())
}
function size(svg: string): [number, number] {
  const vb = svg.match(/viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
  if (vb) return [Number(vb[1]), Number(vb[2])]
  const w = svg.match(/\bwidth=["']([\d.]+)/i), h = svg.match(/\bheight=["']([\d.]+)/i)
  return w && h ? [Number(w[1]), Number(h[1])] : [24, 24]
}
function put(key: string, svg: string, source: string, license: string) {
  const [w, h] = size(svg)
  const buf = Buffer.from(svg)
  icons[key] = { w, h, image: `data:image/svg+xml,${buf.toString("base64")}` }
  sources[key] = { source, license, sha256: createHash("sha256").update(buf).digest("hex") }
}

function unzip(zip: Buffer) {
  let eocd = zip.length - 22
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error("not a zip file")
  const files = new Map<string, Buffer>()
  let p = zip.readUInt32LE(eocd + 16)
  for (let i = 0, n = zip.readUInt16LE(eocd + 10); i < n; i++) {
    const method = zip.readUInt16LE(p + 10), csize = zip.readUInt32LE(p + 20)
    const nlen = zip.readUInt16LE(p + 28), xlen = zip.readUInt16LE(p + 30), clen = zip.readUInt16LE(p + 32)
    const local = zip.readUInt32LE(p + 42)
    const name = zip.toString("utf8", p + 46, p + 46 + nlen)
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = zip.subarray(start, start + csize)
    if (!name.endsWith("/")) files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data))
    p += 46 + nlen + xlen + clen
  }
  return files
}

const needed = new Set([...Object.values(KIND).map(([, icon]) => icon), ...GENERAL_ICONS])
const failed: string[] = []

console.log("Google Cloud icon pack…")
const pack = unzip(await get(GOOGLE_ZIP))
const byName = new Map([...pack].filter(([n]) => n.endsWith(".svg")).map(([n, b]) => [n.split("/").pop()!.replace(/\.svg$/, ""), b]))
for (const [key, name] of Object.entries(GCP)) {
  const svg = byName.get(name)
  if (svg) put(key, svg.toString("utf8"), `${GOOGLE_ZIP} (${name}.svg)`, "Google Cloud icons, see https://cloud.google.com/icons")
  else failed.push(`${key}: ${name}.svg not in the Google pack`)
}

console.log("Azure and SAP BTP libraries from draw.io…")
const fromDrawio = Object.entries({ ...Object.fromEntries(Object.entries(AZURE).map(([k, v]) => [k, `azure2/${v}`])), ...Object.fromEntries(Object.entries(SAP).map(([k, v]) => [k, `sap/${v}`])) })
await Promise.all(fromDrawio.map(async ([key, rel]) => {
  const url = DRAWIO + rel.split("/").map(encodeURIComponent).join("/")
  try { put(key, (await get(url)).toString("utf8"), url, "Apache-2.0 (jgraph/drawio); vendor artwork per vendor terms") }
  catch (error) { failed.push(`${key}: ${(error as Error).message}`) }
}))

console.log("AWS Architecture Icons…")
const awsZip = await get(AWS_PAGE).then((b) => b.toString("utf8").match(/https:\/\/[^"'\s]+Icon-package[^"'\s]*\.zip/)?.[0]).catch(() => undefined) ?? AWS_FALLBACK_ZIP
const awsFiles = new Map([...unzip(await get(awsZip))]
  .filter(([n]) => /\/Arch_[^/]+_48\.svg$/.test(n) && !n.split("/").pop()!.startsWith("._"))
  .map(([n, b]) => [n.split("/").pop()!.replace(/^Arch_|_48\.svg$/g, ""), b]))
for (const [key, names] of Object.entries(AWS)) {
  const name = names.split("|").find((n) => awsFiles.has(n))
  if (name) put(key, awsFiles.get(name)!.toString("utf8"), `${awsZip} (Arch_${name}_48.svg)`, "AWS Architecture Icons, see https://aws.amazon.com/architecture/icons/")
  else failed.push(`${key}: ${names} not in the AWS package`)
}

console.log("Brand logos from Simple Icons…")
await Promise.all(Object.entries(BRANDS).map(async ([key, [slug, colour]]) => {
  const url = `${SIMPLE}${slug}.svg`
  try { put(key, (await get(url)).toString("utf8").replace("<svg ", `<svg fill="${colour}" `), url, "CC0-1.0 (Simple Icons); trademark of its owner") }
  catch (error) {
    if (key === "vault") put(key, glyph(`<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>`), "drawman", "same license as this project")
    else failed.push(`${key}: ${(error as Error).message}`)
  }
}))
for (const [key, svg] of Object.entries(OWN)) put(key, svg, "drawman", "same license as this project")

const missing = [...needed].filter((k) => !icons[k])
const sorted = <T>(o: Record<string, T>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))
writeFileSync(OUT, JSON.stringify(sorted(icons)))
writeFileSync(SOURCES, JSON.stringify(sorted(sources), null, 1) + "\n")
console.log(`${Object.keys(icons).length} icons written (${needed.size} used by the vocabulary)`)
for (const f of failed) console.warn(`FAILED ${f}`)
if (missing.length) {
  console.error(`Missing icons: ${missing.join(", ")}`)
  process.exit(1)
}
