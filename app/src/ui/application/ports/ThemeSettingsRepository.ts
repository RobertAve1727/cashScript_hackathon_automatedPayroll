import type { ThemeSettings } from '@ui/domain/theme/ThemeSettings'

/**
 * Persistence boundary for theme preferences.
 *
 * The application layer depends on this interface only; whether preferences
 * live in localStorage, a cookie or a user profile is an infrastructure
 * decision.
 */
export interface ThemeSettingsRepository {
  load(): ThemeSettings
  save(settings: ThemeSettings): void
  clear(): void
}
