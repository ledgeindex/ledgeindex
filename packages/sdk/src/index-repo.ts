import { indexRepoCheckout } from "@ledgeindex/repo";
import { getStore } from "@ledgeindex/docs/runtime/db/index.js";
import { markSourceAsRepository } from "@ledgeindex/docs/runtime/services/source-kind.js";
import { defaultWebCrawlConfig } from "./crawl.js";
import { createWebCrawlSource, listSources, resolveSourceRef } from "./sources.js";
import type { LedgeIndexIndexRepoOptions, LedgeIndexIndexRepoResult } from "./types.js";

function repoNameFromUrl(url: string): string {
  const parts = url.replace(/\.git$/, "").split("/").filter(Boolean);
  return parts.slice(-2).join("/") || "repo";
}

export async function indexRepository(
  options: LedgeIndexIndexRepoOptions,
): Promise<LedgeIndexIndexRepoResult> {
  const githubUrl = options.githubUrl?.trim() || undefined;
  const checkoutPath = options.checkoutPath?.trim() || undefined;
  if (!githubUrl && !checkoutPath) {
    throw new Error("indexRepo needs githubUrl or checkoutPath");
  }

  const name =
    options.name?.trim() ||
    (githubUrl ? repoNameFromUrl(githubUrl) : "repo");

  let source;
  if (options.source) {
    const resolved = await resolveSourceRef(options.source);
    source = await getStore().getSource(resolved.sourceId);
    if (!source) {
      throw new Error(`Source not found: ${options.source}`);
    }
  } else {
    const sources = await listSources();
    const needle = name.toLowerCase();
    const existing = sources.find(
      (row) =>
        row.slug.toLowerCase() === needle ||
        row.name.toLowerCase() === needle,
    );
    if (existing) {
      source = await getStore().getSource(existing.id);
    } else {
      const startUrl = githubUrl ?? checkoutPath!;
      source = await createWebCrawlSource({
        name,
        config: defaultWebCrawlConfig(startUrl),
      });
    }
  }

  if (!source) {
    throw new Error("Failed to resolve source for repo index");
  }

  const result = await indexRepoCheckout({
    sourceId: source.id,
    projectId: source.projectId,
    checkoutPath,
    githubUrl: githubUrl ?? null,
    ref: options.ref ?? null,
    sourceSlug: source.slug,
    maxFiles: options.maxFiles,
    includeTests: options.includeTests,
    includeReadme: options.includeReadme,
    extensions: options.extensions,
    onProgress: options.onProgress,
  });

  await markSourceAsRepository(source.id);

  return {
    sourceId: source.id,
    slug: source.slug,
    name: source.name,
    ...result,
  };
}
