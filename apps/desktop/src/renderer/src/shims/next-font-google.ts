type GoogleFontOptions = {
  weight?: string | string[]
  style?: string | string[]
  subsets?: string[]
  display?: string
  variable?: string
  fallback?: string[]
  preload?: boolean
  adjustFontFallback?: boolean
}

function googleFont(_options: GoogleFontOptions = {}): {
  className: string
  style: { fontFamily: string }
  variable: string
} {
  return {
    className: '',
    style: { fontFamily: 'inherit' },
    variable: ''
  }
}

export default googleFont
export const Inter = googleFont
export const JetBrains_Mono = googleFont
export const IBM_Plex_Sans = googleFont
