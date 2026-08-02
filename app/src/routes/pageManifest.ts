import type { ComponentType } from 'react'
import type { Role } from '../auth/users'
import type { PageMetadata } from '@ui/domain/page/PageMetadata'
import { ESAHOD_ROUTES, LOGIN_ROUTE } from '@ui/domain/navigation/esahodNavigation'

/**
 * The eSahod screens, as the shell's page metadata.
 *
 * The SmartHR original generated this from 283 mirrored HTML pages; here it is
 * hand-written, because each page is a real component rather than extracted
 * markup. The shape is unchanged so `PageHost` works untouched.
 *
 * `scripts` and `stylesheets` are empty everywhere: the only vendor bundles
 * these screens need are in `GLOBAL_SCRIPTS`, and every stylesheet is already
 * in index.html. Both fields stay so a screen that later wants ApexCharts can
 * name it and get the template's load-once semantics.
 */
export interface PageRoute extends PageMetadata {
  readonly hasFooter: boolean
  readonly stylesheets: readonly string[]
  /** Empty means public — the sign-in screen. */
  readonly roles: readonly Role[]
  readonly load: () => Promise<{ default: ComponentType }>
}

const LOADERS: Readonly<Record<string, () => Promise<{ default: ComponentType }>>> = {
  '/my/time': () => import('../pages/TimeClockPage'),
  '/my/payslips': () => import('../pages/EmployeePage'),
  '/hr/employees': () => import('../pages/HrPage'),
  '/hr/attendance': () => import('../pages/AttendancePage'),
  '/hr/overtime': () => import('../pages/OvertimePage'),
  '/hr/schedule': () => import('../pages/PaySchedulePage'),
  '/treasurer': () => import('../pages/TreasurerPage'),
}

export const PAGE_ROUTES: readonly PageRoute[] = [
  {
    slug: 'login',
    route: LOGIN_ROUTE,
    component: 'LoginPage',
    title: 'Sign in | eSahod',
    // No chrome: the sign-in screen owns its whole page, exactly as the
    // template's own authentication screens do.
    shell: 'bare',
    hasFooter: false,
    scripts: [],
    stylesheets: [],
    roles: [],
    load: () => import('../pages/LoginPage'),
  },
  ...ESAHOD_ROUTES.map((route) => ({
    slug: route.path.replace(/^\//, '').replace(/\//g, '-'),
    route: route.path,
    component: route.title.replace(/\s+/g, ''),
    title: `${route.title} | eSahod`,
    shell: 'main' as const,
    hasFooter: true,
    scripts: [],
    stylesheets: [],
    roles: route.roles,
    load: LOADERS[route.path]!,
  })),
]
