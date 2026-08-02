/**
 * The sidebar navigation tree.
 *
 * The template repeats the same menu markup in all 283 pages, differing only
 * in which entries carry the `active`/`subdrop` classes. Representing the menu
 * as data lets a single component render it and derive that state from the
 * current route, which is why the port needs a navigation model at all.
 */

export interface NavigationLink {
  readonly label: string
  /** In-app route, or an external/placeholder href such as `#`. */
  readonly href: string
  /** Tabler/Feather icon class, present on top-level entries only. */
  readonly icon?: string
  readonly children?: readonly NavigationLink[]
  /** Set when the template marked the entry as opening in a new tab. */
  readonly external?: boolean
}

export interface NavigationSection {
  /** Group heading rendered as `.menu-title`. */
  readonly title: string
  readonly items: readonly NavigationLink[]
}

export type NavigationMenu = readonly NavigationSection[]

/** Depth-first walk over every link in the menu, including nested children. */
export function* walkNavigation(menu: NavigationMenu): Generator<NavigationLink> {
  const visit = function* (items: readonly NavigationLink[]): Generator<NavigationLink> {
    for (const item of items) {
      yield item
      if (item.children) yield* visit(item.children)
    }
  }
  for (const section of menu) {
    yield* visit(section.items)
  }
}

/**
 * True when `link` — or anything beneath it — targets `pathname`.
 * Used to reproduce the template's `active` and `subdrop` classes.
 */
export function isNavigationLinkActive(link: NavigationLink, pathname: string): boolean {
  if (link.href === pathname) return true
  return (link.children ?? []).some((child) => isNavigationLinkActive(child, pathname))
}

/** The section that contains the active route, if any. */
export function findActiveSection(
  menu: NavigationMenu,
  pathname: string,
): NavigationSection | undefined {
  return menu.find((section) =>
    section.items.some((item) => isNavigationLinkActive(item, pathname)),
  )
}
