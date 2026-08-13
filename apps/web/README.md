# @ledgeindex/web

Next.js UI (sources, ingest, docs chat). Talks to the Fastify API. MCP is on the API, not here.

Full walkthrough: docs site **Guides → Set up web** ([`apps/docs/content/guides/setup-web.mdx`](../docs/content/guides/setup-web.mdx)).

## Run (from the ledgeindex repo root)

```bash
npm install

cp env.example .env
cp apps/web/.env.example apps/web/.env.local

npm run dev:api    # :3010 + /mcp
npm run dev:web    # :3004
```

## Env

**API** (`env.example` → `.env`): `PORT`, `LEDGEINDEX_PROFILES`, `LEDGEINDEX_AUTH_REQUIRED=0`, `MASTRA_PUBLIC_URL`, `LEDGEINDEX_FRONTEND_URL`, model keys.

**UI** (`apps/web/.env.example` → `apps/web/.env.local`):

| Variable | Dev default |
|----------|-------------|
| `NEXT_PUBLIC_LEDGEINDEX_API_URL` | `http://localhost:3010` |
| `NEXT_PUBLIC_FIREBASE_*` | unset (optional locally) |

Production `next build` requires a **non-localhost** `NEXT_PUBLIC_LEDGEINDEX_API_URL`.
