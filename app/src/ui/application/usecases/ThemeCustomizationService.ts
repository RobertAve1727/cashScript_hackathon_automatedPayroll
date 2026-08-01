import {
  DEFAULT_THEME_SETTINGS,
  type ThemeSettings,
} from '@ui/domain/theme/ThemeSettings'
import type { ThemePresenter } from '../ports/ThemePresenter'
import type { ThemeSettingsRepository } from '../ports/ThemeSettingsRepository'

/**
 * Drives the theme customiser: restore on boot, change one dimension, reset.
 *
 * Every mutation persists and re-projects, mirroring the template's behaviour
 * where a click on the customiser instantly updates <html> and localStorage.
 */
export class ThemeCustomizationService {
  private current: ThemeSettings

  constructor(
    private readonly repository: ThemeSettingsRepository,
    private readonly presenter: ThemePresenter,
  ) {
    this.current = repository.load()
  }

  /** Applies the persisted theme. Called once when the shell mounts. */
  restore(): ThemeSettings {
    this.current = this.repository.load()
    this.presenter.apply(this.current)
    return this.current
  }

  getSettings(): ThemeSettings {
    return this.current
  }

  /** Updates a single dimension, e.g. `update('theme', 'dark')`. */
  update<K extends keyof ThemeSettings>(key: K, value: ThemeSettings[K]): ThemeSettings {
    if (this.current[key] === value) return this.current
    this.current = { ...this.current, [key]: value }
    this.repository.save(this.current)
    this.presenter.apply(this.current)
    return this.current
  }

  /** Restores every dimension to the template default. */
  reset(): ThemeSettings {
    this.current = DEFAULT_THEME_SETTINGS
    this.repository.clear()
    this.presenter.apply(this.current)
    return this.current
  }
}
