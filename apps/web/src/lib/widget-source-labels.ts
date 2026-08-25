import { authenticatedFetch, type SourceSummary } from "@/lib/ledgeindex-api";
import type { WidgetIntegrationSummary } from "@/lib/widget-api";
import { resolveWidgetCloudApiBaseUrl } from "@/lib/widget-api";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WidgetSourceLabel = {
  id: string;
  name: string;
  startUrl?: string;
  scope: "personal" | "global";
};

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function labelFromStartUrl(startUrl: string | undefined): string | null {
  const url = startUrl?.trim();
  if (!url) return null;
  return hostnameFromUrl(url);
}

export function labelFromSourceSummary(source: SourceSummary): WidgetSourceLabel {
  const startUrl = source.startUrl?.trim() || source.startUrls?.[0]?.trim() || undefined;
  const name =
    source.name?.trim() ||
    source.slug?.trim() ||
    labelFromStartUrl(startUrl) ||
    source.id;
  return {
    id: source.id,
    name,
    startUrl,
    scope: source.scope === "global" ? "global" : "personal",
  };
}

function labelFromApiSource(source: {
  id: string;
  name?: string | null;
  slug?: string | null;
  scope?: string | null;
  config?: { startUrls?: string[] };
}): WidgetSourceLabel {
  const startUrl = source.config?.startUrls?.[0]?.trim() || undefined;
  const name =
    source.name?.trim() ||
    source.slug?.trim() ||
    labelFromStartUrl(startUrl) ||
    source.id;
  return {
    id: source.id,
    name,
    startUrl,
    scope: source.scope === "global" ? "global" : "personal",
  };
}

export function labelFromWidgetSource(
  source: NonNullable<WidgetIntegrationSummary["sources"]>[number],
): WidgetSourceLabel {
  const startUrl = source.startUrl?.trim() || undefined;
  const name =
    source.name?.trim() && !isUuid(source.name)
      ? source.name.trim()
      : labelFromStartUrl(startUrl) || source.name?.trim() || source.id;
  return {
    id: source.id,
    name,
    startUrl,
    scope: source.scope,
  };
}

async function fetchCloudSourceLabel(
  id: string,
  cloudBase: string,
): Promise<WidgetSourceLabel | null> {
  const url = `${cloudBase.replace(/\/$/, "")}/api/sources/${encodeURIComponent(id)}`;
  const res = await authenticatedFetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    source?: {
      id: string;
      name?: string | null;
      slug?: string | null;
      scope?: string | null;
      config?: { startUrls?: string[] };
    };
  };
  if (!json.source) return null;
  return labelFromApiSource(json.source);
}

function unknownSourceLabel(id: string): WidgetSourceLabel {
  return { id, name: "Unknown source", scope: "personal" };
}

export function formatWidgetSourceLabels(labels: WidgetSourceLabel[]): string {
  if (labels.length === 0) return "No source linked";
  return labels
    .map((label) =>
      label.scope === "global" ? `${label.name} (public)` : label.name,
    )
    .join(", ");
}

/** Resolve human-readable source names/URLs for widget cards (cloud API). */
export async function resolveWidgetSourceLabels(
  widgets: WidgetIntegrationSummary[],
  catalog: SourceSummary[],
): Promise<Record<string, WidgetSourceLabel>> {
  const cloudBase = resolveWidgetCloudApiBaseUrl();
  const ids = [...new Set(widgets.flatMap((row) => row.sourceIds))];
  const byId = new Map<string, WidgetSourceLabel>();

  for (const source of catalog) {
    const label = labelFromSourceSummary(source);
    byId.set(source.id, label);
    if (source.sourceFamilyId && source.sourceFamilyId !== source.id) {
      byId.set(source.sourceFamilyId, label);
    }
  }

  for (const row of widgets) {
    for (const source of row.sources ?? []) {
      byId.set(source.id, labelFromWidgetSource(source));
    }
  }

  await Promise.all(
    ids.map(async (id) => {
      const existing = byId.get(id);
      if (existing && existing.name !== id && !isUuid(existing.name)) return;

      try {
        const label = await fetchCloudSourceLabel(id, cloudBase);
        if (label) {
          byId.set(id, label);
          return;
        }
      } catch {
        // fall through to unknown / catalog fallback
      }
      if (!byId.has(id) || byId.get(id)?.name === id || isUuid(byId.get(id)?.name ?? "")) {
        byId.set(id, unknownSourceLabel(id));
      }
    }),
  );

  return Object.fromEntries(byId);
}

export function widgetSourceLabelsForRow(
  row: WidgetIntegrationSummary,
  byId: Record<string, WidgetSourceLabel>,
): WidgetSourceLabel[] {
  return row.sourceIds.map((id) => {
    const fromRow = row.sources?.find((source) => source.id === id);
    if (fromRow) {
      const label = labelFromWidgetSource(fromRow);
      if (label.name !== id && !isUuid(label.name)) return label;
    }
    const resolved = byId[id];
    if (resolved && resolved.name !== id && !isUuid(resolved.name)) {
      return resolved;
    }
    return resolved ?? unknownSourceLabel(id);
  });
}
