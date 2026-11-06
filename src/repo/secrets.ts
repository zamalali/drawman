// Credential files are never read and secret-looking values are masked before anything leaves the machine.
export const SECRET_FILE = /(^|\/)(\.env(\.(?!example$|sample$|template$)[\w.-]+)?|\.npmrc|\.pypirc|\.netrc|id_[rd]sa\w*|credentials(\.json)?|[\w.-]*service[-_]?account[\w.-]*\.json|[\w.-]+\.(pem|key|p12|pfx|jks|keystore|kdbx|tfstate(\.backup)?))$/i
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
