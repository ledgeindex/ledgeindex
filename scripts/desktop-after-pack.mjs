#!/usr/bin/env node
/**
 * electron-builder afterPack: copy the staged desktop server into Resources.
 *
 * This exists because extraResources FileSets drop node_modules, so a
 * `from: build/desktop-server` entry ships a stub and the app starts without a
 * runtime. Copying after pack sidesteps that. Signing stays with
 * electron-builder; this hook only moves files.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const BUNDLE_FILE = "server.cjs";

function assertRuntime(root, label) {
  const bundle = join(root, BUNDLE_FILE);
  if (!existsSync(bundle)) {
    throw new Error(
      `[desktop-after-pack] ${label} has no ${BUNDLE_FILE} at ${bundle}.\n` +
        `Run scripts/pack-desktop-server.mjs first.`,
    );
  }
}

function resolveResourcesDir(context) {
  if (context.electronPlatformName === "darwin") {
    const product = context.packager.appInfo.productFilename;
    return join(context.appOutDir, `${product}.app`, "Contents", "Resources");
  }
  return join(context.appOutDir, "resources");
}

export default async function afterPack(context) {
  const staged = join(context.packager.projectDir, "build", "desktop-server");
  assertRuntime(staged, "staged build/desktop-server");

  const dest = join(resolveResourcesDir(context), "desktop-server");
  rmSync(dest, { recursive: true, force: true });
  cpSync(staged, dest, { recursive: true, dereference: true });
  assertRuntime(dest, "copied Resources/desktop-server");

  console.log("[desktop-after-pack] copied desktop server runtime →", dest);
}
