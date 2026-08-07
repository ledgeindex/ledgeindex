/**
 * Canonical syntax-highlighter language ids for extracted examples.
 * Keep in sync with AG `prism-language` / Prism + Shiki names.
 */
export const EXAMPLE_LANGUAGES = [
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "python",
  "json",
  "yaml",
  "bash",
  "docker",
  "html",
  "css",
  "scss",
  "sql",
  "go",
  "rust",
  "java",
  "kotlin",
  "swift",
  "ruby",
  "php",
  "csharp",
  "cpp",
  "c",
  "markdown",
  "toml",
  "xml",
  /** Code whose syntax is not in the list above — stored explicitly, plain text in UI. */
  "other",
] as const;

export type ExampleLanguage = (typeof EXAMPLE_LANGUAGES)[number];

const EXAMPLE_LANGUAGE_SET = new Set<string>(EXAMPLE_LANGUAGES);

/**
 * Map LLM / fence aliases onto EXAMPLE_LANGUAGES.
 * Unlisted tags become null (LLM should use `other` for code in an unlisted language).
 */
const EXAMPLE_LANGUAGE_ALIASES: Record<string, ExampleLanguage> = {
  js: "javascript",
  javascript: "javascript",
  node: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  typescript: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  py: "python",
  python: "python",
  python3: "python",
  json: "json",
  jsonc: "json",
  json5: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sh: "bash",
  bash: "bash",
  shell: "bash",
  zsh: "bash",
  shellscript: "bash",
  docker: "docker",
  dockerfile: "docker",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  sql: "sql",
  go: "go",
  golang: "go",
  rust: "rust",
  rs: "rust",
  java: "java",
  kotlin: "kotlin",
  kt: "kotlin",
  swift: "swift",
  ruby: "ruby",
  rb: "ruby",
  php: "php",
  csharp: "csharp",
  "c#": "csharp",
  cs: "csharp",
  cpp: "cpp",
  "c++": "cpp",
  c: "c",
  md: "markdown",
  markdown: "markdown",
  other: "other",
};

/** Normalize LLM language tags to EXAMPLE_LANGUAGES (or null). */
export function normalizeExampleLanguage(
  language: string | null | undefined,
): ExampleLanguage | null {
  if (typeof language !== "string") return null;
  const normalized = language.trim().toLowerCase();
  if (!normalized) return null;

  const aliased = EXAMPLE_LANGUAGE_ALIASES[normalized];
  if (aliased) return aliased;

  if (EXAMPLE_LANGUAGE_SET.has(normalized)) {
    return normalized as ExampleLanguage;
  }

  return null;
}
