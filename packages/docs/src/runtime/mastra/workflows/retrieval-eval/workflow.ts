import { createStep, createWorkflow } from "@mastra/core/workflows";
import { mastraWorkflowSchema } from "../ingest-web-crawl/mastra-workflow-schema.js";
import { evaluateRetrievalCases } from "./evaluate.js";
import { generateGoldenSet } from "./generate.js";
import {
  generateGoldenSetInputSchema,
  generatedGoldenSetSchema,
  retrievalEvalInputSchema,
  retrievalEvalOutputSchema,
} from "./schemas.js";

const generateGoldenSetStep = createStep({
  id: "generate-retrieval-golden-set",
  description: "Export an indexed corpus and author grounded retrieval cases",
  inputSchema: mastraWorkflowSchema(generateGoldenSetInputSchema),
  outputSchema: mastraWorkflowSchema(generatedGoldenSetSchema),
  execute: async ({ inputData }) => generateGoldenSet(inputData),
});

export const generateRetrievalGoldenSetWorkflow = createWorkflow({
  id: "generate-retrieval-golden-set",
  inputSchema: generateGoldenSetInputSchema,
  outputSchema: generatedGoldenSetSchema,
}).then(generateGoldenSetStep);

generateRetrievalGoldenSetWorkflow.commit();

const evaluateRetrievalStep = createStep({
  id: "evaluate-retrieval-cases",
  description:
    "Run production retrieval and calculate deterministic RAG metrics",
  inputSchema: mastraWorkflowSchema(retrievalEvalInputSchema),
  outputSchema: mastraWorkflowSchema(retrievalEvalOutputSchema),
  execute: async ({ inputData }) =>
    evaluateRetrievalCases(inputData.cases, {
      sourceId: inputData.sourceId,
      scope: inputData.scope,
      hosting: inputData.hosting,
      strictness: inputData.strictness,
      expandPages: inputData.expandPages,
      concurrency: inputData.concurrency,
      profile: inputData.profile,
      scorerModel: inputData.scorerModel,
    }),
});

export const retrievalEvalWorkflow = createWorkflow({
  id: "retrieval-eval",
  inputSchema: retrievalEvalInputSchema,
  outputSchema: retrievalEvalOutputSchema,
}).then(evaluateRetrievalStep);

retrievalEvalWorkflow.commit();
