import { getStore } from "../db/index.js";
import type { SourceScope } from "../db/types.js";
import { getUserPlan } from "./user-plan.js";
import { getUserRole, isAdminRole } from "./user-role.js";

export const FREE_MAX_SOURCE_SETS = 1;
/** Max sources per set and max owned sources (Just me / Public) on the free plan. */
export const FREE_MAX_SOURCES = 3;
export const FREE_MAX_SOURCES_PER_SET = FREE_MAX_SOURCES;
export const DEFAULT_SOURCE_SET_NAME = "Default";

export type AccountSourceLimits = {
  apply: boolean;
  scope: SourceScope;
  maxSources: number | null;
  currentSourceCount: number;
  canCreate: boolean;
};

function countSourceFamilies(
  sources: Array<{ id: string; sourceFamilyId?: string | null }>,
): number {
  const families = new Set(
    sources.map((source) => source.sourceFamilyId ?? source.id),
  );
  return families.size;
}

async function countPersonalSourceFamilies(userId: string): Promise<number> {
  const sources = await getStore().listPersonalSourcesForOwner(userId);
  return countSourceFamilies(sources);
}

async function countGlobalSourceFamilies(): Promise<number> {
  try {
    const sources = await getStore().listGlobalSources();
    return countSourceFamilies(sources);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ECONNREFUSED|5432|postgres|Cloud Postgres|CLOUD_POSTGRES/i.test(message)) {
      return 0;
    }
    throw error;
  }
}

export async function getAccountSourceLimitsForUser(
  userId: string,
  scope: SourceScope,
): Promise<AccountSourceLimits> {
  const currentSourceCount =
    scope === "global"
      ? await countGlobalSourceFamilies()
      : await countPersonalSourceFamilies(userId);

  if (!isPlanLimitsEnabled()) {
    return {
      apply: false,
      scope,
      maxSources: null,
      currentSourceCount,
      canCreate: true,
    };
  }

  const role = await getUserRole(userId);
  if (isAdminRole(role)) {
    return {
      apply: true,
      scope,
      maxSources: null,
      currentSourceCount,
      canCreate: true,
    };
  }

  const plan = await getUserPlan(userId);
  if (plan === "pro") {
    return {
      apply: true,
      scope,
      maxSources: null,
      currentSourceCount,
      canCreate: true,
    };
  }

  return {
    apply: true,
    scope,
    maxSources: FREE_MAX_SOURCES,
    currentSourceCount,
    canCreate: currentSourceCount < FREE_MAX_SOURCES,
  };
}

export class SourceLimitError extends Error {
  scope: SourceScope;
  limit: number;
  current: number;

  constructor(scope: SourceScope, limit: number, current: number) {
    const scopeLabel = scope === "global" ? "public" : "personal";
    super(
      `Free plan allows ${limit} ${scopeLabel} source${limit === 1 ? "" : "s"} (${current}/${limit})`,
    );
    this.name = "SourceLimitError";
    this.scope = scope;
    this.limit = limit;
    this.current = current;
  }
}

export async function assertCanCreateSource(
  userId: string,
  scope: SourceScope,
): Promise<void> {
  const limits = await getAccountSourceLimitsForUser(userId, scope);
  if (!limits.apply || limits.canCreate) return;
  throw new SourceLimitError(
    scope,
    limits.maxSources ?? FREE_MAX_SOURCES,
    limits.currentSourceCount,
  );
}

export type SourceSetLimits = {
  apply: boolean;
  maxSourceSets: number | null;
  maxSourcesPerSet: number | null;
  currentSourceSetCount: number;
  canCreate: boolean;
};

export function isPlanLimitsEnabled(): boolean {
  const raw = process.env.LEDGEINDEX_APPLY_PLAN_LIMITS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function getSourceSetLimitsForUser(
  userId: string,
): Promise<SourceSetLimits> {
  const sourceSets = await getStore().listSourceSets(userId);
  const currentSourceSetCount = sourceSets.length;

  if (!isPlanLimitsEnabled()) {
    return {
      apply: false,
      maxSourceSets: null,
      maxSourcesPerSet: null,
      currentSourceSetCount,
      canCreate: true,
    };
  }

  const role = await getUserRole(userId);
  if (isAdminRole(role)) {
    return {
      apply: true,
      maxSourceSets: null,
      maxSourcesPerSet: null,
      currentSourceSetCount,
      canCreate: true,
    };
  }

  const plan = await getUserPlan(userId);
  if (plan === "pro") {
    return {
      apply: true,
      maxSourceSets: null,
      maxSourcesPerSet: null,
      currentSourceSetCount,
      canCreate: true,
    };
  }

  return {
    apply: true,
    maxSourceSets: FREE_MAX_SOURCE_SETS,
    maxSourcesPerSet: FREE_MAX_SOURCES_PER_SET,
    currentSourceSetCount,
    canCreate: currentSourceSetCount < FREE_MAX_SOURCE_SETS,
  };
}

export async function ensureDefaultSourceSetForLimitedUser(
  userId: string,
): Promise<void> {
  const limits = await getSourceSetLimitsForUser(userId);
  if (!limits.apply || limits.currentSourceSetCount > 0) return;
  if (limits.maxSourceSets !== FREE_MAX_SOURCE_SETS) return;

  await getStore().createSourceSet({
    ownerUserId: userId,
    name: DEFAULT_SOURCE_SET_NAME,
    slug: "default",
    description: null,
    sourceIds: [],
  });
}

export class SourceSetLimitError extends Error {
  code: "source_set_count" | "sources_per_set";
  limit: number;
  current: number;

  constructor(
    code: "source_set_count" | "sources_per_set",
    limit: number,
    current: number,
  ) {
    const message =
      code === "source_set_count"
        ? `Free plan allows ${limit} source set${limit === 1 ? "" : "s"} (${current}/${limit})`
        : `Free plan allows up to ${limit} sources per set (${current}/${limit})`;
    super(message);
    this.name = "SourceSetLimitError";
    this.code = code;
    this.limit = limit;
    this.current = current;
  }
}

export async function assertCanCreateSourceSet(userId: string): Promise<void> {
  const limits = await getSourceSetLimitsForUser(userId);
  if (!limits.apply || limits.canCreate) return;
  throw new SourceSetLimitError(
    "source_set_count",
    limits.maxSourceSets ?? FREE_MAX_SOURCE_SETS,
    limits.currentSourceSetCount,
  );
}

export async function assertSourceIdsWithinSetLimit(
  userId: string,
  sourceIds: string[],
): Promise<void> {
  const limits = await getSourceSetLimitsForUser(userId);
  if (!limits.apply || limits.maxSourcesPerSet === null) return;
  if (sourceIds.length <= limits.maxSourcesPerSet) return;
  throw new SourceSetLimitError(
    "sources_per_set",
    limits.maxSourcesPerSet,
    sourceIds.length,
  );
}
