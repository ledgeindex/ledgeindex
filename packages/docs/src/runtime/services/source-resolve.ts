import { getStore } from "../db/index.js";
import type { Source, SourceScope } from "../db/types.js";
import {
  ensureUniqueSourceSlug,
  globalSlugOwnerKey,
  slugifySourceName,
} from "../lib/source-slug.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function slugOwnerKeyForSource(
  scope: SourceScope,
  ownerUserId: string | null,
): string {
  return scope === "global" ? globalSlugOwnerKey() : ownerUserId ?? "";
}

export async function resolveSourceSlugOwnerKey(
  source: Source,
): Promise<string> {
  if (source.scope === "global") return globalSlugOwnerKey();
  const project = await getStore().getProject(source.projectId);
  return project?.ownerUserId ?? "";
}

export async function allocateSourceSlug(input: {
  name: string;
  scope: SourceScope;
  ownerUserId: string | null;
  preferredSlug?: string | null;
}): Promise<string> {
  const ownerKey = slugOwnerKeyForSource(input.scope, input.ownerUserId);
  const base = input.preferredSlug?.trim()
    ? input.preferredSlug
    : slugifySourceName(input.name);

  return ensureUniqueSourceSlug(base, ownerKey, async (slug, key) =>
    getStore().isSourceSlugTaken(slug, key),
  );
}

export async function resolveSourceRefForUser(
  ref: string,
  userId: string,
): Promise<Source | null> {
  const trimmed = ref.trim();
  if (!trimmed) return null;

  if (isUuid(trimmed)) {
    const source = await getStore().getSource(trimmed);
    if (!source) return null;
    if (source.scope === "global") return source;
    const project = await getStore().getProject(source.projectId);
    if (project?.ownerUserId === userId) return source;
    return null;
  }

  const personal = await getStore().getSourceBySlug(trimmed, userId);
  if (personal) return personal;

  return getStore().getSourceBySlug(trimmed, globalSlugOwnerKey());
}
