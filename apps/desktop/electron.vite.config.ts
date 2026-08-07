import { createRequire } from 'module'
import { resolve } from 'path'
import { defineConfig, loadEnv, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const require = createRequire(import.meta.url)
const webSrc = resolve(__dirname, '../web/src')
const shim = (name: string) => resolve(__dirname, `src/renderer/src/shims/${name}`)

/** Force one React copy — web has its own node_modules/react; lucide must share it. */
function resolvePkg(id: string): string {
  return resolve(require.resolve(`${id}/package.json`), '..')
}

export default defineConfig(({ mode }) => {
  const webEnv = loadEnv(mode, resolve(__dirname, '../web'), '')
  const defineEnv: Record<string, string> = {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development')
  }

  for (const [key, value] of Object.entries(webEnv)) {
    if (key.startsWith('NEXT_PUBLIC_') || key.startsWith('VITE_')) {
      defineEnv[`process.env.${key}`] = JSON.stringify(value)
    }
  }

  // Desktop: Personal → local sidecar (:3015). Public → hosted API (never web's :3010).
  const localApi = 'http://127.0.0.1:3015'
  const hostedFallback = 'https://api.ledgeindex.com'
  const isLoopback = (url: string) => {
    try {
      const host = new URL(url).hostname
      return host === 'localhost' || host === '127.0.0.1' || host === '::1'
    } catch {
      return true
    }
  }
  const remoteCandidates = [
    webEnv.NEXT_PUBLIC_LEDGEINDEX_REMOTE_API_URL,
    webEnv.NEXT_PUBLIC_KNOWLEDGEINDEX_REMOTE_API_URL,
    webEnv.LEDGEINDEX_REMOTE_API_URL,
    process.env.NEXT_PUBLIC_LEDGEINDEX_REMOTE_API_URL,
    process.env.LEDGEINDEX_REMOTE_API_URL
  ]
  let remoteApi = hostedFallback
  for (const candidate of remoteCandidates) {
    const trimmed = typeof candidate === 'string' ? candidate.trim().replace(/\/$/, '') : ''
    if (trimmed && !isLoopback(trimmed)) {
      remoteApi = trimmed
      break
    }
  }
  defineEnv['process.env.NEXT_PUBLIC_LEDGEINDEX_REMOTE_API_URL'] = JSON.stringify(remoteApi)
  defineEnv['process.env.NEXT_PUBLIC_KNOWLEDGEINDEX_REMOTE_API_URL'] =
    JSON.stringify(remoteApi)
  defineEnv['process.env.NEXT_PUBLIC_LEDGEINDEX_LOCAL_API_URL'] = JSON.stringify(localApi)
  defineEnv['process.env.NEXT_PUBLIC_LEDGEINDEX_API_URL'] = JSON.stringify(localApi)
  defineEnv['process.env.NEXT_PUBLIC_KNOWLEDGEINDEX_API_URL'] = JSON.stringify(localApi)
  defineEnv['process.env.LEDGEINDEX_DESKTOP_SERVER_PORT'] = JSON.stringify('3015')

  const reactDir = resolvePkg('react')
  const reactDomDir = resolvePkg('react-dom')
  const lucideDir = resolvePkg('lucide-react')

  return {
    main: {
      define: defineEnv,
      plugins: [externalizeDepsPlugin()]
    },
    preload: {
      plugins: [externalizeDepsPlugin()]
    },
    renderer: {
      define: defineEnv,
      // Same static assets as Next (`/images/logo.webp`, etc.)
      publicDir: resolve(__dirname, '../web/public'),
      resolve: {
        dedupe: ['react', 'react-dom', 'lucide-react'],
        alias: [
          // Pin shared React — otherwise web/node_modules/react + workspace react
          // both load and lucide-react throws "Invalid hook call".
          { find: /^react$/, replacement: reactDir },
          { find: /^react\/jsx-runtime$/, replacement: resolve(reactDir, 'jsx-runtime.js') },
          { find: /^react\/jsx-dev-runtime$/, replacement: resolve(reactDir, 'jsx-dev-runtime.js') },
          { find: /^react-dom$/, replacement: reactDomDir },
          { find: /^react-dom\/client$/, replacement: resolve(reactDomDir, 'client.js') },
          { find: /^lucide-react$/, replacement: lucideDir },
          { find: /^@\/(.*)/, replacement: `${webSrc}/$1` },
          { find: '@renderer', replacement: resolve('src/renderer/src') },
          {
            find: '@ledgeindex/client',
            replacement: resolve('../../packages/client/src/index.ts')
          },
          { find: 'next/link', replacement: shim('next-link.tsx') },
          { find: 'next/navigation', replacement: shim('next-navigation.ts') },
          { find: 'next/image', replacement: shim('next-image.tsx') },
          { find: 'next/dynamic', replacement: shim('next-dynamic.tsx') },
          { find: 'next/head', replacement: shim('next-head.tsx') },
          { find: 'next/font/local', replacement: shim('next-font-local.ts') },
          { find: 'next/font/google', replacement: shim('next-font-google.ts') }
        ]
      },
      optimizeDeps: {
        include: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react']
      },
      plugins: [tailwindcss(), react()],
      server: {
        fs: {
          allow: [resolve(__dirname, '../..'), resolve(__dirname, '../../../')]
        }
      }
    }
  }
})
