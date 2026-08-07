export type ChunkSearchFilter = Record<string, unknown>;

export type ChunkSearchHit = {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
  text?: string;
};

export type ChunkSearch = {
  ensureIndex(): Promise<void>;
  upsert(
    indexName: string,
    items: Array<{
      id: string;
      vector: number[];
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<void>;
  query(params: {
    indexName: string;
    queryVector: number[];
    topK: number;
    filter?: ChunkSearchFilter;
  }): Promise<ChunkSearchHit[]>;
  deleteByFilter?(indexName: string, filter: ChunkSearchFilter): Promise<void>;
};
