export type SourceCategoryPresetGroup = "kind" | "language";

export type SourceCategoryPreset = {
  slug: string;
  label: string;
  group: SourceCategoryPresetGroup;
};

/**
 * Curated taxonomy for global doc sources (bookshelf shelves).
 * Pick a kind, then optionally tag languages.
 */
export const PREDEFINED_SOURCE_CATEGORIES: SourceCategoryPreset[] = [
  { slug: "frameworks", label: "Frameworks", group: "kind" },
  { slug: "libraries", label: "Libraries", group: "kind" },
  { slug: "apis-services", label: "APIs & Services", group: "kind" },

  { slug: "javascript", label: "JavaScript", group: "language" },
  { slug: "typescript", label: "TypeScript", group: "language" },
  { slug: "python", label: "Python", group: "language" },
  { slug: "other", label: "Other", group: "language" },
  // Legacy combined tag — still recognized when reading old sources.
  { slug: "js-ts", label: "js/ts", group: "language" },
];

/** Older kind slugs → current shelf slug (dashboard + editors stay compatible). */
export const LEGACY_SOURCE_KIND_ALIASES: Record<string, string> = {
  framework: "frameworks",
  library: "libraries",
  service: "apis-services",
  tool: "apis-services",
  "language-docs": "libraries",
};

export const PREDEFINED_SOURCE_CATEGORY_GROUPS: {
  id: SourceCategoryPresetGroup;
  label: string;
}[] = [
  { id: "kind", label: "Shelf" },
  { id: "language", label: "Language (optional)" },
];

export const SOURCE_KIND_PRESETS = PREDEFINED_SOURCE_CATEGORIES.filter(
  (entry) => entry.group === "kind",
);

export const SOURCE_LANGUAGE_PRESETS = PREDEFINED_SOURCE_CATEGORIES.filter(
  (entry) => entry.group === "language" && entry.slug !== "js-ts",
);

const KIND_SLUGS = new Set(SOURCE_KIND_PRESETS.map((entry) => entry.slug));
const LANGUAGE_SLUGS = new Set(
  PREDEFINED_SOURCE_CATEGORIES.filter((entry) => entry.group === "language").map(
    (entry) => entry.slug,
  ),
);

export function normalizeSourceKindSlug(slug: string): string {
  return LEGACY_SOURCE_KIND_ALIASES[slug] ?? slug;
}

export function isSourceKindSlug(slug: string): boolean {
  return KIND_SLUGS.has(normalizeSourceKindSlug(slug));
}

export function isSourceLanguageSlug(slug: string): boolean {
  return LANGUAGE_SLUGS.has(slug);
}

export function splitSourceCategories(categories: string[]): {
  kind: string | null;
  languages: string[];
  custom: string[];
} {
  let kind: string | null = null;
  const languages: string[] = [];
  const custom: string[] = [];

  for (const raw of categories) {
    const slug = normalizeSourceKindSlug(raw);
    if (KIND_SLUGS.has(slug)) {
      kind = slug;
    } else if (isSourceLanguageSlug(raw)) {
      languages.push(raw === "js-ts" ? "javascript" : raw);
    } else if (!LEGACY_SOURCE_KIND_ALIASES[raw]) {
      custom.push(raw);
    }
  }

  return {
    kind,
    languages: [...new Set(languages)].sort(),
    custom: [...new Set(custom)].sort(),
  };
}

export function mergeSourceCategories(input: {
  kind: string | null;
  languages: string[];
  custom?: string[];
}): string[] {
  const merged = [
    ...(input.kind ? [normalizeSourceKindSlug(input.kind)] : []),
    ...input.languages,
    ...(input.custom ?? []),
  ];
  return [...new Set(merged)].sort();
}

export function getPredefinedSourceCategoryLabel(slug: string): string | null {
  const normalized = normalizeSourceKindSlug(slug);
  return (
    PREDEFINED_SOURCE_CATEGORIES.find((entry) => entry.slug === normalized)
      ?.label ?? null
  );
}
