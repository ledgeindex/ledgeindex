import { normalizeStartUrl } from "@/lib/ledgeindex-api";

const STORAGE_KEY = "knowledgeindex:recent-start-urls";
export const MAX_RECENT_START_URLS = 5;

function readStored(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function loadRecentStartUrls(): string[] {
  return readStored().slice(0, MAX_RECENT_START_URLS);
}

export function rememberStartUrls(urls: string[]): string[] {
  if (typeof window === "undefined") return [];

  const normalized = urls
    .map((url) => normalizeStartUrl(url.trim()))
    .filter(Boolean);

  if (normalized.length === 0) {
    return loadRecentStartUrls();
  }

  const next = [...normalized];
  for (const url of readStored()) {
    if (next.length >= MAX_RECENT_START_URLS) break;
    if (!next.includes(url)) next.push(url);
  }

  const capped = next.slice(0, MAX_RECENT_START_URLS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  return capped;
}
