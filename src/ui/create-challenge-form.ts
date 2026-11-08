import {
  CHALLENGE_LIMITS,
  DEFAULT_CHALLENGE_CONFIG,
  type ChallengeConfig,
} from '../domain/challenge'
import { MAX_NAME_LENGTH } from '../persistence/savings-repository'
import { addDays, daysInclusive, isValidDateKey, sek } from './format'

export interface ChallengeForm {
  name: string
  target: string
  startDate: string
  endDate: string
}

export type FormField = keyof ChallengeForm

export interface ValidForm {
  config: ChallengeConfig
  name: string
  dayCount: number
  averagePerDay: number
}

export type FormValidation =
  | { ok: true; value: ValidForm }
  | { ok: false; errors: Partial<Record<FormField, string>> }

const { initialMinimumSek, preferredMaximumSek } = DEFAULT_CHALLENGE_CONFIG

/** New challenge starting today, ending on the default end date (or 180 days later if that has passed). */
export function defaultForm(today: string, existingCount: number): ChallengeForm {
  const endDate = DEFAULT_CHALLENGE_CONFIG.endDate > today ? DEFAULT_CHALLENGE_CONFIG.endDate : addDays(today, 180)
  return { name: `Utmaning ${existingCount + 1}`, target: String(DEFAULT_CHALLENGE_CONFIG.targetSek), startDate: today, endDate }
}

/** The original challenge: 50,000 SEK from 1 January to 30 June 2027. */
export function standardForm(existingCount: number): ChallengeForm {
  const { targetSek, startDate, endDate } = DEFAULT_CHALLENGE_CONFIG
  return { name: `Utmaning ${existingCount + 1}`, target: String(targetSek), startDate, endDate }
}

/** Length of the period if both dates are valid and in order, otherwise null. Safe for any input. */
export function previewDays(startDate: string, endDate: string): number | null {
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate) || endDate <= startDate) return null
  return daysInclusive(startDate, endDate)
}

function parseTarget(text: string): number | null {
  const digits = text.replace(/[\s ]/g, '').replace(/kr$/i, '')
  return /^\d+$/.test(digits) ? Number(digits) : null
}

export function validateForm(form: ChallengeForm, today: string): FormValidation {
  const errors: Partial<Record<FormField, string>> = {}
  const target = parseTarget(form.target)

  if (form.name.trim().length > MAX_NAME_LENGTH) errors.name = `Namnet kan vara högst ${MAX_NAME_LENGTH} tecken.`
  checkTarget(target, errors)
  checkDates(form, today, errors)
  const dayCount = errors.startDate || errors.endDate ? null : daysInclusive(form.startDate, form.endDate)
  if (dayCount !== null) checkPeriod(dayCount, target, errors)

  if (Object.keys(errors).length > 0 || target === null || dayCount === null) return { ok: false, errors }
  const config: ChallengeConfig = {
    targetSek: target,
    startDate: form.startDate,
    endDate: form.endDate,
    initialMinimumSek,
    preferredMaximumSek,
  }
  return { ok: true, value: { config, name: form.name.trim(), dayCount, averagePerDay: Math.round(target / dayCount) } }
}

function checkTarget(target: number | null, errors: Partial<Record<FormField, string>>): void {
  if (target === null) errors.target = 'Ange målet i hela kronor, till exempel 50000.'
  else if (target < 1) errors.target = 'Målet måste vara större än noll.'
  else if (target > CHALLENGE_LIMITS.maxTargetSek) errors.target = `Målet kan vara högst ${sek(CHALLENGE_LIMITS.maxTargetSek)}.`
}

function checkDates(form: ChallengeForm, today: string, errors: Partial<Record<FormField, string>>): void {
  if (!isValidDateKey(form.startDate)) errors.startDate = 'Ange ett giltigt startdatum.'
  else if (form.startDate < today) errors.startDate = 'Startdatumet kan inte ligga före idag.'
  if (!isValidDateKey(form.endDate)) errors.endDate = 'Ange ett giltigt slutdatum.'
  else if (!errors.startDate && form.endDate <= form.startDate) errors.endDate = 'Slutdatumet måste ligga efter startdatumet.'
}

function checkPeriod(dayCount: number, target: number | null, errors: Partial<Record<FormField, string>>): void {
  if (dayCount > CHALLENGE_LIMITS.maxDays) {
    errors.endDate = `En utmaning kan vara högst ${CHALLENGE_LIMITS.maxDays.toLocaleString('sv-SE')} dagar.`
    return
  }
  if (target === null || errors.target) return
  const lowest = dayCount * initialMinimumSek
  const highest = dayCount * preferredMaximumSek
  if (target < lowest) {
    errors.target = `Målet är för lågt för ${dayCount} dagar. Minst ${sek(lowest)} krävs (${sek(initialMinimumSek)} per dag). Höj målet eller korta ner perioden.`
  } else if (target > highest) {
    errors.target = `Målet är för högt för ${dayCount} dagar. Högst ${sek(highest)} går att spara (${sek(preferredMaximumSek)} per dag). Sänk målet eller välj ett senare slutdatum.`
  }
}
