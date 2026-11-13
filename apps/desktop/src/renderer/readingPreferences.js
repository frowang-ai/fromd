export const READING_FONT_SIZES = Object.freeze([14, 16, 18, 20])
export const READING_WIDTHS = Object.freeze([720, 900, 1080])
export const DEFAULT_READING_PREFERENCES = Object.freeze({ fontSize: 16, width: 900, theme: 'light' })
const storageKey = 'frowd.reading-preferences.v1'

export function normalizeReadingPreferences(value) {
  const input = value && typeof value === 'object' ? value : {}
  return {
    fontSize: READING_FONT_SIZES.includes(input.fontSize) ? input.fontSize : DEFAULT_READING_PREFERENCES.fontSize,
    width: READING_WIDTHS.includes(input.width) ? input.width : DEFAULT_READING_PREFERENCES.width,
    theme: ['light', 'dark', 'system'].includes(input.theme) ? input.theme : DEFAULT_READING_PREFERENCES.theme,
  }
}

export function loadReadingPreferences(storage) {
  try {
    const source = (storage ?? window.localStorage).getItem(storageKey)
    return { preferences: normalizeReadingPreferences(source ? JSON.parse(source) : null), error: '' }
  } catch {
    return { preferences: { ...DEFAULT_READING_PREFERENCES }, error: '阅读设置无法读取，已使用默认设置。' }
  }
}

export function saveReadingPreferences(value, storage) {
  const preferences = normalizeReadingPreferences(value)
  try {
    (storage ?? window.localStorage).setItem(storageKey, JSON.stringify(preferences))
    return { preferences, error: '' }
  } catch {
    return { preferences, error: '阅读设置保存失败，本次窗口内仍可使用。' }
  }
}

export function resolvedReadingTheme(preferences, systemDark = false) {
  return preferences.theme === 'system' ? (systemDark ? 'dark' : 'light') : preferences.theme
}

export function readingStyle(preferences) {
  return { '--reading-font-size': `${preferences.fontSize}px`, '--reading-column-width': `${preferences.width}px` }
}
