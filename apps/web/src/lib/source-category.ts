import { getPredefinedSourceCategoryLabel } from "@/lib/source-category-presets";

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

export function formatSourceCategoryLabel(slug: string): string {
  return getPredefinedSourceCategoryLabel(slug) ?? slug.replace(/-/g, "/");
}
