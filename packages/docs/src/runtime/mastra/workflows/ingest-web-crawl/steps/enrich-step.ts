import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import {
  enrichPage,
  enrichPageResultSchema,
  hasEnrichLlm,
  isEnrichFailureReason,
  resolveEnrichModelFromSelection,
  type EnrichPageResult,
} from "@ledgeindex/core";
import {
  markIngestStepProgress,
  setIngestStepProgress,
  clearIngestStepProgress,
} from "../../../../ingest/active-runs.js";
import {
  assertIngestNotCancelled,
  IngestCancelledError,
  isIngestCancellationRequested,
} from "../../../../ingest/ingest-cancel.js";
import { mapWithConcurrency } from "../../../../lib/map-with-concurrency.js";
import { logInfo } from "../../../../lib/logger.js";
import { mastraWorkflowSchema } from "../mastra-workflow-schema.js";
import {
  ENRICH_STEP_ID,
  parsedPageSchema,
  type IngestInput,
} from "../schemas.js";

function enrichExamplesEnabled(): boolean {
  return process.env.LEDGEINDEX_ENRICH_EXAMPLES !== "0";
}

/** Local OpenAI-compatible serves (AG native / LM Studio) are typically single-session. */
function isLocalEnrichBackend(backend: string | undefined): boolean {
  const b = (backend ?? "").toLowerCase();
  return b === "ag-native" || b === "lmstudio" || b === "lm-studio";
}

function resolveEnrichConcurrency(backend: string | undefined): number {
  const raw = Number(process.env.LEDGEINDEX_ENRICH_CONCURRENCY);
  if (Number.isFinite(raw) && raw >= 1) {
    const capped = Math.floor(raw);
    // Local serve: hard max 2. External API: hard max 10.
    return isLocalEnrichBackend(backend) ? Math.min(2, capped) : Math.min(10, capped);
  }
  // Local: 2. External API: 10.
  return isLocalEnrichBackend(backend) ? 2 : 10;
}

const enrichedPageSchema = parsedPageSchema.extend({
  enrichment: enrichPageResultSchema.optional(),
});

type EnrichedPage = z.infer<typeof enrichedPageSchema>;

type EnrichWorkflowState = {
  enrichExamples?: boolean;
  enrichBackend?: string;
  enrichModelId?: string;
  enrichBaseUrl?: string;
  enrichGoogleModelId?: string;
  /** Model context window (tokens) from AutomationGhost / LM Studio. */
  enrichContextTokenLimit?: number;
  enrichedPages?: EnrichedPage[];
};

function isFailedEnrichment(
  enrichment: EnrichPageResult | undefined,
): boolean {
  return (
    enrichment?.status === "skipped" &&
    isEnrichFailureReason(enrichment.reason)
  );
}

async function enrichPagesWithProgress(input: {
  sourceId: string;
  pages: EnrichedPage[];
  concurrency: number;
  selectedModel: ReturnType<typeof resolveEnrichModelFromSelection>;
  contextTokenLimit?: number;
  /** When set, only re-enrich these URLs; others are kept as-is. */
  onlyUrls?: Set<string>;
  /** Sectioned enrich — only for explicit retry flows. */
  mode?: "whole" | "sectioned";
}): Promise<EnrichedPage[]> {
  const {
    sourceId,
    pages,
    concurrency,
    selectedModel,
    contextTokenLimit,
    onlyUrls,
    mode = "whole",
  } = input;
  const targets = onlyUrls
    ? pages.filter((page) => onlyUrls.has(page.url))
    : pages;
  const total = onlyUrls ? targets.length : pages.length;

  let completed = 0;
  let enrichedSoFar = onlyUrls
    ? pages.filter((p) => p.enrichment?.status === "enriched").length
    : 0;
  const previewPages: EnrichedPage[] = onlyUrls
    ? pages.map((page) => ({
        url: page.url,
        title: page.title,
        markdown: page.markdown,
        enrichment: page.enrichment,
        ...(page.error ? { error: page.error } : {}),
      }))
    : [];

  const publishProgress = (section?: {
    sectionCurrent?: number;
    sectionTotal?: number;
    sectionUrl: string;
  }) => {
    setIngestStepProgress(sourceId, {
      stepId: ENRICH_STEP_ID,
      phase: "enriching",
      current: completed,
      total,
      enrichedCount: enrichedSoFar,
      previewPages: [...previewPages],
      ...(section
        ? {
            ...(typeof section.sectionCurrent === "number"
              ? { sectionCurrent: section.sectionCurrent }
              : {}),
            ...(typeof section.sectionTotal === "number"
              ? { sectionTotal: section.sectionTotal }
              : {}),
            sectionUrl: section.sectionUrl,
          }
        : {}),
    });
  };

  setIngestStepProgress(sourceId, {
    stepId: ENRICH_STEP_ID,
    phase: "enriching",
    current: 0,
    total,
    enrichedCount: enrichedSoFar,
    previewPages: [...previewPages],
  });

  if (!onlyUrls) {
    const enriched = await mapWithConcurrency(
      pages,
      concurrency,
      async (page) => {
        assertIngestNotCancelled(sourceId);
        publishProgress({ sectionUrl: page.url });

        if (page.error || !page.markdown.trim()) {
          completed += 1;
          publishProgress({ sectionUrl: page.url });
          return page;
        }

        const enrichment = await enrichPage({
          url: page.url,
          title: page.title,
          markdown: page.markdown,
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(contextTokenLimit ? { contextTokenLimit } : {}),
          ...(mode === "sectioned" ? { mode: "sectioned" } : {}),
        });

        assertIngestNotCancelled(sourceId);

        const next = {
          ...page,
          enrichment,
        } satisfies EnrichedPage;

        completed += 1;
        if (enrichment.status === "enriched") {
          enrichedSoFar += 1;
        }
        previewPages.push({
          url: next.url,
          title: next.title,
          markdown: next.markdown,
          enrichment: next.enrichment,
          ...(next.error ? { error: next.error } : {}),
        });
        publishProgress({ sectionUrl: page.url });
        return next;
      },
      {
        shouldAbort: () => isIngestCancellationRequested(sourceId),
        abortError: () => new IngestCancelledError(sourceId),
      },
    );
    return enriched;
  }

  // Retry path: only failed URLs, merge back into full page list.
  const byUrl = new Map(pages.map((page) => [page.url, page]));
  const retried = await mapWithConcurrency(
    targets,
    concurrency,
    async (page) => {
      assertIngestNotCancelled(sourceId);
      publishProgress({ sectionUrl: page.url });

      if (page.error || !page.markdown.trim()) {
        completed += 1;
        publishProgress({ sectionUrl: page.url });
        return page;
      }

      const enrichment = await enrichPage({
        url: page.url,
        title: page.title,
        markdown: page.markdown,
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(contextTokenLimit ? { contextTokenLimit } : {}),
        ...(mode === "sectioned" ? { mode: "sectioned" } : {}),
        ...(mode === "sectioned"
          ? {
              onSectionProgress: (progress) => {
                assertIngestNotCancelled(sourceId);
                publishProgress({
                  sectionCurrent: progress.sectionCurrent,
                  sectionTotal: progress.sectionTotal,
                  sectionUrl: progress.url,
                });
              },
            }
          : {}),
      });

      assertIngestNotCancelled(sourceId);

      const next = {
        ...page,
        enrichment,
      } satisfies EnrichedPage;

      const prev = byUrl.get(page.url);
      if (prev?.enrichment?.status === "enriched") {
        // shouldn't happen for failed targets
      } else if (enrichment.status === "enriched") {
        enrichedSoFar += 1;
      }

      byUrl.set(page.url, next);
      const previewIndex = previewPages.findIndex((p) => p.url === page.url);
      const previewEntry = {
        url: next.url,
        title: next.title,
        markdown: next.markdown,
        enrichment: next.enrichment,
        ...(next.error ? { error: next.error } : {}),
      };
      if (previewIndex >= 0) previewPages[previewIndex] = previewEntry;
      else previewPages.push(previewEntry);

      completed += 1;
      publishProgress({ sectionUrl: page.url });
      return next;
    },
    {
      shouldAbort: () => isIngestCancellationRequested(sourceId),
      abortError: () => new IngestCancelledError(sourceId),
    },
  );

  void retried;
  return pages.map((page) => byUrl.get(page.url) ?? page);
}

export const enrichStep = createStep({
  id: ENRICH_STEP_ID,
  description:
    "Extract grounded code/setup/usage examples per page, then suspend for review",
  inputSchema: mastraWorkflowSchema(
    z.object({
      pages: z.array(parsedPageSchema),
      sourceId: z.string(),
      projectId: z.string(),
    }),
  ),
  suspendSchema: mastraWorkflowSchema(
    z.object({
      pages: z.array(enrichedPageSchema),
      enrichedCount: z.number().int().nonnegative(),
    }),
  ),
  resumeSchema: mastraWorkflowSchema(
    z.union([
      z.object({ confirmed: z.literal(true) }),
      z.object({
        action: z.literal("retry_failed"),
        /** Optional refresh of context window for this retry. */
        enrichContextTokenLimit: z.number().int().positive().optional(),
      }),
      z.object({
        action: z.literal("retry_urls"),
        urls: z.array(z.string().min(1)).min(1),
        /** Optional refresh of context window for this retry. */
        enrichContextTokenLimit: z.number().int().positive().optional(),
      }),
    ]),
  ),
  outputSchema: mastraWorkflowSchema(
    z.object({
      pages: z.array(enrichedPageSchema),
      sourceId: z.string(),
      projectId: z.string(),
    }),
  ),
  execute: async ({ inputData, resumeData, suspend, getInitData, setState, state }) => {
    const init = getInitData() as IngestInput;
    const sourceId = inputData.sourceId || init.sourceId;
    let enrichState = state as EnrichWorkflowState | undefined;

    // Retry can refresh context from the live client (crawl-time value may be missing).
    if (
      resumeData &&
      "action" in resumeData &&
      (resumeData.action === "retry_failed" ||
        resumeData.action === "retry_urls") &&
      typeof resumeData.enrichContextTokenLimit === "number" &&
      Number.isFinite(resumeData.enrichContextTokenLimit) &&
      resumeData.enrichContextTokenLimit > 0
    ) {
      const nextLimit = Math.floor(resumeData.enrichContextTokenLimit);
      await setState({
        ...(state as object),
        enrichContextTokenLimit: nextLimit,
      });
      enrichState = {
        ...(enrichState ?? {}),
        enrichContextTokenLimit: nextLimit,
      };
    }

    const selectedModel = resolveEnrichModelFromSelection({
      backend: enrichState?.enrichBackend,
      modelId: enrichState?.enrichModelId,
      baseUrl: enrichState?.enrichBaseUrl,
      googleModelId: enrichState?.enrichGoogleModelId,
    });
    const concurrency = resolveEnrichConcurrency(enrichState?.enrichBackend);
    const contextTokenLimit =
      typeof enrichState?.enrichContextTokenLimit === "number" &&
      Number.isFinite(enrichState.enrichContextTokenLimit) &&
      enrichState.enrichContextTokenLimit > 0
        ? Math.floor(enrichState.enrichContextTokenLimit)
        : undefined;

    // Sectioned re-enrich for failed pages and/or explicit URL list, then re-suspend.
    if (
      resumeData &&
      "action" in resumeData &&
      (resumeData.action === "retry_failed" ||
        resumeData.action === "retry_urls")
    ) {
      const existing = (enrichState?.enrichedPages ??
        inputData.pages) as EnrichedPage[];
      const existingByUrl = new Set(existing.map((page) => page.url));
      const retryUrls =
        resumeData.action === "retry_urls"
          ? [
              ...new Set(
                resumeData.urls
                  .map((url) => url.trim())
                  .filter((url) => url.length > 0 && existingByUrl.has(url)),
              ),
            ]
          : existing
              .filter((page) => isFailedEnrichment(page.enrichment))
              .map((page) => page.url);

      if (retryUrls.length === 0 || !hasEnrichLlm(selectedModel)) {
        const enrichedCount = existing.filter(
          (p) => p.enrichment?.status === "enriched",
        ).length;
        return await suspend({ pages: existing, enrichedCount });
      }

      markIngestStepProgress(sourceId, ENRICH_STEP_ID, "running");
      logInfo("Enrich step: retrying pages (sectioned)", "IngestWorkflow", {
        sourceId,
        retryCount: retryUrls.length,
        action: resumeData.action,
        concurrency,
        backend: enrichState?.enrichBackend ?? null,
        mode: "sectioned",
      });

      const pages = await enrichPagesWithProgress({
        sourceId,
        pages: existing,
        concurrency,
        selectedModel,
        contextTokenLimit,
        onlyUrls: new Set(retryUrls),
        mode: "sectioned",
      });

      const enrichedCount = pages.filter(
        (p) => p.enrichment?.status === "enriched",
      ).length;

      markIngestStepProgress(sourceId, ENRICH_STEP_ID, "success", {
        pageCount: pages.length,
        enrichedCount,
        retried: retryUrls.length,
      });
      clearIngestStepProgress(sourceId);

      await setState({
        ...(state as object),
        enrichedPages: pages,
      });

      logInfo("Enrich step: re-suspending after enrich retry", "IngestWorkflow", {
        sourceId,
        pageCount: pages.length,
        enrichedCount,
        retried: retryUrls.length,
      });

      return await suspend({ pages, enrichedCount });
    }

    // Confirm → continue to embed/store.
    if (resumeData && "confirmed" in resumeData && resumeData.confirmed) {
      const enrichedPages = enrichState?.enrichedPages ?? inputData.pages;
      return {
        sourceId: inputData.sourceId,
        projectId: inputData.projectId,
        pages: enrichedPages,
      };
    }

    // Legacy: any other resumeData also continues (defensive).
    if (resumeData) {
      const enrichedPages = enrichState?.enrichedPages ?? inputData.pages;
      return {
        sourceId: inputData.sourceId,
        projectId: inputData.projectId,
        pages: enrichedPages,
      };
    }

    const enrichFromState = enrichState?.enrichExamples;
    const enrichRequested =
      enrichFromState === true && enrichExamplesEnabled();

    markIngestStepProgress(sourceId, ENRICH_STEP_ID, "running");

    if (!enrichRequested || !hasEnrichLlm(selectedModel)) {
      logInfo("Enrich step skipped (disabled or no LLM)", "IngestWorkflow", {
        sourceId,
        enabled: enrichRequested,
        hasLlm: hasEnrichLlm(selectedModel),
        backend: enrichState?.enrichBackend ?? null,
      });
      markIngestStepProgress(sourceId, ENRICH_STEP_ID, "success", {
        skipped: true,
        pageCount: inputData.pages.length,
      });
      // No review when nothing was enriched — continue straight to embed.
      return {
        sourceId: inputData.sourceId,
        projectId: inputData.projectId,
        pages: inputData.pages,
      };
    }

    logInfo("Enrich step: extracting examples", "IngestWorkflow", {
      sourceId,
      pageCount: inputData.pages.length,
      concurrency,
      backend: enrichState?.enrichBackend ?? null,
      modelId: enrichState?.enrichModelId ?? enrichState?.enrichGoogleModelId ?? null,
      contextTokenLimit: contextTokenLimit ?? null,
    });

    const pages = await enrichPagesWithProgress({
      sourceId,
      pages: inputData.pages as EnrichedPage[],
      concurrency,
      selectedModel,
      contextTokenLimit,
    });

    const enrichedCount = pages.filter(
      (p) => p.enrichment?.status === "enriched",
    ).length;

    markIngestStepProgress(sourceId, ENRICH_STEP_ID, "success", {
      pageCount: pages.length,
      enrichedCount,
    });
    clearIngestStepProgress(sourceId);

    await setState({
      ...(state as object),
      enrichedPages: pages,
    });

    logInfo("Enrich step: suspending for example review", "IngestWorkflow", {
      sourceId,
      pageCount: pages.length,
      enrichedCount,
    });

    return await suspend({ pages, enrichedCount });
  },
});
