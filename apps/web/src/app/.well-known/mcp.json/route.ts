import { buildMcpManifest } from "@/lib/agent-readiness/openapi";

export const revalidate = 3600;

export async function GET() {
  return Response.json(buildMcpManifest(), {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
