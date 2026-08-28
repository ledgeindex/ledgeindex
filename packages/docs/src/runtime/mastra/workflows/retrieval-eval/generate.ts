import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import {
  exportSourceCorpus,
  type SourceCorpusPage,
} from "@ledgeindex/core/export/source-corpus.js";
import { resolveRewriteModelConfig } from "../../../llm/chat-model-config.js";
import { agentStructuredOutput } from "../../../llm/agent-structured-output.js";
import type { RetrievalGoldenCase } from "./schemas.js";

const generatedCaseSchema = z.object({
  targetUrl: z.string().url(),
  id: z.string().min(1),
  question: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
  rejectUrls: z.array(z.string()).max(3),
  requiredClaims: z.array(z.string().min(1)).min(2).max(4),
  groundTruth: z.string().min(1),
  tags: z.array(z.string()).max(6),
});

const generatedBatchSchema = z.object({
  cases: z.array(generatedCaseSchema).min(1).max(6),
});

function categoryForUrl(url: string): string {
  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    pathname = url.toLowerCase();
  }
  if (pathname.includes("/workflows")) return "workflows";
  if (pathname.includes("/memory")) return "memory";
  if (pathname.includes("/mcp") || pathname.includes("/connections/"))
    return "mcp";
  if (pathname.includes("/evals") || pathname.includes("/datasets"))
    return "evals";
  if (pathname.includes("/rag") || pathname.includes("/vectors")) return "rag";
  if (pathname.includes("/auth")) return "auth-deploy";
  if (pathname.includes("/deployment")) return "auth-deploy";
  if (pathname.includes("/agents")) return "agents";
  if (pathname.includes("/tools")) return "tools";
  if (pathname.includes("/getting-started") || pathname === "/docs") {
    return "getting-started";
  }
  return pathname.startsWith("/reference") ? "reference" : "docs";
}

function bucketForPage(page: SourceCorpusPage): string {
  try {
    const segments = new URL(page.url).pathname.split("/").filter(Boolean);
    return segments.slice(0, 2).join("/") || "root";
  } catch {
    return page.category || "other";
  }
}

export function selectGoldenSetPages(
  pages: SourceCorpusPage[],
  count: number
): SourceCorpusPage[] {
  const buckets = new Map<string, SourceCorpusPage[]>();
  for (const page of pages) {
    if (!page.markdown.trim()) continue;
    const key = bucketForPage(page);
    buckets.set(key, [...(buckets.get(key) ?? []), page]);
  }
  for (const rows of buckets.values()) {
    rows.sort((left, right) => left.url.localeCompare(right.url));
  }

  const selected: SourceCorpusPage[] = [];
  const orderedBuckets = [...buckets.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  let offset = 0;
  while (selected.length < count) {
    let added = false;
    for (const [, rows] of orderedBuckets) {
      const page = rows[offset];
      if (!page) continue;
      selected.push(page);
      added = true;
      if (selected.length === count) break;
    }
    if (!added) break;
    offset += 1;
  }
  return selected;
}

function batches<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    output.push(items.slice(offset, offset + size));
  }
  return output;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

export async function generateGoldenSet(input: {
  sourceId: string;
  count: number;
}) {
  const corpus = await exportSourceCorpus(input.sourceId, {
    includeContent: true,
    includeChunks: false,
  });
  const selected = selectGoldenSetPages(corpus.pages, input.count);
  if (selected.length < input.count) {
    throw new Error(
      `Corpus only supplied ${selected.length} non-empty pages for ${input.count} cases`
    );
  }

  const corpusUrls = new Set(corpus.pages.map((page) => page.url));
  const titleIndex = corpus.pages.map((page) => ({
    title: page.title,
    url: page.url,
  }));
  const agent = new Agent({
    id: "retrieval-golden-set-author",
    name: "Retrieval golden set author",
    instructions: `Create difficult but answerable RAG retrieval test cases from supplied source pages.
Use only facts explicitly present in the page excerpt.
Write natural questions that a developer would ask without knowing the page title.
Each case must target its assigned URL. Do not switch targets.
Ground truth must be concise and factual.
Required claims must be independently checkable.
Reject URLs are optional hard negatives selected only from the supplied nearby pages.`,
    model: resolveRewriteModelConfig(),
  });

  const generated: RetrievalGoldenCase[] = [];
  for (const batch of batches(selected, 5)) {
    const nearby = titleIndex
      .filter((candidate) => !batch.some((page) => page.url === candidate.url))
      .slice(0, 20);
    const prompt = [
      `Create exactly ${batch.length} cases, one for each target page.`,
      "Target pages:",
      JSON.stringify(
        batch.map((page) => ({
          targetUrl: page.url,
          title: page.title,
          category: categoryForUrl(page.url),
          markdown: page.markdown.slice(0, 7_000),
        }))
      ),
      "Possible hard-negative pages:",
      JSON.stringify(nearby),
    ].join("\n\n");
    const result = await agentStructuredOutput(
      agent,
      prompt,
      generatedBatchSchema,
      { temperature: 0 }
    );
    if (!result || result.cases.length !== batch.length) {
      throw new Error("Golden-set author returned an incomplete batch");
    }

    for (const draft of result.cases) {
      const target = batch.find((page) => page.url === draft.targetUrl);
      if (!target) {
        throw new Error(
          `Golden-set author changed target URL: ${draft.targetUrl}`
        );
      }
      generated.push({
        id: slugify(
          draft.id || `${categoryForUrl(target.url)}-${target.title}`
        ),
        question: draft.question,
        category: categoryForUrl(target.url),
        difficulty: draft.difficulty,
        expectUrls: [target.url],
        rejectUrls: draft.rejectUrls.filter((url) => corpusUrls.has(url)),
        requiredClaims: draft.requiredClaims,
        groundTruth: draft.groundTruth,
        tags: draft.tags,
        sourceUrls: [target.url],
      });
    }
  }

  const ids = new Set<string>();
  const cases = generated.map((testCase, index) => {
    let id = testCase.id;
    if (ids.has(id)) id = `${id}-${index + 1}`;
    ids.add(id);
    return { ...testCase, id };
  });
  const pageHashes = Object.fromEntries(
    corpus.pages
      .filter((page) =>
        cases.some((testCase) => testCase.sourceUrls.includes(page.url))
      )
      .map((page) => [page.url, page.contentHash ?? ""])
  );

  return {
    schemaVersion: 1 as const,
    name: `${corpus.source.slug}-retrieval-${cases.length}`,
    sourceId: corpus.source.id,
    sourceSlug: corpus.source.slug,
    strictness: "strict" as const,
    hosting: corpus.source.hosting,
    scope: corpus.source.scope,
    reviewStatus: "draft" as const,
    corpusPin: {
      exportedAt: corpus.exportedAt,
      sourceVersionNumber: corpus.source.versionNumber,
      sourceIndexedAt: corpus.source.indexedAt,
      pageHashes,
    },
    cases,
  };
}
