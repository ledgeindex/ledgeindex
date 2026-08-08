import {
  isFirebaseAdminConfigured,
  verifyFirebaseIdToken,
} from "../../../lib/firebase-admin.js";
import {
  isMcpAccessTokenFormat,
  verifyMcpAccessToken,
} from "./mcp-access-token.js";

export type ResolvedMcpBearerUser = {
  id: string;
  email: string;
  authMethod: "mcp_access_token" | "firebase_token";
};

export async function resolveMcpBearerUser(
  token: string,
): Promise<ResolvedMcpBearerUser | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const mcpClaims = verifyMcpAccessToken(trimmed);
  if (mcpClaims) {
    return {
      id: mcpClaims.sub,
      email: mcpClaims.email ?? "",
      authMethod: "mcp_access_token",
    };
  }

  if (isMcpAccessTokenFormat(trimmed)) {
    return null;
  }

  if (!isFirebaseAdminConfigured()) {
    return null;
  }

  try {
    const decoded = await verifyFirebaseIdToken(trimmed);
    return {
      id: decoded.uid,
      email: decoded.email ?? "",
      authMethod: "firebase_token",
    };
  } catch {
    return null;
  }
}
