import { useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Supplies the menu state the generated chrome components bind to.
 *
 * The template hard-coded `active` and `subdrop` classes into every page and
 * expanded the matching submenu with an inline `display: block`. The extractor
 * strips that frozen state and replaces it with calls to these helpers, so a
 * single sidebar component highlights correctly on all 283 routes.
 */
export interface MenuState {
  /** Current pathname, normalised without a trailing slash. */
  pathname: string
  /**
   * Appends `stateClass` to `base` when one of `routes` is the current page.
   * Mirrors how the template marked the active link and its open ancestors.
   */
  menuClass(base: string, routes: readonly string[], stateClass?: string): string
  /** Expands a submenu that contains the current route. */
  submenuStyle(routes: readonly string[]): { display: string }
}

export function useMenuState(): MenuState {
  const { pathname } = useLocation()

  const normalized = useMemo(
    () => (pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname),
    [pathname],
  )

  const contains = useCallback(
    (routes: readonly string[]) => routes.includes(normalized),
    [normalized],
  )

  const menuClass = useCallback(
    (base: string, routes: readonly string[], stateClass = 'active') =>
      contains(routes) ? `${base} ${stateClass}`.trim() : base,
    [contains],
  )

  const submenuStyle = useCallback(
    (routes: readonly string[]) => ({ display: contains(routes) ? 'block' : 'none' }),
    [contains],
  )

  return { pathname: normalized, menuClass, submenuStyle }
}
