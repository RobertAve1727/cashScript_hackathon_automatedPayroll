import type { Role } from '../../../auth/users'

/**
 * The app's navigation, as data.
 *
 * The chrome, the router and the page manifest all read these entries, so
 * adding a screen cannot leave the sidebar and the router disagreeing about
 * what exists — the failure mode the SmartHR template's hand-listed 283-route
 * menu was full of. Roles live here too, so a page cannot appear in a menu it
 * is not allowed to open.
 */
export interface EsahodRoute {
  readonly path: string
  /** Label in the sidebar. */
  readonly label: string
  /** Document title, and the page's own heading. */
  readonly title: string
  /** Sidebar group this sits under. */
  readonly section: string
  /** Tabler icon class. */
  readonly icon: string
  /** Who may open it. */
  readonly roles: readonly Role[]
}

export const ESAHOD_ROUTES = [
  {
    path: '/my/time',
    label: 'Time Clock',
    title: 'Time Clock',
    section: 'My Work',
    icon: 'ti ti-clock-play',
    roles: ['employee'],
  },
  {
    path: '/my/payslips',
    label: 'My Payslips',
    title: 'My Payslips',
    section: 'My Work',
    icon: 'ti ti-file-invoice',
    roles: ['employee'],
  },
  {
    path: '/hr/employees',
    label: 'Employment Records',
    title: 'Employment Records',
    section: 'Human Resources',
    icon: 'ti ti-users',
    roles: ['hr'],
  },
  {
    path: '/hr/attendance',
    label: 'Attendance',
    title: 'Attendance',
    section: 'Human Resources',
    icon: 'ti ti-calendar-time',
    roles: ['hr'],
  },
  {
    path: '/hr/overtime',
    label: 'Overtime',
    title: 'Overtime',
    section: 'Human Resources',
    icon: 'ti ti-clock-plus',
    roles: ['hr'],
  },
  {
    path: '/hr/schedule',
    label: 'Pay Schedule',
    title: 'Pay Schedule',
    section: 'Human Resources',
    icon: 'ti ti-calendar-repeat',
    roles: ['hr'],
  },
  {
    path: '/treasurer',
    label: 'Treasury',
    title: 'Treasury',
    section: 'Payroll',
    icon: 'ti ti-building-bank',
    roles: ['treasurer'],
  },
] as const satisfies readonly EsahodRoute[]

/** The sign-in screen, which sits outside the shell and outside the roles. */
export const LOGIN_ROUTE = '/login'

/** Routes this role may open, in menu order. */
export function routesFor(role: Role | null): readonly EsahodRoute[] {
  if (role === null) return []
  return ESAHOD_ROUTES.filter((route) => (route.roles as readonly Role[]).includes(role))
}

/** Sidebar groups for a role: section heading, then its routes. */
export function sectionsFor(role: Role | null): readonly { section: string; routes: readonly EsahodRoute[] }[] {
  const sections: { section: string; routes: EsahodRoute[] }[] = []

  for (const route of routesFor(role)) {
    const existing = sections.find((entry) => entry.section === route.section)
    if (existing) existing.routes.push(route)
    else sections.push({ section: route.section, routes: [route] })
  }

  return sections
}

/** Where a role lands after signing in. */
export function homeRouteFor(role: Role | null): string {
  return routesFor(role)[0]?.path ?? LOGIN_ROUTE
}
