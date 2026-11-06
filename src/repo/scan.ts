import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { config } from "../config.js"
import { KIND, PLATFORMS, platformOf } from "../engine/kinds.js"

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

const TF: [RegExp, string][] = [
  [/google_cloud_run_(v2_)?(service|job)\b/, "cloud_run"], [/google_container_cluster/, "gke"],
  [/google_cloudfunctions2?_function/, "cloud_functions"], [/google_compute_instance\b/, "compute_engine"],
  [/google_sql_database_instance/, "cloud_sql"], [/google_alloydb/, "alloydb"], [/google_spanner/, "spanner"],
  [/google_firestore/, "firestore"], [/google_bigtable/, "bigtable"], [/google_redis_instance/, "memorystore"],
  [/google_bigquery_(dataset|table)/, "bigquery"], [/google_storage_bucket\b/, "cloud_storage"],
  [/google_pubsub_(topic|subscription)/, "pubsub"], [/google_eventarc/, "eventarc"],
  [/google_cloud_scheduler_job/, "cloud_scheduler"], [/google_cloud_tasks_queue/, "cloud_tasks"],
  [/google_workflows_workflow/, "workflows"], [/google_secret_manager_secret\b/, "secret_manager"],
  [/google_kms_/, "kms"], [/google_iam_workload_identity_pool/, "workload_identity"],
  [/google_service_account\b/, "iam"], [/google_compute_security_policy/, "cloud_armor"],
  [/google_compute_(global_)?forwarding_rule|google_compute_url_map|google_compute_backend_service/, "load_balancer"],
  [/google_dns_/, "cloud_dns"], [/google_iap_/, "iap"], [/google_vpc_access_connector/, "vpc_connector"],
  [/google_compute_router_nat/, "cloud_nat"], [/google_compute_network\b/, "vpc"],
  [/google_artifact_registry_repository/, "artifact_registry"], [/google_vertex_ai/, "vertex_ai"],
  [/google_monitoring_/, "cloud_monitoring"], [/google_logging_/, "cloud_logging"], [/google_dataflow/, "dataflow"],
  [/google_composer/, "composer"], [/google_dataproc/, "dataproc"], [/google_api_gateway/, "api_gateway"],
  [/google_apigee/, "apigee"], [/google_compute_vpn/, "cloud_vpn"], [/google_certificate_manager/, "certificate_manager"],
  [/azurerm_kubernetes_cluster\b/, "az_aks"], [/azurerm_(linux_|windows_)?function_app\b/, "az_functions"],
  [/azurerm_(linux_|windows_)?web_app\b|azurerm_app_service\b/, "az_app_service"],
  [/azurerm_container_app\b/, "az_container_apps"], [/azurerm_(linux_|windows_)?virtual_machine\b/, "az_vm"],
  [/azurerm_static_(web_)?(site|app)/, "az_static_web_apps"], [/azurerm_(mssql|sql)_/, "az_sql"],
  [/azurerm_cosmosdb/, "az_cosmos_db"], [/azurerm_storage_account\b/, "az_storage"], [/azurerm_redis/, "az_redis"],
  [/azurerm_synapse/, "az_synapse"], [/azurerm_databricks/, "az_databricks"], [/azurerm_servicebus/, "az_service_bus"],
  [/azurerm_eventhub/, "az_event_hubs"], [/azurerm_eventgrid/, "az_event_grid"], [/azurerm_logic_app/, "az_logic_apps"],
  [/azurerm_api_management\b/, "az_apim"], [/azurerm_cognitive_(account|deployment)/, "az_openai"],
  [/azurerm_search_service/, "az_ai_search"], [/azurerm_machine_learning/, "az_ml"], [/azurerm_key_vault\b/, "az_key_vault"],
  [/azurerm_user_assigned_identity/, "az_managed_identity"], [/azuread_/, "az_entra_id"],
  [/azurerm_application_insights/, "az_app_insights"], [/azurerm_log_analytics/, "az_log_analytics"],
  [/azurerm_monitor_/, "az_monitor"], [/azurerm_sentinel/, "az_sentinel"], [/azurerm_(cdn_frontdoor|frontdoor)/, "az_front_door"],
  [/azurerm_application_gateway/, "az_app_gateway"], [/azurerm_lb\b/, "az_load_balancer"], [/azurerm_dns_/, "az_dns"],
  [/azurerm_virtual_network\b/, "az_vnet"], [/azurerm_firewall\b/, "az_firewall"], [/azurerm_private_endpoint/, "az_private_link"],
  [/azurerm_express_route/, "az_expressroute"], [/azurerm_nat_gateway/, "az_nat"], [/azurerm_container_registry/, "az_acr"],
  [/aws_lambda_function\b/, "aws_lambda"], [/aws_ecs_(service|cluster|task_definition)/, "aws_ecs"], [/aws_eks_cluster/, "aws_eks"],
  [/aws_instance\b|aws_launch_template|aws_autoscaling_group/, "aws_ec2"], [/aws_apprunner_service/, "aws_app_runner"],
  [/aws_elastic_beanstalk/, "aws_beanstalk"], [/aws_amplify_app/, "aws_amplify"], [/aws_batch_/, "aws_batch"],
  [/aws_sfn_state_machine/, "aws_step_functions"], [/aws_s3_bucket\b/, "aws_s3"], [/aws_dynamodb_table/, "aws_dynamodb"],
  [/aws_rds_cluster/, "aws_aurora"], [/aws_db_instance/, "aws_rds"], [/aws_elasticache/, "aws_elasticache"],
  [/aws_docdb/, "aws_documentdb"], [/aws_neptune/, "aws_neptune"], [/aws_efs_file_system/, "aws_efs"], [/aws_redshift/, "aws_redshift"],
  [/aws_athena/, "aws_athena"], [/aws_glue_/, "aws_glue"], [/aws_(opensearch|elasticsearch)_domain/, "aws_opensearch"],
  [/aws_sqs_queue/, "aws_sqs"], [/aws_sns_topic/, "aws_sns"], [/aws_cloudwatch_event_|aws_scheduler_schedule/, "aws_eventbridge"],
  [/aws_kinesis/, "aws_kinesis"], [/aws_msk_cluster/, "aws_msk"], [/aws_bedrock/, "aws_bedrock"], [/aws_sagemaker/, "aws_sagemaker"],
  [/aws_cognito/, "aws_cognito"], [/aws_iam_role\b|aws_iam_openid_connect_provider/, "aws_iam"],
  [/aws_secretsmanager_secret\b/, "aws_secrets_manager"], [/aws_kms_key/, "aws_kms"], [/aws_cloudwatch_(log_group|metric_alarm|dashboard)/, "aws_cloudwatch"],
  [/aws_cloudfront_distribution/, "aws_cloudfront"], [/aws_route53_/, "aws_route53"], [/aws_(lb|alb|elb)\b/, "aws_alb"],
  [/aws_wafv2_/, "aws_waf"], [/aws_(api_gateway|apigatewayv2)_/, "aws_api_gateway"], [/aws_appsync/, "aws_appsync"],
  [/aws_vpc\b/, "aws_vpc"], [/aws_ecr_repository/, "aws_ecr"], [/aws_codepipeline/, "aws_codepipeline"], [/aws_codebuild/, "aws_codebuild"],
]
const CFN: [RegExp, string][] = [
  [/AWS::(Lambda::Function|Serverless::Function)|lambda\.(Function|DockerImageFunction)\b|NodejsFunction|PythonFunction/, "aws_lambda"],
  [/AWS::ECS::|ecs\.(FargateService|Ec2Service|Cluster)|ecs_patterns/, "aws_ecs"], [/AWS::EKS::|eks\.Cluster/, "aws_eks"],
  [/AWS::EC2::Instance|ec2\.Instance\b/, "aws_ec2"], [/AWS::S3::Bucket|s3\.Bucket\b/, "aws_s3"],
  [/AWS::DynamoDB::Table|AWS::Serverless::SimpleTable|dynamodb\.(Table|TableV2)\b/, "aws_dynamodb"],
  [/AWS::RDS::DBCluster|rds\.DatabaseCluster/, "aws_aurora"], [/AWS::RDS::DBInstance|rds\.DatabaseInstance/, "aws_rds"],
  [/AWS::ElastiCache::/, "aws_elasticache"], [/AWS::SQS::Queue|sqs\.Queue\b/, "aws_sqs"], [/AWS::SNS::Topic|sns\.Topic\b/, "aws_sns"],
  [/AWS::Events::Rule|events\.Rule\b/, "aws_eventbridge"], [/AWS::Kinesis::/, "aws_kinesis"],
  [/AWS::StepFunctions::|AWS::Serverless::StateMachine|sfn\.StateMachine/, "aws_step_functions"],
  [/AWS::ApiGateway(V2)?::|AWS::Serverless::(Http)?Api|apigateway\.(RestApi|LambdaRestApi)|HttpApi\b/, "aws_api_gateway"],
  [/AWS::AppSync::/, "aws_appsync"], [/AWS::CloudFront::|cloudfront\.Distribution/, "aws_cloudfront"],
  [/AWS::Cognito::|cognito\.UserPool/, "aws_cognito"], [/AWS::SecretsManager::|secretsmanager\.Secret/, "aws_secrets_manager"],
  [/AWS::KMS::Key/, "aws_kms"], [/AWS::ElasticLoadBalancingV2::|elbv2\.ApplicationLoadBalancer/, "aws_alb"],
  [/AWS::Route53::/, "aws_route53"], [/AWS::Elasticsearch::|AWS::OpenSearchService::/, "aws_opensearch"],
  [/AWS::Neptune::/, "aws_neptune"], [/AWS::DocDB::/, "aws_documentdb"], [/AWS::IAM::Role/, "aws_iam"],
  [/AWS::CloudWatch::|AWS::Logs::LogGroup/, "aws_cloudwatch"], [/AWS::EC2::VPC\b|ec2\.Vpc\b/, "aws_vpc"],
  [/AWS::ECR::Repository|ecr\.Repository/, "aws_ecr"], [/AWS::CodePipeline::/, "aws_codepipeline"], [/AWS::CodeBuild::/, "aws_codebuild"],
  [/AWS::Amplify::/, "aws_amplify"], [/AWS::AppRunner::/, "aws_app_runner"], [/AWS::Bedrock::/, "aws_bedrock"],
  [/AWS::SageMaker::/, "aws_sagemaker"], [/AWS::Glue::/, "aws_glue"], [/AWS::Athena::/, "aws_athena"], [/AWS::Redshift::/, "aws_redshift"],
  [/AWS::WAFv2::/, "aws_waf"], [/AWS::EFS::/, "aws_efs"],
]
const IMAGES: [RegExp, string][] = [
  [/(^|\/)(postgres|postgis|timescale\w*|bitnami\/postgresql)\b/i, "postgres"], [/(^|\/)(mysql|mariadb)\b/i, "mysql"],
  [/(^|\/)mongo\b/i, "mongodb"], [/(^|\/)(redis|valkey|keydb|dragonfly)\b/i, "redis"], [/(^|\/)(elasticsearch|opensearch)\b/i, "elasticsearch"],
  [/(^|\/)minio\b/i, "minio"], [/(^|\/)(cp-kafka|kafka|redpanda)\b/i, "kafka"], [/(^|\/)rabbitmq\b/i, "rabbitmq"],
  [/(^|\/)nginx\b/i, "nginx"], [/(^|\/)traefik\b/i, "traefik"], [/(^|\/)keycloak\b/i, "keycloak"], [/(^|\/)vault\b/i, "vault"],
  [/(^|\/)prometheus\b/i, "prometheus"], [/(^|\/)(grafana|loki|tempo)\b/i, "grafana"],
]
const ARM: [RegExp, string][] = [
  [/Microsoft\.Web\/sites/i, "az_app_service"], [/Microsoft\.ContainerService\/managedClusters/i, "az_aks"],
  [/Microsoft\.App\/containerApps/i, "az_container_apps"], [/Microsoft\.Sql\//i, "az_sql"],
  [/Microsoft\.DocumentDB/i, "az_cosmos_db"], [/Microsoft\.Storage\/storageAccounts/i, "az_storage"],
  [/Microsoft\.KeyVault/i, "az_key_vault"], [/Microsoft\.ServiceBus/i, "az_service_bus"],
  [/Microsoft\.EventHub/i, "az_event_hubs"], [/Microsoft\.EventGrid/i, "az_event_grid"],
  [/Microsoft\.Logic\/workflows/i, "az_logic_apps"], [/Microsoft\.ApiManagement/i, "az_apim"],
  [/Microsoft\.CognitiveServices/i, "az_openai"], [/Microsoft\.Search\/searchServices/i, "az_ai_search"],
  [/Microsoft\.Insights\/components/i, "az_app_insights"], [/Microsoft\.OperationalInsights/i, "az_log_analytics"],
  [/Microsoft\.(Cdn\/profiles|Network\/frontDoors)/i, "az_front_door"], [/Microsoft\.Network\/applicationGateways/i, "az_app_gateway"],
  [/Microsoft\.Network\/virtualNetworks/i, "az_vnet"], [/Microsoft\.Network\/privateEndpoints/i, "az_private_link"],
  [/Microsoft\.ContainerRegistry/i, "az_acr"], [/Microsoft\.ManagedIdentity/i, "az_managed_identity"],
  [/Microsoft\.Cache\/redis/i, "az_redis"],
]
const WORKFLOW: [RegExp, string][] = [
  [/google-github-actions\/auth|workload_identity_provider|wif_provider/i, "workload_identity"],
  [/docker build|docker\/build-push-action|docker-artifactory|build-(python|ts)-docker/i, "docker_build"],
  [/jfrog|artifactory/i, "jfrog_artifactory"], [/docker\.pkg\.dev|gcp_artifact_registry|docker-gcp-push/i, "artifact_registry"],
  [/gcloud run (deploy|jobs)|deploy-cloudrun/i, "cloud_run"], [/gcloud functions deploy/i, "cloud_functions"],
  [/azure\/login/i, "az_entra_id"], [/azure\/webapps-deploy/i, "az_app_service"], [/azure\/functions-action/i, "az_functions"],
  [/azure\/aks-set-context|azure\/k8s-deploy/i, "az_aks"], [/\.azurecr\.io|azure\/docker-login/i, "az_acr"],
  [/cf (push|deploy)|cf-cli|mbt build|cloudfoundry/i, "sap_cf_app"], [/terraform (apply|plan|init)|hashicorp\/setup-terraform|tofu (apply|plan)/i, "terraform"],
  [/aws-actions\/configure-aws-credentials/i, "aws_iam"], [/aws-actions\/amazon-ecr-login|\.dkr\.ecr\./i, "aws_ecr"],
  [/aws-actions\/amazon-ecs-deploy|aws ecs update-service/i, "aws_ecs"], [/aws lambda update-function|sam deploy|serverless deploy/i, "aws_lambda"],
  [/cdk deploy|aws cloudformation deploy/i, "aws_cloudformation"], [/aws s3 (sync|cp)/i, "aws_s3"],
  [/kubectl apply|helm (upgrade|install)|azure\/k8s-deploy/i, "k8s_workload"], [/vercel (deploy|--prod)|amondnet\/vercel-action/i, "vercel"],
  [/netlify deploy|nwtgck\/actions-netlify/i, "netlify"], [/wrangler (deploy|publish)|cloudflare\/wrangler-action/i, "cloudflare"],
]
const DEPS: [RegExp, string][] = [
  [/@aws-sdk\/client-s3|aws-sdk.*\bS3\b|boto3.*s3|"aws-cdk-lib\/aws-s3"/, "aws_s3"], [/@aws-sdk\/(client|lib)-dynamodb|pynamodb|dynamoose/, "aws_dynamodb"],
  [/@aws-sdk\/client-sqs/, "aws_sqs"], [/@aws-sdk\/client-sns/, "aws_sns"], [/@aws-sdk\/client-eventbridge/, "aws_eventbridge"],
  [/@aws-sdk\/client-bedrock|langchain-aws|@langchain\/aws/, "aws_bedrock"], [/@aws-sdk\/client-secrets-manager/, "aws_secrets_manager"],
  [/@aws-sdk\/client-cognito|amazon-cognito-identity-js|aws-amplify/, "aws_cognito"], [/@aws-sdk\/client-kinesis/, "aws_kinesis"],
  [/\b(pg|postgres|psycopg2?(-binary)?|psycopg\[|asyncpg|pgx|lib\/pq|postgresql)\b(?!-)/, "postgres"], [/\b(mysql2?|pymysql|mysqlclient|go-sql-driver\/mysql)\b/, "mysql"],
  [/\b(mongoose|mongodb|pymongo|motor)\b/, "mongodb"], [/\b(redis|ioredis|go-redis|redis-py)\b/, "redis"],
  [/\b(kafkajs|confluent-kafka|kafka-python|aiokafka|sarama|spring-kafka)\b/, "kafka"], [/\b(amqplib|pika|aio-pika|celery|amqp091-go|bullmq)\b/, "rabbitmq"],
  [/@elastic\/elasticsearch|\belasticsearch\b/, "elasticsearch"], [/@supabase\/supabase-js|\bsupabase\b/, "supabase"],
  [/\b(prom-client|prometheus[-_]client|prometheus_fastapi)\b/, "prometheus"], [/keycloak-js|python-keycloak/, "keycloak"],
  [/\b(openai|anthropic|@anthropic-ai\/sdk|litellm|langchain)\b/, "llm_gateway"],
  [/@sap\/cds\b|"@cap-js\//, "sap_cap"], [/@sap\/approuter/, "sap_approuter"], [/@sap-cloud-sdk\/|@sap\/xsenv/, "sap_destination"],
  [/@sap\/xssec|passport-sap/, "sap_xsuaa"], [/@sap\/hana-client|\bhdbcli\b|@cap-js\/hana|@sap\/hdi/, "sap_hana_cloud"],
  [/@sap\/audit-logging/, "sap_audit_log"], [/@sap\/ai-sdk|sap-ai-sdk|generative-ai-hub-sdk/, "sap_ai_core"],
  [/google-cloud-storage|@google-cloud\/storage|cloud\.google\.com\/go\/storage/, "cloud_storage"],
  [/google-cloud-bigquery|@google-cloud\/bigquery|cloud\.google\.com\/go\/bigquery/, "bigquery"],
  [/google-cloud-pubsub|@google-cloud\/pubsub/, "pubsub"], [/google-cloud-firestore|@google-cloud\/firestore/, "firestore"],
  [/google-cloud-secret-manager|@google-cloud\/secret-manager/, "secret_manager"],
  [/google-cloud-aiplatform|@google-cloud\/vertexai|vertexai/, "vertex_ai"], [/google-cloud-logging/, "cloud_logging"],
  [/@azure\/storage-blob|azure-storage-blob/, "az_storage"], [/@azure\/cosmos|azure-cosmos/, "az_cosmos_db"],
  [/@azure\/service-bus|azure-servicebus/, "az_service_bus"], [/@azure\/event-hubs|azure-eventhub/, "az_event_hubs"],
  [/@azure\/keyvault|azure-keyvault/, "az_key_vault"], [/@azure\/msal|@azure\/identity|\bmsal\b|azure-identity/, "az_entra_id"],
  [/applicationinsights|azure-monitor-opentelemetry/, "az_app_insights"], [/@azure\/openai|azure-ai-openai/, "az_openai"],
  [/@azure\/search-documents|azure-search-documents/, "az_ai_search"],
]
const HOSTS: [RegExp, string][] = [
  [/\.hana\.ondemand\.com|\.cfapps\./i, "sap_cf_app"],
  [/graph\.microsoft\.com|login\.microsoftonline\.com/i, "az_entra_id"], [/\.run\.app\b/i, "cloud_run"],
  [/\.azurewebsites\.net/i, "az_app_service"], [/\.blob\.core\.windows\.net/i, "az_storage"],
  [/\.openai\.azure\.com/i, "az_openai"], [/\.vault\.azure\.net/i, "az_key_vault"], [/docker\.pkg\.dev/i, "artifact_registry"],
  [/aiplatform\.googleapis\.com|generativelanguage\.googleapis\.com/i, "vertex_ai"],
  [/api\.openai\.com|api\.anthropic\.com|openrouter\.ai\/api/i, "llm_gateway"],
  [/\.s3[.-]([\w-]+\.)?amazonaws\.com|s3:\/\//i, "aws_s3"], [/\.execute-api\.[\w-]+\.amazonaws\.com/i, "aws_api_gateway"],
  [/\.lambda-url\.[\w-]+\.on\.aws/i, "aws_lambda"], [/\.cloudfront\.net/i, "aws_cloudfront"], [/\.rds\.amazonaws\.com/i, "aws_rds"],
  [/\.supabase\.co\b/i, "supabase"], [/\.vercel\.app\b/i, "vercel"], [/\.netlify\.app\b/i, "netlify"],
  ...(config.profile.endpoints ?? []).flatMap(([pattern, kind]): [RegExp, string][] => {
    try { return [[new RegExp(pattern, "i"), kind]] } catch { return [] }
  }),
]

const SECRET_FILE = /(^|\/)(\.env(\.(?!example$|sample$|template$)[\w.-]+)?|\.npmrc|\.pypirc|\.netrc|id_[rd]sa\w*|credentials(\.json)?|[\w.-]*service[-_]?account[\w.-]*\.json|[\w.-]+\.(pem|key|p12|pfx|jks|keystore|kdbx|tfstate(\.backup)?))$/i
const SECRET_VALUE: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, /\bgh[pousr]_[A-Za-z0-9]{30,}/g, /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, /\bAIza[0-9A-Za-z_-]{35}\b/g, /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g,
  // credentials inside URLs: scheme://user:password@host
  /(\b[a-z][\w+.-]*:\/\/[^\s:/@"'`]+:)([^\s@/"'`]{3,})(?=@)/gi,
  // Azure / Service Bus style connection strings
  /((?:AccountKey|SharedAccessKey|SharedAccessSignature|Password|Pwd)\s*=\s*)([^;"'\s]{6,})/gi,
  // kubeconfig and similar embedded key material
  /((?:client-key-data|client-certificate-data|token-data)\s*:\s*)(\S{12,})/gi,
  // HTTP authorization headers
  /((?:Basic|Bearer)\s+)([A-Za-z0-9+/=._~-]{12,})/g,
  // key = value where the key names a secret (also *_PASS, *_PWD, *_SECRET, *_TOKEN, *_KEY suffixes)
  /((?:password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret|access[_-]?key|[A-Z0-9_]*_(?:PASS|PASSWORD|PWD|SECRET|TOKEN|KEY))["']?\s*[:=]\s*["']?)(?!\$\{|<|\{\{|process\.env|os\.environ)([^\s"',;]{6,})/gi,
]
export function redact(text: string) {
  return SECRET_VALUE.reduce((t, re) => t.replace(re, (m: string, prefix?: string, value?: string) =>
    typeof prefix === "string" && typeof value === "string" ? `${prefix}***` : "***redacted***"), text)
}
const MTA_SERVICE: Record<string, string> = {
  xsuaa: "sap_xsuaa", destination: "sap_destination", connectivity: "sap_connectivity", "hana-cloud": "sap_hana_cloud",
  hana: "sap_hana_cloud", "html5-apps-repo": "sap_html5_repo", "application-logs": "sap_app_logging",
  auditlog: "sap_audit_log", "auditlog-management": "sap_audit_log", credstore: "sap_credential_store",
  jobscheduler: "sap_job_scheduler", "enterprise-messaging": "sap_event_mesh", objectstore: "sap_object_store",
  portal: "sap_work_zone", "build-workzone-standard": "sap_work_zone", aicore: "sap_ai_core",
  "document-information-extraction": "sap_document_ai", "cloud-logging": "sap_cloud_logging",
  "alert-notification": "sap_alert_notification", identity: "sap_ias", "malware-scanner": "sap_credential_store",
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

const PRIORITY: [RegExp, number][] = [
  [/^readme\.md$/i, 0], [/^\.github\/workflows\//, 1], [/(^|\/)mta\.ya?ml$/, 1], [/(^|\/)(xs-security|xs-app)\.json$/, 2],
  [/\.(tf|bicep)$/, 2], [/(^|\/)(manifest\.yml|ui5\.yaml|azure-pipelines\.ya?ml|cloudbuild\.ya?ml|docker-compose[\w.-]*\.ya?ml)$/, 2],
  [/(^|\/)(compose[\w.-]*\.ya?ml|serverless\.ya?ml|template\.ya?ml|samconfig\.toml|cdk\.json|\.gitlab-ci\.yml|chart\.yaml|values\.yaml)$/i, 2],
  [/(^|\/)(k8s|kubernetes|deploy|deployment|manifests|charts|helm|infra|infrastructure|cdk|lib\/[\w-]*stack)[\w-]*\//i, 3],
  [/(^|\/)dockerfile/i, 3], [/(^|\/)(package\.json|requirements[\w-]*\.txt|pyproject\.toml|go\.mod|pom\.xml)$/, 3],
  [/\.env\.example$|\.env\.sample$/, 3], [/\.cds$/, 4], [/(^|\/)(app|main|server|index|config|settings)\.(py|ts|js|go)$/, 5],
  [/\.(py|ts|go|java|kt|cs|js)$/, 7],
]

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
