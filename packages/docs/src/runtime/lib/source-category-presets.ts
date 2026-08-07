export type SourceCategoryPresetGroup = "kind" | "language";

export type SourceCategoryPreset = {
  slug: string;
  label: string;
  group: SourceCategoryPresetGroup;
};

export const PREDEFINED_SOURCE_CATEGORIES: SourceCategoryPreset[] = [
  { slug: "frameworks", label: "Frameworks", group: "kind" },
  { slug: "libraries", label: "Libraries", group: "kind" },
  { slug: "apis-services", label: "APIs & Services", group: "kind" },
  { slug: "js-ts", label: "js/ts", group: "language" },
  { slug: "python", label: "Python", group: "language" },
];

const LEGACY_SOURCE_KIND_ALIASES: Record<string, string> = {
  framework: "frameworks",
  library: "libraries",
  service: "apis-services",
  tool: "apis-services",
  "language-docs": "libraries",
};

export function getPredefinedSourceCategoryLabel(slug: string): string | null {
  const normalized = LEGACY_SOURCE_KIND_ALIASES[slug] ?? slug;
  return (
    PREDEFINED_SOURCE_CATEGORIES.find((entry) => entry.slug === normalized)
      ?.label ?? null
  );
}
