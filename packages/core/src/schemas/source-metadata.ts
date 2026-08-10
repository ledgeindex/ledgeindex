import { z } from "zod";

export const sourceContentTypeSchema = z.enum([
  "documentation",
  "api-reference",
  "changelog",
  "blog",
  "marketing",
  "wiki",
  "repository",
  "unknown",
]);

export const sourceOriginSchema = z.enum(["internal", "external", "vendor"]);

export const versionSourceSchema = z.enum([
  "url_path",
  "openapi",
  "user",
  "detected",
]);

export const llmsTxtCaptureSchema = z.object({
  url: z.string().url(),
  content: z.string(),
  truncated: z.boolean().optional(),
});

export const docsIdentityPathSchema = z.object({
  url: z.string().min(1),
  label: z.string().max(120).optional(),
  description: z.string().max(2000),
  audience: z.string().max(240).optional(),
});

/** Shelf kind inferred by About / docs-identity profiler. */
export const docsIdentityKindSchema = z.enum([
  "frameworks",
  "libraries",
  "apis-services",
  "tooling",
  "uncategorized",
]);

/** Primary language inferred by About / docs-identity profiler. */
export const docsIdentityLanguageSchema = z.enum([
  "javascript",
  "typescript",
  "python",
  "other",
]);

export const docsIdentitySchema = z.object({
  overallSummary: z.string().max(1000).optional(),
  kind: docsIdentityKindSchema.optional(),
  language: docsIdentityLanguageSchema.optional(),
  updatedAt: z.string().optional(),
  generatedAt: z.string().optional(),
  paths: z.array(docsIdentityPathSchema).max(48),
});

export const sourceMetadataSchema = z.object({
  sourceType: sourceContentTypeSchema,
  sourceTypeConfidence: z.number().min(0).max(1),
  origin: sourceOriginSchema.default("external"),
  version: z.string().nullable().optional(),
  versionSource: versionSourceSchema.nullable().optional(),
  detectedSignals: z.array(z.string()).default([]),
  llmsTxt: llmsTxtCaptureSchema.nullable().optional(),
  /** Profile of the indexed docs start URL (lens: crawl → pick context → synthesize). */
  docsIdentity: docsIdentitySchema.optional(),
});

export type SourceContentType = z.infer<typeof sourceContentTypeSchema>;
export type SourceOrigin = z.infer<typeof sourceOriginSchema>;
export type VersionSource = z.infer<typeof versionSourceSchema>;
export type LlmsTxtCapture = z.infer<typeof llmsTxtCaptureSchema>;
export type DocsIdentityPath = z.infer<typeof docsIdentityPathSchema>;
export type DocsIdentityKind = z.infer<typeof docsIdentityKindSchema>;
export type DocsIdentityLanguage = z.infer<typeof docsIdentityLanguageSchema>;
export type DocsIdentity = z.infer<typeof docsIdentitySchema>;
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;

export const DOCS_IDENTITY_KIND_LABELS: Record<DocsIdentityKind, string> = {
  frameworks: "Frameworks",
  libraries: "Libraries",
  "apis-services": "APIs & Services",
  tooling: "Tooling",
  uncategorized: "Uncategorized",
};

export const DOCS_IDENTITY_LANGUAGE_LABELS: Record<
  DocsIdentityLanguage,
  string
> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  other: "Other",
};

export const SOURCE_CONTENT_TYPE_LABELS: Record<SourceContentType, string> = {
  documentation: "Documentation",
  "api-reference": "API reference",
  changelog: "Changelog",
  blog: "Blog",
  marketing: "Marketing site",
  wiki: "Wiki",
  repository: "Repository",
  unknown: "Unknown",
};

export const SOURCE_ORIGIN_LABELS: Record<SourceOrigin, string> = {
  internal: "Internal",
  external: "External",
  vendor: "Vendor",
};
