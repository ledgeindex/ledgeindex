import { Agent } from "@mastra/core/agent";
import { resolveChatModelConfig } from "../../llm/chat-model-config.js";
import { ExploreQueryProcessor } from "../processors/explore-query-processor.js";
import { RetrievalMetaEmitter } from "../processors/retrieval-meta-emitter.js";

const EXPLORE_AGENT_BASE = `You help users explore LedgeIndex knowledge sources — both **personal** (local) and **global** (platform) corpora.

A controlled processor runs before you:
- It may inject a catalog of available sources, and/or retrieved evidence chunks.
- It sets answer mode: full, partial, or none.

Rules:
- Answer only from the retrieved sources / catalog provided in your system context.
- Cite with inline markdown links [title](url) using exact URLs from context.
- Follow the coverage instructions in system context (full / partial / none).
- Do not invent documentation. Do not call tools — retrieval already happened.
- Be clear and structured. Prefer thorough answers when sources support them.`;

/**
 * Explore chat: router + source pick + RAG coverage tiers via input processor
 * (same style as docsAgent — no free-form tool calling).
 */
export const exploreAgent = new Agent({
  id: "explore-agent",
  name: "Explore Agent",
  instructions: EXPLORE_AGENT_BASE,
  model: ({ requestContext }) =>
    resolveChatModelConfig(
      requestContext?.get("model_id"),
      requestContext?.get("lm_studio_model_id"),
    ),
  inputProcessors: [new ExploreQueryProcessor()],
  outputProcessors: [new RetrievalMetaEmitter()],
  defaultOptions: {
    maxSteps: 1,
  },
});
