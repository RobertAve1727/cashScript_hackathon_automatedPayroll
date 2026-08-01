/**
 * Boundary for the template's third-party browser scripts.
 *
 * The SmartHR template ships vanilla plugin bundles (ApexCharts, Grid.js,
 * Quill, FullCalendar, …) that expect a fresh document. In a single-page app
 * they must be loaded once and re-initialised on each navigation, which is an
 * infrastructure concern the presentation layer only triggers.
 */
export interface VendorScriptRuntime {
  /**
   * Ensures each script URL has been evaluated, in order.
   * Already-loaded bundles are not re-fetched.
   */
  load(urls: readonly string[]): Promise<void>

  /**
   * Re-runs the element-scoped initialisers (icons, scrollbars, selects,
   * date pickers) against the markup currently in the document.
   */
  refresh(): void

  /**
   * Tears down widgets that attached themselves to nodes React is about to
   * unmount, preventing duplicate instances after navigation.
   */
  teardown(): void
}
