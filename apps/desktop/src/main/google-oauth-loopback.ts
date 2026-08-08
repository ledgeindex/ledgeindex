/**
 * Google OAuth loopback for packaged Electron (RFC 8252).
 * Opens the system browser — Google blocks OAuth inside Electron BrowserWindows
 * ("This browser or app may not be secure"). Callback still hits http://127.0.0.1.
 * Renderer then calls Firebase signInWithCredential(idToken).
 */
import { ipcMain, shell } from 'electron'
import { createServer, type Server } from 'node:http'

/** Avoid sidecar :3015; ActiveHue used :3011. */
const REDIRECT_PORT = Number(
  process.env.LEDGEINDEX_GOOGLE_OAUTH_REDIRECT_PORT?.trim() || 3016
)
const REDIRECT_PATH = '/oauth2callback'
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}${REDIRECT_PATH}`
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000

function resolveGoogleDesktopCredentials(): { clientId: string; clientSecret: string } {
  const clientId = (
    process.env.LEDGEINDEX_GOOGLE_DESKTOP_CLIENT_ID ||
    process.env.GOOGLE_DESKTOP_CLIENT_ID ||
    ''
  ).trim()
  const clientSecret = (
    process.env.LEDGEINDEX_GOOGLE_DESKTOP_CLIENT_SECRET ||
    process.env.GOOGLE_DESKTOP_CLIENT_SECRET ||
    ''
  ).trim()
  return { clientId, clientSecret }
}

async function getGoogleIdToken(): Promise<string> {
  const { clientId, clientSecret } = resolveGoogleDesktopCredentials()
  if (!clientId || !clientSecret) {
    throw new Error(
      'Desktop Google OAuth is not configured. Set LEDGEINDEX_GOOGLE_DESKTOP_CLIENT_ID and LEDGEINDEX_GOOGLE_DESKTOP_CLIENT_SECRET (Google Cloud → OAuth client type Desktop).'
    )
  }

  let server: Server | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const cleanup = (): void => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    try {
      server?.close()
    } catch {
      // ignore
    }
    server = null
  }

  const codePromise = new Promise<string>((resolve, reject) => {
    server = createServer((req, res) => {
      try {
        if (!req.url?.startsWith(REDIRECT_PATH)) {
          res.writeHead(404).end('Not found')
          return
        }
        const urlObj = new URL(req.url, `http://127.0.0.1:${REDIRECT_PORT}`)
        const authCode = urlObj.searchParams.get('code')
        const err = urlObj.searchParams.get('error')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          '<!doctype html><html><body style="font-family:system-ui;padding:2rem"><h2>Signed in</h2><p>You can close this tab and return to LedgeIndex.</p></body></html>'
        )
        cleanup()
        if (err) {
          reject(new Error(`Google OAuth error: ${err}`))
          return
        }
        if (!authCode) {
          reject(new Error('No code in OAuth callback'))
          return
        }
        resolve(authCode)
      } catch (error) {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })

    server.once('error', (error) => {
      cleanup()
      reject(error)
    })

    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      console.log(`[desktop] OAuth callback listening at ${REDIRECT_URI}`)
    })

    timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error('Google sign-in timed out. Complete sign-in in your browser, then try again.'))
    }, OAUTH_TIMEOUT_MS)
  })

  const authUrl = [
    'https://accounts.google.com/o/oauth2/v2/auth',
    `?client_id=${encodeURIComponent(clientId)}`,
    '&response_type=code',
    '&scope=profile%20email',
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    '&prompt=select_account'
  ].join('')

  // System browser only — embedded Electron Chromium is blocked by Google.
  try {
    await shell.openExternal(authUrl)
  } catch (error) {
    cleanup()
    throw error instanceof Error
      ? error
      : new Error('Could not open the system browser for Google sign-in')
  }

  let authorizationCode: string
  try {
    authorizationCode = await codePromise
  } catch (error) {
    cleanup()
    throw error
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: authorizationCode,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code'
    }).toString()
  })

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text()
    throw new Error(`Google token exchange failed: ${tokenResponse.status} ${errorText}`)
  }

  const data = (await tokenResponse.json()) as { id_token?: string }
  if (!data.id_token) {
    throw new Error('No id_token in Google token response')
  }
  return data.id_token
}

let registered = false

export function registerGoogleOAuthIpc(): void {
  if (registered) return
  registered = true
  ipcMain.handle('oauth:google-signin', async () => getGoogleIdToken())
}
