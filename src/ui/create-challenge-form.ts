import {
  CHALLENGE_LIMITS,
  DEFAULT_CHALLENGE_CONFIG,
  DEFAULT_DAILY_LIMITS,
  DEFAULT_DURATION_MONTHS,
  DURATION_OPTIONS,
  NEW_YEAR_DURATION,
  configForDuration,
  type ChallengeConfig,
  type DurationChoice,
} from '../domain/challenge'
import type { I18n } from '../i18n/i18n'
import { MAX_NAME_LENGTH } from '../persistence/savings-repository'
import { daysInclusive } from './format'

export interface ChallengeForm {
  name: string
  target: string
  /** A number of calendar months, or "Till nyår". One of DURATION_OPTIONS. */
  duration: DurationChoice
  /** Lowest and highest amount of a single day, as typed (whole kronor). */
  minDaily: string
  maxDaily: string
}

export type FormField = 'name' | 'target' | 'duration' | 'minDaily' | 'maxDaily'

/** What the chosen duration turns into, calculated from today's Stockholm date. */
export interface ChallengePlan {
  startDate: string
  endDate: string
  dayCount: number
}

export interface ValidForm {
  config: ChallengeConfig
  name: string
  plan: ChallengePlan
  averagePerDay: number
}

export type FormValidation =
  | { ok: true; value: ValidForm }
  | { ok: false; errors: Partial<Record<FormField, string>> }

/** "1 månad", "2 månader", ... "Till nyår" (or "1 month", ... "Until New Year"). */
export function durationLabel(duration: DurationChoice, { t }: I18n): string {
  return duration === NEW_YEAR_DURATION ? t.form.duration.newYear : t.form.duration.months(duration)
}

/** Six months, 50,000 SEK, 50-500 SEK per day. The name continues the numbering of existing challenges. */
export function defaultForm(existingCount: number, { t }: I18n): ChallengeForm {
  return {
    name: t.form.defaultName(existingCount + 1),
    target: String(DEFAULT_CHALLENGE_CONFIG.targetSek),
    duration: DEFAULT_DURATION_MONTHS,
    minDaily: String(DEFAULT_DAILY_LIMITS.minimumSek),
    maxDaily: String(DEFAULT_DAILY_LIMITS.maximumSek),
  }
}

/**
 * Start = `today` (the Stockholm calendar date), end = start plus the duration (or 31 December for "Till nyår").
 * The day count is the exact number of calendar days from start to end, both included.
 */
export function planFor(today: string, duration: DurationChoice): ChallengePlan {
  const { startDate, endDate } = configForDuration(today, duration)
  return { startDate, endDate, dayCount: daysInclusive(startDate, endDate) }
}

/** Whole kronor only: digits, optionally with spaces and a "kr" suffix. */
export function parseAmount(text: string): number | null {
  const digits = text.replace(/[\s ]/g, '').replace(/kr$/i, '')
  return /^\d+$/.test(digits) ? Number(digits) : null
}

export const parseTarget = parseAmount

/** Validates the form. The error texts are produced in the language of `i18n`, so they change with the language switch. */
export function validateForm(form: ChallengeForm, today: string, i18n: I18n): FormValidation {
  const errors: Partial<Record<FormField, string>> = {}
  const target = parseAmount(form.target)
  const minimum = parseAmount(form.minDaily)
  const maximum = parseAmount(form.maxDaily)
  const knownDuration = DURATION_OPTIONS.includes(form.duration)

  if (form.name.trim().length > MAX_NAME_LENGTH) errors.name = i18n.t.form.errors.nameTooLong(MAX_NAME_LENGTH)
  if (!knownDuration) errors.duration = i18n.t.form.errors.chooseDuration
  checkTarget(target, errors, i18n)
  checkDailyLimits(minimum, maximum, errors, i18n)

  const plan = knownDuration ? planFor(today, form.duration) : null
  const limitsOk = !errors.minDaily && !errors.maxDaily && minimum !== null && maximum !== null
  if (plan && target !== null && !errors.target && limitsOk) {
    checkPeriod({ plan, duration: form.duration, target, minimum, maximum }, errors, i18n)
  }

  if (Object.keys(errors).length > 0 || target === null || minimum === null || maximum === null || plan === null) {
    return { ok: false, errors }
  }
  const config = configForDuration(today, form.duration, target, { minimumSek: minimum, maximumSek: maximum })
  return { ok: true, value: { config, name: form.name.trim(), plan, averagePerDay: Math.round(target / plan.dayCount) } }
}

function checkTarget(target: number | null, errors: Partial<Record<FormField, string>>, { t, fmt }: I18n): void {
  if (target === null) errors.target = t.form.errors.targetInvalid
  else if (target < 1) errors.target = t.form.errors.targetZero
  else if (target > CHALLENGE_LIMITS.maxTargetSek) errors.target = t.form.errors.targetTooHigh(fmt.sek(CHALLENGE_LIMITS.maxTargetSek))
}

/** Both limits are positive whole kronor, the minimum may not exceed the maximum, and the maximum has an upper bound. */
function checkDailyLimits(
  minimum: number | null,
  maximum: number | null,
  errors: Partial<Record<FormField, string>>,
  { t, fmt }: I18n,
): void {
  if (minimum === null) errors.minDaily = t.form.errors.minInvalid
  else if (minimum < 1) errors.minDaily = t.form.errors.minTooLow

  if (maximum === null) errors.maxDaily = t.form.errors.maxInvalid
  else if (maximum < 1) errors.maxDaily = t.form.errors.maxTooLow
  else if (maximum > CHALLENGE_LIMITS.maxDailySek) errors.maxDaily = t.form.errors.maxAboveLimit(fmt.sek(CHALLENGE_LIMITS.maxDailySek))

  if (!errors.minDaily && !errors.maxDaily && minimum !== null && maximum !== null && minimum > maximum) {
    errors.minDaily = t.form.errors.minAboveMax
  }
}

interface PeriodCheck {
  plan: ChallengePlan
  duration: DurationChoice
  target: number
  minimum: number
  maximum: number
}

/** A period only holds a target between days x lowest and days x highest amount. */
function checkPeriod(
  { plan, duration, target, minimum, maximum }: PeriodCheck,
  errors: Partial<Record<FormField, string>>,
  i18n: I18n,
): void {
  const { t, fmt } = i18n
  const lowest = plan.dayCount * minimum
  const highest = plan.dayCount * maximum
  const period = `${durationLabel(duration, i18n)} (${t.units.days(plan.dayCount)})`
  if (target < lowest) {
    errors.target = t.form.errors.periodTooLow(period, fmt.sek(lowest), fmt.sek(minimum))
  } else if (target > highest) {
    errors.target = t.form.errors.periodTooHigh(period, fmt.sek(highest), fmt.sek(maximum))
  }
}
