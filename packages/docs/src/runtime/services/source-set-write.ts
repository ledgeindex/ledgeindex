import { getStore } from "../db/index.js";
import type { SourceSet } from "../db/types.js";
import {
  isValidSourceSlug,
  normalizeSourceSlugInput,
  slugifySourceName,
} from "../lib/source-slug.js";
import {
  assertCanCreateSourceSet,
  assertSourceIdsWithinSetLimit,
} from "./source-set-limits.js";
import { validateSourceIdsForUser } from "./source-set-summary.js";

/**
 * Create or update a source set by slug, with the same validation the HTTP
 * route applies. Upsert rather than create so a script can declare its set on
 * every run without first checking whether it exists.
 */
export async function saveSourceSet(input: {
  ownerUserId: string;
  name: string;
  slug?: string;
  description?: string | null;
  sourceIds: string[];
}): Promise<SourceSet> {
  const slug = normalizeSourceSlugInput(
    input.slug ?? slugifySourceName(input.name),
  );
  if (!isValidSourceSlug(slug)) {
    throw new Error(
      `Invalid source set slug "${slug}". Use lowercase letters, numbers, and hyphens.`,
    );
  }

  const sourceIds = await validateSourceIdsForUser(
    input.sourceIds,
    input.ownerUserId,
  );
  await assertSourceIdsWithinSetLimit(input.ownerUserId, sourceIds);

  const existing = await getStore().getSourceSetBySlug(input.ownerUserId, slug);
  if (existing) {
    const updated = await getStore().updateSourceSet(existing.id, {
      name: input.name,
      description: input.description ?? existing.description,
      sourceIds,
    });
    if (!updated) throw new Error(`Source set not found: ${slug}`);
    return updated;
  }

  await assertCanCreateSourceSet(input.ownerUserId);

  return getStore().createSourceSet({
    ownerUserId: input.ownerUserId,
    name: input.name,
    slug,
    description: input.description ?? null,
    sourceIds,
  });
}
