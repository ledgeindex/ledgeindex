import { getStore } from "../db/index.js";
import type { SourceSet, SourceSetSummary } from "../db/types.js";
import { canReadSource } from "../lib/resource-access.js";

export async function toSourceSetSummary(
  sourceSet: SourceSet,
  userId: string,
): Promise<SourceSetSummary> {
  const sources = [];
  for (const sourceId of sourceSet.sourceIds) {
    const source = await getStore().getSource(sourceId);
    if (!source) continue;
    if (!(await canReadSource(source, userId))) continue;
    sources.push({
      id: source.id,
      slug: source.slug,
      name: source.name,
      scope: source.scope ?? "personal",
      sourceType: source.sourceMetadata?.sourceType ?? "unknown",
    });
  }

  return {
    id: sourceSet.id,
    name: sourceSet.name,
    slug: sourceSet.slug,
    description: sourceSet.description,
    sourceCount: sources.length,
    sources,
  };
}

export async function listSourceSetSummaries(
  userId: string,
): Promise<SourceSetSummary[]> {
  const sourceSets = await getStore().listSourceSets(userId);
  return Promise.all(sourceSets.map((sourceSet) => toSourceSetSummary(sourceSet, userId)));
}

export async function getSourceSetSummary(
  sourceSet: SourceSet,
  userId: string,
): Promise<SourceSetSummary> {
  return toSourceSetSummary(sourceSet, userId);
}

export async function validateSourceIdsForUser(
  sourceIds: string[],
  userId: string,
): Promise<string[]> {
  const valid: string[] = [];
  for (const sourceId of sourceIds) {
    const source = await getStore().getSource(sourceId);
    if (!source) continue;
    if (await canReadSource(source, userId)) {
      valid.push(source.id);
    }
  }
  return valid;
}
