/**
 * Theme configuration of the SmartHR shell.
 *
 * The template drives its entire appearance from `data-*` attributes on the
 * <html> element, each persisted independently. Modelling them here keeps the
 * valid values and defaults in one framework-free place, so both the runtime
 * and the customiser UI agree on what a legal theme is.
 */

export const THEME_MODES = ['light', 'dark'] as const
export const SIDEBAR_THEMES = ['light', 'dark', 'gradient'] as const
export const ACCENT_COLORS = ['primary', 'secondary', 'success', 'info', 'warning', 'danger'] as const
export const TOPBAR_THEMES = ['white', 'dark', 'primary'] as const
export const TOPBAR_COLORS = ['white', 'dark', 'primary'] as const
export const LAYOUT_MODES = [
  'default',
  'mini',
  'box',
  'horizontal',
  'horizontal-single',
  'horizontal-overlay',
  'horizontal-box',
  'detached',
  'two-column',
  'without-header',
  'modern',
] as const
export const CARD_STYLES = ['bordered', 'shadow', 'flat'] as const
export const CONTENT_SIZES = ['default', 'compact'] as const
export const CONTENT_WIDTHS = ['fluid', 'boxed'] as const
export const LOADER_MODES = ['enable', 'disable'] as const

export type ThemeMode = (typeof THEME_MODES)[number]
export type SidebarTheme = (typeof SIDEBAR_THEMES)[number]
export type AccentColor = (typeof ACCENT_COLORS)[number]
export type TopbarTheme = (typeof TOPBAR_THEMES)[number]
export type TopbarColor = (typeof TOPBAR_COLORS)[number]
export type LayoutMode = (typeof LAYOUT_MODES)[number]
export type CardStyle = (typeof CARD_STYLES)[number]
export type ContentSize = (typeof CONTENT_SIZES)[number]
export type ContentWidth = (typeof CONTENT_WIDTHS)[number]
export type LoaderMode = (typeof LOADER_MODES)[number]

export interface ThemeSettings {
  readonly theme: ThemeMode
  readonly sidebarTheme: SidebarTheme
  readonly color: AccentColor
  readonly topbar: TopbarTheme
  readonly topbarColor: TopbarColor
  readonly layout: LayoutMode
  readonly card: CardStyle
  readonly size: ContentSize
  readonly width: ContentWidth
  readonly loader: LoaderMode
}

/** Matches the template's own fallbacks in theme-script.js. */
export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  theme: 'light',
  sidebarTheme: 'light',
  color: 'primary',
  topbar: 'white',
  topbarColor: 'white',
  layout: 'default',
  card: 'bordered',
  size: 'default',
  width: 'fluid',
  loader: 'enable',
}

/**
 * Maps each setting to the `data-*` attribute the stylesheet reads and the
 * storage key the template used, so persisted preferences survive the port.
 */
export const THEME_ATTRIBUTE_BINDINGS: ReadonlyArray<{
  readonly key: keyof ThemeSettings
  readonly attribute: string
  readonly storageKey: string
  readonly allowed: readonly string[]
}> = [
  { key: 'theme', attribute: 'data-theme', storageKey: 'theme', allowed: THEME_MODES },
  { key: 'sidebarTheme', attribute: 'data-sidebar', storageKey: 'sidebarTheme', allowed: SIDEBAR_THEMES },
  { key: 'color', attribute: 'data-color', storageKey: 'color', allowed: ACCENT_COLORS },
  { key: 'topbar', attribute: 'data-topbar', storageKey: 'topbar', allowed: TOPBAR_THEMES },
  { key: 'topbarColor', attribute: 'data-topbarcolor', storageKey: 'topbarcolor', allowed: TOPBAR_COLORS },
  { key: 'layout', attribute: 'data-layout', storageKey: 'layout', allowed: LAYOUT_MODES },
  { key: 'card', attribute: 'data-card', storageKey: 'card', allowed: CARD_STYLES },
  { key: 'size', attribute: 'data-size', storageKey: 'size', allowed: CONTENT_SIZES },
  { key: 'width', attribute: 'data-width', storageKey: 'width', allowed: CONTENT_WIDTHS },
  { key: 'loader', attribute: 'data-loader', storageKey: 'loader', allowed: LOADER_MODES },
]

/**
 * Coerces arbitrary stored input into a valid settings object.
 * Unknown or corrupted values fall back to the template default rather than
 * propagating an attribute the stylesheet cannot interpret.
 */
export function normalizeThemeSettings(input: Partial<Record<keyof ThemeSettings, string | null>>): ThemeSettings {
  const result = { ...DEFAULT_THEME_SETTINGS } as Record<keyof ThemeSettings, string>

  for (const binding of THEME_ATTRIBUTE_BINDINGS) {
    const candidate = input[binding.key]
    if (candidate && binding.allowed.includes(candidate)) {
      result[binding.key] = candidate
    }
  }

  return result as unknown as ThemeSettings
}

/** True when every dimension already matches the template default. */
export function isDefaultTheme(settings: ThemeSettings): boolean {
  return THEME_ATTRIBUTE_BINDINGS.every(
    (binding) => settings[binding.key] === DEFAULT_THEME_SETTINGS[binding.key],
  )
}
