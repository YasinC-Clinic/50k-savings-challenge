import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createI18n, type I18n } from './i18n'
import { LANGUAGE_STORAGE_KEY, isLanguage, readStoredLanguage, writeStoredLanguage, type Language } from './language'

interface LanguageContextValue extends I18n {
  setLanguage: (language: Language) => void
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

/**
 * Holds the chosen language for the whole app. The choice is read from the device once at start (Swedish when none
 * is stored), applied immediately when changed, saved for the next start, and kept in sync between open tabs.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => readStoredLanguage())

  const setLanguage = useCallback((next: Language) => {
    writeStoredLanguage(next)
    setLanguageState(next)
  }, [])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY && isLanguage(event.newValue)) setLanguageState(event.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const i18n = useMemo(() => createI18n(language), [language])

  useEffect(() => {
    document.documentElement.lang = language
    document.title = i18n.t.app.documentTitle
  }, [language, i18n])

  const value = useMemo<LanguageContextValue>(() => ({ ...i18n, setLanguage }), [i18n, setLanguage])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

/** The texts, formatters and language switch of the current language. */
// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): LanguageContextValue {
  const value = useContext(LanguageContext)
  if (!value) throw new Error('useI18n must be used inside LanguageProvider')
  return value
}
