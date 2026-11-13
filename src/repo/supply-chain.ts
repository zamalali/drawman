import { brandKind, normaliseKind } from "../engine/kinds.js"
import type { DiagramInput, InputInterface, InputNode } from "../engine/facts.js"
import type { Signal } from "./scan.js"

const STAGES: { kinds: string[]; id: string; title: string; detail: string }[] = [
  { kinds: ["github_repo"], id: "source_repo", title: "Source repository", detail: "GitHub" },
  { kinds: ["github_actions", "az_devops", "cloud_build", "sap_cicd", "gitlab_ci", "aws_codepipeline", "aws_codebuild"], id: "ci_pipeline", title: "CI/CD pipeline", detail: "build and release workflow" },
  { kinds: ["docker_build"], id: "docker_build", title: "Docker image build", detail: "container image" },
  { kinds: ["jfrog_artifactory"], id: "jfrog_artifactory", title: "JFrog Artifactory", detail: "artifact repository" },
  { kinds: ["artifact_registry", "az_acr", "aws_ecr"], id: "image_registry", title: "Container registry", detail: "runtime images" },
]
const RUNTIMES = new Set(["cloud_run", "gke", "cloud_functions", "app_engine", "compute_engine", "az_app_service", "az_functions",
  "az_aks", "az_container_apps", "az_vm", "sap_kyma", "aws_lambda", "aws_ecs", "aws_fargate", "aws_eks", "aws_app_runner", "aws_ec2",
  "aws_beanstalk", "k8s_workload", "container_service"])
const LINK: Record<string, [label: string, protocol: string, description: string]> = {
  "0>1": ["push / PR", "git", "Commits and pull requests trigger the build workflow."],
  "1>2": ["build image", "docker", "The workflow builds the container image."],
  "2>3": ["push image", "HTTPS", "The built image is pushed to JFrog Artifactory first."],
  "3>4": ["mirror image", "HTTPS", "The released image is mirrored from Artifactory into the cloud registry."],
  "2>4": ["push image", "HTTPS", "The built image is pushed to the cloud registry."],
  "1>4": ["push image", "HTTPS", "The workflow publishes the image to the cloud registry."],
  "1>3": ["push image", "HTTPS", "The workflow publishes the image to JFrog Artifactory."],
}

const slug = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "")

export function enforceSupplyChain(diagram: DiagramInput, signals: Signal[]): { diagram: DiagramInput; changes: string[] } {
  const proven = new Set(signals.map((s) => s.kind))
  const ev = new Map(signals.map((s) => [s.kind, s.evidence[0]?.at ?? ""]))
  const nodes = [...((diagram.nodes as InputNode[] | undefined) ?? [])]
  const interfaces = [...((diagram.interfaces as InputInterface[] | undefined) ?? [])]
  const kindOf = (n: InputNode) => brandKind(normaliseKind(String(n.kind ?? ""), String(n.title ?? ""), String(n.detail ?? "")), String(n.title ?? ""))
  const changes: string[] = []

  const chain: { stage: number; id: string }[] = []
  STAGES.forEach((stage, i) => {
    const existing = nodes.find((n) => stage.kinds.includes(kindOf(n)))
    const provenKind = stage.kinds.find((k) => proven.has(k))
    if (existing) {
      chain.push({ stage: i, id: slug(existing.id) })
      return
    }
    if (!provenKind) return
    const id = nodes.some((n) => slug(n.id) === stage.id) ? `${stage.id}_${i}` : stage.id
    const title = provenKind === "az_acr" ? "Azure Container Registry" : provenKind === "az_devops" ? "Azure DevOps"
      : provenKind === "github_actions" ? "GitHub Actions" : provenKind === "cloud_build" ? "Cloud Build" : stage.title
    nodes.push({ id, kind: provenKind, title, detail: stage.detail, status: "active", evidence: ev.get(provenKind) } as InputNode)
    chain.push({ stage: i, id })
    changes.push(`added ${title} (${ev.get(provenKind)})`)
  })
  if (chain.length < 2) return { diagram, changes }

  const members = new Set(chain.map((c) => c.id))
  const last = chain[chain.length - 1]
  const runtimeNodes = nodes.filter((n) => RUNTIMES.has(kindOf(n)))
  const runtimeIds = new Set(last.stage >= 2 ? runtimeNodes.map((n) => slug(n.id)) : [])
  const kept = interfaces.filter((i) => {
    const from = slug(i.from), to = slug(i.to)
    return !(members.has(from) && (members.has(to) || runtimeIds.has(to)))
  })
  if (kept.length !== interfaces.length) changes.push(`rewired ${interfaces.length - kept.length} release-path interface(s)`)
  const links: InputInterface[] = []
  // Image wording only when the evidence shows a container build or registry; npm, Maven or zip releases are just published.
  const images = ["docker_build", ...STAGES[4].kinds].some((k) => proven.has(k))
  for (let k = 1; k < chain.length; k++) {
    const a = chain[k - 1], b = chain[k]
    const [label, protocol, description] = (images || b.stage < 2 ? LINK[`${a.stage}>${b.stage}`] : undefined)
      ?? (b.stage >= 2 ? ["publish", "HTTPS", "The workflow publishes the release artifact."] : ["hands over", "HTTPS", "Next release stage."])
    links.push({ from: a.id, to: b.id, label, protocol, description })
  }

  if (last.stage >= 2) {
    const targets = runtimeNodes.filter((n) => proven.has(kindOf(n)))
    for (const t of (targets.length ? targets : runtimeNodes.slice(0, 1)).slice(0, 3)) {
      links.push({ from: last.id, to: slug(t.id), label: "deploy", protocol: "deploy", description: `${String(t.title ?? t.id)} runs the released ${images ? "image" : "build"}.` })
    }
  }
  return { diagram: { ...diagram, nodes, interfaces: [...links, ...kept] }, changes }
}
