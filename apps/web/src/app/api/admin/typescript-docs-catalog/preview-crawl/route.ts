import { NextResponse } from "next/server";
import {
  previewPathCrawl,
  previewPathOverlaps,
} from "@/lib/server/preview-path-crawl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function denyUnlessDev() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      {
        error:
          "Path crawl preview is only available in local development.",
      },
      { status: 403 },
    );
  }
  return null;
}

export async function POST(request: Request) {
  const denied = denyUnlessDev();
  if (denied) return denied;

  try {
    const body = (await request.json()) as {
      url?: string;
      startUrl?: string;
      urls?: string[];
      startUrls?: string[];
      mode?: string;
      excludePatterns?: string[];
      patternsAreRegex?: boolean;
      maxUrls?: number;
      maxShared?: number;
    };

    const overlapUrls = [
      ...(Array.isArray(body.urls) ? body.urls : []),
      ...(Array.isArray(body.startUrls) ? body.startUrls : []),
    ]
      .map((url) => String(url || "").trim())
      .filter(Boolean);

    if (body.mode === "overlaps" || overlapUrls.length > 1) {
      const result = await previewPathOverlaps({
        startUrls: overlapUrls,
        excludePatterns: body.excludePatterns,
        patternsAreRegex: body.patternsAreRegex,
        maxUrls: body.maxUrls,
        maxShared: body.maxShared,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const startUrl = String(body.url || body.startUrl || "").trim();
    const result = await previewPathCrawl({
      startUrl,
      excludePatterns: body.excludePatterns,
      patternsAreRegex: body.patternsAreRegex,
      maxUrls: body.maxUrls,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Preview crawl failed",
      },
      { status: 400 },
    );
  }
}
