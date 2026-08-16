'use client'

import Link from 'next/link'
import { DocsLogo } from './DocsLogo'
import { DocsTabs } from './DocsTabs'

export function DocsNavbarBrand() {
  return (
    <div className="docs-navbar-start">
      <Link href="/docs" className="docs-navbar-logo-link" aria-label="Home page">
        <DocsLogo />
      </Link>
      <DocsTabs />
    </div>
  )
}
