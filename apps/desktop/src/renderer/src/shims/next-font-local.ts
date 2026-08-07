type FontOptions = {
  src?: string | Array<{ path: string; weight?: string; style?: string }>
  weight?: string
  style?: string
  display?: string
  variable?: string
  fallback?: string[]
  preload?: boolean
}

export default function localFont(_options: FontOptions = {}): {
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
