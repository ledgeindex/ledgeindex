/** Known AI agent crawlers — never block at the app layer. */
export const AI_AGENT_USER_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-User",
  "anthropic-ai",
  "Google-Extended",
  "Googlebot",
  "Google-CloudVertexBot",
  "PerplexityBot",
  "Perplexity-User",
  "DeepSeekBot",
  "Bytespider",
  "CCBot",
  "Amazonbot",
  "Applebot",
  "meta-externalagent",
  "ora-agent",
] as const;

export function isAiAgentUserAgent(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return AI_AGENT_USER_AGENTS.some((bot) => ua.includes(bot.toLowerCase()));
}

export function acceptsMarkdown(acceptHeader: string | null): boolean {
  if (!acceptHeader) return false;
  return acceptHeader.toLowerCase().includes("text/markdown");
}

/** Browsers send text/html. curl and many agents send * / * or omit Accept. */
export function prefersHtml(acceptHeader: string | null): boolean {
  if (!acceptHeader) return false;
  return acceptHeader.toLowerCase().includes("text/html");
}

export function shouldServeMarkdownNotFound(
  acceptHeader: string | null,
  userAgent: string | null,
): boolean {
  if (isAiAgentUserAgent(userAgent)) return true;
  if (acceptsMarkdown(acceptHeader)) return true;
  return !prefersHtml(acceptHeader);
}

export const MARKDOWN_NEGOTIATION_PATHS = new Set([
  "/",
  "/about",
  "/contact",
  "/privacy",
  "/llms.txt",
  "/developers",
  "/developers/api",
  "/developers/auth",
  "/developers/cli",
  "/developers/mcp",
  "/developers/sdk",
  "/developers/openapi",
  "/developers/onboarding",
]);

export const PUBLIC_MARKETING_PATHS = new Set([
  "/",
  "/about",
  "/contact",
  "/privacy",
  "/login",
  "/llms.txt",
  "/openapi.json",
  "/sitemap.xml",
  "/robots.txt",
  "/developers",
  "/developers/api",
  "/developers/auth",
  "/developers/cli",
  "/developers/mcp",
  "/developers/sdk",
  "/developers/openapi",
  "/developers/onboarding",
]);
