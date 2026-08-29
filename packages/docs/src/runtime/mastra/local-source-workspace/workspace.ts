import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  SOURCE_CORPUS_EXPORT_VERSION,
  exportSourceCorpus,
  writeSourceCorpusToDirectory,
  type SourceCorpusExport,
} from "@ledgeindex/core/export/source-corpus.js";
import {
  LocalFilesystem,
  Workspace,
  WORKSPACE_TOOLS,
} from "@mastra/core/workspace";
import type { RequestContext } from "@mastra/core/request-context";
import type { Source } from "../../db/types.js";
import { dataPath } from "../../lib/data-dir.js";
import {
  LocalAgentSelectionError,
  localAgentUserId,
  readLocalAgentSelection,
  resolveLocalAgentSelection,
  type LocalAgentSelection,
  type ResolvedLocalAgentSelection,
} from "./selection.js";

const WORKSPACE_LAYOUT_VERSION = 3;
const DEFAULT_MAX_PAGES = 10_000;
const DEFAULT_MAX_BYTES = 250 * 1024 * 1024;
const CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const STAGING_RETENTION_MS = 60 * 60 * 1_000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;
const MAX_MEMORY_WORKSPACES = 16;

export type MaterializedWorkspace = {
  key: string;
  path: string;
  sourceCount: number;
  pageCount: number;
  fileCount: number;
  byteCount: number;
  cacheHit: boolean;
};

export type PreparedLocalSourceWorkspace = MaterializedWorkspace & {
  workspace: Workspace;
};

type WorkspaceManifest = Omit<MaterializedWorkspace, "path" | "cacheHit"> & {
  format: "ledgeindex.local-agent-workspace";
  formatVersion: typeof WORKSPACE_LAYOUT_VERSION;
  createdAt: string;
  sources: Array<{
    id: string;
    slug: string;
    name: string;
    indexedAt: string | null;
    versionNumber: number;
    directory: string;
    manifestPath: string;
  }>;
};

const workspacePromises = new Map<
  string,
  { promise: Promise<PreparedLocalSourceWorkspace>; lastUsedAt: number }
>();
let lastCleanupAt = 0;

function positiveEnvInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function workspaceRoot(): string {
  return (
    process.env.LEDGEINDEX_AGENT_WORKSPACE_DIR?.trim() ||
    dataPath("agent-workspaces")
  );
}

function sourceDirectory(source: Source): string {
  const slug =
    source.slug
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "source";
  return `${slug}-${source.id.slice(0, 8)}`;
}

function corpusWithPageMetadata(
  corpus: SourceCorpusExport,
  source: Source,
): SourceCorpusExport {
  return {
    ...corpus,
    pages: corpus.pages.map((page) => ({
      ...page,
      markdown: [
        "---",
        `title: ${JSON.stringify(page.title || page.url)}`,
        `url: ${JSON.stringify(page.url)}`,
        `source: ${JSON.stringify(source.name)}`,
        `source_slug: ${JSON.stringify(source.slug)}`,
        `category: ${JSON.stringify(page.category)}`,
        "---",
        "",
        page.markdown,
      ].join("\n"),
    })),
  };
}

function selectionKey(resolved: ResolvedLocalAgentSelection): string {
  const identity = {
    layoutVersion: WORKSPACE_LAYOUT_VERSION,
    corpusVersion: SOURCE_CORPUS_EXPORT_VERSION,
    sources: resolved.sources.map((source) => ({
      id: source.id,
      indexedAt: source.indexedAt ?? null,
      versionNumber: source.versionNumber ?? 1,
      pageCount: source.indexStats?.pageCount ?? 0,
      chunkCount: source.indexStats?.chunkCount ?? 0,
    })),
  };
  return createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex")
    .slice(0, 24);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function cleanupOldWorkspaceDirectories(): Promise<void> {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;

  const root = workspaceRoot();
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const active = workspacePromises.has(entry.name);
        if (active) return;
        const path = join(root, entry.name);
        try {
          const details = await stat(path);
          const retention = entry.name.startsWith(".staging-")
            ? STAGING_RETENTION_MS
            : CACHE_RETENTION_MS;
          if (now - details.mtimeMs > retention) {
            await rm(path, { recursive: true, force: true });
          }
        } catch {
          // A concurrent cleanup or publisher may have moved the directory.
        }
      }),
  );
}

async function readMaterializedWorkspace(input: {
  key: string;
  path: string;
}): Promise<MaterializedWorkspace | null> {
  try {
    const raw = await readFile(join(input.path, "manifest.json"), "utf8");
    const manifest = JSON.parse(raw) as Partial<WorkspaceManifest>;
    if (
      manifest.format !== "ledgeindex.local-agent-workspace" ||
      manifest.formatVersion !== WORKSPACE_LAYOUT_VERSION ||
      manifest.key !== input.key
    ) {
      return null;
    }
    if (
      typeof manifest.sourceCount !== "number" ||
      typeof manifest.pageCount !== "number" ||
      typeof manifest.fileCount !== "number" ||
      typeof manifest.byteCount !== "number"
    ) {
      return null;
    }
    return {
      key: input.key,
      path: input.path,
      sourceCount: manifest.sourceCount,
      pageCount: manifest.pageCount,
      fileCount: manifest.fileCount,
      byteCount: manifest.byteCount,
      cacheHit: true,
    };
  } catch {
    return null;
  }
}

async function materializeWorkspace(
  resolved: ResolvedLocalAgentSelection,
): Promise<MaterializedWorkspace> {
  const key = selectionKey(resolved);
  const root = workspaceRoot();
  const finalPath = join(root, key);
  await mkdir(root, { recursive: true });

  const existing = await readMaterializedWorkspace({ key, path: finalPath });
  if (existing) return existing;

  const stagingPath = join(root, `.staging-${key}-${randomUUID()}`);
  const maxPages = positiveEnvInteger(
    "LEDGEINDEX_AGENT_WORKSPACE_MAX_PAGES",
    DEFAULT_MAX_PAGES,
  );
  const maxBytes = positiveEnvInteger(
    "LEDGEINDEX_AGENT_WORKSPACE_MAX_BYTES",
    DEFAULT_MAX_BYTES,
  );

  let pageCount = 0;
  let fileCount = 0;
  let byteCount = 0;
  const manifestSources: WorkspaceManifest["sources"] = [];

  try {
    await mkdir(join(stagingPath, "content"), { recursive: true });
    await mkdir(join(stagingPath, "metadata", "sources"), {
      recursive: true,
    });
    for (const source of resolved.sources) {
      const exportedCorpus = await exportSourceCorpus(source.id, {
        includeContent: true,
        includeChunks: false,
      });
      const corpus = corpusWithPageMetadata(exportedCorpus, source);
      pageCount += corpus.pages.length;
      byteCount += corpus.pages.reduce(
        (sum, page) => sum + Buffer.byteLength(page.markdown, "utf8"),
        0,
      );
      if (pageCount > maxPages) {
        throw new LocalAgentSelectionError(
          "limit-exceeded",
          `The selected sources contain ${pageCount} pages. The Agent mode limit is ${maxPages}.`,
        );
      }
      if (byteCount > maxBytes) {
        throw new LocalAgentSelectionError(
          "limit-exceeded",
          `The selected sources exceed the Agent mode file limit of ${maxBytes} bytes.`,
        );
      }

      const directory = sourceDirectory(source);
      const sourcePath = join(stagingPath, "content", directory);
      const written = await writeSourceCorpusToDirectory(corpus, sourcePath, {
        pageLayout: "named-files",
      });
      const privateManifestPath = join(
        stagingPath,
        "metadata",
        "sources",
        `${directory}.json`,
      );
      await rename(written.manifestPath, privateManifestPath);
      fileCount += written.pageFiles.length;
      manifestSources.push({
        id: source.id,
        slug: source.slug,
        name: source.name,
        indexedAt: source.indexedAt ?? null,
        versionNumber: source.versionNumber ?? 1,
        directory: `content/${directory}`,
        manifestPath: `metadata/sources/${directory}.json`,
      });
    }

    const manifest: WorkspaceManifest = {
      format: "ledgeindex.local-agent-workspace",
      formatVersion: WORKSPACE_LAYOUT_VERSION,
      key,
      createdAt: new Date().toISOString(),
      sourceCount: resolved.sources.length,
      pageCount,
      fileCount,
      byteCount,
      sources: manifestSources,
    };
    await writeFile(
      join(stagingPath, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );

    const concurrentlyPublished = await readMaterializedWorkspace({
      key,
      path: finalPath,
    });
    if (concurrentlyPublished) {
      await rm(stagingPath, { recursive: true, force: true });
      return concurrentlyPublished;
    }
    if (await pathExists(finalPath)) {
      await rm(finalPath, { recursive: true, force: true });
    }
    await rename(stagingPath, finalPath);
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  }

  return {
    key,
    path: finalPath,
    sourceCount: resolved.sources.length,
    pageCount,
    fileCount,
    byteCount,
    cacheHit: false,
  };
}

export function createReadOnlyWorkspace(
  materialized: MaterializedWorkspace,
): Workspace {
  return new Workspace({
    id: `local-source-${materialized.key}`,
    name: `Local source ${materialized.key}`,
    filesystem: new LocalFilesystem({
      basePath: join(materialized.path, "content"),
      readOnly: true,
    }),
    bm25: true,
    autoIndexPaths: ["**/*.md"],
    tools: {
      enabled: false,
      [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]: {
        enabled: true,
        maxOutputTokens: 8_000,
      },
      [WORKSPACE_TOOLS.FILESYSTEM.LIST_FILES]: { enabled: true },
      [WORKSPACE_TOOLS.FILESYSTEM.FILE_STAT]: { enabled: true },
      [WORKSPACE_TOOLS.FILESYSTEM.GREP]: {
        enabled: true,
        maxOutputTokens: 6_000,
      },
      [WORKSPACE_TOOLS.SEARCH.SEARCH]: {
        enabled: true,
        maxOutputTokens: 6_000,
      },
    },
  });
}

async function prepareResolvedWorkspace(
  resolved: ResolvedLocalAgentSelection,
): Promise<PreparedLocalSourceWorkspace> {
  const key = selectionKey(resolved);
  const running = workspacePromises.get(key);
  if (running) {
    running.lastUsedAt = Date.now();
    const prepared = await running.promise;
    return { ...prepared, cacheHit: true };
  }

  const promise = (async () => {
    const materialized = await materializeWorkspace(resolved);
    const workspace = createReadOnlyWorkspace(materialized);
    await workspace.init();
    await cleanupOldWorkspaceDirectories();
    return { ...materialized, workspace };
  })();
  const entry = { promise, lastUsedAt: Date.now() };
  workspacePromises.set(key, entry);

  if (workspacePromises.size > MAX_MEMORY_WORKSPACES) {
    const oldest = [...workspacePromises.entries()]
      .filter(([cachedKey]) => cachedKey !== key)
      .sort(
        ([, left], [, right]) => left.lastUsedAt - right.lastUsedAt,
      )[0];
    if (oldest) workspacePromises.delete(oldest[0]);
  }

  try {
    return await promise;
  } catch (error) {
    if (workspacePromises.get(key) === entry) {
      workspacePromises.delete(key);
    }
    throw error;
  }
}

export async function prepareLocalSourceWorkspace(input: {
  selection: LocalAgentSelection;
  userId: string;
}): Promise<PreparedLocalSourceWorkspace> {
  const resolved = await resolveLocalAgentSelection(input);
  return prepareResolvedWorkspace(resolved);
}

export async function resolveLocalSourceAgentWorkspace(input: {
  requestContext?: RequestContext;
}): Promise<Workspace> {
  const userId = localAgentUserId(input.requestContext);
  const selection = readLocalAgentSelection(input.requestContext);
  const prepared = await prepareLocalSourceWorkspace({ selection, userId });
  return prepared.workspace;
}
