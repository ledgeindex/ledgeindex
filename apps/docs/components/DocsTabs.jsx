'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/docs', label: 'Docs', match: (p) => p === '/docs' || p?.startsWith('/docs/') },
  {
    href: '/guides',
    label: 'Guides',
    match: (p) => p === '/guides' || p?.startsWith('/guides/'),
  },
  {
    href: '/reference',
    label: 'Reference',
    match: (p) => p === '/reference' || p?.startsWith('/reference/'),
  },
]

export function DocsTabs() {
  const pathname = usePathname()
  const active = TABS.find((tab) => tab.match(pathname))?.label ?? null

  return (
    <div className="docs-tabs-container">
      <nav className="docs-tabs" aria-label="Docs sections">
        {TABS.map(({ href, label }) => {
          const isActive = active === label
          return (
            <Link
              key={label}
              href={href}
              className={`docs-tab ${isActive ? 'docs-tab-active' : ''}`}
              style={{
                padding: '16px 24px',
                fontSize: '16px',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--nextra-body)' : 'var(--nextra-gray-500)',
                textDecoration: 'none',
                borderBottom: isActive
                  ? '3px solid var(--nextra-body)'
                  : '3px solid transparent',
                marginBottom: '-1px',
                transition: 'color 0.2s, border-color 0.2s',
              }}
            >
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
