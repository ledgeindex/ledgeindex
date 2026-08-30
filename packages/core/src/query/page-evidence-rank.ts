const SECOND_EVIDENCE_WEIGHT = 0.15;
const THIRD_EVIDENCE_WEIGHT = 0.075;
const DEFAULT_ANCHOR_MARGIN = 0.08;

export type PageEvidenceChunk = {
  url: string;
  score: number;
  retrievalKind?: "direct" | "expanded";
};

export type PageEvidenceScore = {
  url: string;
  score: number;
  bestDirectScore: number;
  directHitCount: number;
};

export type PageEvidenceRanking<T extends PageEvidenceChunk> = {
  chunks: T[];
  pages: PageEvidenceScore[];
  anchor: PageEvidenceScore | null;
};

export function pageEvidenceAggregationEnabled(): boolean {
  const raw =
    process.env.LEDGEINDEX_PAGE_EVIDENCE_AGGREGATION?.trim().toLowerCase();
  if (!raw) return false;
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function pageKey<T extends PageEvidenceChunk>(chunk: T, index: number): string {
  return chunk.url.trim() || `__chunk_${index}`;
}

/**
 * Rank pages using only scores the existing reranker already produced.
 * Additional strong hits provide diminishing corroboration; expanded sibling
 * chunks never influence the score because their scores are placeholders.
 */
export function rankChunksByPageEvidence<T extends PageEvidenceChunk>(
  chunks: T[],
  options?: { anchorMargin?: number }
): PageEvidenceRanking<T> {
  const groups = new Map<
    string,
    { url: string; firstIndex: number; chunks: T[]; directScores: number[] }
  >();

  chunks.forEach((chunk, index) => {
    const key = pageKey(chunk, index);
    const group = groups.get(key) ?? {
      url: chunk.url.trim(),
      firstIndex: index,
      chunks: [],
      directScores: [],
    };
    group.chunks.push(chunk);
    if (chunk.retrievalKind !== "expanded" && Number.isFinite(chunk.score)) {
      group.directScores.push(chunk.score);
    }
    groups.set(key, group);
  });

  const rankedGroups = [...groups.values()]
    .map((group) => {
      const directScores = group.directScores.sort((a, b) => b - a);
      const bestDirectScore = directScores[0] ?? 0;
      const score =
        bestDirectScore +
        SECOND_EVIDENCE_WEIGHT * (directScores[1] ?? 0) +
        THIRD_EVIDENCE_WEIGHT * (directScores[2] ?? 0);
      return {
        ...group,
        evidence: {
          url: group.url,
          score,
          bestDirectScore,
          directHitCount: directScores.length,
        } satisfies PageEvidenceScore,
      };
    })
    .sort(
      (left, right) =>
        right.evidence.score - left.evidence.score ||
        left.firstIndex - right.firstIndex
    );

  const pages = rankedGroups.map((group) => group.evidence);
  const first = pages[0];
  const second = pages[1];
  const margin = first ? first.score - (second?.score ?? 0) : 0;
  const anchorMargin = options?.anchorMargin ?? DEFAULT_ANCHOR_MARGIN;
  const anchor =
    first && (pages.length === 1 || margin >= anchorMargin) ? first : null;

  return {
    chunks: anchor
      ? rankedGroups.flatMap((group) => group.chunks)
      : [...chunks],
    pages,
    anchor,
  };
}
