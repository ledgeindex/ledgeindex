/** v1 allowlist — JS/TS/MD only (matches AG Brain reference plan). */
export const REPO_INDEXABLE_EXTENSIONS = [
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".md",
] as const;

export const REPO_SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  "vendor",
  "__pycache__",
]);

/** Mastra recursive chunk language for an indexable relative path. */
export type RepoChunkLanguage = "js" | "ts" | "markdown";

export function isRepoIndexableFile(relativePath: string): boolean {
  const lower = relativePath.replace(/\\/g, "/").toLowerCase();
  return REPO_INDEXABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function repoChunkLanguageForFile(
  relativePath: string,
): RepoChunkLanguage | null {
  if (!isRepoIndexableFile(relativePath)) return null;
  const lower = relativePath.replace(/\\/g, "/").toLowerCase();
  if (lower.endsWith(".ts")) return "ts";
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return "js";
  }
  if (lower.endsWith(".md")) return "markdown";
  return null;
}

export function contentTypeForRepoFile(relativePath: string): string {
  const language = repoChunkLanguageForFile(relativePath);
  switch (language) {
    case "ts":
      return "text/typescript";
    case "js":
      return "text/javascript";
    case "markdown":
      return "text/markdown";
    default:
      return "text/plain";
  }
}
