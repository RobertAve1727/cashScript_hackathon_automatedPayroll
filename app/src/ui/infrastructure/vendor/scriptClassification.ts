/**
 * Splits the template's scripts into the two lifecycles a single-page app needs.
 *
 * Vendor bundles only define globals, so evaluating them twice would be
 * wasteful and can clobber plugin registries. The template's own scripts, by
 * contrast, *initialise the current document* — they must run again after every
 * navigation, or a freshly mounted page keeps raw markup where a widget belongs.
 */

/**
 * Bundles that define globals and are evaluated at most once.
 * Matched on the file name so the plugin directory layout can change freely.
 */
const LIBRARY_PATTERNS: readonly RegExp[] = [
  /\/build\/js\/bootstrap\.bundle\.min\.js$/,
  /\/build\/js\/feather\.min\.js$/,
  // Owns the theme customiser panel and injects it once into <body>.
  /\/build\/js\/theme-script\.js$/,
  /\/build\/js\/plyr-js\.js$/,
  // Everything shipped under plugins/ is a third-party bundle, except the
  // template-authored *-data.js files that describe each page's widgets.
  /\/build\/plugins\/(?!.*(?:chart-data|calendar-data)).*\.js$/,
]

/**
 * True when the script only registers globals and can be loaded a single time.
 */
export function isLibraryScript(url: string): boolean {
  return LIBRARY_PATTERNS.some((pattern) => pattern.test(url))
}

/**
 * True when the script initialises DOM that React has just re-rendered and so
 * must be evaluated again on every page mount.
 */
export function isInitializerScript(url: string): boolean {
  return !isLibraryScript(url)
}

/**
 * Scripts index.html loads directly, which must never be injected again.
 *
 * theme-script.js appends the theme customiser panel to <body> when it runs, so
 * a second evaluation would render a duplicate panel.
 */
export const PRELOADED_SCRIPTS: ReadonlySet<string> = new Set([
  '/build/js/theme-script.js',
])

/**
 * Scripts every page depends on, mirroring the tags the template placed on all
 * 283 pages. Loading them from the shell means a page's own list only has to
 * name what is specific to it.
 */
export const GLOBAL_SCRIPTS: readonly string[] = [
  '/build/js/bootstrap.bundle.min.js',
  '/build/js/feather.min.js',
  '/build/plugins/simplebar/simplebar.min.js',
  // flatpickr and tom-select were in the template's global list; this app does
  // not ship those plugins, and naming a bundle here that is not in
  // public/build makes every page request a 404.
  //
  // theme-script.js is deliberately absent for a different reason: index.html
  // loads it in <head> so the persisted theme applies before first paint, and
  // it appends the theme customiser panel exactly once.
  //
  // Must come last: it initialises widgets provided by the bundles above.
  '/build/js/script.js',
]
