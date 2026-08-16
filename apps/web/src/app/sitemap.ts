import type { MetadataRoute } from "next";
import { buildApexSitemap } from "@/lib/merge-docs-sitemap";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildApexSitemap();
}
