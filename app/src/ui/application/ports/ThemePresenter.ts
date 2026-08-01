import type { ThemeSettings } from '@ui/domain/theme/ThemeSettings'

/**
 * Output boundary that projects theme settings onto the view.
 *
 * The template's stylesheet reacts to `data-*` attributes on <html>; this port
 * hides that DOM detail from the use cases.
 */
export interface ThemePresenter {
  apply(settings: ThemeSettings): void
}
