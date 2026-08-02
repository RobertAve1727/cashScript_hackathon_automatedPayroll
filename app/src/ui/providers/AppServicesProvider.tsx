import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { ThemeCustomizationService } from '@ui/application/usecases/ThemeCustomizationService'
import type { VendorScriptRuntime } from '@ui/application/ports/VendorScriptRuntime'
import { DocumentThemePresenter } from '@ui/infrastructure/theme/DocumentThemePresenter'
import { LocalStorageThemeSettingsRepository } from '@ui/infrastructure/theme/LocalStorageThemeSettingsRepository'
import { DomVendorScriptRuntime } from '@ui/infrastructure/vendor/DomVendorScriptRuntime'

/**
 * Composition root for the browser.
 *
 * This is the only place that knows which concrete adapters implement the
 * application's ports, keeping the dependency rule intact: presentation depends
 * on the use cases, never on infrastructure.
 */
export interface AppServices {
  readonly theme: ThemeCustomizationService
  readonly vendorRuntime: VendorScriptRuntime
}

const AppServicesContext = createContext<AppServices | null>(null)

export function createAppServices(): AppServices {
  return {
    theme: new ThemeCustomizationService(
      new LocalStorageThemeSettingsRepository(),
      new DocumentThemePresenter(),
    ),
    vendorRuntime: new DomVendorScriptRuntime(),
  }
}

export function AppServicesProvider({
  children,
  services,
}: {
  children: ReactNode
  services?: AppServices
}) {
  // A single instance must survive re-renders: the vendor runtime tracks which
  // bundles are already loaded and which listeners it has to remove.
  const value = useMemo(() => services ?? createAppServices(), [services])

  return (
    <AppServicesContext.Provider value={value}>{children}</AppServicesContext.Provider>
  )
}

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext)
  if (!services) {
    throw new Error('useAppServices must be used inside <AppServicesProvider>')
  }
  return services
}
