import type { ThemeSettingsRepository } from '@ui/application/ports/ThemeSettingsRepository'
import {
  normalizeThemeSettings,
  THEME_ATTRIBUTE_BINDINGS,
  type ThemeSettings,
} from '@ui/domain/theme/ThemeSettings'

/**
 * Reads and writes theme preferences using the same localStorage keys as the
 * original template, so a user's existing selection carries over unchanged.
 */
export class LocalStorageThemeSettingsRepository implements ThemeSettingsRepository {
  constructor(private readonly storage: Storage | undefined = safeStorage()) {}

  load(): ThemeSettings {
    if (!this.storage) return normalizeThemeSettings({})

    const raw: Partial<Record<keyof ThemeSettings, string | null>> = {}
    for (const binding of THEME_ATTRIBUTE_BINDINGS) {
      raw[binding.key] = this.storage.getItem(binding.storageKey)
    }
    return normalizeThemeSettings(raw)
  }

  save(settings: ThemeSettings): void {
    if (!this.storage) return
    for (const binding of THEME_ATTRIBUTE_BINDINGS) {
      this.storage.setItem(binding.storageKey, settings[binding.key])
    }
  }

  clear(): void {
    if (!this.storage) return
    for (const binding of THEME_ATTRIBUTE_BINDINGS) {
      this.storage.removeItem(binding.storageKey)
    }
  }
}

/** localStorage throws in private-mode Safari and is absent during SSR. */
function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}
