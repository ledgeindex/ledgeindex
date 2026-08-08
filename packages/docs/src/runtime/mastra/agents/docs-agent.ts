import { Agent } from "@mastra/core/agent";
import { resolveEnrichModelFromSelection } from "@ledgeindex/core";
import { resolveChatModelConfig } from "../../llm/chat-model-config.js";
import { RAGQueryProcessor } from "../processors/rag-query-processor.js";
import { RetrievalMetaEmitter } from "../processors/retrieval-meta-emitter.js";

const DOCS_AGENT_BASE = `You are a documentation assistant.

Answer only from the retrieved sources provided in your system context.
Cite sources with inline markdown links [title](url) using the exact source URLs from context.
Prefer short link titles (page or section names). Place citations next to the claims they support.

Style:
- Be verbose and thorough — not concise. Prefer complete explanations over bullet summaries.
- Include concrete examples, code snippets, configuration samples, and step-by-step usage when the sources support them.
- Cover implementation details: APIs, parameters, options, defaults, edge cases, and how pieces fit together.
- Use clear headings and structure for long answers, but do not sacrifice depth for brevity.

If the context says no valid sources were found, tell the user clearly that the knowledge sources do not confirm their query.
Do not invent or guess information.`;

export const docsAgent = new Agent({
  id: "docs-agent",
  name: "Docs Agent",
  instructions: ({ requestContext }) => {
    const sourceId = requestContext?.get("source_id");
    const extra =
      typeof sourceId === "string" && sourceId.trim()
        ? `\n\nActive sourceId: ${sourceId.trim()}`
        : "";
    return `${DOCS_AGENT_BASE}${extra}`;
  },
  model: ({ requestContext }) => {
    const fromSelection = resolveEnrichModelFromSelection({
      backend: requestContext?.get("model_backend") as string | undefined,
      modelId: requestContext?.get("model_id") as string | undefined,
      baseUrl: requestContext?.get("model_base_url") as string | undefined,
      googleModelId: requestContext?.get("google_model_id") as
        | string
        | undefined,
    });
    if (fromSelection) return fromSelection;

    return resolveChatModelConfig(
      requestContext?.get("model_id"),
      requestContext?.get("lm_studio_model_id"),
    );
  },
  inputProcessors: [new RAGQueryProcessor()],
  outputProcessors: [new RetrievalMetaEmitter()],
  defaultOptions: {
    maxSteps: 1,
  },
});
