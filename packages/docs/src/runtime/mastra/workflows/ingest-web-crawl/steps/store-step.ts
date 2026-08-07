import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { storePreparedChunks } from "../../../../indexing/index-chunks.js";
import { markSourceIndexed } from "../../../../indexing/source-index-status.js";
import { markIngestStepProgress, markIngestWorkflowComplete, setIngestStepProgress } from "../../../../ingest/active-runs.js";
import { logInfo } from "../../../../lib/logger.js";
import { preparedChunkSchema, STORE_STEP_ID } from "../schemas.js";
import { mastraWorkflowSchema } from "../mastra-workflow-schema.js";

export const storeStep = createStep({
  id: STORE_STEP_ID,
  description: "Upsert vectors to LibSQL and rebuild metadata catalog",
  inputSchema: mastraWorkflowSchema(
    z.object({
      sourceId: z.string(),
      projectId: z.string(),
      prepared: z.array(preparedChunkSchema),
      pageCount: z.number(),
    }),
  ),
  outputSchema: mastraWorkflowSchema(
    z.object({
      sourceId: z.string(),
      chunkCount: z.number(),
      pageCount: z.number(),
      catalogUpdatedAt: z.string(),
    }),
  ),
  execute: async ({ inputData }) => {
    logInfo("Store step: upserting vectors", "IngestWorkflow", {
      sourceId: inputData.sourceId,
      chunkCount: inputData.prepared.length,
    });

    markIngestStepProgress(inputData.sourceId, STORE_STEP_ID, "running");

    const result = await storePreparedChunks({
      sourceId: inputData.sourceId,
      prepared: inputData.prepared,
      pageCount: inputData.pageCount,
      onProgress: (progress) => {
        setIngestStepProgress(inputData.sourceId, {
          stepId: STORE_STEP_ID,
          ...progress,
        });
      },
    });

    await markSourceIndexed({
      sourceId: inputData.sourceId,
      pageCount: result.pageCount,
      chunkCount: result.chunkCount,
    });

    markIngestStepProgress(inputData.sourceId, STORE_STEP_ID, "success", {
      chunkCount: result.chunkCount,
    });

    const output = {
      sourceId: inputData.sourceId,
      chunkCount: result.chunkCount,
      pageCount: result.pageCount,
      catalogUpdatedAt: result.catalog.updatedAt,
    };

    markIngestWorkflowComplete(inputData.sourceId, output);

    return output;
  },
});
