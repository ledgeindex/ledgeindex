/** Chrome UA without the word "Electron" (Google/Firebase reject Electron UA). */
export const DESKTOP_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Google / Firebase auth popup or redirect URLs. */
export function isAuthNavigationUrl(url: string): boolean {
  if (!url || url === 'about:blank') return true
  return (
    url.includes('accounts.google.com') ||
    url.includes('google.com/o/oauth2') ||
    url.includes('google.com/signin') ||
    url.includes('firebaseapp.com') ||
    url.includes('googleapis.com/identitytoolkit') ||
    url.includes('gstatic.com/firebasejs')
  )
}
