#!/usr/bin/env node
import { spawn } from "node:child_process"

const VERSION = "0.2.0"
const pkg = process.env.DRAWMAN_PACKAGE || `drawman@${VERSION}`
const win = process.platform === "win32"
const args = ["--yes", `--package=${pkg}`, "--", "drawman", "mcp"]
const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)
// Windows: run npx.cmd through cmd.exe explicitly (spawning .cmd files needs a shell; shell:true is deprecated).
const [cmd, argv, opts] = win
  ? [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${["npx", ...args].map(quote).join(" ")}"`], { windowsVerbatimArguments: true }]
  : ["npx", args, {}]
const child = spawn(cmd, argv, {
  ...opts,
  stdio: "inherit",
  env: { ...process.env, npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" },
})
const forward = (signal) => () => child.kill(signal)
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, forward(s))
child.on("error", (error) => {
  process.stderr.write(`drawman: could not start npx (${error.message}). Node.js 20+ with npm is required.\n`)
  process.exit(1)
})
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
