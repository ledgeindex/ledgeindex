type SearchSource = {
  rank: number
  url: string
  title: string
  snippet?: string
}

const BLOG_LIKE = /\b(blog|medium\.com|dev\.to|changelog|newsletter)\b/i

/** Prefer official /docs/ URLs over blogs when picking a page to fetch. */
export function pickBestDocsUrl(sources: SearchSource[]): string | null {
  if (sources.length === 0) return null

  const docsPaths = sources.filter(
    (s) => /\/docs(\/|$)/i.test(s.url) && !BLOG_LIKE.test(s.url) && !BLOG_LIKE.test(s.title),
  )
  if (docsPaths.length > 0) return docsPaths[0]!.url

  const nonBlog = sources.filter((s) => !BLOG_LIKE.test(s.url) && !BLOG_LIKE.test(s.title))
  if (nonBlog.length > 0) return nonBlog[0]!.url

  return sources[0]!.url
}
