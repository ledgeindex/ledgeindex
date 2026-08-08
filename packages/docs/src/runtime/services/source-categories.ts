import type { SourceSummary } from "../db/types.js";
import { formatSourceCategoryLabel } from "../lib/source-category.js";

export type SourceCategoryOption = {
  slug: string;
  label: string;
  count: number;
};

export function collectSourceCategoryOptions(
  sources: SourceSummary[],
): SourceCategoryOption[] {
  const counts = new Map<string, number>();

  for (const source of sources) {
    for (const slug of source.categories ?? []) {
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([slug, count]) => ({
      slug,
      label: formatSourceCategoryLabel(slug),
      count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
