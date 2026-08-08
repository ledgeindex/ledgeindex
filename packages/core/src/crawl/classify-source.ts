import type { CheerioAPI } from "cheerio";
import { fetchRootLlmsTxt } from "./llms-txt.js";
import { buildMarkdownAlternateUrls } from "../extract/parser/markdown-alternate.js";
import type {
  SourceContentType,
  SourceMetadata,
  VersionSource,
} from "../schemas/source-metadata.js";

export type SourceClassificationInput = {
  url: string;
  html: string;
  $: CheerioAPI;
  userAgent: string;
};

type ScoreEntry = {
  type: SourceContentType;
  weight: number;
  signal: string;
};

const DOC_GENERATORS = [
  { pattern: /mintlify/i, signal: "generator_mintlify" },
  { pattern: /docusaurus/i, signal: "generator_docusaurus" },
  { pattern: /gitbook/i, signal: "generator_gitbook" },
  { pattern: /readme/i, signal: "generator_readme" },
  { pattern: /mkdocs/i, signal: "generator_mkdocs" },
  { pattern: /nextra/i, signal: "generator_nextra" },
];

async function probeNativeMarkdown(
  pageUrl: string,
  userAgent: string,
): Promise<boolean> {
  for (const markdownUrl of buildMarkdownAlternateUrls(pageUrl)) {
    try {
      const response = await fetch(markdownUrl, {
        headers: {
          "User-Agent": userAgent,
          Accept: "text/markdown,text/plain,*/*",
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      const body = (await response.text()).trim();
      if (body.startsWith("#") || body.startsWith(">")) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function extractGeneratorSignal($: CheerioAPI): string | null {
  const generator =
    $('meta[name="generator"]').attr("content")?.trim() ??
    $('meta[property="generator"]').attr("content")?.trim() ??
    "";
  if (!generator) return null;
  for (const entry of DOC_GENERATORS) {
    if (entry.pattern.test(generator)) return entry.signal;
  }
  return null;
}

function pathSignals(pathname: string): ScoreEntry[] {
  const path = pathname.toLowerCase();
  const scores: ScoreEntry[] = [];

  if (
    /\/(docs?|documentation|guide|guides|learn|handbook)(\/|$)/.test(path) ||
    /\/api-reference(\/|$)/.test(path)
  ) {
    scores.push({
      type: "documentation",
      weight: 0.22,
      signal: "path_documentation",
    });
  }

  if (
    /\/(api|api-reference|reference|openapi|swagger)(\/|$)/.test(path) ||
    /\/v\d+(\/api|\/reference)/.test(path)
  ) {
    scores.push({
      type: "api-reference",
      weight: 0.28,
      signal: "path_api_reference",
    });
  }

  if (/\/(changelog|release-notes|releases)(\/|$)/.test(path)) {
    scores.push({
      type: "changelog",
      weight: 0.35,
      signal: "path_changelog",
    });
  }

  if (/\/(blog|news|articles?)(\/|$)/.test(path)) {
    scores.push({ type: "blog", weight: 0.32, signal: "path_blog" });
  }

  if (/\/(wiki|kb|knowledge-base)(\/|$)/.test(path)) {
    scores.push({ type: "wiki", weight: 0.3, signal: "path_wiki" });
  }

  if (
    path === "/" ||
    /\/(pricing|about|contact|careers|home)(\/|$)/.test(path)
  ) {
    scores.push({
      type: "marketing",
      weight: 0.12,
      signal: "path_marketing",
    });
  }

  return scores;
}

function htmlSignals($: CheerioAPI, html: string): ScoreEntry[] {
  const scores: ScoreEntry[] = [];
  const lowerHtml = html.toLowerCase();

  const generatorSignal = extractGeneratorSignal($);
  if (generatorSignal) {
    scores.push({
      type: "documentation",
      weight: 0.3,
      signal: generatorSignal,
    });
  }

  if (
    lowerHtml.includes("openapi") ||
    lowerHtml.includes("swagger-ui") ||
    $('link[href*="openapi"]').length > 0
  ) {
    scores.push({
      type: "api-reference",
      weight: 0.25,
      signal: "html_openapi",
    });
  }

  if ($('script[type="application/ld+json"]').text().includes("BlogPosting")) {
    scores.push({ type: "blog", weight: 0.2, signal: "schema_blog_posting" });
  }

  if (
    $('[class*="sidebar"], nav[class*="doc"], [data-docs-sidebar]').length > 0
  ) {
    scores.push({
      type: "documentation",
      weight: 0.15,
      signal: "html_doc_sidebar",
    });
  }

  return scores;
}

export function extractVersionFromPath(pathname: string): {
  version: string | null;
  source: VersionSource | null;
} {
  const segments = pathname.split("/").filter(Boolean);
  for (const segment of segments) {
    const match = /^v(\d+(?:\.\d+)?)$/i.exec(segment);
    if (match?.[1]) {
      return { version: match[1], source: "url_path" };
    }
  }
  return { version: null, source: null };
}

function pickBestType(scores: ScoreEntry[]): {
  type: SourceContentType;
  confidence: number;
  signals: string[];
} {
  const totals = new Map<SourceContentType, number>();
  const signals: string[] = [];

  for (const entry of scores) {
    totals.set(entry.type, (totals.get(entry.type) ?? 0) + entry.weight);
    signals.push(entry.signal);
  }

  let bestType: SourceContentType = "unknown";
  let bestScore = 0;

  for (const [type, score] of totals) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  if (bestScore < 0.15) {
    return {
      type: "unknown",
      confidence: Math.min(0.4, bestScore),
      signals,
    };
  }

  const confidence = Math.min(0.98, 0.35 + bestScore);
  return { type: bestType, confidence, signals };
}

export async function classifySource(
  input: SourceClassificationInput,
): Promise<SourceMetadata> {
  const parsed = new URL(input.url);
  const origin = parsed.origin;

  const [llmsTxt, hasNativeMarkdown] = await Promise.all([
    fetchRootLlmsTxt(origin, input.userAgent),
    probeNativeMarkdown(input.url, input.userAgent),
  ]);

  const scores: ScoreEntry[] = [
    ...pathSignals(parsed.pathname),
    ...htmlSignals(input.$, input.html),
  ];

  if (llmsTxt) {
    scores.push({
      type: "documentation",
      weight: 0.38,
      signal: "llms_txt",
    });
  }

  if (hasNativeMarkdown) {
    scores.push({
      type: "documentation",
      weight: 0.28,
      signal: "native_markdown",
    });
  }

  const { type, confidence, signals } = pickBestType(scores);
  const { version, source: versionSource } = extractVersionFromPath(
    parsed.pathname,
  );

  return {
    sourceType: type,
    sourceTypeConfidence: Number(confidence.toFixed(2)),
    origin: "external",
    version,
    versionSource,
    detectedSignals: [...new Set(signals)],
    llmsTxt: llmsTxt ?? null,
  };
}
