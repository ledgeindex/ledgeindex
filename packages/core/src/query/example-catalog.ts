import type { ExampleKind } from "../enrich/schemas.js";
import { normalizeExampleLanguage } from "../enrich/example-language.js";

export type ExampleCatalogEntry = {
  url: string;
  pageTitle: string;
  exampleTitle: string;
  kind: ExampleKind | string;
  language: string | null;
  section: string;
  exampleIndex: number;
};

export type ExampleCatalog = {
  sourceId: string;
  examples: ExampleCatalogEntry[];
  updatedAt: string;
};

/** Build example catalog rows from prepared chunk metadata (chunkKind=example). */
export function buildExampleCatalogFromMetadata(
  sourceId: string,
  metadata: Record<string, unknown>[],
): ExampleCatalog {
  const byKey = new Map<string, ExampleCatalogEntry>();

  for (const item of metadata) {
    if (String(item.chunkKind ?? "") !== "example") continue;
    const url = String(item.url ?? item.parentUrl ?? "").trim();
    if (!url) continue;
    const exampleIndex = Number(item.exampleIndex ?? 0);
    const key = `${url}::${exampleIndex}`;
    if (byKey.has(key)) continue;

    const language = normalizeExampleLanguage(
      typeof item.exampleLanguage === "string"
        ? item.exampleLanguage
        : typeof item.language === "string"
          ? item.language
          : null,
    );

    byKey.set(key, {
      url,
      pageTitle: String(item.title ?? "").trim() || url,
      exampleTitle: String(item.exampleTitle ?? item.title ?? "Example").trim(),
      kind: String(item.exampleKind ?? "other"),
      language,
      section: String(item.section ?? "General").trim() || "General",
      exampleIndex,
    });
  }

  const examples = [...byKey.values()].sort((a, b) => {
    const byUrl = a.url.localeCompare(b.url);
    if (byUrl !== 0) return byUrl;
    return a.exampleIndex - b.exampleIndex;
  });

  return {
    sourceId,
    examples,
    updatedAt: new Date().toISOString(),
  };
}

/** Compact catalog text for the example rewrite agent. */
export function formatExampleCatalogText(catalog: ExampleCatalog): string {
  if (catalog.examples.length === 0) {
    return "(no indexed examples yet)";
  }
  return catalog.examples
    .slice(0, 200)
    .map((ex) => {
      const lang = ex.language ?? "-";
      return `${ex.kind} | ${lang} | ${ex.section} | ${ex.exampleTitle}`;
    })
    .join("\n");
}
