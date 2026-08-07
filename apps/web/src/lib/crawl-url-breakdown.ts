export type CrawlUrlBreakdownGroup = {
  segment: string;
  count: number;
  sampleUrls: string[];
};

export function groupDiscoveredUrlsByPath(
  urls: Array<{ url: string; title?: string }>,
  maxGroups = 12,
): CrawlUrlBreakdownGroup[] {
  const groups = new Map<string, { count: number; samples: string[] }>();

  for (const item of urls) {
    let segment = "(root)";
    try {
      const parts = new URL(item.url).pathname.split("/").filter(Boolean);
      segment = parts[0] ?? "(root)";
    } catch {
      segment = "(invalid)";
    }

    const entry = groups.get(segment) ?? { count: 0, samples: [] };
    entry.count += 1;
    if (entry.samples.length < 3) {
      entry.samples.push(item.url);
    }
    groups.set(segment, entry);
  }

  return [...groups.entries()]
    .map(([segment, data]) => ({
      segment,
      count: data.count,
      sampleUrls: data.samples,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, maxGroups);
}

export function filterUrlsByPathSegment(
  urls: Array<{ url: string }>,
  segment: string,
): string[] {
  return urls
    .filter((item) => {
      try {
        const parts = new URL(item.url).pathname.split("/").filter(Boolean);
        const first = parts[0] ?? "(root)";
        return first === segment;
      } catch {
        return false;
      }
    })
    .map((item) => item.url);
}

export type PathSegmentSelectionState = "none" | "partial" | "all";

export function getPathSegmentSelectionState(
  urls: Array<{ url: string }>,
  segment: string,
  selectedUrls: string[],
): PathSegmentSelectionState {
  const segmentUrls = filterUrlsByPathSegment(urls, segment);
  if (segmentUrls.length === 0) return "none";

  const selectedCount = segmentUrls.filter((url) =>
    selectedUrls.includes(url),
  ).length;
  if (selectedCount === 0) return "none";
  if (selectedCount === segmentUrls.length) return "all";
  return "partial";
}

export function collectUrlsForPathSegments(
  urls: Array<{ url: string }>,
  segments: string[],
): string[] {
  const merged = new Set<string>();
  for (const segment of segments) {
    for (const url of filterUrlsByPathSegment(urls, segment)) {
      merged.add(url);
    }
  }
  return [...merged];
}
