import type { ThemePresenter } from '@ui/application/ports/ThemePresenter'
import {
  THEME_ATTRIBUTE_BINDINGS,
  type ThemeSettings,
} from '@ui/domain/theme/ThemeSettings'

/**
 * Projects theme settings onto the <html> element.
 *
 * style.css selects on these attributes (`[data-theme="dark"]`, …), so writing
 * them is all that is required to restyle the shell — exactly what the
 * template's theme-script.js did.
 */
export class DocumentThemePresenter implements ThemePresenter {
  apply(settings: ThemeSettings): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    for (const binding of THEME_ATTRIBUTE_BINDINGS) {
      root.setAttribute(binding.attribute, settings[binding.key])
    }
  }
}
