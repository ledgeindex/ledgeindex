import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  isRepoAllowlistedExtension,
  isRepoDocFile,
  isRepoIndexableFile,
  isRepoTestPath,
  resolveRepoExtensions,
  REPO_SKIP_DIR_NAMES,
  type RepoPathOptions,
} from "./indexable-paths.js";

export type WalkRepoOptions = RepoPathOptions & {
  /** Max files to return (default 2000). */
  maxFiles?: number;
};

export type WalkRepoResult = {
  files: string[];
  /** Files dropped because they are tests, evals, fixtures, or mocks. */
  skippedTests: number;
  /** Files dropped because they are .md / .mdx and includeReadme is off. */
  skippedReadme: number;
  /** Files dropped because the extension is not on the allowlist. */
  skippedExtension: number;
  /** True when `maxFiles` cut the walk short. */
  truncated: boolean;
};

/**
 * Depth-first walk of a local checkout. Returns posix-relative paths that pass
 * the indexable allowlist, plus counts for what was dropped so callers can
 * report why a repo produced fewer pages than the file tree suggests.
 */
export function walkRepoFiles(
  checkoutPath: string,
  options?: WalkRepoOptions,
): WalkRepoResult {
  const maxFiles = options?.maxFiles ?? 2000;
  const includeTests = options?.includeTests ?? false;
  const includeReadme = options?.includeReadme ?? false;
  const extensions = resolveRepoExtensions(options?.extensions);
  const pathOptions = { includeTests, includeReadme, extensions };
  const root = checkoutPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const files: string[] = [];
  let skippedTests = 0;
  let skippedReadme = 0;
  let skippedExtension = 0;
  let truncated = false;

  function walk(absDir: string, relDir: string): void {
    if (files.length >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
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
      if (!isRepoIndexableFile(rel, pathOptions)) {
        if (isRepoAllowlistedExtension(rel, extensions) && isRepoTestPath(rel)) {
          skippedTests += 1;
        } else if (
          isRepoAllowlistedExtension(rel, extensions) &&
          isRepoDocFile(rel)
        ) {
          skippedReadme += 1;
        } else {
          skippedExtension += 1;
        }
        continue;
      }
      try {
        const st = statSync(join(absDir, name));
        if (!st.isFile()) continue;
      } catch {
        continue;
      }
      files.push(rel.replace(/\\/g, "/"));
    }
  }

  walk(root, "");
  return { files, skippedTests, skippedReadme, skippedExtension, truncated };
}

export function listRepoIndexableFiles(
  checkoutPath: string,
  options?: WalkRepoOptions,
): string[] {
  return walkRepoFiles(checkoutPath, options).files;
}
