import { RequestContext } from "@mastra/core/request-context";
import type { RerankBackend } from "@ledgeindex/core/query/rerank-backend.js";
import { getMastra } from "../mastra/instance.js";
import { readRetrievalMeta } from "../retrieval/retrieval-meta.js";
import { hasLlmKey } from "../llm/models.js";
import { logVerbose } from "../lib/logger.js";
import {
  citationsFromHits,
  toAskHits,
  type AskCitation,
  type AskSourceModelSelection,
  type SourceAskHit,
} from "./source-ask.js";

export type RoutedAskPickedSource = {
  id: string;
  slug: string;
  name: string;
  /** "code" for an indexed repository, "docs" for a crawled site. */
  kind: "code" | "docs";
};

export type RoutedAskResult = {
  answer: string;
  chunks: SourceAskHit[];
  citations: AskCitation[];
  insufficient: boolean;
  /** Which sources the picker actually queried for this question. */
  pickedSources: RoutedAskPickedSource[];
};

export type RoutedAskSourceMode = "picker" | "all";

export type RoutedAskOptions = {
  /** Source set id or slug — the ahead-of-time list the picker chooses within. */
  sourceSet?: string;
  /** Inline slug allowlist, for callers that pin sources per call. */
  sources?: string[];
  /**
   * `picker` (default) — LLM picks one or more sources from the allowlist.
   * `all` — retrieve from every allowed source, no picker.
   */
  sourceMode?: RoutedAskSourceMode;
  /** Owner of the personal sources and the set. */
  userId?: string;
  rerankBackend?: RerankBackend;
  model?: AskSourceModelSelection;
};

/**
 * Ask across several sources and let a picker decide which ones to read.
 *
 * Unlike `askSource`, the source is not given: the Explore pipeline routes the
 * question over the allowed sources (a repo, its docs, or both), retrieves from
 * each one under its own rerank context, and synthesizes one answer. Retrieval
 * stays per-source on purpose — merging the corpora into one query pool would
 * lose the per-source ranking each backend depends on.
 */
export async function askRouted(
  question: string,
  options: RoutedAskOptions = {},
): Promise<RoutedAskResult> {
  if (!hasLlmKey() && !options.model) {
    throw new Error(
      "Routed ask needs a chat model to pick sources and answer. Set GOOGLE_GENERATIVE_AI_API_KEY, OPENAI_API_KEY, or LM_STUDIO_BASE_URL, or ask a single source with ask().",
    );
  }

  const requestContext = new RequestContext();
  if (options.sourceSet) {
    requestContext.set("source_set_id", options.sourceSet);
  }
  if (options.sources && options.sources.length > 0) {
    requestContext.set("explore_source_slugs", options.sources);
  }
  if (options.sourceMode === "all") {
    requestContext.set("explore_source_mode", "all");
  }
  if (options.userId) {
    requestContext.set("user_id", options.userId);
  }
  if (options.rerankBackend) {
    requestContext.set("rerank_backend", options.rerankBackend);
  }
  if (options.model?.backend) {
    requestContext.set("model_backend", options.model.backend);
  }
  if (options.model?.modelId) {
    requestContext.set("model_id", options.model.modelId);
  }
  if (options.model?.baseUrl) {
    requestContext.set("model_base_url", options.model.baseUrl);
  }
  if (options.model?.googleModelId) {
    requestContext.set("google_model_id", options.model.googleModelId);
  }

  const agent = getMastra().getAgent("exploreAgent");
  const response = await agent.generate(question, {
    requestContext,
    maxSteps: 1,
  });

  const meta = readRetrievalMeta(requestContext);
  const chunks = toAskHits(meta?.chunks ?? []);
  const insufficient = meta?.insufficient ?? chunks.length === 0;
  const pickedSources: RoutedAskPickedSource[] = (meta?.pickedSources ?? []).map(
    (source) => ({
      id: source.id,
      slug: source.slug,
      name: source.name,
      kind: source.kind === "code" ? "code" : "docs",
    }),
  );

  logVerbose("Routed ask finished", "RoutedAsk", {
    question,
    sourceSet: options.sourceSet ?? null,
    pinnedSlugs: options.sources ?? null,
    sourceMode: options.sourceMode ?? "picker",
    picked: pickedSources.map((source) => `${source.slug}:${source.kind}`),
    chunkCount: chunks.length,
    insufficient,
  });

  return {
    answer:
      typeof response.text === "string" && response.text.trim().length > 0
        ? response.text
        : "The selected sources do not answer this question.",
    chunks,
    citations: citationsFromHits(chunks),
    insufficient,
    pickedSources,
  };
}
