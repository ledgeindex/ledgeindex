import { buildLlmsTxt } from "@/lib/agent-readiness/llms-txt";

export const revalidate = 3600;

export async function GET() {
  return new Response(buildLlmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
