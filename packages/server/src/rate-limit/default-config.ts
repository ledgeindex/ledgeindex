import type { RateLimitConfig } from "./types.js";

/**
 * Default LedgeIndex HTTP limits — same pattern as backend-api legacy JSON
 * (`windowSeconds` + buckets + read/write fallback).
 */
export const LEDGEINDEX_API_RATE_LIMIT: RateLimitConfig = {
  api: "ledgeindex",
  version: 1,
  description:
    "Hosted + local Fastify surface. Keyed by Firebase uid / API key uid, else IP.",
  windowSeconds: 60,
  fallback: {
    readMaxPerWindow: 120,
    writeMaxPerWindow: 60,
    note: "Unlisted routes under /api, /chat, /mastra",
  },
  buckets: {
    sources_read: {
      maxPerWindow: 120,
      label: "List / get sources",
      routes: [
        { method: "GET", path: "/api/sources" },
        { method: "GET", path: "/api/sources/duplicates" },
        { method: "GET", path: "/api/source-categories" },
        { method: "GET", path: "/api/sources/:id" },
        { method: "GET", path: "/api/sources/:id/summary" },
        { method: "GET", path: "/api/sources/:id/crawl-progress" },
        { method: "GET", path: "/api/source-sets" },
        { method: "GET", path: "/api/source-sets/:id" },
        { method: "GET", path: "/api/projects" },
        { method: "GET", path: "/api/projects/:id" },
        { method: "GET", path: "/api/auth/me" },
      ],
    },
    sources_write: {
      maxPerWindow: 40,
      label: "Create / update / delete sources",
      routes: [
        { method: "POST", path: "/api/sources" },
        { method: "PUT", path: "/api/sources" },
        { method: "PUT", path: "/api/sources/reorder" },
        { method: "PUT", path: "/api/sources/:id" },
        { method: "DELETE", path: "/api/sources/:id" },
        { method: "PUT", path: "/api/sources/:id/docs-identity" },
        { method: "PUT", path: "/api/sources/:id/site-profile" },
        { method: "DELETE", path: "/api/sources/:id/site-profile" },
        { method: "POST", path: "/api/source-sets" },
        { method: "PUT", path: "/api/source-sets/:id" },
        { method: "DELETE", path: "/api/source-sets/:id" },
        { method: "POST", path: "/api/projects" },
      ],
    },
    crawl_setup: {
      maxPerWindow: 30,
      label: "Preflight + crawl filter / probe helpers",
      routes: [
        { method: "POST", path: "/api/preflight" },
        { method: "POST", path: "/api/discover-header-nav" },
        { method: "GET", path: "/api/discover-header-nav" },
        { method: "GET", path: "/api/discover-header-nav/runtime" },
        { method: "POST", path: "/api/discover-header-nav/runtime/install" },
        { method: "POST", path: "/api/crawl/url-filter" },
        { method: "POST", path: "/api/crawl/url-removals" },
        { method: "POST", path: "/api/crawl/sitemap-pages" },
        { method: "POST", path: "/api/crawl/robots-txt" },
        { method: "POST", path: "/api/crawl/probe-statuses" },
        { method: "POST", path: "/api/sources/:id/crawl-preview" },
        { method: "POST", path: "/api/sources/:id/parse-preview" },
      ],
    },
    ingest: {
      maxPerWindow: 20,
      label: "Ingest / crawl start",
      routes: [
        { method: "POST", path: "/api/sources/:id/ingest/start" },
        { method: "POST", path: "/api/sources/:id/ingest/cancel" },
        { method: "POST", path: "/api/sources/:id/ingest/:runId/resume" },
      ],
    },
    ingest_poll: {
      maxPerWindow: 600,
      label: "Ingest run status (UI polling)",
      routes: [
        { method: "GET", path: "/api/sources/:id/ingest/:runId" },
      ],
    },
    chat: {
      maxPerWindow: 40,
      label: "Docs chat + ask",
      routes: [
        { method: "POST", path: "/chat/:agentId" },
        { method: "POST", path: "/api/sources/:id/ask" },
        { method: "POST", path: "/api/sources/:id/find-examples" },
      ],
    },
    auth_keys: {
      maxPerWindow: 30,
      label: "API keys",
      routes: [
        { method: "GET", path: "/api/auth/api-keys" },
        { method: "POST", path: "/api/auth/api-keys" },
        { method: "DELETE", path: "/api/auth/api-keys/:keyId" },
      ],
    },
  },
};
