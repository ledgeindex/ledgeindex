export function formatUrlLabel(url: string) {
  try {
    const parsed = new URL(url);
    const path =
      parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname}${path}`;
  } catch {
    return url;
  }
}

/** Short line for source pickers (storage + page count). */
export function formatSourceListMeta(source: {
  scope?: "personal" | "global";
  hosting?: "local" | "cloud";
  pageCount: number;
}): string {
  const storage =
    source.scope === "global"
      ? "Public"
      : source.hosting === "cloud"
        ? "Cloud"
        : "Local";
  const pages = source.pageCount;
  return `${storage} · ${pages} page${pages === 1 ? "" : "s"}`;
}

export function formatIndexedAt(value: string | null) {
  if (!value) return "Not indexed";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

/** Compact "2d ago" for tight chrome. Falls back to {@link formatIndexedAt}. */
export function formatIndexedAtRelative(value: string | null): string {
  if (!value) return "Not indexed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const deltaMs = Date.now() - date.getTime();
  if (deltaMs < 0) return formatIndexedAt(value);
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return formatIndexedAt(value);
}
