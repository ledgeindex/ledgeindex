import {
  exportSourceCorpus,
  writeSourceCorpusToDirectory,
  type SourceCorpusExport,
  type SourceCorpusExportOptions,
  type WrittenSourceCorpus,
} from "@ledgeindex/core/export/source-corpus.js";
import { resolveSourceRef } from "./sources.js";

export async function exportCorpus(
  sourceIdOrSlug: string,
  options?: SourceCorpusExportOptions,
): Promise<SourceCorpusExport> {
  const source = await resolveSourceRef(sourceIdOrSlug);
  return exportSourceCorpus(source.sourceId, options);
}

export async function exportCorpusToDirectory(
  sourceIdOrSlug: string,
  outputDirectory: string,
  options?: SourceCorpusExportOptions,
): Promise<WrittenSourceCorpus> {
  const corpus = await exportCorpus(sourceIdOrSlug, options);
  return writeSourceCorpusToDirectory(corpus, outputDirectory);
}
