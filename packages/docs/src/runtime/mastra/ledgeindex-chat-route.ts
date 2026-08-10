import { registerApiRoute } from "@mastra/core/server";
import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse } from "ai";
import {
  coalesceStreamUsage,
  mergeUsageRecords,
  normalizeUsageRecord,
  usageHasCounts,
  type NormalizedTokenUsage,
} from "../llm/token-usage.js";
import { mergeChatRequestContext } from "./merge-chat-request-context.js";

export type LedgeindexChatRouteOptions = {
  path: string;
  agent: string;
  sendReasoning?: boolean;
  sendSources?: boolean;
};

/**
 * Mastra chatRoute + messageMetadata for token usage and response duration.
 * (Stock chatRoute does not forward messageMetadata to handleChatStream.)
 */
export function ledgeindexChatRoute({
  path,
  agent,
  sendReasoning = false,
  sendSources = false,
}: LedgeindexChatRouteOptions) {
  return registerApiRoute(path, {
    method: "POST",
    handler: async (c) => {
      const requestStartedAt = Date.now();
      const params = await c.req.json();
      const mastra = c.get("mastra");
      // Middleware often installs an empty RequestContext that would shadow the
      // client body (model_id, rerank_backend, source_id, …). Merge both.
      const effectiveRequestContext = mergeChatRequestContext({
        middleware: c.get("requestContext"),
        body: params.requestContext,
      });

      let accumulatedStepUsage: NormalizedTokenUsage | undefined;

      const messageMetadata = ({
        part,
      }: {
        part: { type: string; [key: string]: unknown };
      }) => {
        if (part.type === "finish-step") {
          const stepUsage = normalizeUsageRecord(
            (part as { usage?: unknown; response?: { usage?: unknown } }).usage ??
              (part as { response?: { usage?: unknown } }).response?.usage,
          );
          if (stepUsage && usageHasCounts(stepUsage)) {
            accumulatedStepUsage = mergeUsageRecords(
              accumulatedStepUsage,
              stepUsage,
            );
          }
          return undefined;
        }

        if (part.type === "finish") {
          const finishUsage = normalizeUsageRecord(
            (part as { usage?: unknown; totalUsage?: unknown }).usage ??
              (part as { totalUsage?: unknown }).totalUsage,
          );
          const usage = coalesceStreamUsage({
            finishUsage,
            stepUsage: accumulatedStepUsage,
          });
          const durationMs = Date.now() - requestStartedAt;

          return {
            ...(usage && usageHasCounts(usage) ? { usage } : {}),
            durationMs,
          };
        }

        return undefined;
      };

      const handlerOptions = {
        mastra,
        agentId: agent,
        params: {
          ...params,
          requestContext: effectiveRequestContext,
          abortSignal: c.req.raw.signal,
        },
        sendReasoning,
        sendSources,
        messageMetadata,
      };

      const uiMessageStream = await handleChatStream(handlerOptions);
      return createUIMessageStreamResponse({ stream: uiMessageStream });
    },
  });
}
