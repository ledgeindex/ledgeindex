import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  acceptsMarkdown,
  isAiAgentUserAgent,
  MARKDOWN_NEGOTIATION_PATHS,
  PUBLIC_MARKETING_PATHS,
  shouldServeMarkdownNotFound,
} from "@/lib/agent-readiness/constants";
import {
  markdownForPath,
  notFoundMarkdown,
} from "@/lib/agent-readiness/markdown";
import { ROBOTS_DISALLOW_PATHS } from "@/lib/seo-non-indexable-paths";

function isAppRoute(pathname: string): boolean {
  if (pathname === "/login") return true;
  return ROBOTS_DISALLOW_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function agentFriendlyHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  if (isAiAgentUserAgent(request.headers.get("user-agent"))) {
    headers.set("X-LedgeIndex-Agent-Crawler", "allowed");
  }
  return headers;
}

function markdownResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Accept, Accept-Encoding, User-Agent",
      "Cache-Control": status === 404 ? "no-store" : "public, max-age=300",
      "X-LedgeIndex-Agent-Crawler": "allowed",
    },
  });
}

function withNegotiationVary(response: NextResponse): NextResponse {
  response.headers.set("Vary", "Accept, Accept-Encoding, User-Agent");
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const accept = request.headers.get("accept");
  const userAgent = request.headers.get("user-agent");
  const extra = agentFriendlyHeaders(request);

  if (pathname.startsWith("/_next") || /\.[a-z0-9]+$/i.test(pathname)) {
    return NextResponse.next({ headers: extra });
  }

  if (acceptsMarkdown(accept) && MARKDOWN_NEGOTIATION_PATHS.has(pathname)) {
    const md = markdownForPath(pathname);
    if (md) return markdownResponse(md);
  }

  if (
    isAppRoute(pathname) ||
    PUBLIC_MARKETING_PATHS.has(pathname) ||
    pathname.startsWith("/.well-known") ||
    pathname === "/openapi.json"
  ) {
    const response = NextResponse.next({ headers: extra });
    if (MARKDOWN_NEGOTIATION_PATHS.has(pathname)) {
      return withNegotiationVary(response);
    }
    return response;
  }

  if (shouldServeMarkdownNotFound(accept, userAgent)) {
    return markdownResponse(notFoundMarkdown(pathname), 404);
  }

  return NextResponse.next({ headers: extra });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images/).*)"],
};
