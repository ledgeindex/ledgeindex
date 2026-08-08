import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  isRepoIndexableFile,
  REPO_SKIP_DIR_NAMES,
} from "./indexable-paths.js";

export type WalkRepoOptions = {
  /** Max files to return (default 2000). */
  maxFiles?: number;
};

/**
 * Depth-first walk of a local checkout; returns posix-relative paths that pass
 * the v1 indexable allowlist (skips .git, node_modules, etc.).
 */
export function listRepoIndexableFiles(
  checkoutPath: string,
  options?: WalkRepoOptions,
): string[] {
  const maxFiles = options?.maxFiles ?? 2000;
  const root = checkoutPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const results: string[] = [];

  function walk(absDir: string, relDir: string): void {
    if (results.length >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      const name = entry.name;
      if (name === "." || name === "..") continue;
      if (entry.isDirectory()) {
        if (REPO_SKIP_DIR_NAMES.has(name)) continue;
        const childRel = relDir ? `${relDir}/${name}` : name;
        walk(join(absDir, name), childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relDir ? `${relDir}/${name}` : name;
      if (!isRepoIndexableFile(rel)) continue;
      try {
        const st = statSync(join(absDir, name));
        if (!st.isFile()) continue;
      } catch {
        continue;
      }
      results.push(rel.replace(/\\/g, "/"));
    }
  }

  walk(root, "");
  return results;
}
