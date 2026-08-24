/** Known AI agent crawlers — never block at the app layer. */
export const AI_AGENT_USER_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "ClaudeBot",
  "anthropic-ai",
  "Google-Extended",
  "Googlebot",
  "PerplexityBot",
  "DeepSeekBot",
  "ora-agent",
  "Bytespider",
  "CCBot",
] as const;

export function isAiAgentUserAgent(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return AI_AGENT_USER_AGENTS.some((bot) => ua.includes(bot.toLowerCase()));
}

export const MARKDOWN_NEGOTIATION_PATHS = new Set([
  "/",
  "/about",
  "/contact",
  "/privacy",
  "/llms.txt",
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
]);

export function acceptsMarkdown(acceptHeader: string | null): boolean {
  if (!acceptHeader) return false;
  return acceptHeader.toLowerCase().includes("text/markdown");
}
