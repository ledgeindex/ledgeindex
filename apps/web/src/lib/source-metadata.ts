export type SourceContentType =
  | "documentation"
  | "api-reference"
  | "changelog"
  | "blog"
  | "marketing"
  | "wiki"
  | "repository"
  | "unknown";

export type SourceOrigin = "internal" | "external" | "vendor";

export type VersionSource = "url_path" | "openapi" | "user" | "detected";

export type LlmsTxtCapture = {
  url: string;
  content: string;
  truncated?: boolean;
};

export type DocsIdentityPath = {
  url: string;
  label?: string;
  description: string;
  audience?: string;
};

export type DocsIdentityKind =
  | "frameworks"
  | "libraries"
  | "apis-services"
  | "tooling"
  | "uncategorized";

export type DocsIdentityLanguage =
  | "javascript"
  | "typescript"
  | "python"
  | "other";

export type DocsIdentity = {
  overallSummary?: string;
  kind?: DocsIdentityKind;
  language?: DocsIdentityLanguage;
  updatedAt?: string;
  generatedAt?: string;
  paths: DocsIdentityPath[];
};

export type SourceMetadata = {
  sourceType: SourceContentType;
  sourceTypeConfidence: number;
  origin: SourceOrigin;
  version?: string | null;
  versionSource?: VersionSource | null;
  detectedSignals: string[];
  llmsTxt?: LlmsTxtCapture | null;
  docsIdentity?: DocsIdentity;
};

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

export const SOURCE_CONTENT_TYPES = Object.keys(
  SOURCE_CONTENT_TYPE_LABELS,
) as SourceContentType[];

export const SOURCE_ORIGINS = Object.keys(
  SOURCE_ORIGIN_LABELS,
) as SourceOrigin[];

const SIGNAL_LABELS: Record<string, string> = {
  generator_docusaurus: "Docusaurus",
  generator_mintlify: "Mintlify",
  generator_gitbook: "GitBook",
  generator_readme: "ReadMe",
  generator_mkdocs: "MkDocs",
  generator_nextra: "Nextra",
  html_doc_sidebar: "Doc sidebar",
  html_openapi: "OpenAPI",
  schema_blog_posting: "Blog schema",
  llms_txt: "llms.txt",
  native_markdown: "Native markdown",
  path_documentation: "Documentation",
  path_api_reference: "API reference",
  path_changelog: "Changelog",
  path_blog: "Blog",
  path_wiki: "Wiki",
  path_marketing: "Marketing",
  "source-builder": "Source builder",
};

const PATH_SIGNAL_BY_TYPE: Partial<Record<SourceContentType, string>> = {
  documentation: "path_documentation",
  "api-reference": "path_api_reference",
  changelog: "path_changelog",
  blog: "path_blog",
  wiki: "path_wiki",
  marketing: "path_marketing",
};

export function formatDetectedSignal(signal: string): string {
  return (
    SIGNAL_LABELS[signal] ??
    signal.replace(/^(path_|generator_)/, "").replace(/_/g, " ")
  );
}

/** Drops path-based type hints when the detected type already covers them. */
export function getDisplayDetectedSignals(metadata: SourceMetadata): string[] {
  const redundantPath = PATH_SIGNAL_BY_TYPE[metadata.sourceType];
  return metadata.detectedSignals.filter((signal) => signal !== redundantPath);
}

export function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}
