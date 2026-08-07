'use client'

import { usePathname } from 'next/navigation'
import { getDocsSection } from '../lib/section'

export function SectionProvider({ children }) {
  const pathname = usePathname()
  const section = getDocsSection(pathname)

  return (
    <div className="docs-section-root" data-docs-section={section}>
      {children}
    </div>
  )
}
