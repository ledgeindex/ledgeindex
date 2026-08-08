import type { ExampleKind } from "../enrich/schemas.js";
import type { ApiResponseMeta } from "../enrich/api-response-meta.js";
import {
  formatExampleCatalogText,
  type ExampleCatalog,
} from "./example-catalog.js";
import { getExampleCatalog } from "./example-catalog-store.js";
import {
  queryExamples,
  type QueryExamplesHit,
} from "./query-examples.js";
import { rewriteExampleQueries } from "./rewrite-example-queries.js";

export type FoundExample = {
  title: string;
  kind: ExampleKind | string;
  language: string | null;
  section: string;
  body: string;
  url: string;
  score: number;
  exampleIndex: number;
  pageSummary?: string;
  apiResponse?: ApiResponseMeta | null;
};

export type FindExamplesSearchAttempt = {
  query: string;
  initialCount: number;
  rerankedCount: number;
  directHitCount: number;
  directHitScores: number[];
  insufficient: boolean;
  relaxedPassUsed: boolean;
};

export type FindExamplesRetrievalMeta = {
  question: string;
  rewrittenQueries: string[];
  rewriteMethod: "llm" | "fallback" | "skipped";
  insufficient: boolean;
  relaxedPassUsed: boolean;
  maxChunkScore?: number;
  avgTop3Score?: number;
  searchAttempts: FindExamplesSearchAttempt[];
  chunks: Array<{
    text: string;
    url: string;
    title: string;
    score: number;
    category: string;
    section: string;
  }>;
};

export type FindExamplesInput = {
  sourceId: string;
  query: string;
  /** Optional hard filter; otherwise rewrite may infer. */
  kind?: ExampleKind;
  language?: string;
  topK?: number;
  history?: string;
  /** Skip LLM rewrite (tests / already-keyword queries). */
  skipRewrite?: boolean;
  /** Inject catalog (tests). */
  catalog?: ExampleCatalog | null;
};

export type FindExamplesResult = {
  examples: FoundExample[];
  rewrittenQueries: string[];
  rewriteMethod: "llm" | "fallback" | "skipped";
  exampleKind?: ExampleKind;
  language?: string;
  retrieval: FindExamplesRetrievalMeta;
};

function dedupeHits(hits: QueryExamplesHit[]): QueryExamplesHit[] {
  const seen = new Set<string>();
  const out: QueryExamplesHit[] = [];
  for (const hit of hits) {
    const key = `${hit.url}::${hit.exampleIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

function toFound(hit: QueryExamplesHit): FoundExample {
  return {
    title: hit.title,
    kind: hit.kind,
    language: hit.language,
    section: hit.section,
    body: hit.body,
    url: hit.url,
    score: hit.score,
    exampleIndex: hit.exampleIndex,
    ...(hit.pageSummary ? { pageSummary: hit.pageSummary } : {}),
    ...(hit.apiResponse ? { apiResponse: hit.apiResponse } : {}),
  };
}

function avgTop3(scores: number[]): number | undefined {
  if (scores.length === 0) return undefined;
  const top = [...scores].sort((a, b) => b - a).slice(0, 3);
  return top.reduce((sum, score) => sum + score, 0) / top.length;
}

/**
 * Rewrite against the example catalog, then wide-vector → rerank → threshold
 * (same stages as docs kapaRetrieve, examples-only).
 */
export async function findExamples(
  input: FindExamplesInput,
): Promise<FindExamplesResult> {
  const topK = input.topK ?? 8;
  const catalog =
    input.catalog === undefined
      ? await getExampleCatalog(input.sourceId)
      : input.catalog;

  const catalogText = catalog
    ? formatExampleCatalogText(catalog)
    : "(no indexed examples yet)";

  let rewrittenQueries = [input.query.trim()].filter(Boolean);
  let rewriteMethod: FindExamplesResult["rewriteMethod"] = "skipped";
  let inferredKind = input.kind;
  let inferredLanguage = input.language?.trim().toLowerCase();

  if (!input.skipRewrite && rewrittenQueries.length > 0) {
    const rewritten = await rewriteExampleQueries({
      question: input.query,
      catalogText,
      history: input.history,
    });
    rewrittenQueries = rewritten.queries;
    rewriteMethod = rewritten.method;
    if (!inferredKind && rewritten.exampleKind) {
      inferredKind = rewritten.exampleKind;
    }
    if (!inferredLanguage && rewritten.language) {
      inferredLanguage = rewritten.language;
    }
  }

  const collected: QueryExamplesHit[] = [];
  const searchAttempts: FindExamplesSearchAttempt[] = [];

  for (const q of rewrittenQueries) {
    const result = await queryExamples({
      sourceId: input.sourceId,
      query: q,
      topK,
      ...(inferredKind ? { exampleKind: inferredKind } : {}),
      ...(inferredLanguage ? { language: inferredLanguage } : {}),
    });
    collected.push(...result.hits);
    searchAttempts.push({
      query: result.query,
      initialCount: result.initialCount,
      rerankedCount: result.rerankedCount,
      directHitCount: result.directHitCount,
      directHitScores: result.directHitScores,
      insufficient: result.insufficient,
      relaxedPassUsed: result.relaxedPassUsed,
    });
  }

  const examples = dedupeHits(collected)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(toFound);

  const scores = examples.map((ex) => ex.score);
  const maxChunkScore = scores.length > 0 ? Math.max(...scores) : undefined;
  const avgTop3Score = avgTop3(scores);
  const relaxedPassUsed = searchAttempts.some((a) => a.relaxedPassUsed);

  const retrieval: FindExamplesRetrievalMeta = {
    question: input.query,
    rewrittenQueries,
    rewriteMethod,
    insufficient: examples.length === 0,
    relaxedPassUsed,
    ...(typeof maxChunkScore === "number" ? { maxChunkScore } : {}),
    ...(typeof avgTop3Score === "number" ? { avgTop3Score } : {}),
    searchAttempts,
    chunks: examples.map((ex) => ({
      text: ex.body.slice(0, 500),
      url: ex.url,
      title: ex.title,
      score: ex.score,
      category: String(ex.kind),
      section: ex.section,
    })),
  };

  return {
    examples,
    rewrittenQueries,
    rewriteMethod,
    ...(inferredKind ? { exampleKind: inferredKind } : {}),
    ...(inferredLanguage ? { language: inferredLanguage } : {}),
    retrieval,
  };
}
