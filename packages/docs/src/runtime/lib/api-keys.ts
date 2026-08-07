import { createHash, randomUUID } from "node:crypto";

export const API_KEY_PREFIX = "live_";
/** @deprecated Legacy keys issued before the prefix change. */
export const LEGACY_API_KEY_PREFIX = "ki_live_";
export const API_KEY_LIMIT = 1;

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomUUID().replace(/-/g, "")}`;
}

export function hashApiKey(apiKey: string, salt: string): string {
  return createHash("sha256").update(apiKey + salt).digest("hex");
}

export function getApiKeySalt(): string {
  const salt = process.env.API_KEY_SALT?.trim();
  if (!salt) {
    throw new Error("API_KEY_SALT is not configured");
  }
  return salt;
}

export function toKeyPrefix(apiKey: string): string {
  if (apiKey.length <= 16) return apiKey;
  return `${apiKey.slice(0, 16)}...`;
}

export function isKnowledgeIndexApiKey(value: string): boolean {
  return (
    value.startsWith(API_KEY_PREFIX) || value.startsWith(LEGACY_API_KEY_PREFIX)
  );
}

export function isRawApiKeyValue(name: string): boolean {
  return (
    name.startsWith(API_KEY_PREFIX) || name.startsWith(LEGACY_API_KEY_PREFIX)
  );
}
