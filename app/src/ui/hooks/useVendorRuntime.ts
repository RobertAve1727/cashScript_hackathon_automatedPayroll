import { useEffect } from 'react'
import type { VendorScriptRuntime } from '@ui/application/ports/VendorScriptRuntime'
import {
  GLOBAL_SCRIPTS,
  PRELOADED_SCRIPTS,
} from '@ui/infrastructure/vendor/scriptClassification'

/**
 * Re-runs the template's browser scripts whenever a page mounts.
 *
 * The vendor bundles expect to find their markup already in the document, so
 * the effect runs after React has committed the page. Each navigation first
 * tears down the previous page's widgets and listeners, then evaluates the
 * global scripts followed by the page's own — the same order the original
 * pages used in their <body>.
 */
export function useVendorRuntime(
  runtime: VendorScriptRuntime,
  pageScripts: readonly string[],
  routeKey: string,
): void {
  useEffect(() => {
    let cancelled = false

    // Scripts the shell or index.html already handle must not run twice.
    const specific = pageScripts.filter(
      (src) => !GLOBAL_SCRIPTS.includes(src) && !PRELOADED_SCRIPTS.has(src),
    )

    const run = async () => {
      await runtime.load([...GLOBAL_SCRIPTS, ...specific])
      if (cancelled) return
      runtime.refresh()
    }

    void run()

    return () => {
      cancelled = true
      runtime.teardown()
    }
    // `routeKey` identifies the page; the script list is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, runtime])
}
