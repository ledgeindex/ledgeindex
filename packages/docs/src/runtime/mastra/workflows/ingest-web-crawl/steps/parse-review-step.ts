import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import {
  markIngestStepProgress,
  setIngestStepProgress,
  clearIngestStepProgress,
} from "../../../../ingest/active-runs.js";
import { parsePage } from "../../../../parser/extract-content.js";
import { mapWithConcurrency } from "../../../../lib/map-with-concurrency.js";
import { dedupeUrlsByCanonical } from "../../../../crawler/canonical-dedupe.js";
import { logInfo } from "../../../../lib/logger.js";
import type { IngestInput } from "../schemas.js";
import {
  discoveredUrlSchema,
  PARSE_REVIEW_STEP_ID,
  parsedPageSchema,
  skippedUrlSchema,
} from "../schemas.js";
import { mastraWorkflowSchema } from "../mastra-workflow-schema.js";

/** Parallel HTTP fetch + HTML→markdown per page during extract. */
const EXTRACT_CONCURRENCY = Math.max(
  1,
  Number(process.env.LEDGEINDEX_EXTRACT_CONCURRENCY ?? 8) || 8,
);

export const parseReviewStep = createStep({
  id: PARSE_REVIEW_STEP_ID,
  description: "Parse selected URLs and suspend for markdown review",
  inputSchema: mastraWorkflowSchema(
    z.object({
      selectedUrls: z.array(z.string().url()),
      urls: z.array(discoveredUrlSchema),
      skipped: z.array(skippedUrlSchema),
    }),
  ),
  suspendSchema: mastraWorkflowSchema(
    z.object({
      pages: z.array(parsedPageSchema),
    }),
  ),
  resumeSchema: mastraWorkflowSchema(
    z.object({
      confirmed: z.literal(true),
      /** Override crawl-review choice: when false, enrich-step skips LLM extraction. */
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
      pages: z.array(parsedPageSchema),
      sourceId: z.string(),
      projectId: z.string(),
    }),
  ),
  execute: async ({ inputData, resumeData, suspend, getInitData, setState, state }) => {
    const init = getInitData() as IngestInput;

    if (!resumeData) {
      const { unique: urlsToExtract, skipped: dedupeSkipped } =
        dedupeUrlsByCanonical(inputData.selectedUrls);

      logInfo("Parse review: extracting markdown", "IngestWorkflow", {
        sourceId: init.sourceId,
        urlCount: urlsToExtract.length,
        selectedUrlCount: inputData.selectedUrls.length,
        canonicalDuplicatesSkipped: dedupeSkipped.length,
        concurrency: EXTRACT_CONCURRENCY,
      });

      const total = urlsToExtract.length;
      markIngestStepProgress(init.sourceId, PARSE_REVIEW_STEP_ID, "running");
      setIngestStepProgress(init.sourceId, {
        stepId: PARSE_REVIEW_STEP_ID,
        phase: "extracting",
        current: 0,
        total,
      });

      const pages = await mapWithConcurrency(
        urlsToExtract,
        EXTRACT_CONCURRENCY,
        async (url) => {
          try {
            return await parsePage(
              url,
              init.config.contentSelectors,
              init.config.excludeSelectors,
              init.config.userAgent,
            );
          } catch (error) {
            return {
              url,
              title: url,
              markdown: "",
              error:
                error instanceof Error ? error.message : "Failed to parse page",
            };
          }
        },
        {
          onItemComplete: (completed, pageTotal, url) => {
            setIngestStepProgress(init.sourceId, {
              stepId: PARSE_REVIEW_STEP_ID,
              phase: "extracting",
              current: completed,
              total: pageTotal,
              sectionUrl: url,
            });
          },
        },
      );

      markIngestStepProgress(init.sourceId, PARSE_REVIEW_STEP_ID, "success", {
        pages,
      });
      clearIngestStepProgress(init.sourceId);

      await setState({
        ...(state as object),
        parsedPages: pages,
      });

      return await suspend({ pages });
    }

    const parsedPages =
      (state as { parsedPages?: z.infer<typeof parsedPageSchema>[] })
        .parsedPages ?? [];

    // Allow changing enrich on/off (and model) at parse review, not only crawl review.
    if (resumeData.enrichExamples !== undefined) {
      logInfo("Parse review: resumed with enrich preference", "IngestWorkflow", {
        sourceId: init.sourceId,
        enrichExamples: resumeData.enrichExamples === true,
        enrichBackend: resumeData.enrichBackend ?? null,
      });
      await setState({
        ...(state as object),
        enrichExamples: resumeData.enrichExamples === true,
        ...(resumeData.enrichBackend !== undefined
          ? { enrichBackend: resumeData.enrichBackend }
          : {}),
        ...(resumeData.enrichModelId !== undefined
          ? { enrichModelId: resumeData.enrichModelId }
          : {}),
        ...(resumeData.enrichBaseUrl !== undefined
          ? { enrichBaseUrl: resumeData.enrichBaseUrl }
          : {}),
        ...(resumeData.enrichGoogleModelId !== undefined
          ? { enrichGoogleModelId: resumeData.enrichGoogleModelId }
          : {}),
        ...(resumeData.enrichContextTokenLimit !== undefined
          ? { enrichContextTokenLimit: resumeData.enrichContextTokenLimit }
          : {}),
      });
    }

    return {
      pages: parsedPages,
      sourceId: init.sourceId,
      projectId: init.projectId,
    };
  },
});
