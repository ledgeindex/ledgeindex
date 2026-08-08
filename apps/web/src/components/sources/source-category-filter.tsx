"use client";

import { cn } from "@/lib/utils";
import { formatSourceCategoryLabel } from "@/lib/source-category";
import { SOURCE_KIND_PRESETS } from "@/lib/source-category-presets";
import type { SourceCategoryOption } from "@/lib/ledgeindex-api";

export function SourceCategoryFilterBar({
  categories,
  selected,
  onChange,
  className,
  /** Always show bookshelf shelves (even at 0), plus any extra tags. */
  showShelfPresets = false,
}: {
  categories: SourceCategoryOption[];
  selected: string | null;
  onChange: (slug: string | null) => void;
  className?: string;
  showShelfPresets?: boolean;
}) {
  const options = showShelfPresets
    ? mergeShelfFilterOptions(categories)
    : categories;

  if (options.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        className,
      )}
    >
      <FilterBadge
        active={selected === null}
        onClick={() => onChange(null)}
      >
        All shelves
      </FilterBadge>
      {options.map((category) => (
        <FilterBadge
          key={category.slug}
          active={selected === category.slug}
          onClick={() =>
            onChange(selected === category.slug ? null : category.slug)
          }
        >
          {category.label}
          <span className="opacity-60">({category.count})</span>
        </FilterBadge>
      ))}
    </div>
  );
}

function mergeShelfFilterOptions(
  categories: SourceCategoryOption[],
): SourceCategoryOption[] {
  const bySlug = new Map(categories.map((entry) => [entry.slug, entry]));
  const shelves = SOURCE_KIND_PRESETS.map((preset) => ({
    slug: preset.slug,
    label: preset.label,
    count: bySlug.get(preset.slug)?.count ?? 0,
  }));
  const extras = categories.filter(
    (entry) => !SOURCE_KIND_PRESETS.some((preset) => preset.slug === entry.slug),
  );
  return [...shelves, ...extras];
}

export function SourceCategoryBadges({
  categories,
  className,
}: {
  categories: string[];
  className?: string;
}) {
  if (!categories.length) return null;

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {categories.map((slug) => (
        <span
          key={slug}
          className="inline-flex items-center rounded-md border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase"
        >
          {formatSourceCategoryLabel(slug)}
        </span>
      ))}
    </div>
  );
}

function FilterBadge({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[0.5625rem] font-semibold tracking-[0.08em] uppercase transition-colors",
        active
          ? "border-foreground/20 bg-foreground text-background"
          : "border-border bg-card-solid text-muted hover:border-foreground/15 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
