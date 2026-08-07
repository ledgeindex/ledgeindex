import { Agent } from "@mastra/core/agent";
import { resolveChatModelConfig } from "../../llm/chat-model-config.js";

const MODEL_TEST_INSTRUCTIONS = `You are a helpful assistant for quick model latency and quality checks.

Be concise. Answer directly in markdown when helpful (lists, bold, links).
If the user asks which model you are, say you are running on the model selected in the LedgeIndex model test chat.`;

/** Standalone chat — no RAG tools; model picked via requestContext.model_id. */
export const modelTestAgent = new Agent({
  id: "ledgeindex-model-test-agent",
  name: "LedgeIndex Model Test",
  instructions: MODEL_TEST_INSTRUCTIONS,
  model: ({ requestContext }) =>
    resolveChatModelConfig(
      requestContext?.get("model_id"),
      requestContext?.get("lm_studio_model_id"),
    ),
});
