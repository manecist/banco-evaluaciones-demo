import { existsSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const docsDir = fileURLToPath(new URL("../../docs", import.meta.url));

/**
 * Vacía docs/ antes de compilar el demo, pero conserva las capturas de
 * pantalla que usa el README (docs/capturas). Equivale a emptyOutDir: true
 * con una excepción.
 */
function cleanDocs(keep: string[]): Plugin {
  return {
    name: "clean-docs",
    apply: "build",
    buildStart() {
      if (!existsSync(docsDir)) return;
      for (const entry of readdirSync(docsDir)) {
        if (!keep.includes(entry)) rmSync(`${docsDir}/${entry}`, { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    // Rutas relativas: el demo funciona en cualquier subruta (p. ej. GitHub Pages /banco-evaluaciones-demo/).
    base: demo ? "./" : "/",
    plugins: [react(), ...(demo ? [cleanDocs(["capturas"])] : [])],
    // En el demo, public-demo/ aporta .nojekyll para GitHub Pages.
    publicDir: demo ? "public-demo" : "public",
    optimizeDeps: { exclude: ["@electric-sql/pglite"] },
    server: { proxy: { "/api": "http://localhost:3000" } },
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 4000,
      outDir: demo ? docsDir : "dist",
      emptyOutDir: !demo, // en el demo lo hace cleanDocs (conserva docs/capturas)
    },
  };
});
