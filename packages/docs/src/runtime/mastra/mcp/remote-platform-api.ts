/**
 * When the desktop sidecar lists/asks global sources, the corpus lives on the
 * hosted API — not the local SQLite/PG under LEDGEINDEX_DATA_DIR.
 * Set LEDGEINDEX_REMOTE_API_URL (or NEXT_PUBLIC_LEDGEINDEX_REMOTE_API_URL) and
 * forward the user's Firebase Bearer as auth_token.
 */

import type { SourceContentType } from "../../db/types.js";

export type RemotePlatformSourceSummary = {
  id: string;
  slug: string;
  name: string;
  scope: "personal" | "global";
  startUrl: string;
  pageCount: number;
  chunkCount: number;
  faviconUrl?: string | null;
  /** Absent on older platform builds that predate the corpus-kind field. */
  sourceType?: SourceContentType;
};

export type RemoteSourceSetMember = {
  id: string;
  slug: string;
  name: string;
  scope: "personal" | "global";
};

export type RemoteSourceSetSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sourceCount: number;
  sources: RemoteSourceSetMember[];
};

export type RemoteAskHit = {
  text: string;
  url: string;
  title: string;
  score: number;
  section?: string;
};

export type RemoteAskResult = {
  mode?: string;
  answer?: string;
  chunks?: RemoteAskHit[];
  insufficient?: boolean;
};

export function getRemotePlatformApiBase(): string | null {
  const raw =
    process.env.LEDGEINDEX_REMOTE_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_LEDGEINDEX_REMOTE_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_KNOWLEDGEINDEX_REMOTE_API_URL?.trim() ||
    "";
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

export async function remoteListGlobalSources(
  token: string,
): Promise<{ ok: true; items: RemotePlatformSourceSummary[] } | { ok: false; message: string }> {
  const base = getRemotePlatformApiBase();
  if (!base) {
    return { ok: false, message: "Remote platform API URL is not configured" };
  }

  let res: Response;
  try {
    res = await fetch(`${base}/api/sources?scope=global`, {
      method: "GET",
      headers: authHeaders(token),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    return { ok: false, message: `Cannot reach remote platform API: ${message}` };
  }

  const data = (await readJson(res)) as {
    sources?: Array<Partial<RemotePlatformSourceSummary>>;
    error?: unknown;
  };

  if (!res.ok) {
    const err =
      typeof data.error === "string"
        ? data.error
        : `Remote list failed (${res.status})`;
    return { ok: false, message: err };
  }

  const items = (data.sources ?? [])
    .filter((s) => typeof s.id === "string" && typeof s.slug === "string")
    .map((s) => ({
      id: String(s.id),
      slug: String(s.slug),
      name: String(s.name ?? s.slug),
      scope: (s.scope === "personal" ? "personal" : "global") as
        | "personal"
        | "global",
      startUrl: String(s.startUrl ?? ""),
      pageCount: Number(s.pageCount ?? 0),
      chunkCount: Number(s.chunkCount ?? 0),
      faviconUrl:
        typeof s.faviconUrl === "string" && s.faviconUrl.trim()
          ? s.faviconUrl.trim()
          : null,
    }));

  return { ok: true, items };
}

export async function remoteListUserSourceSets(
  token: string,
): Promise<
  { ok: true; items: RemoteSourceSetSummary[] } | { ok: false; message: string }
> {
  const base = getRemotePlatformApiBase();
  if (!base) {
    return { ok: false, message: "Remote platform API URL is not configured" };
  }

  let res: Response;
  try {
    res = await fetch(`${base}/api/source-sets`, {
      method: "GET",
      headers: authHeaders(token),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    return { ok: false, message: `Cannot reach remote platform API: ${message}` };
  }

  const data = (await readJson(res)) as {
    sourceSets?: Array<Partial<RemoteSourceSetSummary>>;
    error?: unknown;
  };

  if (!res.ok) {
    const err =
      typeof data.error === "string"
        ? data.error
        : `Remote source sets failed (${res.status})`;
    return { ok: false, message: err };
  }

  const items = (data.sourceSets ?? [])
    .filter((set) => typeof set.id === "string" && typeof set.slug === "string")
    .map((set) => ({
      id: String(set.id),
      slug: String(set.slug),
      name: String(set.name ?? set.slug),
      description:
        typeof set.description === "string" || set.description === null
          ? set.description
          : null,
      sourceCount: Number(set.sourceCount ?? 0),
      sources: (set.sources ?? [])
        .filter((member) => typeof member?.id === "string")
        .map((member) => ({
          id: String(member!.id),
          slug: String(member!.slug ?? member!.id),
          name: String(member!.name ?? member!.slug ?? member!.id),
          scope: (member!.scope === "global" ? "global" : "personal") as
            | "personal"
            | "global",
        })),
    }));

  return { ok: true, items };
}

export async function remoteResolveGlobalSource(
  token: string,
  ref: string,
): Promise<RemotePlatformSourceSummary | null> {
  const listed = await remoteListGlobalSources(token);
  if (!listed.ok) return null;
  const trimmed = ref.trim().toLowerCase();
  return (
    listed.items.find(
      (s) => s.id.toLowerCase() === trimmed || s.slug.toLowerCase() === trimmed,
    ) ?? null
  );
}

export async function remoteAskSource(
  token: string,
  sourceId: string,
  question: string,
  options?: { rerankBackend?: string },
): Promise<
  | { ok: true; result: RemoteAskResult }
  | { ok: false; message: string; status?: number }
> {
  const base = getRemotePlatformApiBase();
  if (!base) {
    return { ok: false, message: "Remote platform API URL is not configured" };
  }

  let res: Response;
  try {
    res = await fetch(`${base}/api/sources/${encodeURIComponent(sourceId)}/ask`, {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: question,
        mode: "retrieve-only",
        ...(options?.rerankBackend
          ? { rerankBackend: options.rerankBackend }
          : {}),
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    return { ok: false, message: `Cannot reach remote platform API: ${message}` };
  }

  const data = (await readJson(res)) as RemoteAskResult & { error?: unknown };

  if (!res.ok) {
    const err =
      typeof data.error === "string"
        ? data.error
        : `Remote ask failed (${res.status})`;
    return { ok: false, message: err, status: res.status };
  }

  return { ok: true, result: data };
}

export async function remoteGetMetadataCatalog(
  token: string,
  sourceId: string,
): Promise<{ ok: true; catalog: unknown } | { ok: false; message: string }> {
  const base = getRemotePlatformApiBase();
  if (!base) {
    return { ok: false, message: "Remote platform API URL is not configured" };
  }

  let res: Response;
  try {
    res = await fetch(
      `${base}/api/sources/${encodeURIComponent(sourceId)}/metadata-catalog`,
      {
        method: "GET",
        headers: authHeaders(token),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    return { ok: false, message: `Cannot reach remote platform API: ${message}` };
  }

  const data = (await readJson(res)) as { catalog?: unknown; error?: unknown };
  if (!res.ok) {
    const err =
      typeof data.error === "string"
        ? data.error
        : `Remote catalog failed (${res.status})`;
    return { ok: false, message: err };
  }

  return { ok: true, catalog: data.catalog ?? null };
}

export function readAuthTokenFromContext(requestContext: {
  get: (key: string) => unknown;
}): string {
  const raw = requestContext.get("auth_token");
  return typeof raw === "string" ? raw.trim() : "";
}
