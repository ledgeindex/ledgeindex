/**
 * Diagnose why a page is (or is not) retrieved for a query.
 *
 *   node ledgeindex/scripts/debug-retrieve.mjs <slug> "<query>" [urlSubstring]
 *
 * Prints: indexed pages matching urlSubstring, vector candidates, rerank scores.
 */
import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();

const slug = process.argv[2];
const query = process.argv[3];
const urlNeedle = (process.argv[4] ?? "").toLowerCase();

if (!slug || !query) {
  console.error(
    'Usage: node scripts/debug-retrieve.mjs <slug> "<query>" [urlSubstring]',
  );
  process.exit(2);
}

const { getStore } = await import("../packages/core/dist/db/index.js");
const { kapaRetrieve } = await import(
  "../packages/core/dist/query/kapa-retrieve.js"
);
const { searchLexical } = await import(
  "../packages/core/dist/query/lexical-store.js"
);
const { getMetadataCatalog } = await import(
  "../packages/core/dist/query/metadata-catalog-store.js"
);

const store = await getStore();
const sources = await store.listSources();
const isUuid = /^[0-9a-f-]{36}$/i.test(slug);
const source = isUuid
  ? ((await store.getSource(slug)) ?? { id: slug, slug, name: slug })
  : (sources.find((s) => s.slug === slug) ??
    sources.find((s) => s.slug?.includes(slug)) ??
    sources.find((s) => s.name?.toLowerCase().includes(slug.toLowerCase())));

if (!source) {
  console.error(`No source matching "${slug}". Available:`);
  for (const s of sources) console.error(`  ${s.slug}  (${s.name})`);
  process.exit(1);
}

console.log(`source: ${source.name} [${source.slug}] id=${source.id}`);

if (urlNeedle) {
  const catalog = await getMetadataCatalog(source.id);
  const pages = catalog?.pages ?? [];
  const matching = pages.filter((p) =>
    `${p.url} ${p.title ?? ""}`.toLowerCase().includes(urlNeedle),
  );
  console.log(
    `\ncatalog pages: ${pages.length} · matching "${urlNeedle}": ${matching.length}`,
  );
  for (const page of matching.slice(0, 20)) {
    console.log(`  ${page.title ?? ""} — ${page.url}`);
  }
}

const lexical = await searchLexical({
  sourceId: source.id,
  query,
  topK: 10,
});
console.log(`\nlexical (BM25) top ${lexical.length}:`);
for (const hit of lexical) {
  console.log(
    `  ${hit.score.toFixed(3)}  ${hit.metadata?.title ?? ""} — ${hit.metadata?.url ?? ""}`,
  );
}

const result = await kapaRetrieve({
  query,
  sourceId: source.id,
  relevanceThreshold: 0,
  expandPages: false,
});

console.log(
  `\nkapaRetrieve: ${result.initialCount} vec → ${result.rerankedCount} rerank`,
);
console.log(`rerank scores (threshold ignored):`);
for (const chunk of result.chunks.slice(0, 12)) {
  const flag = urlNeedle && chunk.url.toLowerCase().includes(urlNeedle) ? " <<<" : "";
  console.log(
    `  ${chunk.score.toFixed(3)}  ${chunk.title} — ${chunk.url}${flag}`,
  );
}

process.exit(0);
