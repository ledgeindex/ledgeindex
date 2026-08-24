#!/usr/bin/env node
/**
 * Build + stage the desktop server runtime for electron-builder.
 *
 * Output:
 *   apps/desktop/build/desktop-server/
 *     server.cjs    — the whole server bundled into one file
 *     start.cjs     — standalone launcher (smoke + manual debugging)
 *     node_modules/ — only the packages that cannot be bundled
 *
 * Everything importable is bundled, so node_modules holds native addons plus
 * jsdom instead of the full production tree. That is what keeps the shipped file
 * count in the thousands: codesign and notarization walk every single file.
 *
 * The remaining tree still needs real resolution semantics, because native
 * packages carry their own transitive deps and peer/ESM pairings. The walker
 * below resolves each dependency from its consumer's directory (Node's real
 * algorithm via createRequire) and seeds from the externals list.
 */
import { spawn, execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUNDLE_FILE,
  START_FILE,
  bundleDesktopServer,
} from "./bundle-desktop-server.mjs";
import { RUNTIME_TREE_SEEDS, OPTIONAL_RUNTIME_PACKAGES } from "./desktop-server-externals.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const hostDir = join(root, "hosts", "desktop-server");
const dest = join(root, "apps", "desktop", "build", "desktop-server");

/**
 * LedgeIndex-only module roots for rare fallbacks when createRequire fails.
 * Parent monorepo node_modules is intentionally last-resort only — hoisted
 * pindownai versions often break ESM peer pairings for packages resolved
 * inside ledgeindex/.
 */
const LEDGEINDEX_FALLBACK_ROOTS = [root, join(root, "node_modules")];
const PARENT_FALLBACK_ROOTS = [
  join(root, ".."),
  join(root, "..", "node_modules"),
];

/** Prefer monorepo package sources over stale nested copies under node_modules. */
const WORKSPACE_PACKAGE_DIRS = {
  "@ledgeindex/core": join(root, "packages", "core"),
  "@ledgeindex/repo": join(root, "packages", "repo"),
  "@ledgeindex/docs": join(root, "packages", "docs"),
  "@ledgeindex/profile": join(root, "packages", "profile"),
  "@ledgeindex/ag": join(root, "packages", "ag"),
  "@ledgeindex/server": join(root, "packages", "server"),
  "@ledgeindex/model": join(root, "packages", "model"),
  "@ledgeindex/client": join(root, "packages", "client"),
  "@ledgeindex/desktop-server": hostDir,
};

const BUILD_ORDER = [
  "@ledgeindex/core",
  "@ledgeindex/repo",
  "@ledgeindex/docs",
  "@ledgeindex/profile",
  "@ledgeindex/ag",
  "@ledgeindex/server",
  "@ledgeindex/desktop-server",
];

const SKIP_PACKAGES = new Set([
  // Never ship tooling accidentally pulled via optional/peer graphs
  "typescript",
  "tsx",
  "esbuild",
  "@esbuild/win32-x64",
  "@esbuild/darwin-arm64",
  "@esbuild/darwin-x64",
  "@esbuild/linux-x64",
  "electron",
  "electron-builder",
  "electron-vite",
  "vite",
  "prettier",
  "eslint",
  // Browser WASM runtime — Node sidecar uses onnxruntime-node only.
  // (@huggingface/transformers lists both; shipping web adds ~90MB for nothing.)
  "onnxruntime-web",
]);

const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

/**
 * Deprecated Node builtins that still have npm packages. Under Electron/Node 22,
 * `require('punycode/')` (used by tr46) needs the npm package — not the builtin.
 * Do not skip packing these when they appear as real dependencies.
 */
const NPM_SHADOWED_BUILTINS = new Set(["punycode", "domain"]);

function isSkippedBuiltin(depName) {
  if (!depName) return false;
  const bare = depName.startsWith("node:") ? depName.slice("node:".length) : depName;
  if (NPM_SHADOWED_BUILTINS.has(bare)) return false;
  return NODE_BUILTINS.has(depName) || depName.startsWith("node:");
}

const SMOKE_PORT = 3098;
const SMOKE_TIMEOUT_MS = 90_000;

function log(...args) {
  console.log("[pack-desktop-server]", ...args);
}

function realPathOrSelf(dir) {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

function buildWorkspaces() {
  if (process.env.PACK_DESKTOP_SERVER_SKIP_BUILD === "1") {
    log("skipping workspace builds (PACK_DESKTOP_SERVER_SKIP_BUILD=1)");
    return;
  }
  for (const ws of BUILD_ORDER) {
    log("build", ws);
    execSync(`npm run build -w ${ws}`, {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      },
    });
  }
}

/** Clear stage dir; on Windows EBUSY, rename aside so packing can proceed. */
function clearDest() {
  if (!existsSync(dest)) return;
  try {
    rmSync(dest, { recursive: true, force: true });
    return;
  } catch (err) {
    const stale = `${dest}.stale-${Date.now()}`;
    log(
      `rmSync busy (${err instanceof Error ? err.message : err}); renaming → ${relative(root, stale)}`,
    );
    try {
      renameSync(dest, stale);
    } catch (renameErr) {
      throw new Error(
        `Cannot clear staged desktop-server at ${dest} (busy). ` +
          `Stop any running sidecar/Electron using it, then retry. ` +
          `(${renameErr instanceof Error ? renameErr.message : renameErr})`,
      );
    }
    setTimeout(() => {
      try {
        rmSync(stale, { recursive: true, force: true });
      } catch {
        // leave stale dir for a later pack / manual cleanup
      }
    }, 0);
  }
}

/**
 * Walk up from a resolved file/dir until we find package.json with matching name.
 */
function findPackageRootFromPath(startPath, expectedName) {
  let dir = startPath;
  while (dir && dir !== dirname(dir)) {
    const pkgJson = join(dir, "package.json");
    if (existsSync(pkgJson)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJson, "utf8"));
        if (pkg.name === expectedName) return dir;
      } catch {
        // keep walking
      }
    }
    dir = dirname(dir);
  }
  return null;
}

/**
 * Manual path search used only when createRequire cannot resolve a package.
 * Prefers ledgeindex roots; parent monorepo is last resort.
 */
function findPackageDirFallback(name, extraBases = []) {
  const workspaceDir = WORKSPACE_PACKAGE_DIRS[name];
  if (workspaceDir && existsSync(join(workspaceDir, "package.json"))) {
    return workspaceDir;
  }

  const rel = join("node_modules", ...name.split("/"));
  const bases = [
    ...extraBases,
    ...LEDGEINDEX_FALLBACK_ROOTS,
    ...PARENT_FALLBACK_ROOTS,
  ];
  for (const base of bases) {
    const candidates = [
      join(base, rel),
      join(base, "node_modules", ...name.split("/")),
    ];
    for (const dir of candidates) {
      if (existsSync(join(dir, "package.json"))) return dir;
    }
  }
  return null;
}

/**
 * Resolve `name` the same way Node would from `fromDir`.
 * Uses createRequire(…/package.json); falls back when exports block package.json.
 *
 * Always climb to the package root whose package.json.name matches. Some
 * packages (notably @modelcontextprotocol/sdk) export a nested stub
 * `dist/cjs/package.json` with only `{ "type": "commonjs" }` — resolving
 * `${name}/package.json` lands there, which has no dependencies and would
 * leave packages like `eventsource` out of the staged tree.
 */
function resolvePackageDir(name, fromDir) {
  const workspaceDir = WORKSPACE_PACKAGE_DIRS[name];
  if (workspaceDir && existsSync(join(workspaceDir, "package.json"))) {
    return workspaceDir;
  }

  const req = createRequire(join(fromDir, "package.json"));
  try {
    const resolved = dirname(req.resolve(`${name}/package.json`));
    return findPackageRootFromPath(resolved, name) || resolved;
  } catch {
    // Many packages omit "./package.json" from "exports".
    try {
      const entry = req.resolve(name);
      const rootDir = findPackageRootFromPath(entry, name);
      if (rootDir) return rootDir;
    } catch {
      // fall through
    }
  }

  return findPackageDirFallback(name, [fromDir]);
}
/**
 * Prefer installs hoisted under ledgeindex/node_modules over nested copies
 * under packages/* or hosts/* (those often pin alternate majors).
 */
function flatWinnerScore(realDir) {
  const normalized = realDir.replace(/\\/g, "/").toLowerCase();
  const hoistedRoot = realPathOrSelf(join(root, "node_modules"))
    .replace(/\\/g, "/")
    .toLowerCase();
  if (normalized === hoistedRoot || normalized.startsWith(`${hoistedRoot}/`)) {
    const rest = normalized.slice(hoistedRoot.length);
    // True hoist: ledgeindex/node_modules/<pkg> — no further node_modules
    if (!rest.includes("/node_modules/")) return 300;
    return 100;
  }
  if (
    normalized.includes("/packages/") ||
    normalized.includes("/hosts/") ||
    normalized.includes("/apps/")
  ) {
    return 10;
  }
  // Parent monorepo or elsewhere — last resort
  return 1;
}

/**
 * Walk production deps starting at the bundle externals.
 * Each dependency is resolved from its consumer's directory (createRequire).
 *
 * After the walk, pick one flat install per package name (prefer ledgeindex
 * hoists), and nest alternate realpaths under consumers that need them —
 * but only when that consumer is the canonical flat install of its name
 * (avoids polluting top-level cheerio with deps from a nested cheerio copy).
 *
 * @param {string[]} seeds package names the bundle requires at runtime
 * @returns {{ flat: Map<string, string>, nested: Array<{ parentName: string, name: string, srcDir: string }>, unresolvedSeeds: Set<string> }}
 */
function collectProductionPackages(seeds) {
  /**
   * @typedef {{ consumerName: string, consumerDir: string, realDir: string }} Resolution
   * @type {Map<string, Resolution[]>}
   */
  const resolutions = new Map();
  /** Walk each physical install dir once (name may appear at multiple paths). */
  const walkedDirs = new Set();

  /** @type {Array<{ name: string, dir: string }>} */
  const queue = [];

  const record = (depName, consumerName, consumerDir, realDir) => {
    const list = resolutions.get(depName) || [];
    list.push({ consumerName, consumerDir, realDir });
    resolutions.set(depName, list);
  };

  // Seed from the packages the bundle keeps external. Resolve each from the
  // host first so nested pins win over the monorepo hoist when both exist.
  /** @type {Set<string>} */
  const unresolvedSeeds = new Set();

  for (const name of seeds) {
    const pkgDir =
      resolvePackageDir(name, hostDir) ?? resolvePackageDir(name, root);
    if (!pkgDir) {
      // Not installed anywhere: optional natives (bufferutil, pg-native) and
      // opt-in extras (playwright, canvas). Recorded so the integrity check can
      // tell "never installed" apart from "installed but dropped while packing".
      unresolvedSeeds.add(name);
      log(`external not installed, skipping: ${name}`);
      continue;
    }
    const realDir = realPathOrSelf(pkgDir);
    record(name, "(externals)", hostDir, realDir);
    if (!walkedDirs.has(realDir)) {
      walkedDirs.add(realDir);
      queue.push({ name, dir: realDir });
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(current.dir, "package.json"), "utf8"));
    } catch {
      continue;
    }

    const deps = {
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    };

    for (const depName of Object.keys(deps || {})) {
      if (!depName || SKIP_PACKAGES.has(depName)) continue;
      if (isSkippedBuiltin(depName)) continue;

      const pkgDir = resolvePackageDir(depName, current.dir);
      if (!pkgDir) {
        // Optional native bindings / platform packages may be absent.
        continue;
      }

      const realDir = realPathOrSelf(pkgDir);
      record(depName, current.name, current.dir, realDir);

      if (!walkedDirs.has(realDir)) {
        walkedDirs.add(realDir);
        queue.push({ name: depName, dir: realDir });
      }
    }
  }

  /** @type {Map<string, string>} */
  const flat = new Map();
  /** @type {Array<{ parentName: string, name: string, srcDir: string }>} */
  const nested = [];
  const nestedKeys = new Set();

  for (const [name, entries] of resolutions) {
    let best = entries[0].realDir;
    let bestScore = flatWinnerScore(best);
    for (const entry of entries) {
      const score = flatWinnerScore(entry.realDir);
      if (score > bestScore) {
        best = entry.realDir;
        bestScore = score;
      }
    }
    flat.set(name, best);
  }

  /**
   * If a consumer isn't the flat canonical install of its name (e.g. nested
   * cheerio or @ai-sdk/google under a workspace), nest alternate deps under
   * the innermost flat package that contains that consumer dir — matching
   * sibling layouts like packages/core/node_modules/@ai-sdk/{google,provider-utils}.
   */
  function innermostFlatAncestor(consumerDir) {
    const child = realPathOrSelf(consumerDir).replace(/\\/g, "/").toLowerCase();
    let bestName = null;
    let bestLen = -1;
    for (const [pkgName, pkgDir] of flat) {
      const parent = realPathOrSelf(pkgDir).replace(/\\/g, "/").toLowerCase();
      if (child === parent) continue;
      if (!child.startsWith(`${parent}/`)) continue;
      if (parent.length > bestLen) {
        bestLen = parent.length;
        bestName = pkgName;
      }
    }
    return bestName;
  }

  // Nest alternate versions under the right parent so Node keeps pairings.
  for (const [name, entries] of resolutions) {
    const winner = flat.get(name);
    if (!winner) continue;
    for (const entry of entries) {
      if (realPathOrSelf(entry.realDir) === realPathOrSelf(winner)) continue;
      if (entry.consumerName === "(externals)") continue;

      const parentFlat = flat.get(entry.consumerName);
      const parentIsFlatCanonical =
        Boolean(parentFlat) &&
        realPathOrSelf(parentFlat) === realPathOrSelf(entry.consumerDir);

      let nestParent = null;
      if (parentIsFlatCanonical) {
        nestParent = entry.consumerName;
      } else {
        const ancestor = innermostFlatAncestor(entry.consumerDir);
        // Only nest under workspace ancestors. Non-workspace packages keep the
        // nested node_modules from cpSync; adding siblings there shadows other
        // deps (e.g. entities@6 under @crawlee/utils breaks htmlparser2).
        if (ancestor && WORKSPACE_PACKAGE_DIRS[ancestor]) {
          nestParent = ancestor;
        }
      }
      if (!nestParent) continue;

      // Non-workspace nest parent: only add when the nested dep is missing in
      // the source install (never overwrite cpSync nested trees).
      if (!WORKSPACE_PACKAGE_DIRS[nestParent]) {
        const parentSrc = flat.get(nestParent);
        if (!parentSrc) continue;
        const alreadyNested = join(
          parentSrc,
          "node_modules",
          ...name.split("/"),
          "package.json",
        );
        if (existsSync(alreadyNested)) continue;
      }

      const nestKey = `${nestParent}\0${name}\0${entry.realDir}`;
      if (nestedKeys.has(nestKey)) continue;
      nestedKeys.add(nestKey);
      nested.push({
        parentName: nestParent,
        name,
        srcDir: entry.realDir,
      });
    }
  }

  // Safety net: tr46 does `require('punycode/')` which needs the npm package.
  ensureNpmPunycodeForTr46(flat, nested);

  return { flat, nested, unresolvedSeeds };
}

/**
 * If tr46 was collected, ensure punycode is available flat (or nested under tr46)
 * so Electron/Node 22 can resolve the npm package instead of the deprecated builtin.
 */
function ensureNpmPunycodeForTr46(flat, nested) {
  if (!flat.has("tr46")) return;
  if (flat.has("punycode")) return;

  const nestedUnderTr46 = nested.some(
    (n) => n.parentName === "tr46" && n.name === "punycode",
  );
  if (nestedUnderTr46) return;

  const tr46Dir = flat.get("tr46");
  const fromDirs = [tr46Dir, hostDir, ...LEDGEINDEX_FALLBACK_ROOTS].filter(
    Boolean,
  );
  let punyDir = null;
  for (const fromDir of fromDirs) {
    punyDir = resolvePackageDir("punycode", fromDir);
    if (punyDir) break;
  }
  if (!punyDir) {
    punyDir = findPackageDirFallback("punycode", fromDirs);
  }
  if (!punyDir) {
    log(
      "warning: tr46 is staged but npm punycode could not be resolved — " +
        "sidecar may fail under Electron with Cannot find module 'punycode/'",
    );
    return;
  }

  flat.set("punycode", realPathOrSelf(punyDir));
  log(`ensured npm punycode for tr46 ← ${relative(root, punyDir)}`);
}

/**
 * node-llama-cpp ships one package per os/arch/accelerator and declares no
 * os/cpu fields, so npm installs all 14 variants (~666MB) on every platform.
 * Keep the one this build actually runs on.
 *
 * CUDA and Vulkan stay out by default: they add ~600MB for hardware most users
 * do not have. Set LEDGEINDEX_PACK_GPU_BACKENDS=1 to ship them.
 */
const LLAMA_OS_BY_PLATFORM = { win32: "win", darwin: "mac", linux: "linux" };
const LLAMA_GPU_SUFFIXES = new Set(["cuda", "cuda-ext", "vulkan"]);

function shouldSkipPlatformPackage(name) {
  const scope = "@node-llama-cpp/";
  if (!name.startsWith(scope)) return false;

  const os = LLAMA_OS_BY_PLATFORM[process.platform];
  if (!os) return false;

  const variant = name.slice(scope.length);
  const prefix = `${os}-${process.arch}`;
  if (!variant.startsWith(prefix)) return true;

  // "" (plain) and "metal" are the baseline builds for their platform.
  const accelerator = variant.slice(prefix.length).replace(/^-/, "");
  if (LLAMA_GPU_SUFFIXES.has(accelerator)) {
    return process.env.LEDGEINDEX_PACK_GPU_BACKENDS !== "1";
  }
  return false;
}

function destPathForPackage(name) {
  return join(dest, "node_modules", ...name.split("/"));
}

function destPathForNestedPackage(parentName, name) {
  return join(destPathForPackage(parentName), "node_modules", ...name.split("/"));
}

function isWorkspacePackage(name, srcDir) {
  const expected = WORKSPACE_PACKAGE_DIRS[name];
  if (!expected) return false;
  try {
    return realpathSync(expected) === realpathSync(srcDir);
  } catch {
    return false;
  }
}

/**
 * Filter files while copying a single package into the stage.
 * Per-platform builds (Windows CI vs macOS CI) only keep THIS host's natives —
 * Mac shipping is unaffected; the Mac job packs darwin binaries separately.
 */
function packageCopyFilter(src) {
  const base = src.replace(/\\/g, "/");
  // Transformers.js downloads models into package-local .cache at runtime —
  // never ship a developer's HF cache (can be >1GB of .onnx weights).
  if (base.includes("/.cache/") || base.endsWith("/.cache")) return false;

  // Drop nested onnx runtimes copied inside other packages (esp.
  // @huggingface/transformers). We stage a single flat onnxruntime-node;
  // keeping the nested copy duplicated ~200MB and re-introduced every OS.
  // Do NOT strip all nested node_modules — packages like htmlparser2/entities
  // need nested version pins.
  if (
    /\/node_modules\/(?:@[^/]+\/)?[^/]+\/node_modules\/onnxruntime-(?:node|web)(\/|$)/.test(
      base,
    )
  ) {
    return false;
  }

  // onnxruntime-node layout: bin/napi-v6/{darwin,linux,win32}/{arm64,x64}/...
  // Older filter expected bin/win32 and never matched, so all OSes shipped.
  const native = base.match(
    /\/onnxruntime-node\/bin\/(?:[^/]+\/)*(darwin|linux|win32)(?:\/(arm64|arm|x64|ia32))?(\/|$)/,
  );
  if (native) {
    const os = native[1];
    const arch = native[2];
    if (os !== process.platform) return false;
    if (arch && arch !== process.arch) return false;
  }
  return true;
}

/** Workspace packages: ship package.json + dist only (not src / local node_modules). */
function copyWorkspacePackage(srcDir, target) {
  mkdirSync(target, { recursive: true });
  cpSync(join(srcDir, "package.json"), join(target, "package.json"));
  const dist = join(srcDir, "dist");
  if (!existsSync(dist)) {
    throw new Error(
      `Workspace package at ${srcDir} has no dist/ — run its build before packing`,
    );
  }
  cpSync(dist, join(target, "dist"), { recursive: true });
}

function copyPackageTree(name, srcDir, target) {
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
  if (isWorkspacePackage(name, srcDir)) {
    copyWorkspacePackage(srcDir, target);
  } else {
    cpSync(srcDir, target, {
      recursive: true,
      dereference: true,
      filter: packageCopyFilter,
    });
  }
}

function copyCollectedPackages(flat, nested) {
  const nm = join(dest, "node_modules");
  mkdirSync(nm, { recursive: true });

  let copied = 0;
  let skippedPlatform = 0;
  for (const [name, srcDir] of flat) {
    if (shouldSkipPlatformPackage(name)) {
      skippedPlatform += 1;
      continue;
    }
    copyPackageTree(name, srcDir, destPathForPackage(name));
    copied += 1;
  }
  if (skippedPlatform > 0) {
    log(`skipped ${skippedPlatform} off-platform / opt-in GPU packages`);
  }

  let nestedCopied = 0;
  for (const { parentName, name, srcDir } of nested) {
    // Never nest browser/native onnx duplicates — flat onnxruntime-node is enough.
    if (name === "onnxruntime-web" || name === "onnxruntime-node") {
      log(`skip nested ${name} under ${parentName} (use flat onnxruntime-node)`);
      continue;
    }
    if (shouldSkipPlatformPackage(name)) continue;
    // Ensure parent exists (workspace packages are copied without node_modules).
    const parentTarget = destPathForPackage(parentName);
    if (!existsSync(parentTarget)) {
      log(`skip nested ${name} under missing parent ${parentName}`);
      continue;
    }
    copyPackageTree(name, srcDir, destPathForNestedPackage(parentName, name));
    nestedCopied += 1;
  }

  log(`copied ${copied} packages → node_modules (${nestedCopied} nested conflicts)`);
}

function writeRuntimePackageJson() {
  const hostPkg = JSON.parse(
    readFileSync(join(hostDir, "package.json"), "utf8"),
  );
  const runtimePkg = {
    name: "ledgeindex-desktop-server-runtime",
    version: hostPkg.version || "0.0.0",
    private: true,
    // server.cjs / start.cjs carry their format in the extension; the externals
    // each declare their own. Anything unmarked here is CommonJS.
    type: "commonjs",
    description: "Packaged desktop server (bundle + unbundlable externals)",
    main: `./${BUNDLE_FILE}`,
  };
  writeFileSync(
    join(dest, "package.json"),
    `${JSON.stringify(runtimePkg, null, 2)}\n`,
  );
}

/**
 * Fail fast if the bundle is missing or the tree regrew past the externals.
 *
 * @param {string[]} externals package names the bundle imports at runtime
 * @param {Set<string>} unresolvedSeeds externals that are not installed at all
 */
function assertStagedIntegrity(externals, unresolvedSeeds) {
  for (const file of [BUNDLE_FILE, START_FILE, "package.json"]) {
    if (!existsSync(join(dest, file))) {
      throw new Error(`pack integrity: staged runtime is missing ${file}`);
    }
  }

  // Every external the bundle imports has to be on disk next to it — unless it
  // is not installed at all, which is how optional native accelerators behave
  // (bufferutil for ws, pg-native, encoding). Those are required in a try/catch
  // and have JS fallbacks, and if they are absent here they were absent in dev
  // too, so nothing regressed.
  //
  // What this does catch is a package that resolves in dev but never got staged.
  // The smoke test cannot: it copies the tree to tmp, but a junction-based run
  // resolves from the realpath and silently falls back to the monorepo hoist,
  // which is how a missing @libsql/client shipped.
  const missing = externals.filter(
    (name) =>
      !OPTIONAL_RUNTIME_PACKAGES.has(name) &&
      !unresolvedSeeds.has(name) &&
      !existsSync(join(destPathForPackage(name), "package.json")),
  );
  if (missing.length > 0) {
    throw new Error(
      `pack integrity: these resolve in dev but were not staged: ${missing.join(", ")}`,
    );
  }

  // The whole point of bundling: workspace packages must not be on disk.
  // If they reappear, something slipped back into the externals list.
  const stagedWorkspaceDir = join(dest, "node_modules", "@ledgeindex");
  if (existsSync(stagedWorkspaceDir)) {
    throw new Error(
      `pack integrity: @ledgeindex packages must be bundled, not staged: ${stagedWorkspaceDir}`,
    );
  }

  // Size / platform integrity
  if (existsSync(destPathForPackage("onnxruntime-web"))) {
    throw new Error(
      "pack integrity: onnxruntime-web must not be staged (Node uses onnxruntime-node)",
    );
  }

  const ortBin = join(destPathForPackage("onnxruntime-node"), "bin");
  if (existsSync(ortBin)) {
    const foreign = [];
    const walk = (dir) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          if (
            (ent.name === "darwin" || ent.name === "linux" || ent.name === "win32") &&
            ent.name !== process.platform
          ) {
            foreign.push(relative(ortBin, p));
            continue;
          }
          walk(p);
        }
      }
    };
    walk(ortBin);
    if (foreign.length > 0) {
      throw new Error(
        `pack integrity: onnxruntime-node still has foreign OS natives: ${foreign.join(", ")}`,
      );
    }
  }

  const hfNestedOrt = join(
    destPathForPackage("@huggingface/transformers"),
    "node_modules",
    "onnxruntime-node",
  );
  if (existsSync(hfNestedOrt)) {
    throw new Error(
      "pack integrity: nested onnxruntime-node under @huggingface/transformers must not be staged",
    );
  }
}

/**
 * Link (or copy) the staged tree outside the monorepo so Node cannot walk up
 * into ledgeindex/node_modules during smoke — that hoist was masking missing
 * packages like eventsource.
 */
/**
 * Copy — do not link. Node resolves modules from a file's realpath, so running
 * the tree through a junction still walks up into the monorepo node_modules and
 * finds packages the staged tree is missing. That is how a missing
 * @libsql/client passed the smoke and only failed in the packaged app.
 */
function prepareIsolatedSmokeDir() {
  const smokeRoot = mkdtempSync(join(tmpdir(), "ledgeindex-desktop-smoke-"));
  const smokeDir = join(smokeRoot, "desktop-server");
  log("smoke: copying staged tree to a temp dir for real isolation…");
  cpSync(dest, smokeDir, { recursive: true, dereference: true });
  return { smokeRoot, smokeDir };
}

function cleanupIsolatedSmokeDir(smokeRoot) {
  try {
    rmSync(smokeRoot, { recursive: true, force: true });
  } catch {
    // best-effort; the OS clears tmp eventually
  }
}

/**
 * Smoke: boot the staged launcher and hit /health.
 * Runs from an isolated temp dir so parent monorepo hoists cannot mask a
 * missing external — that hoist used to hide gaps like eventsource.
 */
async function smokeStagedServer() {
  if (process.env.PACK_DESKTOP_SERVER_SKIP_SMOKE === "1") {
    log("skipping smoke test (PACK_DESKTOP_SERVER_SKIP_SMOKE=1)");
    return;
  }

  const { request } = await import("node:http");
  const { smokeRoot, smokeDir } = prepareIsolatedSmokeDir();

  log(
    `smoke: spawning node ${START_FILE} (PORT=${SMOKE_PORT}, isolated=${smokeDir})…`,
  );

  const child = spawn(process.execPath, [START_FILE], {
    cwd: smokeDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      // Clear NODE_PATH so nothing outside the staged tree is injected.
      NODE_PATH: "",
      PORT: String(SMOKE_PORT),
      HOST: "127.0.0.1",
      // Avoid clobbering a developer's real data dir during pack smoke.
      LEDGEINDEX_DATA_DIR: join(smokeDir, `.smoke-data-${process.pid}`),
      LEDGEINDEX_AUTH_REQUIRED: "0",
      LEDGEINDEX_LOCAL_USER_ID: "ledgeindex-pack-smoke",
      LEDGEINDEX_PROFILES: process.env.LEDGEINDEX_PROFILES?.trim() || "docs,profile",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    stdout += text;
    for (const line of text.trimEnd().split(/\r?\n/)) {
      if (line.trim()) log("smoke:out", line);
    }
  });
  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    stderr += text;
    for (const line of text.trimEnd().split(/\r?\n/)) {
      if (line.trim()) log("smoke:err", line);
    }
  });

  const killChild = () => {
    if (child.exitCode !== null || child.killed) return;
    if (process.platform === "win32" && child.pid) {
      try {
        execSync(`taskkill /pid ${child.pid} /T /F`, {
          stdio: "ignore",
          windowsHide: true,
        });
        return;
      } catch {
        // fall through
      }
    }
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  };

  const probeHealth = (path) =>
    new Promise((resolve) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: SMOKE_PORT,
          path,
          method: "GET",
          timeout: 1500,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });

  const deadline = Date.now() + SMOKE_TIMEOUT_MS;
  let healthy = false;

  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        const tail = (stderr || stdout).trim().slice(-2000);
        throw new Error(
          `smoke failed: staged server exited early (code ${child.exitCode})\n${tail}`,
        );
      }

      if ((await probeHealth("/health")) || (await probeHealth("/health/packages"))) {
        healthy = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    if (!healthy) {
      const tail = (stderr || stdout).trim().slice(-2000);
      throw new Error(
        `smoke failed: /health not ready within ${SMOKE_TIMEOUT_MS}ms` +
          (tail ? `\n${tail}` : " (no server output)"),
      );
    }

    log(`smoke ok — http://127.0.0.1:${SMOKE_PORT}/health`);
  } finally {
    killChild();
    // Brief wait so Windows releases file handles before next pack.
    await new Promise((r) => setTimeout(r, 500));
    cleanupIsolatedSmokeDir(smokeRoot);
  }
}

async function main() {
  buildWorkspaces();

  clearDest();
  mkdirSync(dest, { recursive: true });
  writeRuntimePackageJson();

  const { externals } = await bundleDesktopServer(dest);

  // Stagehand + playwright-core JS are staged; Chromium is not (first-use CDN).
  const seeds = [
    ...new Set([
      ...externals.filter((name) => !OPTIONAL_RUNTIME_PACKAGES.has(name)),
      ...RUNTIME_TREE_SEEDS,
    ]),
  ].sort();

  log("collecting externals dependency tree (per-consumer resolve)…");
  const { flat, nested, unresolvedSeeds } = collectProductionPackages(seeds);
  log(
    `resolved ${flat.size} flat packages, ${nested.length} nested conflicts`,
  );
  copyCollectedPackages(flat, nested);

  assertStagedIntegrity(externals, unresolvedSeeds);

  log("staged", relative(root, dest));
  await smokeStagedServer();

  // Every platform ships this directory as-is (afterPack copies it into
  // Resources). No archive, no first-launch extraction.
  function countFiles(dir) {
    let n = 0;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) n += countFiles(p);
      else n += 1;
    }
    return n;
  }
  const sizeMb = (dirSize(dest) / (1024 * 1024)).toFixed(0);
  log(`runtime ready: ${countFiles(dest)} files, ${sizeMb} MB`);
}

function dirSize(dir) {
  let bytes = 0;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) bytes += dirSize(p);
    else {
      try {
        bytes += statSync(p).size;
      } catch {
        // races with antivirus scanners on Windows; size is informational
      }
    }
  }
  return bytes;
}

main().catch((err) => {
  console.error("[pack-desktop-server]", err instanceof Error ? err.message : err);
  process.exit(1);
});
