import {
  exportSourceCorpus,
  writeSourceCorpusToDirectory,
  type SourceCorpusExport,
  type SourceCorpusExportOptions,
  type SourceCorpusWriteOptions,
  type WrittenSourceCorpus,
} from "@ledgeindex/core/export/source-corpus.js";
import { resolveSourceRef } from "./sources.js";

export type ExportCorpusToDirectoryOptions = SourceCorpusExportOptions &
  SourceCorpusWriteOptions;

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
  options: ExportCorpusToDirectoryOptions = {},
): Promise<WrittenSourceCorpus> {
  const { pageLayout, ...exportOptions } = options;
  const corpus = await exportCorpus(sourceIdOrSlug, exportOptions);
  return writeSourceCorpusToDirectory(corpus, outputDirectory, { pageLayout });
}
