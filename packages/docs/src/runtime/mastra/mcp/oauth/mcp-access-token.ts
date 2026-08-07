import { createHmac, timingSafeEqual } from "node:crypto";

const ISSUER = "ledgeindex-mcp-oauth";
const TOKEN_TYPE = "mcp_access";

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buf.toString("base64url");
}

function getSigningSecret(): string {
  const explicit = process.env.MCP_OAUTH_TOKEN_SECRET?.trim();
  if (explicit) return explicit;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (privateKey) {
    return createHmac("sha256", "ledgeindex-mcp-oauth")
      .update(privateKey)
      .digest("hex");
  }
  return "ledgeindex-mcp-dev-insecure-secret";
}

export function accessTokenTtlSeconds(): number {
  return 3600;
}

export type McpAccessTokenClaims = {
  sub: string;
  email?: string;
  scope?: string;
  clientId?: string;
};

export type VerifiedMcpAccessToken = McpAccessTokenClaims & {
  exp: number;
};

export function mintMcpAccessToken(claims: McpAccessTokenClaims): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: ISSUER,
      typ: TOKEN_TYPE,
      sub: claims.sub,
      email: claims.email,
      scope: claims.scope,
      client_id: claims.clientId,
      iat: now,
      exp: now + accessTokenTtlSeconds(),
    }),
  );
  const signature = createHmac("sha256", getSigningSecret())
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function isMcpAccessTokenFormat(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const decoded = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { iss?: unknown; typ?: unknown };
    return decoded.iss === ISSUER && decoded.typ === TOKEN_TYPE;
  } catch {
    return false;
  }
}

export function verifyMcpAccessToken(
  token: string,
): VerifiedMcpAccessToken | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payloadPart, signature] = parts;
  const expected = createHmac("sha256", getSigningSecret())
    .update(`${header}.${payloadPart}`)
    .digest("base64url");
  try {
    const sigBuf = Buffer.from(signature, "base64url");
    const expBuf = Buffer.from(expected, "base64url");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
  } catch {
    return null;
  }

  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (decoded.iss !== ISSUER || decoded.typ !== TOKEN_TYPE) return null;
  const exp = decoded.exp;
  const sub = decoded.sub;
  if (typeof exp !== "number" || exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  if (typeof sub !== "string" || !sub.trim()) return null;

  return {
    sub: sub.trim(),
    email: typeof decoded.email === "string" ? decoded.email : undefined,
    scope: typeof decoded.scope === "string" ? decoded.scope : undefined,
    clientId: typeof decoded.client_id === "string" ? decoded.client_id : undefined,
    exp,
  };
}

export function readMcpAccessTokenExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { iss?: unknown; typ?: unknown; exp?: unknown };
    if (decoded.iss !== ISSUER || decoded.typ !== TOKEN_TYPE) return null;
    if (typeof decoded.exp === "number" && Number.isFinite(decoded.exp)) {
      return decoded.exp;
    }
  } catch {
    return null;
  }
  return null;
}
