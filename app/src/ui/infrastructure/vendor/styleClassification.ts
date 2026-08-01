/**
 * Stylesheets that index.html already loads for every page.
 *
 * A page's own list is filtered against this set so the shared sheets are not
 * injected twice. Everything else is page-scoped on purpose: several template
 * pages ship sheets that would restyle the entire app if made global — most
 * obviously `bootstrap.rtl.min.css`, which mirrors the whole layout.
 *
 * This list must stay in step with the <link> tags in index.html. The sheets
 * for plugins this app does not ship (flatpickr, tom-select, gridjs) were
 * removed from both together — leaving them here would be harmless, but
 * leaving them in index.html would 404.
 */
export const GLOBAL_STYLESHEETS: ReadonlySet<string> = new Set([
  '/build/css/bootstrap.min.css',
  '/build/plugins/icons/feather/feather.css',
  '/build/plugins/tabler-icons/tabler-icons.min.css',
  '/build/plugins/fontawesome/css/fontawesome.min.css',
  '/build/plugins/fontawesome/css/all.min.css',
  '/build/css/style.css',
])

/** True when a stylesheet still has to be injected for the current page. */
export function isPageStylesheet(href: string): boolean {
  return !GLOBAL_STYLESHEETS.has(href)
}
