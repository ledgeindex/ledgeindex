import * as cheerio from 'cheerio'

export type DocsCodeBlock = {
  code: string
  language: string | null
  languageSource: string | null
  section: string | null
}

export type FetchedDocsPage = {
  url: string
  title: string
  excerpt: string
  textBlocks: string[]
  codeBlocks: DocsCodeBlock[]
  metrics: {
    textBlockCount: number
    codeBlockCount: number
    codeBlocksWithLanguage: number
    totalTextChars: number
    totalCodeChars: number
  }
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function extractLanguageFromClass(className?: string): string | null {
  if (!className) return null

  const patterns = [
    /\blanguage-([\w+#.-]+)\b/i,
    /\blang-([\w+#.-]+)\b/i,
    /\bhighlight-source-([\w+#.-]+)\b/i,
    /\bprism-code\s+language-([\w+#.-]+)\b/i,
  ]

  for (const pattern of patterns) {
    const match = className.match(pattern)
    if (match?.[1]) return match[1]
  }

  return null
}

function normalizeLanguageToken(raw?: string | null): string | null {
  if (!raw) return null
  const language = raw.trim().toLowerCase()
  if (!language || language === 'plain' || language === 'text' || language === 'none') {
    return null
  }
  return language
}

function detectCodeLanguage($: cheerio.CheerioAPI, el: cheerio.Element): {
  language: string | null
  languageSource: string | null
} {
  const pre = $(el)
  const code = pre.is('pre') ? pre.find('code').first() : pre
  const candidates = [
    { source: 'pre.data-language', value: pre.attr('data-language') },
    { source: 'code.data-language', value: code.attr('data-language') },
    { source: 'pre.data-lang', value: pre.attr('data-lang') },
    { source: 'code.data-lang', value: code.attr('data-lang') },
    { source: 'pre.class', value: extractLanguageFromClass(pre.attr('class')) },
    { source: 'code.class', value: extractLanguageFromClass(code.attr('class')) },
  ]

  for (const { source, value } of candidates) {
    const language = normalizeLanguageToken(value)
    if (language) return { language, languageSource: source }
  }

  return { language: null, languageSource: null }
}

function nearestHeading($: cheerio.CheerioAPI, el: cheerio.Element): string | null {
  let cur = $(el)
  while (cur.length) {
    const prev = cur.prevAll('h1,h2,h3,h4').first()
    if (prev.length) return normalizeWhitespace(prev.text())
    cur = cur.parent()
    if (cur.is('body,html')) break
  }
  return null
}

export function parseDocsHtml(html: string): Omit<FetchedDocsPage, 'url'> {
  const $ = cheerio.load(html)

  const title =
    $('h1').first().text().trim() ||
    $('title').first().text().trim() ||
    'Untitled'

  const root = $('article').length ? $('article').first() : $('main').first()
  const scope = root.length ? root : $('body')

  const textBlocks: string[] = []
  const codeBlocks: DocsCodeBlock[] = []

  scope.find('pre').each((_, el) => {
    const codeEl = $(el).find('code').first()
    const raw = (codeEl.length > 0 ? codeEl.text() : $(el).text()).replace(/\n$/, '')
    const code = raw.replace(/\r\n/g, '\n')
    if (!code.trim()) return

    const { language, languageSource } = detectCodeLanguage($, el)
    codeBlocks.push({
      code,
      language,
      languageSource,
      section: nearestHeading($, el),
    })
  })

  scope.find('p, li, h2, h3, h4, blockquote').each((_, el) => {
    if ($(el).parents('pre').length) return
    const text = normalizeWhitespace($(el).text())
    if (text.length >= 20) textBlocks.push(text)
  })

  const excerpt =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    textBlocks[0] ||
    ''

  return {
    title,
    excerpt,
    textBlocks,
    codeBlocks,
    metrics: {
      textBlockCount: textBlocks.length,
      codeBlockCount: codeBlocks.length,
      codeBlocksWithLanguage: codeBlocks.filter((b) => b.language).length,
      totalTextChars: textBlocks.join('\n\n').length,
      totalCodeChars: codeBlocks.map((b) => b.code).join('\n\n').length,
    },
  }
}

export async function fetchDocsPage(url: string): Promise<FetchedDocsPage> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AutomationGhost/1.0; docs-fetcher)',
      Accept: 'text/html,application/xhtml+xml',
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const parsed = parseDocsHtml(html)
  return { url, ...parsed }
}
