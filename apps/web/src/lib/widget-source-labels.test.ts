import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  labelFromSourceSummary,
  resolveWidgetSourceLabels,
} from "./widget-source-labels.ts";
import type { WidgetIntegrationSummary } from "./widget-api.ts";

describe("widget source labels", () => {
  it("prefers name then start URL hostname", () => {
    const label = labelFromSourceSummary({
      id: "abc",
      projectId: "p1",
      name: "Mastra docs",
      slug: "mastra",
      scope: "personal",
      hosting: "cloud",
      startUrl: "https://mastra.ai/docs",
      startUrls: ["https://mastra.ai/docs"],
      sourceType: "documentation",
      ogImageUrl: null,
      faviconUrl: null,
      indexedAt: null,
      pageCount: 1,
      chunkCount: 1,
      canonicalUrl: null,
      sourceFamilyId: "abc",
      versionNumber: 1,
      versionLabel: "v1",
      categories: [],
      displayOrder: null,
      versions: [],
      excludePatterns: [],
      includePatterns: [],
      hasSiteProfile: false,
      siteProfileLensCount: 0,
    });
    assert.equal(label.name, "Mastra docs");
    assert.equal(label.startUrl, "https://mastra.ai/docs");
  });

  it("falls back to URL hostname when name missing", () => {
    const label = labelFromSourceSummary({
      id: "6cabf272-42f5-4d48-bf10-cac53fca40de",
      projectId: "p1",
      name: "",
      slug: "",
      scope: "personal",
      hosting: "cloud",
      startUrl: "https://docs.example.com/guides",
      startUrls: ["https://docs.example.com/guides"],
      sourceType: "documentation",
      ogImageUrl: null,
      faviconUrl: null,
      indexedAt: null,
      pageCount: 0,
      chunkCount: 0,
      canonicalUrl: null,
      sourceFamilyId: "6cabf272-42f5-4d48-bf10-cac53fca40de",
      versionNumber: 1,
      versionLabel: "v1",
      categories: [],
      displayOrder: null,
      versions: [],
      excludePatterns: [],
      includePatterns: [],
      hasSiteProfile: false,
      siteProfileLensCount: 0,
    });
    assert.equal(label.name, "docs.example.com");
  });

  it("uses catalog labels without fetching when names are present", async () => {
    const widgets: WidgetIntegrationSummary[] = [
      {
        websiteId: "wgt_test",
        name: "Docs widget",
        brand: {
          projectName: "Docs widget",
          projectColor: "#000",
          projectLogo: null,
        },
        status: "active",
        sourceIds: ["src-1"],
        allowedOrigins: ["https://example.com"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const labels = await resolveWidgetSourceLabels(widgets, [
      {
        id: "src-1",
        projectId: "p1",
        name: "My docs",
        slug: "my-docs",
        scope: "personal",
        hosting: "cloud",
        startUrl: "https://docs.example.com",
        startUrls: ["https://docs.example.com"],
        sourceType: "documentation",
        ogImageUrl: null,
        faviconUrl: null,
        indexedAt: null,
        pageCount: 1,
        chunkCount: 1,
        canonicalUrl: null,
        sourceFamilyId: "src-1",
        versionNumber: 1,
        versionLabel: "v1",
        categories: [],
        displayOrder: null,
        versions: [],
        excludePatterns: [],
        includePatterns: [],
        hasSiteProfile: false,
        siteProfileLensCount: 0,
      },
    ]);

    assert.equal(labels["src-1"]?.name, "My docs");
    assert.equal(labels["src-1"]?.startUrl, "https://docs.example.com");
  });
});
