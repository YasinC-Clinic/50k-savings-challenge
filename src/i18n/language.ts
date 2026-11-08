export type Language = 'sv' | 'en'

export const LANGUAGES: readonly Language[] = ['sv', 'en']

/** New installations start in Swedish. */
export const DEFAULT_LANGUAGE: Language = 'sv'

/**
 * The chosen language is a per-device interface preference. It lives in localStorage on purpose, not in the
 * IndexedDB savings database: it must work before the database opens (recovery and reload screens), and it must
 * never be part of challenge data, backups or migrations. It survives reloads, restarts and app updates (same origin).
 */
export const LANGUAGE_STORAGE_KEY = 'spar.language'

export function isLanguage(value: unknown): value is Language {
  return value === 'sv' || value === 'en'
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** The stored language, or Swedish when nothing valid is stored or storage is unavailable. Never throws. */
export function readStoredLanguage(storage: Storage | null = browserStorage()): Language {
  try {
    const stored = storage?.getItem(LANGUAGE_STORAGE_KEY)
    return isLanguage(stored) ? stored : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

/** Returns false when the choice could not be saved (private mode, blocked storage); the app keeps working. */
export function writeStoredLanguage(language: Language, storage: Storage | null = browserStorage()): boolean {
  try {
    if (!storage) return false
    storage.setItem(LANGUAGE_STORAGE_KEY, language)
    return true
  } catch {
    return false
  }
}
