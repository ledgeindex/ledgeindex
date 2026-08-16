import type { Source } from "../../db/types.js";
import { getStore } from "../../db/index.js";
import { canReadSource } from "../../lib/resource-access.js";
import type { RemotePlatformSourceSummary } from "./remote-platform-api.js";
import {
  getRemotePlatformApiBase,
  remoteListUserSourceSets,
} from "./remote-platform-api.js";

function refMatchesSource(ref: string, source: { id: string; slug: string }): boolean {
  const trimmed = ref.trim().toLowerCase();
  return (
    source.id.toLowerCase() === trimmed ||
    source.slug.toLowerCase() === trimmed
  );
}

/**
 * MCP may only query sources that appear in at least one of the user's source sets.
 */
export async function resolveSourceViaUserSourceSets(
  userId: string,
  ref: string,
): Promise<Source | null> {
  const sets = await getStore().listSourceSets(userId);
  for (const set of sets) {
    for (const sourceId of set.sourceIds) {
      const source = await getStore().getSource(sourceId);
      if (!source) continue;
      if (!(await canReadSource(source, userId))) continue;
      if (refMatchesSource(ref, source)) return source;
    }
  }
  return null;
}

export async function remoteResolveSourceViaUserSourceSets(
  token: string,
  ref: string,
): Promise<RemotePlatformSourceSummary | null> {
  if (!getRemotePlatformApiBase()) return null;

  const listed = await remoteListUserSourceSets(token);
  if (!listed.ok) return null;

  for (const set of listed.items) {
    for (const member of set.sources) {
      if (!refMatchesSource(ref, member)) continue;
      return {
        id: member.id,
        slug: member.slug,
        name: member.name,
        scope: member.scope,
        startUrl: "",
        pageCount: 0,
        chunkCount: 0,
      };
    }
  }
  return null;
}

export const MCP_SOURCE_SET_ONLY_MESSAGE =
  "Source not in your source sets. Workflow: list_source_sets → get_source_set → ask_source with a member slug.";
