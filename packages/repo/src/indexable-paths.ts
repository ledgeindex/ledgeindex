/**
 * JS/TS family. Python and Go are deliberately absent: Mastra's chunker
 * supports both, but indexing sibling SDK ports alongside a TS codebase buries
 * the TS source under near-duplicate ports of the same API.
 */
export const REPO_CODE_EXTENSIONS = [
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
] as const;

/** Prose that ships inside the repo — chunked as markdown, not as code. */
export const REPO_DOC_EXTENSIONS = [".md", ".mdx"] as const;

export const REPO_INDEXABLE_EXTENSIONS = [
  ...REPO_CODE_EXTENSIONS,
  ...REPO_DOC_EXTENSIONS,
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
  ".yarn",
  ".pnpm-store",
  "out",
  ".output",
  ".nuxt",
  ".svelte-kit",
  ".vercel",
  ".netlify",
  "target",
  ".gradle",
  ".venv",
  "venv",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "__snapshots__",
  "storybook-static",
  ".idea",
]);

/**
 * Directory names that describe repo layout rather than a topic. Stripped
 * before deriving facets so `packages/sdk-ts/src/act.ts` files under `sdk-ts`
 * instead of under `packages` along with everything else.
 */
const GENERIC_REPO_DIRS = new Set([
  "packages",
  "apps",
  "libs",
  "lib",
  "src",
  "source",
  "sources",
  "modules",
  "internal",
]);

const TEST_DIR_SEGMENTS = new Set([
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "e2e",
  "eval",
  "evals",
  "fixtures",
  "__fixtures__",
  "__mocks__",
  "mocks",
  "testdata",
  "benchmark",
  "benchmarks",
  "bench",
]);

const EXAMPLE_DIR_SEGMENTS = new Set([
  "example",
  "examples",
  "demo",
  "demos",
  "sample",
  "samples",
  "cookbook",
  "recipes",
]);

const DOC_DIR_SEGMENTS = new Set([
  "docs",
  "doc",
  "documentation",
  "website",
]);

/** `foo.test.ts`, `foo-spec.js`, `foo_bench.mts`, `foo.e2e.tsx`. */
const TEST_FILE_RE = /[._-](test|spec|bench|e2e)\.[cm]?[jt]sx?$/i;
/** Bare `test.ts` / `spec.js` entry files. */
const TEST_BASENAME_RE = /^(test|tests|spec|specs)\.[cm]?[jt]sx?$/i;
const CONFIG_FILE_RE =
  /(^|[.-])config\.[cm]?[jt]sx?$|^\.?(eslintrc|prettierrc|babelrc)/i;

export type RepoChunkLanguage = "js" | "ts" | "markdown";
export type RepoChunkStrategy = "recursive" | "semantic-markdown";
export type RepoPageKind = "source" | "test" | "example" | "docs" | "config";

export type RepoPathOptions = {
  /**
   * Index test, eval, fixture, and mock files. Off by default: on a typical
   * SDK repo these outnumber the real source and answer questions with
   * assertion scaffolding instead of the API.
   */
  includeTests?: boolean;
  /**
   * Index `.md` / `.mdx` files (README, changelogs, in-repo prose). Off by
   * default — code-only retrieval for implementation questions.
   */
  includeReadme?: boolean;
  /**
   * Optional extension allowlist — narrows the default JS/TS (+ md/mdx when
   * `includeReadme`) set. Values like `"ts"` or `".tsx"` are fine. Unknown
   * extensions are ignored; an empty result after filtering throws.
   */
  extensions?: readonly string[];
};

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function pathSegments(relativePath: string): string[] {
  return normalizeRelativePath(relativePath).split("/").filter(Boolean);
}

function hasExtension(
  relativePath: string,
  extensions: readonly string[],
): boolean {
  const lower = normalizeRelativePath(relativePath).toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

const INDEXABLE_EXTENSION_SET = new Set<string>(
  REPO_INDEXABLE_EXTENSIONS.map((ext) => ext.toLowerCase()),
);

/**
 * Normalize user input (`"ts"`, `".TSX"`) to a subset of
 * {@link REPO_INDEXABLE_EXTENSIONS}. Returns `undefined` when the caller did
 * not request a filter (use the full default allowlist).
 */
export function resolveRepoExtensions(
  extensions: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!extensions || extensions.length === 0) return undefined;

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of extensions) {
    let ext = String(raw).trim().toLowerCase();
    if (!ext) continue;
    if (!ext.startsWith(".")) ext = `.${ext}`;
    if (!INDEXABLE_EXTENSION_SET.has(ext) || seen.has(ext)) continue;
    seen.add(ext);
    out.push(ext);
  }

  if (out.length === 0) {
    throw new Error(
      `No supported file extensions in [${extensions.join(", ")}]. Supported: ${REPO_INDEXABLE_EXTENSIONS.join(", ")}`,
    );
  }
  return out;
}

export function isRepoAllowlistedExtension(
  relativePath: string,
  extensions?: readonly string[],
): boolean {
  return hasExtension(
    relativePath,
    extensions && extensions.length > 0
      ? extensions
      : REPO_INDEXABLE_EXTENSIONS,
  );
}

export function isRepoDocFile(relativePath: string): boolean {
  return hasExtension(relativePath, REPO_DOC_EXTENSIONS);
}

export function isRepoCodeFile(relativePath: string): boolean {
  return hasExtension(relativePath, REPO_CODE_EXTENSIONS);
}

/** Test, eval, fixture, mock, or benchmark file — by directory or filename. */
export function isRepoTestPath(relativePath: string): boolean {
  const segments = pathSegments(relativePath);
  const fileName = segments.at(-1) ?? "";
  const dirs = segments.slice(0, -1);

  if (dirs.some((dir) => TEST_DIR_SEGMENTS.has(dir.toLowerCase()))) return true;
  if (TEST_FILE_RE.test(fileName)) return true;
  if (TEST_BASENAME_RE.test(fileName)) return true;
  return false;
}

/** Coarse role of a file, stored on every chunk so retrieval can weight it. */
export function repoPageKind(relativePath: string): RepoPageKind {
  const segments = pathSegments(relativePath);
  const fileName = segments.at(-1) ?? "";
  const dirs = segments.slice(0, -1).map((dir) => dir.toLowerCase());

  if (isRepoTestPath(relativePath)) return "test";
  if (dirs.some((dir) => EXAMPLE_DIR_SEGMENTS.has(dir))) return "example";
  if (isRepoDocFile(relativePath)) return "docs";
  if (dirs.some((dir) => DOC_DIR_SEGMENTS.has(dir))) return "docs";
  if (CONFIG_FILE_RE.test(fileName)) return "config";
  return "source";
}

export function isRepoIndexableFile(
  relativePath: string,
  options?: RepoPathOptions,
): boolean {
  if (!isRepoAllowlistedExtension(relativePath, options?.extensions)) {
    return false;
  }
  const includeTests = options?.includeTests ?? false;
  const includeReadme = options?.includeReadme ?? false;
  if (!includeTests && isRepoTestPath(relativePath)) return false;
  if (!includeReadme && isRepoDocFile(relativePath)) return false;
  return true;
}

export function repoChunkLanguageForFile(
  relativePath: string,
): RepoChunkLanguage | null {
  const lower = normalizeRelativePath(relativePath).toLowerCase();
  if (isRepoDocFile(lower)) return "markdown";
  if (/\.(ts|mts|cts|tsx)$/.test(lower)) return "ts";
  if (/\.(js|mjs|cjs|jsx)$/.test(lower)) return "js";
  return null;
}

/**
 * Markdown in a repo gets the same header-aware chunker as crawled docs.
 * Only code goes through the smaller recursive window.
 */
export function repoChunkStrategyForFile(
  relativePath: string,
): RepoChunkStrategy {
  return isRepoDocFile(relativePath) ? "semantic-markdown" : "recursive";
}

export function contentTypeForRepoFile(relativePath: string): string {
  const lower = normalizeRelativePath(relativePath).toLowerCase();
  if (lower.endsWith(".mdx")) return "text/mdx";
  if (lower.endsWith(".md")) return "text/markdown";
  switch (repoChunkLanguageForFile(lower)) {
    case "ts":
      return "text/typescript";
    case "js":
      return "text/javascript";
    default:
      return "text/plain";
  }
}

/**
 * Facets for chunk metadata. Without these, every chunk in a GitHub-hosted
 * repo derives the same `category`/`section` from the owner and repo segments
 * of the blob URL, which makes both fields useless for filtering.
 */
export function repoPathFacets(relativePath: string): {
  category: string;
  section: string;
} {
  const segments = pathSegments(relativePath);
  const dirs = segments.slice(0, -1);
  const meaningful = dirs.filter(
    (dir) => !GENERIC_REPO_DIRS.has(dir.toLowerCase()),
  );

  return {
    category: meaningful[0] ?? "root",
    section: meaningful[1] ?? meaningful[0] ?? repoPageKind(relativePath),
  };
}
