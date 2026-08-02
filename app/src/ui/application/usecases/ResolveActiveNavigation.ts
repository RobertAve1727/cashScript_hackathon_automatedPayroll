import {
  isNavigationLinkActive,
  type NavigationLink,
  type NavigationMenu,
} from '@ui/domain/navigation/NavigationItem'

/**
 * The activation state the sidebar needs for one route.
 *
 * The template expresses this with CSS classes (`active` on the current link,
 * `subdrop` plus an expanded <ul> on its ancestors); resolving it here keeps
 * that logic out of the view.
 */
export interface ActiveNavigationState {
  /** Route currently displayed. */
  readonly pathname: string
  /** True when the link, or any descendant, is the current route. */
  isActive(link: NavigationLink): boolean
  /** True when a submenu should render expanded. */
  isExpanded(link: NavigationLink): boolean
}

/**
 * Builds the activation state for a pathname.
 *
 * Trailing slashes are normalised so `/employees/` and `/employees` resolve to
 * the same entry.
 */
export function resolveActiveNavigation(
  _menu: NavigationMenu,
  pathname: string,
): ActiveNavigationState {
  const normalized = normalizeRoute(pathname)

  const isActive = (link: NavigationLink): boolean =>
    isNavigationLinkActive(link, normalized)

  return {
    pathname: normalized,
    isActive,
    // A parent expands exactly when one of its descendants is active.
    isExpanded: (link: NavigationLink) =>
      Boolean(link.children?.length) && isActive(link),
  }
}

function normalizeRoute(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1)
  }
  return pathname
}
