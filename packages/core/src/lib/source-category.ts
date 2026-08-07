import { getPredefinedSourceCategoryLabel } from "./source-category-presets.js";

/** Normalize admin-entered labels like "js/ts" → "js-ts". */
export function normalizeSourceCategory(input: string): string | null {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/\//g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!slug || slug.length > 48) return null;
  return slug;
}

export function normalizeSourceCategories(inputs: string[]): string[] {
  const unique = new Set<string>();
  for (const input of inputs) {
    const slug = normalizeSourceCategory(input);
    if (slug) unique.add(slug);
  }
  return [...unique].sort();
}

/** Display "js-ts" as "js/ts", or preset label when known. */
export function formatSourceCategoryLabel(slug: string): string {
  return getPredefinedSourceCategoryLabel(slug) ?? slug.replace(/-/g, "/");
}
