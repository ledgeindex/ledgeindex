import { createHash, randomBytes } from "node:crypto";

export function generateOAuthSessionId(): string {
  return randomBytes(24).toString("base64url");
}

export function generateAuthCode(): string {
  return randomBytes(32).toString("base64url");
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyPkceS256(
  codeVerifier: string,
  codeChallenge: string,
): boolean {
  const digest = createHash("sha256").update(codeVerifier).digest("base64url");
  return digest === codeChallenge;
}

export function oauthSessionTtlMs(): number {
  return 10 * 60 * 1000;
}

export function authCodeTtlMs(): number {
  return 5 * 60 * 1000;
}

export function refreshTokenTtlMs(): number {
  return 14 * 24 * 60 * 60 * 1000;
}
