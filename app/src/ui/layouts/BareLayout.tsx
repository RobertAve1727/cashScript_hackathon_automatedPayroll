import { useEffect, type ReactNode } from 'react'

/** Scoped in index.html — hides the template's floating theme customiser. */
const HIDE_CUSTOMISER_CLASS = 'esahod-bare-shell'

/**
 * Shell for the standalone screens — login, registration, password recovery,
 * error and maintenance pages.
 *
 * These pages had no `.main-wrapper` in the template and supply their own
 * full-page markup, so the layout adds nothing around them.
 *
 * Except one thing. theme-script.js injects its floating gear and settings
 * panel straight into <body>, so they float over these screens too — a
 * layout customiser on a sign-in page, configuring chrome that is not on it.
 * The class this adds is what index.html's rule keys off, and it comes back
 * off on unmount so the customiser is available everywhere inside the app.
 */
export function BareLayout({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.body.classList.add(HIDE_CUSTOMISER_CLASS)

    return () => {
      document.body.classList.remove(HIDE_CUSTOMISER_CLASS)
    }
  }, [])

  return <>{children}</>
}
