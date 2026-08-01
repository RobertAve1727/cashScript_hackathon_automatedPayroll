import { Suspense, lazy, useMemo } from 'react'
import { MainLayout } from '@ui/layouts/MainLayout'
import { BareLayout } from '@ui/layouts/BareLayout'
import { useVendorRuntime } from '@ui/hooks/useVendorRuntime'
import { useVendorStyles } from '@ui/hooks/useVendorStyles'
import { useDocumentTitle } from '@ui/hooks/useDocumentTitle'
import { useAppServices } from '@ui/providers/AppServicesProvider'
import type { PageRoute } from './pageManifest'

/**
 * Mounts one ported page inside the shell it belongs to.
 *
 * Responsibilities are deliberately narrow: pick the layout, restore the
 * document title, and hand the page's vendor scripts to the runtime once the
 * markup is in the DOM.
 */
export function PageHost({ page }: { page: PageRoute }) {
  const { vendorRuntime } = useAppServices()

  // Keyed on the route so navigating between pages remounts the component
  // rather than reconciling two unrelated markup trees.
  const Component = useMemo(() => lazy(page.load), [page.route])

  useDocumentTitle(page.title)
  // Styles are injected before the scripts run, so widgets measure themselves
  // against the same CSS the template had applied.
  useVendorStyles(page.stylesheets)
  useVendorRuntime(vendorRuntime, page.scripts, page.route)

  const content = (
    <Suspense fallback={null}>
      <Component key={page.route} />
    </Suspense>
  )

  if (page.shell === 'bare') {
    return <BareLayout>{content}</BareLayout>
  }

  return <MainLayout hasFooter={page.hasFooter}>{content}</MainLayout>
}
