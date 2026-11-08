import { createFormatters, type Formatters, type Locale } from './formatters'
import type { Language } from './language'
import { en } from './messages.en'
import type { Messages } from './messages.sv'
import { sv } from './messages.sv'

export interface I18n {
  language: Language
  locale: Locale
  /** Every user-visible text of the app in this language. */
  t: Messages
  /** Dates, amounts and percentages formatted for this language. */
  fmt: Formatters
}

const LOCALES: Record<Language, Locale> = { sv: 'sv-SE', en: 'en-GB' }
const DICTIONARIES: Record<Language, Messages> = { sv, en }
const cache = new Map<Language, I18n>()

/** Pure and cached: usable from React components and from plain functions (validation, error descriptions). */
export function createI18n(language: Language): I18n {
  const cached = cache.get(language)
  if (cached) return cached
  const created: I18n = { language, locale: LOCALES[language], t: DICTIONARIES[language], fmt: createFormatters(LOCALES[language]) }
  cache.set(language, created)
  return created
}
