import { NextRequest, NextResponse } from "next/server";

const DOCS_DEV_ORIGIN =
  process.env.LEDGEINDEX_DOCS_DEV_ORIGIN?.replace(/\/$/, "") ??
  "http://127.0.0.1:3005";

const DOCS_PREFIXES = ["/docs", "/guides", "/reference"] as const;

function isDocsPath(pathname: string): boolean {
  return DOCS_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isDocsReferer(referer: string | null): boolean {
  if (!referer) return false;
  try {
    return isDocsPath(new URL(referer).pathname);
  } catch {
    return false;
  }
}

function shouldProxyDocsDev(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname;
  if (isDocsPath(pathname)) return true;
  if (!pathname.startsWith("/_next")) return false;
  return isDocsReferer(request.headers.get("referer"));
}

async function proxyToDocsDev(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const target = new URL(`${pathname}${request.nextUrl.search}`, DOCS_DEV_ORIGIN);

  const headers = new Headers(request.headers);
  headers.set("host", new URL(DOCS_DEV_ORIGIN).host);

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  const upstream = await fetch(target, init);
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.next();
  }

  if (!shouldProxyDocsDev(request)) {
    return NextResponse.next();
  }

  try {
    return await proxyToDocsDev(request);
  } catch {
    return NextResponse.json(
      {
        error: "Docs dev server unreachable",
        hint: "Run npm run dev:ledgeindex-docs (port 3005) alongside the web app.",
        origin: DOCS_DEV_ORIGIN,
      },
      { status: 502 },
    );
  }
}

export const config = {
  matcher: [
    "/docs",
    "/docs/:path*",
    "/guides",
    "/guides/:path*",
    "/reference",
    "/reference/:path*",
    "/_next/:path*",
  ],
};
