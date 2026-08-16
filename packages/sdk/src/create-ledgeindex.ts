import { askAcrossSources } from "./ask-across.js";
import { askQuestion } from "./ask.js";
import { runWebCrawl } from "./crawl.js";
import { deleteSource } from "./delete-source.js";
import { indexRepository } from "./index-repo.js";
import { profileWithResolvedOptions } from "./profile.js";
import { resolveOptions } from "./resolve-options.js";
import { initRuntime, getActiveOptions } from "./runtime.js";
import { applyUpdates, checkForUpdates } from "./refresh.js";
import { listSources, resolveSourceRef } from "./sources.js";
import { listSourceSets, saveSet } from "./source-sets.js";
import type { LedgeIndex, LedgeIndexOptions } from "./types.js";

export async function createLedgeIndex(
  options: LedgeIndexOptions = {},
): Promise<LedgeIndex> {
  const resolved = resolveOptions(options);
  await initRuntime(resolved);

  return {
    get dataDir() {
      return getActiveOptions().dataDir;
    },
    get localUserId() {
      return getActiveOptions().localUserId;
    },
    crawl: (crawlOptions) => runWebCrawl(crawlOptions),
    indexRepo: (indexOptions) => indexRepository(indexOptions),
    ask: (sourceIdOrSlug, question, askOptions) =>
      askQuestion(sourceIdOrSlug, question, askOptions),
    askAcross: (question, askOptions) =>
      askAcrossSources(question, askOptions),
    listSources: async () => {
      const sources = await listSources();
      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        slug: source.slug,
      }));
    },
    listSourceSets: () => listSourceSets(),
    saveSourceSet: (setOptions) => saveSet(setOptions),
    resolveSource: resolveSourceRef,
    profile: (url, profileOptions) =>
      profileWithResolvedOptions(url, profileOptions ?? {}, getActiveOptions()),
    checkForUpdates: (options) => checkForUpdates(options),
    applyUpdates: (options) => applyUpdates(options),
    deleteSource: (sourceIdOrSlug) => deleteSource(sourceIdOrSlug),
  };
}
