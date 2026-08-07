#!/usr/bin/env node
/**
 * Build + stage @ledgeindex/desktop-server for electron-builder extraResources.
 *
 * Output: apps/desktop/build/desktop-server/{dist/start.js,package.json,node_modules}
 * Spawned in prod as: ELECTRON_RUN_AS_NODE=1 <electron> dist/start.js
 * with cwd = resources/desktop-server
 *
 * Copies a production dependency tree from the monorepo install (walk of
 * package.json dependencies), including workspace packages and native addons.
 */
import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const hostDir = join(root, "hosts", "desktop-server");
const dest = join(root, "apps", "desktop", "build", "desktop-server");
/** Public CI uses ledgeindex/node_modules; local pindownai hoists to ../node_modules. */
const moduleRoots = [
  root,
  join(root, "node_modules"),
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
]);

const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

function log(...args) {
  console.log("[pack-desktop-server]", ...args);
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

/**
 * Locate an installed package dir without require.resolve(package.json) —
 * many packages omit "./package.json" from "exports" and that path fails.
 */
function findPackageDir(name, searchRoots) {
  const workspaceDir = WORKSPACE_PACKAGE_DIRS[name];
  if (workspaceDir && existsSync(join(workspaceDir, "package.json"))) {
    return workspaceDir;
  }

  const rel = join("node_modules", ...name.split("/"));
  for (const base of searchRoots) {
    const candidates = [
      join(base, rel),
      // When base is already a package dir, also check its nested node_modules
      join(base, "node_modules", ...name.split("/")),
    ];
    for (const dir of candidates) {
      const pkgJson = join(dir, "package.json");
      if (existsSync(pkgJson)) return dir;
    }
  }
  return null;
}

/**
 * Walk production deps starting at @ledgeindex/desktop-server.
 * Maps package name → real filesystem directory.
 */
function collectProductionPackages() {
  /** @type {Map<string, string>} */
  const seen = new Map();
  // Seed host from its source dir (may not be linked under ledgeindex/node_modules).
  seen.set("@ledgeindex/desktop-server", realpathSync(hostDir));
  const hostPkg = JSON.parse(
    readFileSync(join(hostDir, "package.json"), "utf8"),
  );
  const queue = Object.keys({
    ...hostPkg.dependencies,
    ...hostPkg.optionalDependencies,
  });

  while (queue.length > 0) {
    const name = queue.pop();
    if (!name || seen.has(name) || SKIP_PACKAGES.has(name)) continue;
    if (NODE_BUILTINS.has(name) || name.startsWith("node:")) continue;

    const searchRoots = [
      hostDir,
      ...moduleRoots,
      ...seen.values(),
    ];
    const pkgDir = findPackageDir(name, searchRoots);
    if (!pkgDir) {
      // Optional native bindings / platform packages may be absent.
      continue;
    }

    let realDir;
    try {
      realDir = realpathSync(pkgDir);
    } catch {
      realDir = pkgDir;
    }
    seen.set(name, realDir);

    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(realDir, "package.json"), "utf8"));
    } catch {
      continue;
    }

    const next = {
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    };
    for (const dep of Object.keys(next || {})) {
      if (!seen.has(dep) && !SKIP_PACKAGES.has(dep)) queue.push(dep);
    }
  }

  return seen;
}

function destPathForPackage(name) {
  return join(dest, "node_modules", ...name.split("/"));
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

function copyCollectedPackages(packages) {
  const nm = join(dest, "node_modules");
  mkdirSync(nm, { recursive: true });

  let copied = 0;
  for (const [name, srcDir] of packages) {
    if (name === "@ledgeindex/desktop-server") {
      // Host entry is staged as dist/ + package.json at dest root, not under node_modules.
      continue;
    }
    const target = destPathForPackage(name);
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
        filter: (src) => {
          const base = src.replace(/\\/g, "/");
          // Transformers.js downloads models into package-local .cache at runtime —
          // never ship a developer's HF cache (can be >1GB of .onnx weights).
          if (base.includes("/.cache/") || base.endsWith("/.cache")) return false;
          // onnxruntime-node ships all OS natives; keep only this build host.
          const nativeOs = base.match(
            /\/onnxruntime-node\/bin\/(darwin|linux|win32)(\/|$)/,
          );
          if (nativeOs && nativeOs[1] !== process.platform) return false;
          return true;
        },
      });
    }
    copied += 1;
  }
  log(`copied ${copied} packages → node_modules`);
}

function writeRuntimePackageJson() {
  const hostPkg = JSON.parse(
    readFileSync(join(hostDir, "package.json"), "utf8"),
  );
  const runtimePkg = {
    name: "ledgeindex-desktop-server-runtime",
    version: hostPkg.version || "0.0.0",
    private: true,
    type: "module",
    description: "Packaged desktop-server sidecar (electron-builder extraResources)",
    dependencies: hostPkg.dependencies || {},
  };
  writeFileSync(
    join(dest, "package.json"),
    `${JSON.stringify(runtimePkg, null, 2)}\n`,
  );
}

function main() {
  buildWorkspaces();

  const entry = join(hostDir, "dist", "start.js");
  if (!existsSync(entry)) {
    console.error(
      "[pack-desktop-server] Missing hosts/desktop-server/dist/start.js after build",
    );
    process.exit(1);
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(hostDir, "dist"), join(dest, "dist"), { recursive: true });
  writeRuntimePackageJson();

  log("collecting production dependency tree…");
  const packages = collectProductionPackages();
  log(`resolved ${packages.size} packages (incl. host)`);
  copyCollectedPackages(packages);

  if (!existsSync(join(dest, "dist", "start.js"))) {
    console.error("[pack-desktop-server] staging failed: dist/start.js missing");
    process.exit(1);
  }
  if (!existsSync(join(dest, "node_modules", "@ledgeindex", "server"))) {
    console.error(
      "[pack-desktop-server] staging failed: node_modules/@ledgeindex/server missing",
    );
    process.exit(1);
  }

  log("staged", relative(root, dest));
}

main();
