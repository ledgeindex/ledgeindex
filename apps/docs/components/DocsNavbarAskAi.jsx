'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export function DocsNavbarAskAi() {
  const [target, setTarget] = useState(null)

  useEffect(() => {
    const nav = document.querySelector(
      'header.nextra-navbar nav, .nextra-navbar nav',
    )
    if (!nav) return

    const githubLink = nav.querySelector('a[href*="github.com"]')
    if (!githubLink?.parentElement) return

    const slot = document.createElement('div')
    slot.className = 'docs-ask-ai-slot x:max-md:hidden'
    githubLink.parentElement.insertBefore(slot, githubLink)
    setTarget(slot)

    return () => {
      slot.remove()
    }
  }, [])

  if (!target) return null

  return createPortal(
    <button type="button" className="docs-ask-ai-btn" data-docs-ask-ai>
      Ask AI
    </button>,
    target,
  )
}
