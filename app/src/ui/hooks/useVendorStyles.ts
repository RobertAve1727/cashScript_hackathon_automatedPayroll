import { useEffect } from 'react'
import { isPageStylesheet } from '@ui/infrastructure/vendor/styleClassification'

/** Marks the <link> elements this hook owns so it can remove its own. */
const OWNED_ATTRIBUTE = 'data-page-stylesheet'

/**
 * Injects the stylesheets a page declared but the shell does not already load,
 * and removes them again when the page unmounts.
 *
 * Order matters: these sheets are appended after the global ones so they keep
 * the precedence they had in the template, where the page listed them last.
 */
export function useVendorStyles(hrefs: readonly string[]): void {
  // A stable key avoids re-running the effect when an equal array is rebuilt.
  const key = hrefs.join('|')

  useEffect(() => {
    const pageSheets = hrefs.filter(isPageStylesheet)
    if (!pageSheets.length) return undefined

    const links = pageSheets.map((href) => {
      // A sheet already present (e.g. two pages sharing it during a
      // transition) is reused rather than duplicated.
      const existing = document.querySelector<HTMLLinkElement>(
        `link[${OWNED_ATTRIBUTE}][href="${CSS.escape(href)}"]`,
      )
      if (existing) {
        existing.dataset.refCount = String(Number(existing.dataset.refCount ?? '1') + 1)
        return existing
      }

      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      link.setAttribute(OWNED_ATTRIBUTE, '')
      link.dataset.refCount = '1'
      document.head.appendChild(link)
      return link
    })

    return () => {
      for (const link of links) {
        const next = Number(link.dataset.refCount ?? '1') - 1
        if (next <= 0) link.remove()
        else link.dataset.refCount = String(next)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
