# @ledgeindex/desktop

Electron desktop app for LedgeIndex. UI is the **same React app as `apps/web`**, bundled in Electron Vite — **no Next.js website server**.

## Develop

```bash
npm run dev:ledgeindex-desktop
```

Starts:

1. Electron + Vite renderer (shared web UI)
2. **Its own** `@ledgeindex/desktop-server` on **`:3015`** for **Personal**
3. **Public** tab uses the remote/web API URL from `apps/web` env (`NEXT_PUBLIC_LEDGEINDEX_API_URL`) — never the local sidecar

## Stack

- Frameless window; web AppShell header = drag region + window controls
- Next.js imports shimmed → React Router
- Sidecar: `@ledgeindex/desktop-server` → `@ledgeindex/server` on dedicated port

**License:** same as monorepo — see [`../../LICENSE.md`](../../LICENSE.md).
