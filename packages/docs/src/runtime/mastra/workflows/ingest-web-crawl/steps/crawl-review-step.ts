import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { discoverUrls } from "../../../../crawler/discover.js";
import { logInfo } from "../../../../lib/logger.js";
import {
  CRAWL_REVIEW_STEP_ID,
  discoveredUrlSchema,
  ingestInputSchema,
  skippedUrlSchema,
} from "../schemas.js";
import { mastraWorkflowSchema } from "../mastra-workflow-schema.js";

export const crawlReviewStep = createStep({
  id: CRAWL_REVIEW_STEP_ID,
  description: "Discover URLs and suspend for user review",
  inputSchema: mastraWorkflowSchema(ingestInputSchema),
  suspendSchema: mastraWorkflowSchema(
    z.object({
      urls: z.array(discoveredUrlSchema),
      skipped: z.array(skippedUrlSchema),
      pagesDiscovered: z.number(),
      httpStatusFiltered: z.number().optional(),
    }),
  ),
  resumeSchema: mastraWorkflowSchema(
    z.object({
      selectedUrls: z.array(z.string().url()).min(1),
      enrichExamples: z.boolean().optional(),
      enrichBackend: z.string().optional(),
      enrichModelId: z.string().optional(),
      enrichBaseUrl: z.string().optional(),
      enrichGoogleModelId: z.string().optional(),
      enrichContextTokenLimit: z.number().int().positive().optional(),
    }),
  ),
  outputSchema: mastraWorkflowSchema(
    z.object({
      selectedUrls: z.array(z.string().url()),
      urls: z.array(discoveredUrlSchema),
      skipped: z.array(skippedUrlSchema),
    }),
  ),
  execute: async ({ inputData, resumeData, suspend, setState, state }) => {
    if (!resumeData) {
      logInfo("Crawl review: discovering URLs", "IngestWorkflow", {
        sourceId: inputData.sourceId,
      });

      const result = await discoverUrls(inputData.config, {
        sourceId: inputData.sourceId,
      });
      await setState({
        ...(state as object),
        crawlResult: result,
      });

      return await suspend({
        urls: result.urls,
        skipped: result.skipped,
        pagesDiscovered: result.urls.length,
        httpStatusFiltered: result.httpStatusFiltered ?? 0,
      });
    }

    logInfo("Crawl review: resumed with URL selection", "IngestWorkflow", {
      sourceId: inputData.sourceId,
      selectedCount: resumeData.selectedUrls.length,
      enrichExamples: resumeData.enrichExamples === true,
      enrichBackend: resumeData.enrichBackend ?? null,
    });

    const crawlResult = (state as { crawlResult?: Awaited<ReturnType<typeof discoverUrls>> })
      .crawlResult ?? { urls: [], skipped: [] };

    await setState({
      ...(state as object),
      enrichExamples: resumeData.enrichExamples === true,
      enrichBackend: resumeData.enrichBackend,
      enrichModelId: resumeData.enrichModelId,
      enrichBaseUrl: resumeData.enrichBaseUrl,
      enrichGoogleModelId: resumeData.enrichGoogleModelId,
      enrichContextTokenLimit: resumeData.enrichContextTokenLimit,
    });

    return {
      selectedUrls: resumeData.selectedUrls,
      urls: crawlResult.urls,
      skipped: crawlResult.skipped,
    };
  },
});
