import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getApiKeySalt } from "./api-keys.js";

function deriveUserEncryptionKey(userId: string): Buffer {
  return createHash("sha256")
    .update(`${userId}:${getApiKeySalt()}:api-key-storage`)
    .digest();
}

export function encryptApiKeyForUser(apiKey: string, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveUserEncryptionKey(userId), iv);
  const encrypted = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptApiKeyForUser(
  ciphertext: string,
  userId: string,
): string | null {
  try {
    const payload = Buffer.from(ciphertext, "base64");
    if (payload.length < 29) return null;

    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveUserEncryptionKey(userId),
      iv,
    );
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 20) return apiKey;
  const visibleStart = apiKey.slice(0, 12);
  const visibleEnd = apiKey.slice(-4);
  const hiddenLength = Math.max(apiKey.length - visibleStart.length - visibleEnd.length, 8);
  return `${visibleStart}${"•".repeat(hiddenLength)}${visibleEnd}`;
}
