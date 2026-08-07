const SLUG_MAX_LENGTH = 64;

export function slugifySourceName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH);

  return base || "source";
}

export function isValidSourceSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug);
}

export function normalizeSourceSlugInput(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH);
}

export function globalSlugOwnerKey(): string {
  return "__global__";
}

export async function ensureUniqueSourceSlug(
  baseSlug: string,
  ownerKey: string,
  isTaken: (slug: string, ownerKey: string) => Promise<boolean>,
): Promise<string> {
  const normalized = normalizeSourceSlugInput(baseSlug) || "source";
  if (!(await isTaken(normalized, ownerKey))) {
    return normalized;
  }

  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${normalized.slice(0, SLUG_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!(await isTaken(candidate, ownerKey))) {
      return candidate;
    }
  }

  return `${normalized.slice(0, 48)}-${Date.now().toString(36)}`;
}
