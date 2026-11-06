import { resolve } from "node:path"
import { defineConfig } from "vite"

export default defineConfig({
  root: resolve(import.meta.dirname, "src/host/web"),
  build: { outDir: resolve(import.meta.dirname, "dist/web"), emptyOutDir: true },
})
