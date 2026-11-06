import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge"
import "./style.css"

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T
const thread = $<HTMLElement>("#thread")
const hero = $<HTMLElement>("#hero")
const form = $<HTMLFormElement>("#form")
const input = $<HTMLTextAreaElement>("#input")
const send = $<HTMLButtonElement>("#send")
const modelSelect = $<HTMLSelectElement>("#model")
const HOST = { name: "Drawman", version: "0.1.0" }
const APP_HEIGHT = 640

let sessionId = crypto.randomUUID()
let busy = false

fetch("/api/info").then((r) => r.json()).then((info: { defaultModel: string; models: string[] }) => {
  for (const m of info.models) modelSelect.add(new Option(m, m, m === info.defaultModel, m === info.defaultModel))
  if (!info.models.includes(info.defaultModel)) modelSelect.add(new Option(info.defaultModel, info.defaultModel, true, true))
})
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-prompt]")) b.onclick = () => submit(b.dataset.prompt!)
$<HTMLButtonElement>("#new").onclick = async () => {
  await fetch("/api/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) })
  sessionId = crypto.randomUUID()
  thread.replaceChildren(hero)
  hero.hidden = false
  input.focus()
}
input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 180)}px` })
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit() }
})
form.addEventListener("submit", (e) => {
  e.preventDefault()
  const text = input.value.trim()
  if (text) submit(text)
})

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
function markdown(src: string) {
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>")
  const out: string[] = []
  let list = false
  for (const raw of src.split("\n")) {
    const line = raw.trimEnd()
    const li = line.match(/^\s*[-*•]\s+(.*)/) || line.match(/^\s*\d+[.)]\s+(.*)/)
    if (li) { if (!list) { out.push("<ul>"); list = true } out.push(`<li>${inline(li[1])}</li>`); continue }
    if (list) { out.push("</ul>"); list = false }
    const h = line.match(/^#{1,4}\s+(.*)/)
    if (h) out.push(`<h3>${inline(h[1])}</h3>`)
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`)
  }
  if (list) out.push("</ul>")
  return out.join("")
}

const resourceCache = new Map<string, Promise<{ text: string; _meta?: { ui?: { csp?: Record<string, string[]> } } }>>()
const loadResource = (uri: string) => {
  if (!resourceCache.has(uri)) resourceCache.set(uri, fetch(`/api/resource?uri=${encodeURIComponent(uri)}`).then((r) => r.json()))
  return resourceCache.get(uri)!
}

function cspFor(csp: Record<string, string[]> | undefined) {
  const res = (csp?.resourceDomains ?? []).join(" ")
  const con = (csp?.connectDomains ?? []).join(" ")
  return [
    "default-src 'none'", `script-src 'unsafe-inline' ${res}`, `style-src 'unsafe-inline' ${res}`, `img-src data: blob: ${res}`,
    `font-src data: ${res}`, `connect-src ${con || "'none'"}`, "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
  ].join("; ")
}

interface AppHandle {
  partial(args: Record<string, unknown>): void
  input(args: Record<string, unknown>): void
  result(result: unknown): void
  meta: HTMLElement
  tool: string
}

function mountApp(stack: HTMLElement, uri: string, toolName: string): AppHandle {
  const card = document.createElement("div")
  card.className = "appcard"
  card.innerHTML = `<div class="chrome"><span><b>draw.io</b> · ${esc(toolName)}</span><span><span class="badge live">MCP App · live</span> <span class="badge">${esc(uri)}</span></span></div>`
  const iframe = document.createElement("iframe")
  iframe.setAttribute("sandbox", "allow-scripts")
  iframe.setAttribute("title", "draw.io MCP App")
  card.appendChild(iframe)
  stack.appendChild(card)
  const meta = document.createElement("div")
  meta.className = "meta"
  stack.appendChild(meta)

  let ready = false
  const queue: (() => void)[] = []
  let latestPartial: Record<string, unknown> | null = null
  const whenReady = (fn: () => void) => (ready ? fn() : queue.push(fn))
  const ctx = () => ({
    theme: "light" as const, platform: "web" as const, locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    displayMode: (card.classList.contains("fullscreen") ? "fullscreen" : "inline") as "inline" | "fullscreen",
    availableDisplayModes: ["inline", "fullscreen"],
    containerDimensions: { height: card.classList.contains("fullscreen") ? window.innerHeight - 34 : APP_HEIGHT, maxWidth: card.clientWidth },
  })

  const bridge = new AppBridge(null, HOST, {
    openLinks: {}, downloadFile: {}, serverTools: {}, logging: {},
    updateModelContext: { text: {} }, message: { text: {} },
  } as never, { hostContext: ctx() as never })

  bridge.oninitialized = () => {
    ready = true
    if (latestPartial) bridge.sendToolInputPartial({ arguments: latestPartial })
    for (const fn of queue.splice(0)) fn()
  }
  bridge.oncalltool = async (params) => {
    const r = await fetch("/api/tools/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) })
    return r.json()
  }
  bridge.onmessage = async ({ content }) => {
    const text = content.map((c) => ("text" in c ? c.text : "")).join("\n").trim()
    if (!text || busy) return { isError: true }
    void submit(text, "from the diagram")
    return {}
  }
  bridge.onupdatemodelcontext = async ({ content }) => {
    const text = (content ?? []).map((c) => ("text" in c ? c.text : "")).join("\n")
    await fetch("/api/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, text }) })
    return {}
  }
  bridge.onopenlink = async ({ url }) => {
    window.open(url, "_blank", "noopener")
    return {}
  }
  bridge.ondownloadfile = async ({ contents }) => {
    for (const item of contents) {
      if (item.type !== "resource") continue
      const r = item.resource as { uri: string; mimeType?: string; text?: string; blob?: string }
      const data = r.text ?? atob(r.blob ?? "")
      const a = document.createElement("a")
      a.href = URL.createObjectURL(new Blob([data], { type: r.mimeType ?? "application/octet-stream" }))
      a.download = r.uri.split("/").pop() || "diagram.drawio"
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    }
    return {}
  }
  bridge.onrequestdisplaymode = async ({ mode }) => {
    card.classList.toggle("fullscreen", mode === "fullscreen")
    await bridge.sendHostContextChange(ctx() as never)
    return { mode }
  }
  bridge.onloggingmessage = ({ level, data }) => console.debug(`[app ${level}]`, data)
  window.addEventListener("resize", () => { if (ready) void bridge.sendHostContextChange(ctx() as never) })

  void loadResource(uri).then(async (res) => {
    const csp = `<meta http-equiv="Content-Security-Policy" content="${cspFor(res._meta?.ui?.csp)}">`
    const html = res.text.includes("<head>") ? res.text.replace("<head>", `<head>${csp}`) : csp + res.text
    iframe.srcdoc = html
    await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!))
  })

  return {
    meta,
    tool: toolName,
    partial(args) {
      latestPartial = args
      if (ready) void bridge.sendToolInputPartial({ arguments: args })
    },
    input(args) { whenReady(() => void bridge.sendToolInput({ arguments: args })) },
    result(result) { whenReady(() => void bridge.sendToolResult(result as never)) },
  }
}

const AVATAR = `<div class="avatar"><svg viewBox="0 0 24 24"><rect x="5" y="5" width="6" height="5" rx="1" fill="#fff"/><rect x="13" y="14" width="6" height="5" rx="1" fill="#fff"/><path d="M8 10v4h8" stroke="#fff" stroke-width="1.8" fill="none"/></svg></div>`

function scrollDown() { thread.scrollTop = thread.scrollHeight }

async function submit(text: string, via?: string) {
  if (busy) return
  busy = true
  send.disabled = true
  hero.hidden = true
  input.value = ""
  input.style.height = "auto"

  const user = document.createElement("div")
  user.className = "msg user"
  user.innerHTML = `<div class="bubble">${via ? `<span class="via">↩ ${esc(via)}</span>` : ""}${esc(text)}</div>`
  thread.appendChild(user)
  const turn = document.createElement("div")
  turn.className = "msg assistant"
  turn.innerHTML = `${AVATAR}<div class="stack"><div class="thinking"><i></i><i></i><i></i></div></div>`
  thread.appendChild(turn)
  const stack = turn.querySelector<HTMLElement>(".stack")!
  scrollDown()

  let textEl: HTMLElement | null = null
  let textBuf = ""
  const apps = new Map<string, AppHandle>()
  const clearThinking = () => stack.querySelector(".thinking")?.remove()

  try {
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text, model: modelSelect.value }),
    })
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i)
        buf = buf.slice(i + 2)
        if (!block.startsWith("data:")) continue
        const ev = JSON.parse(block.slice(5))
        switch (ev.type) {
          case "text": {
            clearThinking()
            if (!textEl) {
              textEl = document.createElement("div")
              textEl.className = "text streaming"
              stack.appendChild(textEl)
              textBuf = ""
            }
            textBuf += ev.delta
            textEl.innerHTML = markdown(textBuf)
            break
          }
          case "tool_start": {
            clearThinking()
            textEl?.classList.remove("streaming")
            textEl = null
            if (ev.resourceUri) apps.set(ev.callId, mountApp(stack, ev.resourceUri, ev.name))
            scrollDown()
            setTimeout(scrollDown, 400)
            break
          }
          case "tool_partial": apps.get(ev.callId)?.partial(ev.args); break
          case "tool_input": apps.get(ev.callId)?.input(ev.args); break
          case "tool_result": {
            const a = apps.get(ev.callId)
            a?.result(ev.result)
            if (a) a.meta.textContent = `${a.tool} returned in ${ev.ms} ms · result pushed to the MCP App via ui/notifications/tool-result`
            break
          }
          case "done": {
            textEl?.classList.remove("streaming")
            const u = ev.usage
            const meta = document.createElement("div")
            meta.className = "meta"
            meta.textContent = `${modelSelect.value} · ${(ev.ms / 1000).toFixed(1)} s · ${u.calls} call${u.calls === 1 ? "" : "s"} · ${u.prompt.toLocaleString()} → ${u.completion.toLocaleString()} tokens`
            stack.appendChild(meta)
            break
          }
          case "error": {
            clearThinking()
            const err = document.createElement("div")
            err.className = "error"
            err.textContent = ev.message
            stack.appendChild(err)
            break
          }
        }
        if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 260) scrollDown()
      }
    }
  } catch (error) {
    clearThinking()
    stack.insertAdjacentHTML("beforeend", `<div class="error">${esc((error as Error).message)}</div>`)
  } finally {
    textEl?.classList.remove("streaming")
    busy = false
    send.disabled = false
    input.focus()
  }
}
