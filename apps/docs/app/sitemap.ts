import type { MetadataRoute } from "next";
import { getPageMap } from "nextra/page-map";
import {
  collectDocsRoutes,
  type DocsPageMapItem,
} from "../lib/docs-page-routes";

const DEFAULT_DOCS_ORIGIN = "https://ledgeindex.com";

function docsSitemapOrigin(): string {
  const fromEnv = process.env.LEDGEINDEX_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  }
  return DEFAULT_DOCS_ORIGIN;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = docsSitemapOrigin();
  const pageMap = await getPageMap();
  const routes = collectDocsRoutes(pageMap as DocsPageMapItem[]);

  return routes.map((route) => ({
    url: route === "/" ? base : `${base}${route}`,
    changeFrequency: "weekly" as const,
    priority: route === "/" ? 0.9 : 0.75,
  }));
}
