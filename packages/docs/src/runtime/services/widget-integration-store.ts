import { randomBytes } from "node:crypto";
import { getAdminFirestore } from "../lib/firestore-admin.js";

export type WidgetIntegrationBrand = {
  projectName: string;
  projectColor: string;
  projectLogo: string | null;
};

export type WidgetIntegration = {
  websiteId: string;
  ownerUserId: string;
  name: string;
  sourceIds: string[];
  allowedOrigins: string[];
  brand: WidgetIntegrationBrand;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

export type CreateWidgetIntegrationInput = {
  name: string;
  sourceIds: string[];
  allowedOrigins: string[];
  brand?: Partial<WidgetIntegrationBrand>;
};

export type UpdateWidgetIntegrationInput = {
  name?: string;
  sourceIds?: string[];
  allowedOrigins?: string[];
  brand?: Partial<WidgetIntegrationBrand>;
  status?: "active" | "disabled";
};

function newWebsiteId(): string {
  return `wgt_${randomBytes(12).toString("base64url")}`;
}

function integrationsCollection() {
  const db = getAdminFirestore();
  if (!db) throw new Error("Firestore is not configured");
  return db.collection("widget_integrations");
}

function userIndexCollection(userId: string) {
  const db = getAdminFirestore();
  if (!db) throw new Error("Firestore is not configured");
  return db.collection("users").doc(userId).collection("widget_integrations");
}

function normalizeOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function normalizeAllowedOrigins(origins: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of origins) {
    const origin = normalizeOrigin(raw);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    out.push(origin);
  }
  return out;
}

/** True when request Origin/Referer is allowed (localhost always ok in non-prod). */
export function isOriginAllowed(
  allowedOrigins: string[],
  requestOrigin: string | null,
  requestReferer: string | null,
  options?: { requireOriginHeader?: boolean },
): boolean {
  // Production chat should require Origin — Referer-only is easier to omit/spoof oddly.
  if (options?.requireOriginHeader && !requestOrigin) {
    return false;
  }

  const candidate =
    (requestOrigin && normalizeOrigin(requestOrigin)) ||
    (requestReferer ? normalizeOrigin(requestReferer) : null);
  if (!candidate) return false;

  if (
    process.env.NODE_ENV !== "production" &&
    (candidate.startsWith("http://localhost:") ||
      candidate.startsWith("http://127.0.0.1:"))
  ) {
    return true;
  }

  return allowedOrigins.includes(candidate);
}

function fromDoc(
  websiteId: string,
  data: Record<string, unknown>,
): WidgetIntegration {
  const brand = (data.brand ?? {}) as Partial<WidgetIntegrationBrand>;
  return {
    websiteId,
    ownerUserId: String(data.ownerUserId ?? ""),
    name: String(data.name ?? "Widget"),
    sourceIds: Array.isArray(data.sourceIds)
      ? data.sourceIds.filter((id): id is string => typeof id === "string")
      : [],
    allowedOrigins: Array.isArray(data.allowedOrigins)
      ? data.allowedOrigins.filter((o): o is string => typeof o === "string")
      : [],
    brand: {
      projectName: String(brand.projectName ?? data.name ?? "Ask AI"),
      projectColor: String(brand.projectColor ?? "#FF5A1F"),
      projectLogo:
        typeof brand.projectLogo === "string" && brand.projectLogo.trim()
          ? brand.projectLogo.trim()
          : null,
    },
    status: data.status === "disabled" ? "disabled" : "active",
    createdAt: String(data.createdAt ?? new Date().toISOString()),
    updatedAt: String(data.updatedAt ?? new Date().toISOString()),
  };
}

export async function createWidgetIntegration(
  ownerUserId: string,
  input: CreateWidgetIntegrationInput,
): Promise<WidgetIntegration> {
  const websiteId = newWebsiteId();
  const now = new Date().toISOString();
  const allowedOrigins = normalizeAllowedOrigins(input.allowedOrigins);
  const record: WidgetIntegration = {
    websiteId,
    ownerUserId,
    name: input.name.trim() || "Website widget",
    sourceIds: [...new Set(input.sourceIds.filter(Boolean))],
    allowedOrigins,
    brand: {
      projectName: input.brand?.projectName?.trim() || input.name.trim() || "Ask AI",
      projectColor: input.brand?.projectColor?.trim() || "#FF5A1F",
      projectLogo: input.brand?.projectLogo?.trim() || null,
    },
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  const batch = getAdminFirestore()!.batch();
  batch.set(integrationsCollection().doc(websiteId), record);
  batch.set(userIndexCollection(ownerUserId).doc(websiteId), {
    websiteId,
    name: record.name,
    status: record.status,
    updatedAt: now,
  });
  await batch.commit();
  return record;
}

export async function listWidgetIntegrations(
  ownerUserId: string,
): Promise<WidgetIntegration[]> {
  const index = await userIndexCollection(ownerUserId).get();
  if (index.empty) return [];

  const docs = await Promise.all(
    index.docs.map((doc) => integrationsCollection().doc(doc.id).get()),
  );

  return docs
    .filter((doc) => doc.exists)
    .map((doc) => fromDoc(doc.id, (doc.data() ?? {}) as Record<string, unknown>))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getWidgetIntegration(
  websiteId: string,
): Promise<WidgetIntegration | null> {
  const doc = await integrationsCollection().doc(websiteId).get();
  if (!doc.exists) return null;
  return fromDoc(doc.id, (doc.data() ?? {}) as Record<string, unknown>);
}

export async function updateWidgetIntegration(
  ownerUserId: string,
  websiteId: string,
  input: UpdateWidgetIntegrationInput,
): Promise<WidgetIntegration | null> {
  const existing = await getWidgetIntegration(websiteId);
  if (!existing || existing.ownerUserId !== ownerUserId) return null;

  const now = new Date().toISOString();
  const next: WidgetIntegration = {
    ...existing,
    name: input.name?.trim() || existing.name,
    sourceIds: input.sourceIds
      ? [...new Set(input.sourceIds.filter(Boolean))]
      : existing.sourceIds,
    allowedOrigins: input.allowedOrigins
      ? normalizeAllowedOrigins(input.allowedOrigins)
      : existing.allowedOrigins,
    brand: {
      projectName:
        input.brand?.projectName?.trim() || existing.brand.projectName,
      projectColor:
        input.brand?.projectColor?.trim() || existing.brand.projectColor,
      projectLogo:
        input.brand?.projectLogo !== undefined
          ? input.brand.projectLogo?.trim() || null
          : existing.brand.projectLogo,
    },
    status: input.status ?? existing.status,
    updatedAt: now,
  };

  const batch = getAdminFirestore()!.batch();
  batch.set(integrationsCollection().doc(websiteId), next);
  batch.set(userIndexCollection(ownerUserId).doc(websiteId), {
    websiteId,
    name: next.name,
    status: next.status,
    updatedAt: now,
  });
  await batch.commit();
  return next;
}

export async function deleteWidgetIntegration(
  ownerUserId: string,
  websiteId: string,
): Promise<boolean> {
  const existing = await getWidgetIntegration(websiteId);
  if (!existing || existing.ownerUserId !== ownerUserId) return false;

  const batch = getAdminFirestore()!.batch();
  batch.delete(integrationsCollection().doc(websiteId));
  batch.delete(userIndexCollection(ownerUserId).doc(websiteId));
  await batch.commit();
  return true;
}
