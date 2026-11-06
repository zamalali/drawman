import { resolve } from "node:path"
import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

export default defineConfig({
  root: resolve(import.meta.dirname, "src/view"),
  plugins: [viteSingleFile()],
  build: { outDir: resolve(import.meta.dirname, "dist/view"), emptyOutDir: true, rollupOptions: { input: resolve(import.meta.dirname, "src/view/view.html") } },
})
