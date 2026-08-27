import type { KapaRetrieveFilter } from "@ledgeindex/core/query/kapa-retrieve.js";
import {
  getResolvedRetrievalSettings,
  runWithRetrievalContext,
} from "@ledgeindex/core/query/rerank-request-context.js";
import type { RerankBackend } from "@ledgeindex/core/query/rerank-backend.js";
import { kapaRetrieveMany, type KapaRetrievedChunk } from "./kapa-retrieve.js";
import {
  maybeFilterRetrievedPages,
  type DroppedRetrievedPage,
} from "./filter-retrieved-pages.js";
import { ensureCatalogHasPages } from "./page-catalog-rebuild.js";
import { getMetadataCatalog } from "./metadata-catalog-store.js";
import { formatCatalogForAgent } from "./search-query-planner.js";
import { rewriteQueries, type RewriteResult } from "./rewrite-queries.js";

export type StructuredRetrieveResult = {
  chunks: KapaRetrievedChunk[];
  insufficient: boolean;
  rewrite: RewriteResult;
  rerankBackendUsed?: RerankBackend;
  relaxedPassUsed: boolean;
  weakEvidenceUsed: boolean;
  droppedPages?: DroppedRetrievedPage[];
  pageFilterUsed?: boolean;
};

/**
 * Default docs retrieval: LlamaIndex-style query generation → hybrid per variant →
 * RRF fuse → rerank on user question.
 */
export async function retrieveWithStructuredRewrite(input: {
  sourceId: string;
  question: string;
  expandPages?: boolean;
  history?: string;
  filter?: KapaRetrieveFilter;
  requestContext?: { get?: (key: string) => unknown };
}): Promise<StructuredRetrieveResult> {
  const settings = getResolvedRetrievalSettings();
  const expandPages = input.expandPages !== false;
  const history = input.history?.trim() || "(no prior messages)";

  const catalogRecord =
    (await ensureCatalogHasPages(input.sourceId)) ??
    (await getMetadataCatalog(input.sourceId));
  const catalogText = formatCatalogForAgent(catalogRecord);

  const rewrite = await rewriteQueries({
    question: input.question,
    catalogText,
    history,
    pages: catalogRecord?.pages,
    requestContext: input.requestContext,
  });

  let relaxedPassUsed = false;
  let weakEvidenceUsed = false;

  let retrieval = await kapaRetrieveMany({
    queries: rewrite.queries,
    question: input.question,
    sourceId: input.sourceId,
    filter: input.filter,
    catalogQueries: rewrite.catalogQueries,
    relevanceThreshold: settings.relevanceThreshold,
    allowWeakEvidence: false,
    expandPages: input.expandPages !== false,
  });

  if (
    retrieval.merged.length === 0 &&
    settings.relaxedThreshold < settings.relevanceThreshold
  ) {
    retrieval = await kapaRetrieveMany({
      queries: rewrite.queries,
      question: input.question,
      sourceId: input.sourceId,
      filter: input.filter,
      catalogQueries: rewrite.catalogQueries,
      relevanceThreshold: settings.relaxedThreshold,
      expandPages: input.expandPages !== false,
    });
    relaxedPassUsed = retrieval.merged.length > 0;
  }

  if (retrieval.merged.length === 0 && settings.includeWeakEvidence) {
    retrieval = await kapaRetrieveMany({
      queries: rewrite.queries,
      question: input.question,
      sourceId: input.sourceId,
      filter: input.filter,
      catalogQueries: rewrite.catalogQueries,
      relevanceThreshold: settings.relevanceThreshold,
      allowWeakEvidence: true,
      expandPages: input.expandPages !== false,
    });
    weakEvidenceUsed = retrieval.merged.length > 0;
  }

  const filtered = await maybeFilterRetrievedPages({
    question: input.question,
    chunks: retrieval.merged,
    catalogQueries: rewrite.catalogQueries,
    requestContext: input.requestContext,
    relaxedPassUsed,
    weakEvidenceUsed,
  });

  return {
    chunks: filtered.kept,
    insufficient: filtered.kept.length === 0,
    rewrite,
    rerankBackendUsed: retrieval.rerankBackendUsed,
    relaxedPassUsed,
    weakEvidenceUsed,
    droppedPages: filtered.dropped,
    pageFilterUsed: filtered.usedFilter,
  };
}

export async function retrieveWithStructuredRewriteInContext(
  input: {
    sourceId: string;
    question: string;
    expandPages?: boolean;
    history?: string;
    filter?: KapaRetrieveFilter;
    requestContext?: { get?: (key: string) => unknown };
  },
  retrievalContext: Parameters<typeof runWithRetrievalContext>[0],
): Promise<StructuredRetrieveResult> {
  return runWithRetrievalContext(retrievalContext, () =>
    retrieveWithStructuredRewrite(input),
  );
}
