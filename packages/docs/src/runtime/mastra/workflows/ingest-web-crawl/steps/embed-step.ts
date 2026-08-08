import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { prepareChunksForPages } from "../../../../indexing/index-chunks.js";
import {
  markIngestStepProgress,
  setIngestStepProgress,
} from "../../../../ingest/active-runs.js";
import { logInfo } from "../../../../lib/logger.js";
import { mastraWorkflowSchema } from "../mastra-workflow-schema.js";
import { enrichPageResultSchema } from "@ledgeindex/core";
import {
  EMBED_STEP_ID,
  parsedPageSchema,
  preparedChunkSchema,
  type IngestInput,
} from "../schemas.js";

const embedPageSchema = parsedPageSchema.extend({
  enrichment: enrichPageResultSchema.optional(),
});

export const embedStep = createStep({
  id: EMBED_STEP_ID,
  description: "Chunk markdown + examples and generate embeddings",
  inputSchema: mastraWorkflowSchema(
    z.object({
      pages: z.array(embedPageSchema),
      sourceId: z.string(),
      projectId: z.string(),
    }),
  ),
  outputSchema: mastraWorkflowSchema(
    z.object({
      sourceId: z.string(),
      projectId: z.string(),
      prepared: z.array(preparedChunkSchema),
      pageCount: z.number(),
    }),
  ),
  execute: async ({ inputData, getInitData }) => {
    const init = getInitData() as IngestInput;
    const crawlRoots = (init.config?.startUrls ?? [])
      .map((url) => url.trim())
      .filter(Boolean);
    const crawlRoot = crawlRoots[0] ?? null;

    logInfo("Embed step: chunking and embedding", "IngestWorkflow", {
      sourceId: inputData.sourceId,
      pageCount: inputData.pages.length,
      crawlRoot,
      crawlRootCount: crawlRoots.length,
    });

    markIngestStepProgress(inputData.sourceId, EMBED_STEP_ID, "running");

    const prepared = await prepareChunksForPages({
      sourceId: inputData.sourceId,
      projectId: inputData.projectId,
      crawlRoot,
      crawlRoots,
      pages: inputData.pages.map((page) => ({
        url: page.url,
        title: page.title,
        markdown: page.markdown,
        enrichment: page.enrichment,
      })),
      onProgress: (progress) => {
        setIngestStepProgress(inputData.sourceId, {
          stepId: EMBED_STEP_ID,
          ...progress,
        });
      },
    });

    markIngestStepProgress(inputData.sourceId, EMBED_STEP_ID, "success", {
      prepared,
    });

    return {
      sourceId: inputData.sourceId,
      projectId: inputData.projectId,
      prepared,
      pageCount: inputData.pages.length,
    };
  },
});
