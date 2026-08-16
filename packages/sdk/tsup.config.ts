import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  bundle: true,
  splitting: false,
  dts: true,
  external: [/^@ledgeindex\//, /^@mastra\//],
});
