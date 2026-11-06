import * as path from "node:path"
import * as vscode from "vscode"

const SECRET = "drawman.llmKey"

export function activate(context: vscode.ExtensionContext) {
  const changed = new vscode.EventEmitter<void>()
  const server = context.asAbsolutePath(path.join("dist", "server.mjs"))
  const version = String(context.extension.packageJSON.version ?? "0.0.0")

  context.subscriptions.push(
    changed,
    vscode.lm.registerMcpServerDefinitionProvider("drawman", {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: async () => {
        const cfg = vscode.workspace.getConfiguration("drawman")
        const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
        const env: Record<string, string> = {
          // The extension host binary runs the bundled server as plain Node.js.
          ELECTRON_RUN_AS_NODE: "1",
          DRAWMAN_WORKSPACE_ROOTS: folders.join(path.delimiter),
          DRAWMAN_OUTPUT_DIR: cfg.get("outputDir", "diagrams"),
          DRAWMAN_GITHUB_HOST: cfg.get("githubHost", "github.com"),
          DRAWMAN_ALLOW_CLONE: cfg.get("allowRemoteClone", true) ? "1" : "0",
        }
        const baseUrl = cfg.get<string>("llm.baseUrl", "")
        const key = await context.secrets.get(SECRET)
        if (baseUrl && key) {
          Object.assign(env, {
            DRAWMAN_LLM_URL: baseUrl,
            DRAWMAN_LLM_KEY: key,
            DRAWMAN_LLM_MODEL: cfg.get("llm.model", "gpt-4.1"),
            DRAWMAN_LLM_KEY_HEADER: cfg.get("llm.keyHeader", "Authorization"),
          })
        }
        const profile = cfg.get<string>("profile", "")
        if (profile) env.DRAWMAN_PROFILE = path.resolve(folders[0] ?? "", profile)
        const definition = new vscode.McpStdioServerDefinition("Drawman", process.execPath, [server, "mcp"], env, version)
        if (folders[0]) definition.cwd = vscode.Uri.file(folders[0])
        return [definition]
      },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("drawman")) changed.fire() }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()),
    context.secrets.onDidChange((e) => { if (e.key === SECRET) changed.fire() }),

    vscode.commands.registerCommand("drawman.drawWorkspace", () => openChat(
      "Use the Drawman analyze_repository tool on \".\" and draw the architecture of this workspace, then summarise it citing the interface numbers.",
    )),
    vscode.commands.registerCommand("drawman.design", async () => {
      const ask = await vscode.window.showInputBox({
        title: "Design an architecture",
        prompt: "What should the diagram show?",
        placeHolder: "e.g. an event-driven document pipeline on GCP with Document AI and BigQuery",
      })
      if (ask) await openChat(`Use the Drawman create_architecture_diagram tool: ${ask}`)
    }),
    vscode.commands.registerCommand("drawman.setApiKey", async () => {
      const key = await vscode.window.showInputBox({ title: "LLM API key for repository analysis", password: true, ignoreFocusOut: true })
      if (!key) return
      await context.secrets.store(SECRET, key)
      if (!vscode.workspace.getConfiguration("drawman").get("llm.baseUrl")) {
        void vscode.window.showInformationMessage("Key stored. Set Drawman › Llm: Base Url to use it.", "Open settings")
          .then((pick) => pick && vscode.commands.executeCommand("workbench.action.openSettings", "drawman.llm"))
      }
    }),
    vscode.commands.registerCommand("drawman.clearApiKey", () => context.secrets.delete(SECRET)),
  )
}

async function openChat(query: string) {
  await vscode.commands.executeCommand("workbench.action.chat.open", { query, mode: "agent" })
}

export function deactivate() {}
