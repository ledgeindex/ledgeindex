export type DocsPathKind =
  | "guides"
  | "api"
  | "examples"
  | "reference"
  | "home"
  | "other";

export type DocsPathEntry = {
  kind: DocsPathKind;
  url: string;
  label?: string;
};

export type TypescriptDocsCatalogEntry = {
  package: string;
  category: string;
  docs: string | null;
  apiReferenceUrls: string[];
  /**
   * Section roots for crawl (siblings or children of docs).
   * Ingest maps these to LedgeIndex startUrls.
   */
  paths: DocsPathEntry[];
  /** Convenience: paths.map(p => p.url) */
  startUrls: string[];
  pathsStatus?: string | null;
  pathsReason?: string | null;
  /** LedgeIndex crawl excludePatterns (filled by exclude-pattern agent later). */
  excludePatterns: string[];
  patternsAreRegex: boolean;
  /**
   * Available doc versions on the site.
   * Default is ["latest"] when only the current tree exists.
   */
  versions: string[];
  selectedVersion: string;
  docsStatus?: string | null;
  /** True when `docs` HTTP-redirects to a different final URL. */
  isRedirect?: boolean | null;
  /** Final URL after following redirects. */
  finalDocsUrl?: string | null;
  /** Final host is GitHub/npm/etc — not usable as crawl root. */
  redirectUncrawlable?: boolean | null;
  description?: string | null;
  homepage?: string | null;
  github?: string | null;
  downloadsLastMonth?: number | null;
  rank?: number | null;
  /** Domain scored by Open PageRank (from docs URL). */
  docsDomain?: string | null;
  openPageRank?: number | null;
  openPageRankGlobalRank?: number | null;
  referringDomains?: number | null;
  /** 1-based rank when sorted by openPageRank (downloads as tiebreak). */
  oprRank?: number | null;
};

export type TypescriptDocsCatalog = {
  generatedAt: string;
  source: string;
  count: number;
  entries: TypescriptDocsCatalogEntry[];
};

/** Verified/fixed docs that are crawlable (soft same-site redirects OK). */
export function isCatalogEntryCrawlReady(
  entry: TypescriptDocsCatalogEntry,
): boolean {
  const docsUrl = entry.finalDocsUrl || entry.docs;
  if (!docsUrl) return false;
  if (entry.docsStatus !== "verified" && entry.docsStatus !== "fixed") {
    return false;
  }
  // Hard rejects only — GitHub/npm/etc finals. Soft redirects keep finalDocsUrl.
  if (entry.redirectUncrawlable) return false;
  return true;
}

/** Prefer the post-redirect docs URL when the bounce is still crawlable. */
export function effectiveCatalogDocsUrl(
  entry: TypescriptDocsCatalogEntry,
): string | null {
  if (entry.redirectUncrawlable) return entry.docs ?? null;
  return entry.finalDocsUrl || entry.docs || null;
}

function asPathEntries(value: unknown): DocsPathEntry[] {
  if (!Array.isArray(value)) return [];
  const out: DocsPathEntry[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const url = typeof (row as { url?: unknown }).url === "string"
      ? (row as { url: string }).url
      : null;
    if (!url) continue;
    const kindRaw = String((row as { kind?: unknown }).kind || "other");
    const kind = (
      [
        "guides",
        "api",
        "examples",
        "reference",
        "home",
        "other",
      ] as const
    ).includes(kindRaw as DocsPathKind)
      ? (kindRaw as DocsPathKind)
      : "other";
    const label =
      typeof (row as { label?: unknown }).label === "string"
        ? (row as { label: string }).label
        : undefined;
    out.push(label ? { kind, url, label } : { kind, url });
  }
  return out;
}

function asOptionalNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeCatalogEntry(
  entry: TypescriptDocsCatalogEntry,
): TypescriptDocsCatalogEntry {
  const versions =
    Array.isArray(entry.versions) && entry.versions.length > 0
      ? entry.versions
      : ["latest"];
  const selectedVersion = versions.includes(entry.selectedVersion)
    ? entry.selectedVersion
    : versions[0]!;
  const paths = asPathEntries(entry.paths);
  const startUrls =
    Array.isArray(entry.startUrls) && entry.startUrls.length > 0
      ? entry.startUrls.filter(Boolean)
      : paths.map((p) => p.url);
  return {
    ...entry,
    docs: effectiveCatalogDocsUrl(entry) ?? entry.docs,
    apiReferenceUrls: entry.apiReferenceUrls ?? [],
    paths,
    startUrls,
    excludePatterns: entry.excludePatterns ?? [],
    patternsAreRegex: Boolean(entry.patternsAreRegex),
    versions,
    selectedVersion,
    openPageRank: asOptionalNumber(entry.openPageRank),
    openPageRankGlobalRank: asOptionalNumber(entry.openPageRankGlobalRank),
    referringDomains: asOptionalNumber(entry.referringDomains),
    oprRank: asOptionalNumber(entry.oprRank),
    docsDomain: entry.docsDomain ?? null,
  };
}

/**
 * Hand-picked Top 50 for Source updater — frameworks, runtimes, data, UI, and
 * tooling admins usually want first. Order is display priority (not downloads).
 */
export const CURATED_TOP_DOCS_PACKAGES = [
  "typescript",
  "node",
  "bun",
  "deno",
  "react",
  "next",
  "vue",
  "svelte",
  "astro",
  "@angular/core",
  "express",
  "fastify",
  "hono",
  "@nestjs/core",
  "prisma",
  "drizzle-orm",
  "typeorm",
  "kysely",
  "@supabase/supabase-js",
  "graphql",
  "@apollo/client",
  "@trpc/server",
  "axios",
  "tailwindcss",
  "shadcn",
  "@mui/material",
  "lucide-react",
  "zod",
  "valibot",
  "zustand",
  "jotai",
  "@reduxjs/toolkit",
  "react-hook-form",
  "@tanstack/react-query",
  "vite",
  "vitest",
  "esbuild",
  "turbo",
  "storybook",
  "playwright",
  "cypress",
  "jest",
  "eslint",
  "prettier",
  "tsx",
  "lodash",
  "dayjs",
  "@octokit/rest",
  "ai",
  "openai",
] as const;

const CURATED_TOP_DOCS_RANK = new Map(
  CURATED_TOP_DOCS_PACKAGES.map((name, index) => [name, index]),
);

export function isCuratedTopDocsPackage(packageName: string): boolean {
  return CURATED_TOP_DOCS_RANK.has(packageName);
}

export function curatedTopDocsRank(packageName: string): number | null {
  const rank = CURATED_TOP_DOCS_RANK.get(packageName);
  return rank == null ? null : rank + 1;
}

export function compareCuratedTopDocs(
  a: Pick<TypescriptDocsCatalogEntry, "package">,
  b: Pick<TypescriptDocsCatalogEntry, "package">,
): number {
  const aRank = CURATED_TOP_DOCS_RANK.get(a.package);
  const bRank = CURATED_TOP_DOCS_RANK.get(b.package);
  if (aRank != null && bRank != null) return aRank - bRank;
  if (aRank != null) return -1;
  if (bRank != null) return 1;
  return a.package.localeCompare(b.package);
}
