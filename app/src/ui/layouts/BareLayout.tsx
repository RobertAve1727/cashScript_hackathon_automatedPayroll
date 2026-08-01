import type { ReactNode } from 'react'

/**
 * Shell for the standalone screens — login, registration, password recovery,
 * error and maintenance pages.
 *
 * These pages had no `.main-wrapper` in the template and supply their own
 * full-page markup, so the layout adds nothing around them.
 */
export function BareLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
