import {
  buildChatThinkingTransportExtras,
  type ChatThinkingLevel,
  resolveChatThinkingLevel,
} from "./chat-thinking-level";
import type { LedgeIndexRerankBackendId } from "./rerank-backend";
import { isCloudHostedSource } from "./rerank-backend";
import { getLedgeIndexApiBaseUrl } from "@ledgeindex/client";

export type LedgeIndexChatAgent =
  | "docsAgent"
  | "modelTestAgent"
  | "exploreAgent";

/** Mastra chatRoute paths (registered on Fastify root, not under /mastra prefix). */
export function mastraChatUrl(agent: LedgeIndexChatAgent): string {
  return `${getLedgeIndexApiBaseUrl()}/chat/${agent}`;
}

export type MastraChatTransportBody = {
  requestContext: {
    model_id: string;
    source_id?: string;
    source_name?: string;
    source_scope?: "personal" | "global";
    source_hosting?: "local" | "cloud";
    rerank_backend?: string;
    docs_url_prefix?: string;
    docs_crawl_root?: string;
    model_thinking_level?: ChatThinkingLevel;
    include_thoughts?: boolean;
  };
  model: string;
  config?: {
    thinkingLevel: ChatThinkingLevel;
    includeThoughts: boolean;
  };
  providerOptions?: Record<string, Record<string, unknown>>;
};

export function mastraChatTransportBody(input: {
  modelId: string;
  sourceId?: string;
  sourceName?: string;
  sourceScope?: "personal" | "global";
  sourceHosting?: "local" | "cloud";
  thinkingLevel?: ChatThinkingLevel;
  rerankBackend?: LedgeIndexRerankBackendId;
  docsUrlPrefix?: string;
  docsCrawlRoot?: string;
}): MastraChatTransportBody {
  const modelId = input.modelId.trim();
  const thinking = buildChatThinkingTransportExtras(
    modelId,
    resolveChatThinkingLevel(modelId, input.thinkingLevel),
  );
  const docsUrlPrefix = input.docsUrlPrefix?.trim();
  const docsCrawlRoot = input.docsCrawlRoot?.trim();
  const sourceScope = input.sourceScope;
  const sourceHosting = input.sourceHosting;
  const cloud = isCloudHostedSource({
    hosting: sourceHosting,
    scope: sourceScope,
  });
  const rerankBackend = cloud ? "cohere-auto" : input.rerankBackend;

  return {
    model: modelId,
    requestContext: {
      model_id: modelId,
      ...thinking.requestContext,
      ...(input.sourceId ? { source_id: input.sourceId } : {}),
      ...(input.sourceName?.trim()
        ? { source_name: input.sourceName.trim() }
        : {}),
      ...(sourceScope ? { source_scope: sourceScope } : {}),
      ...(sourceHosting ? { source_hosting: sourceHosting } : {}),
      ...(rerankBackend ? { rerank_backend: rerankBackend } : {}),
      ...(docsUrlPrefix ? { docs_url_prefix: docsUrlPrefix } : {}),
      ...(docsCrawlRoot ? { docs_crawl_root: docsCrawlRoot } : {}),
    },
    ...(thinking.config ? { config: thinking.config } : {}),
    ...(thinking.providerOptions
      ? { providerOptions: thinking.providerOptions }
      : {}),
  };
}
