import type { ComponentType } from 'react'
import type { PageMetadata } from '@ui/domain/page/PageMetadata'
import { ESAHOD_ROUTES } from '@ui/domain/navigation/esahodNavigation'

/**
 * The three eSahod screens, as the shell's page metadata.
 *
 * The SmartHR original generated this file from 283 mirrored HTML pages; here
 * it is hand-written, because there are three pages and each one is a real
 * component rather than extracted markup. The shape is unchanged so `PageHost`
 * works untouched.
 *
 * `scripts` and `stylesheets` are empty on every page: the only vendor bundles
 * these screens need are the ones in `GLOBAL_SCRIPTS`, and every stylesheet is
 * already in index.html. Both lists exist so a screen that later wants, say,
 * ApexCharts can name it here and get the template's load-once semantics.
 */
export interface PageRoute extends PageMetadata {
  /** Whether the page renders the footer inside its wrapper. */
  readonly hasFooter: boolean
  /** Stylesheets the page needs beyond the global ones, in cascade order. */
  readonly stylesheets: readonly string[]
  readonly load: () => Promise<{ default: ComponentType }>
}

const [treasury, hr, employee] = ESAHOD_ROUTES

export const PAGE_ROUTES: readonly PageRoute[] = [
  {
    slug: 'treasurer',
    route: treasury.path,
    component: 'TreasurerPage',
    title: `${treasury.title} | eSahod`,
    shell: 'main',
    hasFooter: true,
    scripts: [],
    stylesheets: [],
    load: () => import('../pages/TreasurerPage'),
  },
  {
    slug: 'hr',
    route: hr.path,
    component: 'HrPage',
    title: `${hr.title} | eSahod`,
    shell: 'main',
    hasFooter: true,
    scripts: [],
    stylesheets: [],
    load: () => import('../pages/HrPage'),
  },
  {
    slug: 'employee',
    route: employee.path,
    component: 'EmployeePage',
    title: `${employee.title} | eSahod`,
    shell: 'main',
    hasFooter: true,
    scripts: [],
    stylesheets: [],
    load: () => import('../pages/EmployeePage'),
  },
]
