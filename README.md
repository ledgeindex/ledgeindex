<p align="center">
  <img src="apps/web/public/images/logo.webp" alt="LedgeIndex" width="160">
</p>

<h1 align="center">LedgeIndex</h1>

<p align="center">
  Open-core knowledge indexing for developer documentation: crawl, chunk, embed, retrieve, and chat with citations.
</p>

<p align="center">
  <a href="https://ledgeindex.com"><img alt="Website" src="https://img.shields.io/badge/Website-ledgeindex.com-1f6feb"></a>
  <a href="https://github.com/ledgeindex/ledgeindex"><img alt="Repository" src="https://img.shields.io/badge/GitHub-ledgeindex-24292f?logo=github"></a>
  <a href="https://mastra.ai"><img alt="Built with Mastra" src="https://img.shields.io/badge/Built%20with-Mastra-6e40c9"></a>
  <a href="./LICENSE.md"><img alt="License" src="https://img.shields.io/badge/License-Sustainable%20Use-4a5568"></a>
</p>

---

## Repository layout

```
ledgeindex/                    # monorepo root
  package.json                   # workspaces: apps/*, packages/*, hosts/*
  tsconfig.base.json
  apps/
    web/                         # @ledgeindex/web — Next.js UI
    docs/                        # @ledgeindex/docs-site — Nextra docs (port 3005)
    desktop/                     # @ledgeindex/desktop — Electron
    mobile/                      # @ledgeindex/mobile — Expo
  packages/                      # @ledgeindex/*
  hosts/
    api/                         # Fastify API + MCP (default :3010)
    desktop-server/              # Electron sidecar (default :3015)
```

Minimal install uses **`docs`** and **`profile`** (`LEDGEINDEX_PROFILES=docs,profile`). The Electron app uses **`hosts/desktop-server`**.

---

## Prerequisites

- Node.js 20+
- npm (install from this repo root)
- At least one LLM / embedding provider (optional until you crawl)

---

## Quick start

From this repository root:

```bash
npm install

cp env.example .env
# edit .env — add model keys if you want ingest/chat

cp apps/web/.env.example apps/web/.env.local

npm run dev:api    # Fastify + MCP on :3010
npm run dev:web    # Next.js UI on :3004
```

- Health: `http://localhost:3010/health`
- MCP: `http://localhost:3010/mcp`
- UI: `http://localhost:3004`

Data defaults to `./.data` unless `LEDGEINDEX_DATA_DIR` is set.

Production web builds **require** `NEXT_PUBLIC_LEDGEINDEX_API_URL` to a non-localhost origin (set in your deploy env / vault, not in this repo).

---

## Environment

API: [`env.example`](./env.example) → `.env`

Web: [`apps/web/.env.example`](./apps/web/.env.example) → `apps/web/.env.local`

Desktop: [`apps/desktop/.env.example`](./apps/desktop/.env.example)

| Variable | Purpose |
| --- | --- |
| `LEDGEINDEX_DATA_DIR` | Writable data dir |
| `LEDGEINDEX_PROFILES` | `docs`, `profile` |
| `PORT` / `HOST` | API listen (default `3010`) |
| `MASTRA_PUBLIC_URL` | Origin advertised for `/mcp` and OAuth |
| `LEDGEINDEX_FRONTEND_URL` | Web origin for MCP OAuth (`/mcp/connect`) |
| `NEXT_PUBLIC_LEDGEINDEX_API_URL` | Web → API (dev default `http://localhost:3010`) |
| `NEXT_PUBLIC_LEDGEINDEX_LOCAL_API_URL` | Desktop sidecar (default `http://127.0.0.1:3015`) |
| `NEXT_PUBLIC_LEDGEINDEX_REMOTE_API_URL` | Desktop Public / hosted API (empty for local-only) |
| `GOOGLE_GENERATIVE_AI_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` | Models |
| `COHERE_API_KEY` | Rerank (optional) |
| `LEDGEINDEX_VECTOR_BACKEND` | `libsql` or `pgvector` |

---

## Scripts

Run from this repo root:

| Script | Description |
| --- | --- |
| `dev:api` | API + Mastra + MCP (`hosts/api`) |
| `dev:web` | Next.js web UI (`:3004`) |
| `dev:docs` | Docs site (`:3005`) |
| `dev:desktop` | Electron desktop |
| `build:packages` | Build `@ledgeindex/*` |

---

## Packages

| Package | Description |
| --- | --- |
| `@ledgeindex/core` | Crawl, chunk, vector, query |
| `@ledgeindex/docs` | Ingest, RAG, MCP, routes |
| `@ledgeindex/profile` | Site / entity research profiles |
| `@ledgeindex/server` | `startLedgeIndexServer` |
| `@ledgeindex/client` | HTTP client |

---

## MCP

The MCP server lives on the API process, not in Next.js.

Local Cursor config (after `npm run dev:api`):

```json
{
  "mcpServers": {
    "ledgeindex": {
      "url": "http://localhost:3010/mcp"
    }
  }
}
```

The connect page in the UI prints the same URL from `NEXT_PUBLIC_LEDGEINDEX_API_URL`. Desktop injects `MASTRA_PUBLIC_URL` for the sidecar (`:3015/mcp`).

Step-by-step env and run commands: docs site **Guides** (`npm run dev:docs` → `/guides/setup-web` and `/guides/setup-desktop`).

---

## Contributing

Run package typecheck and `@ledgeindex/core` tests before opening a PR.

---

## License

[Sustainable Use License](./LICENSE.md)
