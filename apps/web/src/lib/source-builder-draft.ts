import { getLedgeIndexApiBaseUrl } from "@/lib/ledgeindex-api";

export type BuilderPinKind = "markdown" | "code";

export type BuilderMarkdownPin = {
  id: string;
  kind: "markdown";
  title: string;
  markdown: string;
};

export type BuilderCodePin = {
  id: string;
  kind: "code";
  title: string;
  language: string;
  code: string;
  filename?: string;
};

export type BuilderPin = BuilderMarkdownPin | BuilderCodePin;

export type BuilderPage = {
  id: string;
  categoryId: string;
  /** When set, page lives under this subcategory; otherwise directly under the category. */
  subcategoryId?: string | null;
  title: string;
  pins: BuilderPin[];
};

export type BuilderSubcategory = {
  id: string;
  title: string;
};

export type BuilderCategory = {
  id: string;
  title: string;
  subcategories?: BuilderSubcategory[];
};

export type BuilderSourceMetadata = {
  sourceType:
    | "documentation"
    | "api-reference"
    | "changelog"
    | "blog"
    | "marketing"
    | "wiki"
    | "repository"
    | "unknown";
  sourceTypeConfidence: number;
  origin: "internal" | "external" | "vendor";
  version?: string | null;
  versionSource?: "url_path" | "openapi" | "user" | "detected" | null;
  detectedSignals: string[];
  docsIdentity?: {
    overallSummary?: string;
    kind?: "frameworks" | "libraries" | "apis-services" | "tooling" | "uncategorized";
    language?: "javascript" | "typescript" | "python" | "other";
    updatedAt?: string;
    generatedAt?: string;
    paths: Array<{
      url: string;
      label?: string;
      description: string;
      audience?: string;
    }>;
  };
};

export type SourceBuilderDraft = {
  id: string;
  /** Shared across versions of the same builder source. */
  familyId: string;
  name: string;
  description?: string;
  versionNumber: number;
  versionLabel: string;
  /** LedgeIndex source id after this version has been indexed. */
  linkedSourceId?: string | null;
  /** Preferred index hosting for new linked sources (dev/desktop). */
  preferredHosting?: "local" | "cloud";
  /** Local copy of source metadata (type/origin/about) for the builder bar. */
  sourceMetadata?: BuilderSourceMetadata | null;
  categories: BuilderCategory[];
  pages: BuilderPage[];
  activePageId: string | null;
  updatedAt: string;
  createdAt: string;
};

const STORAGE_KEY = "ledgeindex:source-builder-drafts";

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function emptyMarkdownPage(input: {
  pageId: string;
  categoryId: string;
  subcategoryId?: string | null;
  title: string;
  markdown: string;
}): BuilderPage {
  return {
    id: input.pageId,
    categoryId: input.categoryId,
    subcategoryId: input.subcategoryId ?? null,
    title: input.title,
    pins: [
      {
        id: createId("pin"),
        kind: "markdown",
        title: "Overview",
        markdown: input.markdown,
      },
    ],
  };
}

function migrateDraft(raw: SourceBuilderDraft): SourceBuilderDraft {
  const familyId = raw.familyId?.trim() || raw.id;
  const versionNumber =
    typeof raw.versionNumber === "number" && raw.versionNumber > 0
      ? raw.versionNumber
      : 1;
  return {
    ...raw,
    familyId,
    versionNumber,
    versionLabel: raw.versionLabel?.trim() || `v${versionNumber}`,
    linkedSourceId: raw.linkedSourceId ?? null,
    sourceMetadata: raw.sourceMetadata ?? null,
  };
}

export function createEmptyDraft(name = "Untitled source"): SourceBuilderDraft {
  const draftId = createId("draft");
  const categoryId = createId("cat");
  const subcategoryId = createId("sub");
  const pageId = createId("page");
  const createdAt = nowIso();

  return {
    id: draftId,
    familyId: draftId,
    name,
    description: "",
    versionNumber: 1,
    versionLabel: "v1",
    linkedSourceId: null,
    sourceMetadata: {
      sourceType: "documentation",
      sourceTypeConfidence: 1,
      origin: "internal",
      version: "v1",
      versionSource: "user",
      detectedSignals: ["source-builder"],
    },
    categories: [
      {
        id: categoryId,
        title: "Getting started",
        subcategories: [{ id: subcategoryId, title: "Basics" }],
      },
    ],
    pages: [
      emptyMarkdownPage({
        pageId,
        categoryId,
        subcategoryId,
        title: "Introduction",
        markdown:
          "# Introduction\n\nStart documenting this source. Add categories, subcategories, and pages on the left, then drop markdown or code pins here.",
      }),
    ],
    activePageId: pageId,
    createdAt,
    updatedAt: createdAt,
  };
}

export function createSampleDraft(): SourceBuilderDraft {
  const apiBase = getLedgeIndexApiBaseUrl();
  const draftId = createId("draft");
  const gettingStartedId = createId("cat");
  const basicsId = createId("sub");
  const setupId = createId("sub");
  const guidesId = createId("cat");
  const askSubId = createId("sub");
  const mcpSubId = createId("sub");
  const conceptsId = createId("cat");
  const sourcesSubId = createId("sub");
  const overviewId = createId("page");
  const quickstartId = createId("page");
  const askId = createId("page");
  const mcpId = createId("page");
  const sourcesId = createId("page");
  const createdAt = nowIso();

  return {
    id: draftId,
    familyId: draftId,
    name: "LedgeIndex docs",
    description:
      "Sample LedgeIndex product docs — overview, quickstart, ask/retrieve, MCP, and sources — for profiler and index testing.",
    versionNumber: 1,
    versionLabel: "v1",
    linkedSourceId: null,
    sourceMetadata: {
      sourceType: "documentation",
      sourceTypeConfidence: 1,
      origin: "internal",
      version: "v1",
      versionSource: "user",
      detectedSignals: ["source-builder", "ledgeindex-docs-sample"],
    },
    categories: [
      {
        id: gettingStartedId,
        title: "Getting started",
        subcategories: [
          { id: basicsId, title: "Basics" },
          { id: setupId, title: "Setup" },
        ],
      },
      {
        id: guidesId,
        title: "Guides",
        subcategories: [
          { id: askSubId, title: "Ask & retrieve" },
          { id: mcpSubId, title: "MCP" },
        ],
      },
      {
        id: conceptsId,
        title: "Concepts",
        subcategories: [{ id: sourcesSubId, title: "Sources" }],
      },
    ],
    pages: [
      {
        id: overviewId,
        categoryId: gettingStartedId,
        subcategoryId: basicsId,
        title: "Overview",
        pins: [
          {
            id: createId("pin"),
            kind: "markdown",
            title: "What is LedgeIndex?",
            markdown: `LedgeIndex is a **documentation knowledge engine**. Point it at your docs (crawl, builder, or repo), index them, then ask grounded questions with citations — from the app, SDK/REST, or MCP.

### What you get

- **Sources** — indexed corpora (personal or platform-wide)
- **Retrieval** — embed → rerank → score-pruned chunks tied to real pages
- **Ask** — synthesize answers with citations, or retrieve-only for agents
- **MCP** — \`list_source_sets\`, \`get_source_set\`, \`ask_source\`

### Who it is for

Teams wiring docs copilots, support agents, or IDE tools that must stay tied to the real documentation — not generic model memory.`,
          },
          {
            id: createId("pin"),
            kind: "markdown",
            title: "Core workflow",
            markdown: `1. **Ingest** — crawl a site, build pages in Source Builder, or attach a catalog
2. **Index** — parse pages into chunks and embeddings
3. **Ask** — query by source slug/id; optionally scope to a docs path
4. **Wire** — expose the same index via UI chat, REST, or MCP for Cursor/Claude`,
          },
        ],
      },
      {
        id: quickstartId,
        categoryId: gettingStartedId,
        subcategoryId: setupId,
        title: "Quickstart",
        pins: [
          {
            id: createId("pin"),
            kind: "markdown",
            title: "Install the client",
            markdown: `Use \`@ledgeindex/client\` from Node or the browser (with auth headers). For local open-source, run the LedgeIndex server and point the client at your API base URL.`,
          },
          {
            id: createId("pin"),
            kind: "code",
            title: "Install",
            language: "bash",
            filename: "terminal",
            code: "npm install @ledgeindex/client",
          },
          {
            id: createId("pin"),
            kind: "markdown",
            title: "Configure",
            markdown: `Set your API base (\`${apiBase}\`) and pass auth when the server requires it.`,
          },
          {
            id: createId("pin"),
            kind: "code",
            title: "Create client",
            language: "typescript",
            filename: "client.ts",
            code: `import { createLedgeIndexClient } from "@ledgeindex/client";

export const ledge = createLedgeIndexClient({
  apiBaseUrl:
    process.env.LEDGEINDEX_API_URL ?? "${apiBase}",
  getAuthHeaders: async () => ({
    Authorization: \`Bearer \${process.env.LEDGEINDEX_API_KEY}\`,
  }),
});

const health = await ledge.getHealth();
console.log(health);`,
          },
        ],
      },
      {
        id: askId,
        categoryId: guidesId,
        subcategoryId: askSubId,
        title: "Ask a source",
        pins: [
          {
            id: createId("pin"),
            kind: "markdown",
            title: "Usage",
            markdown: `Call **ask** on a source id (or use MCP \`ask_source\` with a **slug**). LedgeIndex retrieves relevant chunks, reranks them, and either returns evidence or synthesizes a cited answer.

### Tips

- Prefer **slugs** in MCP (\`mastra\`, \`ledgeindex\`) over raw UUIDs
- Use **path scope** when a source has multiple docs roots
- For agents that need raw evidence, use retrieve-only / evidence mode when available`,
          },
          {
            id: createId("pin"),
            kind: "code",
            title: "REST ask",
            language: "typescript",
            filename: "ask-source.ts",
            code: `import { askSource } from "@ledgeindex/client";

const result = await askSource(
  "src_your_source_id",
  "How do I connect MCP in Cursor?",
);

console.log(result.answer);
for (const cite of result.citations ?? []) {
  console.log("-", cite.title, cite.url);
}`,
          },
          {
            id: createId("pin"),
            kind: "code",
            title: "curl",
            language: "bash",
            filename: "ask.sh",
            code: `curl -sS "$LEDGEINDEX_API_URL/api/sources/$SOURCE_ID/ask" \\
  -H "Authorization: Bearer $LEDGEINDEX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"message":"What is a source set?"}'`,
          },
        ],
      },
      {
        id: mcpId,
        categoryId: guidesId,
        subcategoryId: mcpSubId,
        title: "MCP for agents",
        pins: [
          {
            id: createId("pin"),
            kind: "markdown",
            title: "Connect Cursor or Claude",
            markdown: `LedgeIndex ships an MCP server so agents can query knowledge through your source sets.

### Typical tools

| Tool | Purpose |
| --- | --- |
| \`list_source_sets\` | Your configured source groups |
| \`get_source_set\` | Member sources in a set |
| \`ask_source\` | Retrieve evidence from a set member |

Flow: \`list_source_sets\` → \`get_source_set\` → \`ask_source\` with a member slug.`,
          },
          {
            id: createId("pin"),
            kind: "code",
            title: "Cursor mcp.json",
            language: "json",
            filename: "mcp.json",
            code: `{
  "mcpServers": {
    "ledgeindex": {
      "url": "${apiBase}/mcp"
    }
  }
}`,
          },
          {
            id: createId("pin"),
            kind: "code",
            title: "Example ask_source args",
            language: "json",
            filename: "ask_source.json",
            code: `{
  "source": "ledgeindex",
  "question": "How do source sets work with ask_source?"
}`,
          },
        ],
      },
      {
        id: sourcesId,
        categoryId: conceptsId,
        subcategoryId: sourcesSubId,
        title: "Sources and sets",
        pins: [
          {
            id: createId("pin"),
            kind: "markdown",
            title: "Sources",
            markdown: `A **source** is one indexed documentation corpus. It has a name, slug, scope (\`personal\` or \`global\`), crawl/builder config, and index stats.

### Source Builder

Use Source Builder when you author docs yourself: categories → subcategories → pages → markdown/code pins. Save versions, then **Index** to create or update the linked LedgeIndex source.

### Source sets

A **source set** groups several sources (e.g. product docs + API ref + changelog). Agents list the set, inspect members, then ask the right slug.`,
          },
          {
            id: createId("pin"),
            kind: "markdown",
            title: "About / docs identity",
            markdown: `Each source can store an **About** summary (docs identity). Generate it with the profiler from seeded builder pages or a live crawl. Agents and the chat side panel use this to understand what the corpus covers before asking.`,
          },
          {
            id: createId("pin"),
            kind: "code",
            title: "List sources (sketch)",
            language: "typescript",
            filename: "list-sources.ts",
            code: `import { listSources } from "@ledgeindex/client";

const { sources } = await listSources("personal");
for (const source of sources) {
  console.log(source.slug ?? source.id, source.name, source.scope);
}`,
          },
        ],
      },
    ],
    activePageId: overviewId,
    createdAt,
    updatedAt: createdAt,
  };
}

function readAll(): SourceBuilderDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SourceBuilderDraft[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(migrateDraft);
  } catch {
    return [];
  }
}

function writeAll(drafts: SourceBuilderDraft[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

export function listBuilderDrafts(): SourceBuilderDraft[] {
  return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** One card per family — latest version. */
export function listBuilderFamilies(): SourceBuilderDraft[] {
  const byFamily = new Map<string, SourceBuilderDraft>();
  for (const draft of readAll()) {
    const existing = byFamily.get(draft.familyId);
    if (
      !existing ||
      draft.versionNumber > existing.versionNumber ||
      (draft.versionNumber === existing.versionNumber &&
        draft.updatedAt > existing.updatedAt)
    ) {
      byFamily.set(draft.familyId, draft);
    }
  }
  return [...byFamily.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function listBuilderVersions(familyId: string): SourceBuilderDraft[] {
  return readAll()
    .filter((draft) => draft.familyId === familyId)
    .sort((a, b) => b.versionNumber - a.versionNumber);
}

export function getBuilderDraft(id: string): SourceBuilderDraft | null {
  return readAll().find((draft) => draft.id === id) ?? null;
}

export function saveBuilderDraft(draft: SourceBuilderDraft): SourceBuilderDraft {
  const next = migrateDraft({ ...draft, updatedAt: nowIso() });
  const drafts = readAll();
  const index = drafts.findIndex((entry) => entry.id === next.id);
  if (index >= 0) {
    drafts[index] = next;
  } else {
    drafts.unshift(next);
  }
  writeAll(drafts);
  return next;
}

/** Persist current content as a new version in the same family. */
export function saveBuilderDraftAsNewVersion(
  draft: SourceBuilderDraft,
): SourceBuilderDraft {
  const siblings = listBuilderVersions(draft.familyId);
  const nextNumber =
    Math.max(0, ...siblings.map((entry) => entry.versionNumber)) + 1;
  const createdAt = nowIso();
  const next: SourceBuilderDraft = {
    ...structuredClone(draft),
    id: createId("draft"),
    familyId: draft.familyId,
    versionNumber: nextNumber,
    versionLabel: `v${nextNumber}`,
    linkedSourceId: null,
    createdAt,
    updatedAt: createdAt,
  };
  return saveBuilderDraft(next);
}

export function deleteBuilderDraft(id: string) {
  writeAll(readAll().filter((draft) => draft.id !== id));
}

export function deleteBuilderFamily(familyId: string) {
  writeAll(readAll().filter((draft) => draft.familyId !== familyId));
}

/** Pages directly under a category (no subcategory). */
export function pagesForCategory(
  draft: SourceBuilderDraft,
  categoryId: string,
): BuilderPage[] {
  return draft.pages.filter(
    (page) => page.categoryId === categoryId && !page.subcategoryId,
  );
}

export function pagesForSubcategory(
  draft: SourceBuilderDraft,
  categoryId: string,
  subcategoryId: string,
): BuilderPage[] {
  return draft.pages.filter(
    (page) =>
      page.categoryId === categoryId && page.subcategoryId === subcategoryId,
  );
}

export function subcategoriesForCategory(
  category: BuilderCategory,
): BuilderSubcategory[] {
  return category.subcategories ?? [];
}

export function findActivePage(
  draft: SourceBuilderDraft,
): BuilderPage | null {
  if (draft.activePageId) {
    const active = draft.pages.find((page) => page.id === draft.activePageId);
    if (active) return active;
  }
  return draft.pages[0] ?? null;
}

function slugifySegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "page"
  );
}

/** Flatten a page's pins into markdown for indexing. */
export function builderPageToMarkdown(page: BuilderPage): string {
  const parts: string[] = [`# ${page.title}`, ""];
  for (const pin of page.pins) {
    if (pin.kind === "markdown") {
      if (pin.title.trim()) parts.push(`## ${pin.title}`, "");
      parts.push(pin.markdown.trim(), "");
    } else {
      const heading = pin.title.trim() || pin.filename || "Code";
      parts.push(`## ${heading}`, "");
      parts.push(`\`\`\`${pin.language || "text"}`, pin.code, "```", "");
    }
  }
  return parts.join("\n").trim();
}

export type BuilderIndexPage = {
  pageId: string;
  title: string;
  categoryId: string;
  categoryTitle: string;
  subcategoryId: string | null;
  subcategoryTitle: string | null;
  pathLabel: string;
  url: string;
  markdown: string;
  charCount: number;
};

export type BuilderIndexGroup = {
  categoryId: string;
  categoryTitle: string;
  sections: Array<{
    subcategoryId: string | null;
    subcategoryTitle: string | null;
    pages: BuilderIndexPage[];
  }>;
};

/** Build indexable pages with synthetic URLs for a draft version. */
export function buildIndexPagesForDraft(
  draft: SourceBuilderDraft,
): BuilderIndexPage[] {
  const base = `https://builder.ledgeindex.local/${draft.familyId}`;
  const categoryById = new Map(
    draft.categories.map((category) => [category.id, category]),
  );

  return draft.pages.map((page) => {
    const category = categoryById.get(page.categoryId);
    const subcategory = category?.subcategories?.find(
      (entry) => entry.id === page.subcategoryId,
    );
    const segments = [
      category ? slugifySegment(category.title) : "docs",
      subcategory ? slugifySegment(subcategory.title) : null,
      slugifySegment(page.title),
    ].filter(Boolean) as string[];
    const categoryTitle = category?.title?.trim() || "Uncategorized";
    const subcategoryTitle = subcategory?.title?.trim() || null;
    const pathLabel = [categoryTitle, subcategoryTitle, page.title]
      .filter(Boolean)
      .join(" / ");
    const markdown = builderPageToMarkdown(page);
    return {
      pageId: page.id,
      title: page.title,
      categoryId: page.categoryId,
      categoryTitle,
      subcategoryId: page.subcategoryId ?? null,
      subcategoryTitle,
      pathLabel,
      url: `${base}/${segments.join("/")}`,
      markdown,
      charCount: markdown.length,
    };
  });
}

/** Group index pages by category → subcategory, preserving draft order. */
export function groupIndexPagesForDraft(
  draft: SourceBuilderDraft,
  pages: BuilderIndexPage[],
): BuilderIndexGroup[] {
  const pagesByKey = new Map<string, BuilderIndexPage[]>();
  for (const page of pages) {
    const key = `${page.categoryId}::${page.subcategoryId ?? ""}`;
    const list = pagesByKey.get(key) ?? [];
    list.push(page);
    pagesByKey.set(key, list);
  }

  const groups: BuilderIndexGroup[] = [];
  const seenCategories = new Set<string>();

  for (const category of draft.categories) {
    seenCategories.add(category.id);
    const sections: BuilderIndexGroup["sections"] = [];

    const rootPages = pagesByKey.get(`${category.id}::`) ?? [];
    if (rootPages.length > 0) {
      sections.push({
        subcategoryId: null,
        subcategoryTitle: null,
        pages: rootPages,
      });
    }

    for (const subcategory of category.subcategories ?? []) {
      const sectionPages =
        pagesByKey.get(`${category.id}::${subcategory.id}`) ?? [];
      if (sectionPages.length === 0) continue;
      sections.push({
        subcategoryId: subcategory.id,
        subcategoryTitle: subcategory.title,
        pages: sectionPages,
      });
    }

    if (sections.length > 0) {
      groups.push({
        categoryId: category.id,
        categoryTitle: category.title,
        sections,
      });
    }
  }

  // Orphan pages whose category was removed from the draft tree
  const orphanByCategory = new Map<string, BuilderIndexPage[]>();
  for (const page of pages) {
    if (seenCategories.has(page.categoryId)) continue;
    const list = orphanByCategory.get(page.categoryId) ?? [];
    list.push(page);
    orphanByCategory.set(page.categoryId, list);
  }
  for (const [categoryId, orphanPages] of orphanByCategory) {
    groups.push({
      categoryId,
      categoryTitle: orphanPages[0]?.categoryTitle ?? "Uncategorized",
      sections: [
        {
          subcategoryId: null,
          subcategoryTitle: null,
          pages: orphanPages,
        },
      ],
    });
  }

  return groups;
}

export function builderStartUrl(draft: SourceBuilderDraft): string {
  return `https://builder.ledgeindex.local/${draft.familyId}`;
}
