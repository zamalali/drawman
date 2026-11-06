import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { config, llmConfigured, llmHeaders } from "./config.js"

export interface Completion { text: string; model: string; usage?: { prompt: number; completion: number } }
export type Complete = (prompt: string, maxTokens: number) => Promise<Completion>

export function httpCompleter(): Complete | null {
  if (!llmConfigured()) return null
  return async (prompt, maxTokens) => {
    const { baseUrl, model } = config.llm
    const body: Record<string, unknown> = { model, max_tokens: maxTokens, temperature: 0, messages: [{ role: "user", content: prompt }] }
    if (/^(openai\/)?(o\d|gpt-5)/.test(model)) delete body.temperature
    const url = /\/v\d+$/.test(baseUrl) ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`
    const res = await fetch(url, {
      method: "POST",
      headers: { ...llmHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(240_000),
    })
    if (!res.ok) throw new Error(`LLM endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const json = (await res.json()) as { model?: string; choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } }
    return {
      text: json.choices[0]?.message?.content ?? "",
      model: json.model || model,
      usage: json.usage ? { prompt: json.usage.prompt_tokens, completion: json.usage.completion_tokens } : undefined,
    }
  }
}

export function samplingCompleter(server: McpServer): Complete | null {
  if (!server.server.getClientCapabilities()?.sampling) return null
  return async (prompt, maxTokens) => {
    const r = await server.server.createMessage({
      messages: [{ role: "user", content: { type: "text", text: prompt } }],
      maxTokens,
      includeContext: "none",
      modelPreferences: { intelligencePriority: 0.9, speedPriority: 0.3, hints: [{ name: "claude-sonnet" }, { name: "gpt-5" }] },
    }, { timeout: 240_000 })
    const content = Array.isArray(r.content) ? r.content : [r.content]
    return { text: content.map((c) => (c.type === "text" ? c.text : "")).join(""), model: r.model || "host model (sampling)" }
  }
}
