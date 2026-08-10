import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type DocsPathKind =
  | "guides"
  | "api"
  | "examples"
  | "reference"
  | "home"
  | "other";

export type DocsPathWrite = {
  kind: DocsPathKind | string;
  url: string;
  label?: string;
  confidence?: number;
};

export type DocsListEntry = {
  package: string;
  category?: string;
  docs?: string | null;
  apiReferenceUrls?: string[];
  paths?: DocsPathWrite[];
  startUrls?: string[];
  pathsStatus?: string | null;
  pathsReason?: string | null;
  [key: string]: unknown;
};

const PATH_KINDS = new Set([
  "guides",
  "api",
  "examples",
  "reference",
  "home",
  "other",
]);

function ledgeindexRootFromCwd(): string {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, "../.."), // apps/web → ledgeindex
    path.resolve(cwd, "ledgeindex"),
    cwd,
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "top-typescript-docs.json"))) return dir;
    if (existsSync(path.join(dir, "apps/web/package.json"))) return dir;
  }
  return path.resolve(cwd, "../..");
}

export function resolveDocsCatalogPaths(): {
  root: string;
  sourcePath: string;
  catalogPath: string;
} {
  const root = ledgeindexRootFromCwd();
  return {
    root,
    sourcePath: path.join(root, "top-typescript-docs.json"),
    catalogPath: path.join(
      root,
      "apps/web/public/data/typescript-docs-catalog.json",
    ),
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}

function normalizePathKey(url: string): string {
  return normalizeUrl(url).toLowerCase();
}

function packageKey(entry: DocsListEntry): string {
  return String(entry.package || "").trim();
}

function normalizePathEntry(row: DocsPathWrite): DocsPathWrite | null {
  const url = normalizeUrl(String(row.url || ""));
  if (!url) return null;
  const kindRaw = String(row.kind || "other");
  const kind = PATH_KINDS.has(kindRaw) ? kindRaw : "other";
  const out: DocsPathWrite = { kind, url };
  if (row.label && String(row.label).trim()) {
    out.label = String(row.label).trim();
  }
  if (typeof row.confidence === "number" && Number.isFinite(row.confidence)) {
    out.confidence = row.confidence;
  }
  return out;
}

function runCatalogSync(root: string) {
  const script = path.join(root, "scripts/sync-typescript-docs-catalog.mjs");
  if (!existsSync(script)) {
    throw new Error(`Missing sync script: ${script}`);
  }
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() ||
        result.stdout?.trim() ||
        `Catalog sync failed (exit ${result.status})`,
    );
  }
}

export function readDocsSourceList(): {
  sourcePath: string;
  catalogPath: string;
  entries: DocsListEntry[];
} {
  const { sourcePath, catalogPath } = resolveDocsCatalogPaths();
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing docs list: ${sourcePath}`);
  }
  const raw = JSON.parse(readFileSync(sourcePath, "utf8")) as unknown;
  const entries = Array.isArray(raw)
    ? (raw as DocsListEntry[])
    : asArray<DocsListEntry>((raw as { entries?: unknown }).entries);
  return { sourcePath, catalogPath, entries };
}

export function writeDocsSourceAndSync(entries: DocsListEntry[]) {
  const { root, sourcePath, catalogPath } = resolveDocsCatalogPaths();
  writeFileSync(sourcePath, `${JSON.stringify(entries, null, 2)}\n`);
  runCatalogSync(root);
  return { sourcePath, catalogPath, count: entries.length };
}

export type PatchPackagePathsInput = {
  packageName: string;
  paths?: DocsPathWrite[];
  pathsStatus?: string | null;
  pathsReason?: string | null;
  approve?: boolean;
};

export function patchPackagePaths(input: PatchPackagePathsInput) {
  const { entries } = readDocsSourceList();
  const want = input.packageName.trim().toLowerCase();
  const index = entries.findIndex(
    (row) => packageKey(row).toLowerCase() === want,
  );
  if (index < 0) {
    throw new Error(`Package not found: ${input.packageName}`);
  }

  const entry = { ...entries[index]! };
  if (input.paths) {
    const normalized = input.paths
      .map((row) => normalizePathEntry(row))
      .filter(Boolean) as DocsPathWrite[];
    const seen = new Set<string>();
    const deduped: DocsPathWrite[] = [];
    for (const row of normalized) {
      const key = normalizePathKey(row.url);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
    }
    entry.paths = deduped;
    entry.startUrls = deduped.map((p) => p.url);
  }

  if (input.approve) {
    entry.pathsStatus = "discovered";
    entry.pathsReason =
      input.pathsReason?.trim() ||
      "Approved in Source updater (manual path review)";
  } else {
    if (input.pathsStatus !== undefined) {
      entry.pathsStatus = input.pathsStatus;
    }
    if (input.pathsReason !== undefined) {
      entry.pathsReason = input.pathsReason;
    }
  }

  entries[index] = entry;
  const written = writeDocsSourceAndSync(entries);
  return { entry, ...written, catalog: { count: written.count } };
}

export type UpsertManualPackageInput = {
  packageName: string;
  docsUrl: string;
  category?: string;
  pathUrl?: string;
  pathKind?: string;
  pathLabel?: string;
};

export function upsertManualPackage(input: UpsertManualPackageInput) {
  const { entries } = readDocsSourceList();
  const packageName = input.packageName.trim();
  const docsUrl = normalizeUrl(input.docsUrl);
  if (!packageName) throw new Error("packageName is required");
  if (!docsUrl) throw new Error("docsUrl is required");

  const want = packageName.toLowerCase();
  let index = entries.findIndex(
    (row) => packageKey(row).toLowerCase() === want,
  );

  const pathUrl = normalizeUrl(input.pathUrl || docsUrl);
  const pathEntry = normalizePathEntry({
    kind: input.pathKind || "guides",
    url: pathUrl,
    label: input.pathLabel,
    confidence: 1,
  });

  if (index < 0) {
    const fresh: DocsListEntry = {
      package: packageName,
      category: input.category?.trim() || "uncategorized",
      docs: docsUrl,
      apiReferenceUrls: [],
      paths: pathEntry ? [pathEntry] : [],
      startUrls: pathEntry ? [pathEntry.url] : [docsUrl],
      pathsStatus: "discovered",
      pathsReason: "Added manually in Source updater",
      excludePatterns: [],
      patternsAreRegex: false,
      versions: ["latest"],
      selectedVersion: "latest",
      docsStatus: "verified",
      isRedirect: false,
      finalDocsUrl: docsUrl,
      redirectUncrawlable: false,
    };
    entries.push(fresh);
    index = entries.length - 1;
  } else {
    const entry = { ...entries[index]! };
    entry.docs = docsUrl;
    if (input.category?.trim()) entry.category = input.category.trim();
    const existing = asArray<DocsPathWrite>(entry.paths);
    if (pathEntry) {
      const key = normalizePathKey(pathEntry.url);
      if (!existing.some((p) => normalizePathKey(p.url) === key)) {
        existing.push(pathEntry);
      }
    }
    entry.paths = existing;
    entry.startUrls = existing.map((p) => p.url);
    if (!entry.pathsStatus) {
      entry.pathsStatus = "discovered";
      entry.pathsReason = "Updated manually in Source updater";
    }
    entries[index] = entry;
  }

  const written = writeDocsSourceAndSync(entries);
  return {
    entry: entries[index]!,
    ...written,
    catalog: { count: written.count },
  };
}
