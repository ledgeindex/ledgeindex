import { buildOpenApiSpec } from "@/lib/agent-readiness/openapi";

export const revalidate = 3600;

export async function GET() {
  return Response.json(buildOpenApiSpec(), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      Vary: "Accept, Accept-Encoding",
    },
  });
}
