/**
 * Shared tsup options for @ledgeindex/* packages.
 * Transpile src → dist (ESM), keep file layout for deep subpath exports.
 * Same idea as client-js (tsup), but bundle:false so `./runtime/*` etc. stay resolvable.
 */
import { defineConfig, type Options } from "tsup";

export function defineLedgeindexPackageConfig(
  overrides: Options = {},
): ReturnType<typeof defineConfig> {
  return defineConfig({
    entry: [
      "src/**/*.ts",
      "!src/**/*.{test,spec}.ts",
      "!src/**/__tests__/**",
    ],
    format: ["esm"],
    // JS for Node consumers first; dts generation is flaky on this tree (rollup-plugin-dts).
    dts: false,
    sourcemap: true,
    clean: true,
    bundle: false,
    target: "node22",
    outDir: "dist",
    ...overrides,
  });
}
