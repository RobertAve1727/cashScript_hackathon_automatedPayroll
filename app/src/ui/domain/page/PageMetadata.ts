/**
 * Describes one ported page.
 *
 * Each mirrored page contributes a route, a document title and the list of
 * vendor scripts it depended on. Keeping that as data (rather than hard-coding
 * it inside each component) lets the shell decide which layout to mount and
 * which plugin bundles to load, without importing 283 modules eagerly.
 */

/** Which shell a page renders inside. */
export type PageShell =
  /** Full chrome: header, sidebar and footer. */
  | 'main'
  /** Standalone screens (login, errors, coming soon) that own their markup. */
  | 'bare'

export interface PageMetadata {
  /** Directory name in the source mirror, e.g. `payroll-dashboard`. */
  readonly slug: string
  /** Absolute in-app route, e.g. `/payroll-dashboard`. */
  readonly route: string
  /** Generated component name, e.g. `PayrollDashboardPage`. */
  readonly component: string
  /** Contents of the source <title> element. */
  readonly title: string
  readonly shell: PageShell
  /** Public URLs of the vendor scripts this page requires, in source order. */
  readonly scripts: readonly string[]
}

/** The route the app opens on. */
export const HOME_ROUTE = '/index'
