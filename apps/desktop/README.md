# @ledgeindex/desktop

Electron app. Same React UI as `apps/web`, bundled with Vite. **No Next.js server.** Personal indexes run on a sidecar (`hosts/desktop-server`) at `:3015`.

Full walkthrough: docs site **Guides → Set up desktop** ([`apps/docs/content/guides/setup-desktop.mdx`](../docs/content/guides/setup-desktop.mdx)).

## Run (from the ledgeindex repo root)

```bash
npm install
cp apps/desktop/.env.example apps/desktop/.env

npm run dev:desktop
```

Starts Electron plus `@ledgeindex/desktop-server` on **`:3015`**. You do not need `dev:api` / `dev:web` for Personal.

## Env (`apps/desktop/.env.example`)

| Variable | Dev default | Notes |
|----------|-------------|--------|
| `NEXT_PUBLIC_LEDGEINDEX_LOCAL_API_URL` | `http://127.0.0.1:3015` | Personal tab / sidecar |
| `NEXT_PUBLIC_LEDGEINDEX_REMOTE_API_URL` | empty | Public / cloud. Leave empty for local-only OSS. Required (non-localhost) for a packaged production build. |

MCP for this machine: `http://127.0.0.1:3015/mcp`.

## Stack

- Frameless window; web AppShell header is the drag region
- Next.js imports shimmed to React Router
- Sidecar: `@ledgeindex/desktop-server` → `@ledgeindex/server`

**License:** [`../../LICENSE.md`](../../LICENSE.md)
