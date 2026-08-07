/**
 * Web app entry — wires Firebase auth + API base URL into the shared HTTP client.
 */
export * from "@ledgeindex/client";
import { auth } from "@/lib/firebase";
import {
  setApiAuthTokenGetter,
  setLedgeIndexApiBaseUrl,
} from "@ledgeindex/client";

// Direct NEXT_PUBLIC_* access so Next inlines the production API URL at build time.
const apiBase =
  process.env.NEXT_PUBLIC_LEDGEINDEX_API_URL?.trim() ||
  process.env.NEXT_PUBLIC_KNOWLEDGEINDEX_API_URL?.trim();
if (apiBase) {
  setLedgeIndexApiBaseUrl(apiBase);
}

setApiAuthTokenGetter(async (forceRefresh) => {
  const user = auth?.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
});
