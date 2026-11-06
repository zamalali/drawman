// The MCP Apps connection to the host and how its theme, fonts and display mode are applied.
import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps"
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps"
import { ui } from "./dom.js"

export const app = new App({ name: "drawman", version: "0.1.0" }, { availableDisplayModes: ["inline", "fullscreen"] })

export function applyContext(ctx: McpUiHostContext | undefined) {
  if (!ctx) return
  if (ctx.theme) applyDocumentTheme(ctx.theme)
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)
  if (ctx.displayMode) {
    document.documentElement.dataset.display = ctx.displayMode
    ui.fullscreen.textContent = ctx.displayMode === "fullscreen" ? "⤡" : "⤢"
  }
  const dims = ctx.containerDimensions as { height?: number; maxHeight?: number } | undefined
  const app = document.getElementById("app")!
  if (dims && typeof dims.height === "number") app.style.height = "100vh"
  else app.style.height = `${Math.min(dims?.maxHeight ?? 620, 620)}px`
}
