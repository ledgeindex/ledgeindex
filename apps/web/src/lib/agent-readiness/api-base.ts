export function getPublicApiBaseUrl(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_LEDGEINDEX_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_KNOWLEDGEINDEX_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3010";
  }
  return "https://api.ledgeindex.com";
}
