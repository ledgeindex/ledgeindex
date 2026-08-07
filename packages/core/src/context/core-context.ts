import { noopLogger, type Logger } from "../types/logger.js";
import type { ChunkSearch } from "../types/chunk-search.js";
import type { Embedder } from "../types/embedder.js";
import type { SourceRecords } from "../types/source-records.js";

export type CoreContext = {
  dataDir: string;
  sourceRecords: SourceRecords;
  chunkSearch: ChunkSearch;
  embedder: Embedder;
  logger: Logger;
};

export type CreateCoreContextInput = {
  dataDir: string;
  sourceRecords: SourceRecords;
  chunkSearch: ChunkSearch;
  embedder: Embedder;
  logger?: Logger;
};

export function createCoreContext(input: CreateCoreContextInput): CoreContext {
  return {
    dataDir: input.dataDir,
    sourceRecords: input.sourceRecords,
    chunkSearch: input.chunkSearch,
    embedder: input.embedder,
    logger: input.logger ?? noopLogger,
  };
}
