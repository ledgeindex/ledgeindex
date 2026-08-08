import { createWorkflow } from "@mastra/core/workflows";
import {
  crawlReviewStep,
  embedStep,
  enrichStep,
  parseReviewStep,
  storeStep,
} from "./steps/index.js";
import {
  ingestInputSchema,
  ingestOutputSchema,
  ingestStateSchema,
} from "./schemas.js";

export const ingestWebCrawlWorkflow = createWorkflow({
  id: "ingest-web-crawl",
  inputSchema: ingestInputSchema,
  outputSchema: ingestOutputSchema,
  stateSchema: ingestStateSchema,
})
  .map(async ({ inputData, setState }) => {
    await setState({
      sourceId: inputData.sourceId,
      projectId: inputData.projectId,
      config: inputData.config,
    });
    return inputData;
  })
  .then(crawlReviewStep)
  .then(parseReviewStep)
  .then(enrichStep)
  .then(embedStep)
  .then(storeStep);

ingestWebCrawlWorkflow.commit();
