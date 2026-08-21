/**
 * Packages that cannot go into the desktop server bundle and therefore ship as
 * real directories under desktop-server/node_modules.
 *
 * Two reasons a package lands here:
 *   1. native addon (.node / .dylib / .dll) — esbuild cannot inline those
 *   2. reads sibling assets or spawns child processes relative to __dirname,
 *      which breaks as soon as the code moves into a bundle
 *
 * Everything else is bundled. Keep this list as short as possible: each entry
 * drags its whole transitive tree back into the shipped file count.
 */

/** esbuild `external` patterns (supports a single trailing wildcard). */
export const BUNDLE_EXTERNALS = [
  // Native: ONNX inference for local embeddings
  "onnxruntime-node",
  // Native: transformers.js loads onnxruntime + wasm backends by path
  "@huggingface/transformers",
  // Native: image decoding
  "sharp",
  "@img/*",
  // Native: SQLite / libSQL client bindings
  "libsql",
  "@libsql/*",
  // Native: fastembed tokenizers
  "@anush008/*",
  // Native: local llama.cpp inference
  "node-llama-cpp",
  "@node-llama-cpp/*",
  // Native: napi-rs helpers pulled in by crawlee's file store
  "@napi-rs/*",
  "@reflink/*",
  // Optional browser automation; never bundled, resolved only when used
  "playwright",
  "playwright-core",
  // Optional native canvas behind jsdom
  "canvas",
  // jsdom spawns ./xhr-sync-worker.js as a child process and reads
  // browser/default-stylesheet.css relative to __dirname. Both break when
  // bundled. It must NOT be aliased either: @crawlee/jsdom pins a nested
  // jsdom 26 for ResourceLoader while the hoisted copy is 29.
  "jsdom",
];

/**
 * Extra seeds for staging desktop-server/node_modules, unioned with the packages
 * esbuild reports as external in the built bundle. Those reported names are the
 * authoritative list; this covers the ones no static import reaches, because
 * something requires them lazily at runtime.
 *
 * Wildcards are dropped: the dependency walk reaches concrete platform packages
 * (e.g. @img/sharp-darwin-arm64) through their parents' optionalDependencies.
 */
export const RUNTIME_TREE_SEEDS = BUNDLE_EXTERNALS.filter(
  (name) => !name.includes("*"),
);
