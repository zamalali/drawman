import { cpSync, existsSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = new URL("../", import.meta.url)
const at = (p: string) => fileURLToPath(new URL(p, root))
if (!existsSync(at("dist/view/view.html"))) throw new Error("build the view first (vite build -c vite.view.config.ts)")

const common = { bundle: true, platform: "node", format: "esm", target: "node20", legalComments: "none", logLevel: "warning" } as const

await build({ ...common, entryPoints: [at("src/cli.ts")], outfile: at("dist/cli.js"), packages: "external" })
console.log("dist/cli.js")

if (process.argv.includes("--vscode")) {
  const out = at("vscode/dist")
  mkdirSync(`${out}/view`, { recursive: true })
  await build({
    ...common, entryPoints: [at("src/cli.ts")], outfile: `${out}/server.mjs`, minify: true,
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  })
  await build({
    bundle: true, platform: "node", format: "cjs", target: "node20", logLevel: "warning",
    entryPoints: [at("vscode/src/extension.ts")], outfile: `${out}/extension.js`, external: ["vscode"],
  })
  cpSync(at("dist/view/view.html"), `${out}/view/view.html`)
  console.log("vscode/dist/{server.mjs,extension.js,view/view.html}")
}
