import { RequestContext } from "@mastra/core/request-context";
import { resolveEnrichModelFromSelection } from "@ledgeindex/core";
import {
  isRequestRerankBackend,
  runWithRetrievalContext,
  type SourceHosting,
  type SourceScope,
} from "@ledgeindex/core/query/rerank-request-context.js";
import type { RerankBackend } from "@ledgeindex/core/query/rerank-backend.js";
import { getMastra } from "../mastra/instance.js";
import { kapaRetrieve } from "../retrieval/kapa-retrieve.js";
import { readRetrievalMeta } from "../retrieval/retrieval-meta.js";
import { hasLlmKey } from "../llm/models.js";
import { logVerbose } from "../lib/logger.js";

export type SourceAskHit = {
  text: string;
  url: string;
  title: string;
  score: number;
  section?: string;
};

export type SourceAskResult = {
  mode: "agent" | "retrieve-only";
  answer: string;
  chunks: SourceAskHit[];
  insufficient: boolean;
  rerankBackend?: RerankBackend;
};

export type AskSourceModelSelection = {
  backend: "api" | "lm-studio" | "ag-native" | string;
  modelId?: string;
  baseUrl?: string;
  googleModelId?: string;
};

export type AskSourceOptions = {
  /** Per-request override: cohere | local | vector (…also llm-batch / cohere-mastra). */
  rerankBackend?: RerankBackend;
  /** personal = owner-bound; global = public corpus. */
  sourceScope?: SourceScope;
  /** local FileStore/LibSQL vs cloud Postgres — drives embed/rerank stack. */
  sourceHosting?: SourceHosting;
  /** AG / LM Studio / API selection from AutomationGhost. */
  model?: AskSourceModelSelection;
  /**
   * agent — docs agent synthesizes an answer (default when LLM available).
   * retrieve-only — return score-pruned rerank hits only (MCP evidence path).
   */
  mode?: "agent" | "retrieve-only";
};

function formatRetrieveOnlyAnswer(
  query: string,
  chunks: SourceAskHit[],
  insufficient: boolean,
  opts?: { evidenceStyle?: boolean },
): string {
  if (insufficient || chunks.length === 0) {
    return "The knowledge sources do not confirm this question. Try rephrasing or index more pages.";
  }

  if (opts?.evidenceStyle) {
    const lines = chunks.map((chunk, index) => {
      const label = chunk.title || chunk.url;
      return `${index + 1}. [${label}](${chunk.url}) (score ${chunk.score.toFixed(2)}) — ${chunk.text}`;
    });
    return [`Top matches for **${query}**:`, "", ...lines].join("\n");
  }

  const lines = chunks.slice(0, 5).map((chunk, index) => {
    const label = chunk.title || chunk.url;
    return `${index + 1}. [${label}](${chunk.url}) — ${chunk.text.slice(0, 220)}${chunk.text.length > 220 ? "…" : ""}`;
  });

  return [
    `_Retrieval-only mode (set GOOGLE_GENERATIVE_AI_API_KEY, LM_STUDIO_BASE_URL, or OPENAI_API_KEY for full agent answers)._`,
    "",
    `Top matches for **${query}**:`,
    "",
    ...lines,
  ].join("\n");
}

function canRunAskAgent(model?: AskSourceModelSelection): boolean {
  if (resolveEnrichModelFromSelection(model ?? null)) return true;
  return hasLlmKey();
}

function toHits(
  chunks: Array<{
    text: string;
    url: string;
    title: string;
    score: number;
    section?: string;
  }>,
): SourceAskHit[] {
  return chunks.map((chunk) => ({
    text: chunk.text,
    url: chunk.url,
    title: chunk.title,
    score: chunk.score,
    ...(chunk.section ? { section: chunk.section } : {}),
  }));
}

async function retrievePrunedHits(
  sourceId: string,
  message: string,
  expandPages: boolean,
): Promise<{ chunks: SourceAskHit[]; insufficient: boolean }> {
  const retrieval = await kapaRetrieve({
    query: message,
    sourceId,
    expandPages,
  });

  return {
    chunks: toHits(retrieval.pruned),
    insufficient: retrieval.insufficient,
  };
}

async function askSourceInner(
  sourceId: string,
  message: string,
  options?: AskSourceOptions,
): Promise<SourceAskResult> {
  const rerankBackend = options?.rerankBackend;
  const model = options?.model;
  const forceRetrieveOnly = options?.mode === "retrieve-only";

  if (forceRetrieveOnly || !canRunAskAgent(model)) {
    const { chunks, insufficient } = await retrievePrunedHits(
      sourceId,
      message,
      !forceRetrieveOnly,
    );

    logVerbose("Source ask retrieve-only finished", "SourceAsk", {
      sourceId,
      chunkCount: chunks.length,
      insufficient,
      forced: forceRetrieveOnly,
      rerankBackend: rerankBackend ?? null,
    });

    return {
      mode: "retrieve-only",
      answer: formatRetrieveOnlyAnswer(message, chunks, insufficient, {
        evidenceStyle: forceRetrieveOnly,
      }),
      chunks,
      insufficient,
      ...(rerankBackend ? { rerankBackend } : {}),
    };
  }

  const requestContext = new RequestContext();
  requestContext.set("source_id", sourceId);
  if (rerankBackend) {
    requestContext.set("rerank_backend", rerankBackend);
  }
  if (model?.backend) {
    requestContext.set("model_backend", model.backend);
  }
  if (model?.modelId) {
    requestContext.set("model_id", model.modelId);
  }
  if (model?.baseUrl) {
    requestContext.set("model_base_url", model.baseUrl);
  }
  if (model?.googleModelId) {
    requestContext.set("google_model_id", model.googleModelId);
  }

  const agent = getMastra().getAgent("docsAgent");
  const response = await agent.generate(message, {
    requestContext,
    maxSteps: 1,
  });

  const meta = readRetrievalMeta(requestContext);
  const chunks = toHits(meta?.chunks ?? []);

  logVerbose("Source ask agent finished", "SourceAsk", {
    sourceId,
    chunkCount: chunks.length,
    insufficient: meta?.insufficient ?? chunks.length === 0,
    rerankBackend: rerankBackend ?? null,
    modelBackend: model?.backend ?? null,
  });

  const insufficient = meta?.insufficient ?? chunks.length === 0;
  const answer =
    typeof response.text === "string" && response.text.trim().length > 0
      ? response.text
      : formatRetrieveOnlyAnswer(message, chunks, insufficient);

  return {
    mode: "agent",
    answer,
    chunks,
    insufficient,
    ...(rerankBackend ? { rerankBackend } : {}),
  };
}

export async function askSource(
  sourceId: string,
  message: string,
  options?: AskSourceOptions,
): Promise<SourceAskResult> {
  const sourceScope = options?.sourceScope === "global" ? "global" : "personal";
  const sourceHosting =
    options?.sourceHosting === "local" || options?.sourceHosting === "cloud"
      ? options.sourceHosting
      : sourceScope === "global"
        ? "cloud"
        : "local";
  const cloud = sourceHosting === "cloud";
  const rerankBackend = cloud
    ? "cohere-auto"
    : options?.rerankBackend && isRequestRerankBackend(options.rerankBackend)
      ? options.rerankBackend
      : undefined;

  return runWithRetrievalContext(
    { backend: rerankBackend, sourceScope, sourceHosting },
    () =>
      askSourceInner(sourceId, message, {
        ...options,
        sourceScope,
        sourceHosting,
        ...(rerankBackend ? { rerankBackend } : {}),
      }),
  );
}
