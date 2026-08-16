#!/usr/bin/env node
/**
 * LedgeIndex package release — one version for every @ledgeindex/* package.
 *
 * Usage (from ledgeindex/):
 *   npm run release:packages -- --check              # report drift, change nothing
 *   npm run release:packages -- --bump patch         # 0.1.5 → 0.1.6 everywhere (no publish)
 *   npm run release:packages -- --bump minor
 *   npm run release:packages -- --version 0.2.0
 *   npm run release:packages -- --bump patch --publish
 *   npm run release:packages -- --bump patch --dry-run
 *
 * Consumers that install from the registry (apps/web, ledgeindex-api) build in Docker
 * with no workspace, so a package change only reaches them once the version is bumped,
 * published, their pin updated, and their standalone lockfile regenerated. Doing any
 * subset of that by hand is what breaks the Cloud Build instead of the local build.
 */
import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const semver = require("semver");

const ledgeRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const monoRoot = path.resolve(ledgeRoot, "..");

/** Published packages, in dependency order — publish order matters. */
const PACKAGES = [
  "core",
  "repo",
  "profile",
  "docs",
  "client",
  "sdk",
  "ag",
  "server",
  "model",
];

/** npm name differs from @ledgeindex/<dir> (CLI publishes as `ledgeindex`). */
const NAMED_PACKAGES = new Map([["ledgeindex", "cli"]]);

/** Private workspace members: npm links these, so a range that merely matches is enough. */
const WORKSPACE_CONSUMERS = [
  "apps/desktop",
  "apps/web",
  "hosts/desktop-server",
  "hosts/ag-server",
  "hosts/api",
];

/**
 * Consumers built outside the workspace from the registry. They pin exact versions and
 * keep a standalone package-lock.json that `npm ci` validates inside Docker.
 */
const REGISTRY_CONSUMERS = [
  path.join(ledgeRoot, "apps/web"),
  path.join(monoRoot, "ledgeindex-api"),
];

const args = process.argv.slice(2).filter((a) => a !== "--");
const dryRun = args.includes("--dry-run");
const doPublish = args.includes("--publish");
const checkOnly = args.includes("--check");
const bumpLevel = argValue("--bump");
const explicitVersion = argValue("--version");

function argValue(flag) {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  const value = args[i + 1];
  return value && !value.startsWith("-") ? value : null;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function packageJsonPath(dir) {
  return path.join(dir, "package.json");
}

function run(command, cwd) {
  execSync(command, { cwd, stdio: "inherit" });
}

const packageDirs = new Map([
  ...PACKAGES.map((name) => [
    `@ledgeindex/${name}`,
    path.join(ledgeRoot, "packages", name),
  ]),
  ...[...NAMED_PACKAGES.entries()].map(([npmName, dirName]) => [
    npmName,
    path.join(ledgeRoot, "packages", dirName),
  ]),
]);

/** Current version of each publishable package, straight from the workspace. */
function workspaceVersions() {
  const versions = new Map();
  for (const [name, dir] of packageDirs) {
    versions.set(name, readJson(packageJsonPath(dir)).version);
  }
  return versions;
}

function nextVersion(versions) {
  if (explicitVersion) {
    if (!semver.valid(explicitVersion)) {
      fail(`--version ${explicitVersion} is not a valid semver version`);
    }
    return explicitVersion;
  }
  const highest = [...versions.values()].sort(semver.rcompare)[0];
  return semver.inc(highest, bumpLevel ?? "patch");
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

/** Every place that names an @ledgeindex/* package, with the range style it needs. */
function allConsumers() {
  const consumers = [];
  for (const dir of packageDirs.values()) {
    consumers.push({ dir, style: "caret" });
  }
  for (const rel of WORKSPACE_CONSUMERS) {
    consumers.push({ dir: path.join(ledgeRoot, rel), style: "caret" });
  }
  for (const dir of REGISTRY_CONSUMERS) {
    consumers.push({ dir, style: "exact" });
  }
  // apps/web is both a workspace member and a registry consumer; exact wins.
  const seen = new Map();
  for (const consumer of consumers) seen.set(consumer.dir, consumer);
  return [...seen.values()];
}

function checkDrift(versions) {
  const problems = [];

  for (const { dir, style } of allConsumers()) {
    const file = packageJsonPath(dir);
    if (!existsSync(file)) continue;
    const pkg = readJson(file);
    const label = path.relative(monoRoot, dir).split(path.sep).join("/");

    for (const key of ["dependencies", "devDependencies"]) {
      for (const [name, range] of Object.entries(pkg[key] ?? {})) {
        const version = versions.get(name);
        if (!version) continue;

        if (style === "exact") {
          if (range !== version) {
            problems.push(
              `${label} pins ${name}@${range} but the workspace is at ${version} — Docker builds get ${range}`,
            );
          }
        } else if (!semver.satisfies(version, range)) {
          problems.push(
            `${label} wants ${name}@${range}, which the workspace ${version} does not satisfy — npm installs a registry copy instead of your source`,
          );
        }
      }
    }
  }

  for (const dir of REGISTRY_CONSUMERS) {
    const lockPath = path.join(dir, "package-lock.json");
    const file = packageJsonPath(dir);
    if (!existsSync(lockPath) || !existsSync(file)) continue;
    const label = path.relative(monoRoot, dir).split(path.sep).join("/");
    const lock = readJson(lockPath);
    const pkg = readJson(file);

    for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
      if (!versions.has(name)) continue;
      const locked = lock.packages?.[`node_modules/${name}`]?.version;
      if (locked && locked !== range) {
        problems.push(
          `${label} lockfile has ${name}@${locked} but package.json asks for ${range} — npm ci will refuse to install`,
        );
      }
    }
  }

  return problems;
}

/** Rewrite every version and every range that names one of our packages. */
function applyVersion(version, versions) {
  const touched = [];

  for (const [name, dir] of packageDirs) {
    const file = packageJsonPath(dir);
    const pkg = readJson(file);
    if (pkg.version !== version) {
      pkg.version = version;
      if (!dryRun) writeJson(file, pkg);
      touched.push(`${name} version → ${version}`);
    }
  }

  // Keep the web app badge (NEXT_PUBLIC_APP_VERSION from apps/web/package.json)
  // in lockstep with published @ledgeindex/* versions.
  const webPkgPath = packageJsonPath(path.join(ledgeRoot, "apps/web"));
  if (existsSync(webPkgPath)) {
    const webPkg = readJson(webPkgPath);
    if (webPkg.version !== version) {
      webPkg.version = version;
      if (!dryRun) writeJson(webPkgPath, webPkg);
      touched.push(`@ledgeindex/web version → ${version}`);
    }
  }

  for (const { dir, style } of allConsumers()) {
    const file = packageJsonPath(dir);
    if (!existsSync(file)) continue;
    const pkg = readJson(file);
    const label = path.relative(monoRoot, dir).split(path.sep).join("/");
    let changed = false;

    for (const key of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(pkg[key] ?? {})) {
        if (!versions.has(name)) continue;
        const wanted = style === "exact" ? version : `^${version}`;
        if (pkg[key][name] !== wanted) {
          touched.push(`${label} ${name} ${pkg[key][name]} → ${wanted}`);
          pkg[key][name] = wanted;
          changed = true;
        }
      }
    }

    if (changed && !dryRun) writeJson(file, pkg);
  }

  return touched;
}

/**
 * Regenerate a consumer's standalone lockfile. Copying to a temp dir first matters:
 * run in place and npm walks up to the workspace root and rewrites the monorepo lock
 * instead of this one.
 */
function regenerateStandaloneLock(dir) {
  const lockPath = path.join(dir, "package-lock.json");
  if (!existsSync(lockPath)) return false;

  const temp = mkdtempSync(path.join(tmpdir(), "ledgeindex-lock-"));
  try {
    copyFileSync(packageJsonPath(dir), packageJsonPath(temp));
    copyFileSync(lockPath, path.join(temp, "package-lock.json"));
    run("npm install --package-lock-only --no-audit --no-fund", temp);
    run("npm ci --dry-run --no-audit --no-fund", temp);
    copyFileSync(path.join(temp, "package-lock.json"), lockPath);
    return true;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const versions = workspaceVersions();

if (checkOnly) {
  const problems = checkDrift(versions);
  console.log("Workspace package versions:");
  for (const [name, version] of versions) console.log(`  ${name}@${version}`);
  if (problems.length === 0) {
    console.log("\n✔ every consumer pin and range is consistent");
    process.exit(0);
  }
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  • ${problem}`);
  process.exit(1);
}

if (!bumpLevel && !explicitVersion) {
  fail("pass --bump <patch|minor|major>, --version <x.y.z>, or --check");
}

const version = nextVersion(versions);
console.log(
  `${dryRun ? "[dry-run] " : ""}releasing every @ledgeindex/* package as ${version}\n`,
);

const touched = applyVersion(version, versions);
if (touched.length === 0) {
  console.log("nothing to change — versions and ranges already match");
} else {
  for (const line of touched) console.log(`  ${line}`);
}

if (dryRun) {
  console.log("\n[dry-run] stopping before lockfiles and publish");
  process.exit(0);
}

console.log("\n→ refreshing the monorepo lockfile");
run("npm install --package-lock-only --no-audit --no-fund", ledgeRoot);

if (!doPublish) {
  console.log(
    "\nDone (no publish). Registry consumers still resolve the previous version until you re-run with --publish.",
  );
  process.exit(0);
}

console.log("\n→ publishing to npm");
run(`node ${path.join(ledgeRoot, "scripts/publish-packages.mjs")}`, ledgeRoot);

console.log("\n→ resyncing standalone consumer lockfiles against the registry");
for (const dir of REGISTRY_CONSUMERS) {
  const label = path.relative(monoRoot, dir).split(path.sep).join("/");
  if (regenerateStandaloneLock(dir)) {
    console.log(`  ${label}/package-lock.json updated`);
  }
}

console.log(`\nDone — everything is on ${version}.`);
