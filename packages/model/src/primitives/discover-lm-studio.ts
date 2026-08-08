/**
 * Scan LM Studio's local model cache for `.gguf` files.
 *
 *   npx tsx src/primitives/discover-lm-studio.ts
 *   npx tsx src/primitives/discover-lm-studio.ts --root "D:\lmstudio-models"
 */
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { flagString, parseArgs } from "../cli-args.js";
import type { DiscoverLmStudioOptions, LmStudioModelDescriptor } from "../types.js";
import { formatBytes, isMainModule } from "../utils.js";

const QUANT_PATTERN =
  /(?:^|[-_.])((?:Q\d+(?:_[A-Z0-9]+)*)|(?:IQ\d+(?:_[A-Z0-9]+)*)|BF16|F16|F32)(?:[-_.]|$)/i;

export function defaultLmStudioModelsRoot(): string {
  return path.join(homedir(), ".lmstudio", "models");
}

function isMmprojFile(fileName: string): boolean {
  return fileName.toLowerCase().startsWith("mmproj");
}

function parseQuant(fileName: string): string | undefined {
  const match = QUANT_PATTERN.exec(fileName);
  return match?.[1]?.toUpperCase();
}

/**
 * LM Studio stores models under `<root>/<publisher>/<repo>/<file>.gguf`.
 * Use the immediate parent directory name as a best-effort "family" label,
 * falling back to the grandparent (`publisher`) directory when the file sits
 * directly under the scan root.
 */
function parseFamily(root: string, filePath: string): string | undefined {
  const relativeDir = path.dirname(path.relative(root, filePath));
  if (!relativeDir || relativeDir === ".") return undefined;
  const segments = relativeDir.split(path.sep).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : undefined;
}

function findSiblingMmproj(filePath: string): string | undefined {
  const dir = path.dirname(filePath);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const match = entries.find(
    (entry) => entry.isFile() && isMmprojFile(entry.name) && entry.name.toLowerCase().endsWith(".gguf"),
  );
  return match ? path.join(dir, match.name) : undefined;
}

function walkGgufFiles(root: string): string[] {
  const results: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(".gguf")) continue;
      if (isMmprojFile(entry.name)) continue;
      results.push(full);
    }
  }

  return results;
}

function buildDescriptor(root: string, filePath: string): LmStudioModelDescriptor {
  const stats = fs.statSync(filePath);
  const fileName = path.basename(filePath);
  const nameWithoutExt = fileName.replace(/\.gguf$/i, "");
  const relativeId = path.relative(root, filePath).replace(/\.gguf$/i, "").split(path.sep).join("/");

  return {
    id: relativeId || nameWithoutExt,
    name: nameWithoutExt,
    path: filePath,
    bytes: stats.size,
    quant: parseQuant(fileName),
    family: parseFamily(root, filePath),
    mmprojPath: findSiblingMmproj(filePath),
  };
}

/** Recursively scan `~/.lmstudio/models` (or `options.roots`) for `.gguf` model files. */
export function discoverLmStudioModels(options: DiscoverLmStudioOptions = {}): LmStudioModelDescriptor[] {
  const roots = options.roots?.length ? options.roots : [defaultLmStudioModelsRoot()];

  const seen = new Set<string>();
  const descriptors: LmStudioModelDescriptor[] = [];

  for (const root of roots) {
    const absoluteRoot = path.resolve(root);
    if (!fs.existsSync(absoluteRoot)) continue;

    for (const filePath of walkGgufFiles(absoluteRoot)) {
      const resolved = path.resolve(filePath);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      descriptors.push(buildDescriptor(absoluteRoot, resolved));
    }
  }

  return descriptors.sort((a, b) => b.bytes - a.bytes);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rootFlag = flagString(args, "root", "");
  const models = discoverLmStudioModels(rootFlag ? { roots: [rootFlag] } : {});

  console.log(`Scanned    : ${rootFlag || defaultLmStudioModelsRoot()}`);
  console.log(`Found      : ${models.length} model(s)`);
  for (const model of models) {
    console.log(`  - ${model.id} (${formatBytes(model.bytes)}${model.quant ? `, ${model.quant}` : ""})`);
    console.log(`      path   : ${model.path}`);
    if (model.family) console.log(`      family : ${model.family}`);
    if (model.mmprojPath) console.log(`      mmproj : ${model.mmprojPath}`);
  }
  console.log(JSON.stringify(models, null, 2));
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
