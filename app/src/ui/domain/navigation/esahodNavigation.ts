/**
 * The app's navigation, as data.
 *
 * The chrome, the router and the page manifest all read the same three routes
 * from here, so adding a screen cannot leave the sidebar and the router
 * disagreeing about what exists — the failure mode the template's hand-listed
 * 283-route menu was full of.
 */
export interface EsahodRoute {
  readonly path: string
  /** Label in the sidebar. */
  readonly label: string
  /** Document title, and the heading the page breadcrumbs to. */
  readonly title: string
  /** Tabler icon class used beside the page heading. */
  readonly icon: string
}

export const ESAHOD_ROUTES = [
  {
    path: '/treasurer',
    label: 'Treasury',
    title: 'Treasury',
    icon: 'ti ti-building-bank',
  },
  {
    path: '/hr',
    label: 'Employment Records',
    title: 'Employment Records',
    icon: 'ti ti-users',
  },
  {
    path: '/employee',
    label: 'My Payslips',
    title: 'My Payslips',
    icon: 'ti ti-file-invoice',
  },
] as const satisfies readonly EsahodRoute[]

/** The route the app opens on. */
export const HOME_ROUTE = ESAHOD_ROUTES[0].path
