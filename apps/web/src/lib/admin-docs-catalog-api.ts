import type { DocsPathEntry, TypescriptDocsCatalogEntry } from "@/lib/typescript-docs-catalog";

const ENDPOINT = "/api/admin/typescript-docs-catalog";

export type CatalogPathDraft = DocsPathEntry & {
  confidence?: number;
};

async function parseJson(response: Response) {
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    ok?: boolean;
    entry?: TypescriptDocsCatalogEntry;
    catalogCount?: number;
  };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export async function saveCatalogPackagePaths(input: {
  packageName: string;
  paths: CatalogPathDraft[];
  approve?: boolean;
  pathsReason?: string;
}): Promise<TypescriptDocsCatalogEntry> {
  const response = await fetch(ENDPOINT, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "patch-paths",
      packageName: input.packageName,
      paths: input.paths,
      approve: input.approve ?? false,
      pathsReason: input.pathsReason,
    }),
  });
  const data = await parseJson(response);
  if (!data.entry) throw new Error("Save succeeded but no entry returned");
  return data.entry;
}

export async function upsertCatalogPackage(input: {
  packageName: string;
  docsUrl: string;
  category?: string;
  pathUrl?: string;
  pathLabel?: string;
}): Promise<TypescriptDocsCatalogEntry> {
  const response = await fetch(ENDPOINT, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "upsert-package",
      packageName: input.packageName,
      docsUrl: input.docsUrl,
      category: input.category,
      pathUrl: input.pathUrl,
      pathLabel: input.pathLabel,
    }),
  });
  const data = await parseJson(response);
  if (!data.entry) throw new Error("Upsert succeeded but no entry returned");
  return data.entry;
}

export function pathsEqual(
  a: CatalogPathDraft[],
  b: CatalogPathDraft[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]!;
    const right = b[i]!;
    if (left.url !== right.url) return false;
    if ((left.kind || "other") !== (right.kind || "other")) return false;
    if ((left.label || "") !== (right.label || "")) return false;
  }
  return true;
}
