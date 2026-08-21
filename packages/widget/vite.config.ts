import { defineConfig } from "vite";
import { resolve } from "node:path";

/** Single IIFE for CDN — no React; marked + speed-highlight only. */
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/cdn-entry.ts"),
      name: "LedgeIndexWidget",
      formats: ["iife"],
      fileName: () => "ledgeindex-widget.bundle.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: "esbuild",
    cssCodeSplit: false,
    target: "es2020",
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
