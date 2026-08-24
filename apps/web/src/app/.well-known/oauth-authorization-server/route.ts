import { getPublicApiBaseUrl } from "@/lib/agent-readiness/api-base";

export const revalidate = 3600;

async function proxyWellKnown(path: string) {
  const api = getPublicApiBaseUrl();
  const response = await fetch(`${api}${path}`, {
    next: { revalidate: 3600 },
  });
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      Vary: "Accept, Accept-Encoding",
    },
  });
}

export async function GET() {
  return proxyWellKnown("/.well-known/oauth-authorization-server");
}
