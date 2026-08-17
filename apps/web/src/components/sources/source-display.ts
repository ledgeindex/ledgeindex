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
