import { z } from "zod";
import type { RequestContext } from "@mastra/core/request-context";
import type { Source } from "../../db/types.js";
import { resolveSourceHosting } from "../../db/types.js";
import { getStore } from "../../db/index.js";
import { getSourceForUser } from "../../lib/resource-access.js";

const MAX_DIRECT_SOURCES = 3;
const MAX_SOURCE_SET_SOURCES = 12;

export const localAgentSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sources"),
    sourceIds: z.array(z.string().uuid()).min(1).max(MAX_DIRECT_SOURCES),
  }),
  z.object({
    kind: z.literal("source-set"),
    sourceSetId: z.string().min(1),
  }),
]);

export type LocalAgentSelection = z.infer<typeof localAgentSelectionSchema>;

export type ResolvedLocalAgentSelection = {
  selection: LocalAgentSelection;
  sources: [Source, ...Source[]];
};

export class LocalAgentSelectionError extends Error {
  constructor(
    readonly code:
      | "invalid-selection"
      | "source-not-found"
      | "source-set-not-found"
      | "not-local"
      | "empty-index"
      | "limit-exceeded",
    message: string,
  ) {
    super(message);
    this.name = "LocalAgentSelectionError";
  }
}

export function localAgentUserId(requestContext?: RequestContext): string {
  const raw =
    requestContext?.get("user_id") ?? requestContext?.get("userId") ?? "";
  const userId = typeof raw === "string" ? raw.trim() : "";
  if (userId) return userId;

  if (process.env.LEDGEINDEX_AUTH_REQUIRED !== "1") {
    return (
      process.env.LEDGEINDEX_LOCAL_USER_ID?.trim() ||
      "ledgeindex-desktop-local"
    );
  }
  return "";
}

export function readLocalAgentSelection(
  requestContext?: RequestContext,
): LocalAgentSelection {
  const parsed = localAgentSelectionSchema.safeParse(
    requestContext?.get("local_agent_selection"),
  );
  if (!parsed.success) {
    throw new LocalAgentSelectionError(
      "invalid-selection",
      "Select local knowledge before using Agent mode.",
    );
  }
  return parsed.data;
}

export async function resolveLocalAgentSelection(input: {
  selection: LocalAgentSelection;
  userId: string;
}): Promise<ResolvedLocalAgentSelection> {
  if (!input.userId) {
    throw new LocalAgentSelectionError(
      "source-not-found",
      "Authentication is required to open a local source workspace.",
    );
  }

  let sourceIds: string[];
  if (input.selection.kind === "sources") {
    sourceIds = input.selection.sourceIds;
  } else {
    const sourceSet =
      (await getStore().getSourceSet(input.selection.sourceSetId)) ??
      (await getStore().getSourceSetBySlug(
        input.userId,
        input.selection.sourceSetId,
      ));
    if (!sourceSet || sourceSet.ownerUserId !== input.userId) {
      throw new LocalAgentSelectionError(
        "source-set-not-found",
        "The selected source set was not found.",
      );
    }
    sourceIds = sourceSet.sourceIds;
  }

  const uniqueIds = [...new Set(sourceIds)];
  if (uniqueIds.length === 0) {
    throw new LocalAgentSelectionError(
      "source-not-found",
      "The selected source set contains no sources.",
    );
  }
  if (uniqueIds.length > MAX_SOURCE_SET_SOURCES) {
    throw new LocalAgentSelectionError(
      "limit-exceeded",
      `Agent mode supports at most ${MAX_SOURCE_SET_SOURCES} sources at once.`,
    );
  }

  const sources: Source[] = [];
  for (const sourceId of uniqueIds) {
    const source = await getSourceForUser(sourceId, input.userId);
    if (!source) {
      throw new LocalAgentSelectionError(
        "source-not-found",
        "One of the selected sources is unavailable.",
      );
    }
    const hosting = resolveSourceHosting({
      hosting: source.hosting,
      scope: source.scope,
      vectorBackend: source.indexStats?.vectorBackend,
    });
    if (source.scope === "global" || hosting !== "local") {
      throw new LocalAgentSelectionError(
        "not-local",
        `Agent mode is available only for personal local sources. "${source.name}" is not local.`,
      );
    }
    if (
      !source.indexedAt ||
      !source.indexStats ||
      source.indexStats.pageCount < 1 ||
      source.indexStats.chunkCount < 1
    ) {
      throw new LocalAgentSelectionError(
        "empty-index",
        `"${source.name}" must be indexed before it can be explored.`,
      );
    }
    sources.push(source);
  }

  sources.sort((left, right) => left.id.localeCompare(right.id));
  const first = sources[0];
  if (!first) {
    throw new LocalAgentSelectionError(
      "source-not-found",
      "No local sources were resolved.",
    );
  }

  return {
    selection: input.selection,
    sources: [first, ...sources.slice(1)],
  };
}
