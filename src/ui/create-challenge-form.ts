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
import { MAX_NAME_LENGTH } from '../persistence/savings-repository'
import { daysInclusive, sek } from './format'

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

/** "1 månad", "2 månader", ... "Till nyår". */
export function durationLabel(duration: DurationChoice): string {
  if (duration === NEW_YEAR_DURATION) return 'Till nyår'
  return duration === 1 ? '1 månad' : `${duration} månader`
}

/** Six months, 50,000 SEK, 50-500 SEK per day. The name continues the numbering of existing challenges. */
export function defaultForm(existingCount: number): ChallengeForm {
  return {
    name: `Utmaning ${existingCount + 1}`,
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

export function validateForm(form: ChallengeForm, today: string): FormValidation {
  const errors: Partial<Record<FormField, string>> = {}
  const target = parseAmount(form.target)
  const minimum = parseAmount(form.minDaily)
  const maximum = parseAmount(form.maxDaily)
  const knownDuration = DURATION_OPTIONS.includes(form.duration)

  if (form.name.trim().length > MAX_NAME_LENGTH) errors.name = `Namnet kan vara högst ${MAX_NAME_LENGTH} tecken.`
  if (!knownDuration) errors.duration = 'Välj hur länge du vill spara.'
  checkTarget(target, errors)
  checkDailyLimits(minimum, maximum, errors)

  const plan = knownDuration ? planFor(today, form.duration) : null
  const limitsOk = !errors.minDaily && !errors.maxDaily && minimum !== null && maximum !== null
  if (plan && target !== null && !errors.target && limitsOk) {
    checkPeriod({ plan, duration: form.duration, target, minimum, maximum }, errors)
  }

  if (Object.keys(errors).length > 0 || target === null || minimum === null || maximum === null || plan === null) {
    return { ok: false, errors }
  }
  const config = configForDuration(today, form.duration, target, { minimumSek: minimum, maximumSek: maximum })
  return { ok: true, value: { config, name: form.name.trim(), plan, averagePerDay: Math.round(target / plan.dayCount) } }
}

function checkTarget(target: number | null, errors: Partial<Record<FormField, string>>): void {
  if (target === null) errors.target = 'Ange målet i hela kronor, till exempel 50000.'
  else if (target < 1) errors.target = 'Målet måste vara större än noll.'
  else if (target > CHALLENGE_LIMITS.maxTargetSek) errors.target = `Målet kan vara högst ${sek(CHALLENGE_LIMITS.maxTargetSek)}.`
}

/** Both limits are positive whole kronor, the minimum may not exceed the maximum, and the maximum has an upper bound. */
function checkDailyLimits(minimum: number | null, maximum: number | null, errors: Partial<Record<FormField, string>>): void {
  if (minimum === null) errors.minDaily = 'Ange lägsta dagsbelopp i hela kronor, till exempel 50.'
  else if (minimum < 1) errors.minDaily = 'Lägsta dagsbelopp måste vara minst 1 kr.'

  if (maximum === null) errors.maxDaily = 'Ange högsta dagsbelopp i hela kronor, till exempel 500.'
  else if (maximum < 1) errors.maxDaily = 'Högsta dagsbelopp måste vara minst 1 kr.'
  else if (maximum > CHALLENGE_LIMITS.maxDailySek) errors.maxDaily = `Högsta dagsbelopp kan vara högst ${sek(CHALLENGE_LIMITS.maxDailySek)}.`

  if (!errors.minDaily && !errors.maxDaily && minimum !== null && maximum !== null && minimum > maximum) {
    errors.minDaily = 'Lägsta dagsbelopp kan inte vara högre än högsta dagsbelopp.'
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
function checkPeriod({ plan, duration, target, minimum, maximum }: PeriodCheck, errors: Partial<Record<FormField, string>>): void {
  const lowest = plan.dayCount * minimum
  const highest = plan.dayCount * maximum
  const period = `${durationLabel(duration)} (${plan.dayCount} dagar)`
  if (target < lowest) {
    errors.target = `Målet är för lågt för ${period}. Minst ${sek(lowest)} krävs (${sek(minimum)} per dag). Höj målet, sänk lägsta dagsbelopp eller välj en kortare tid.`
  } else if (target > highest) {
    errors.target = `Målet är för högt för ${period}. Högst ${sek(highest)} går att spara (${sek(maximum)} per dag). Sänk målet, höj högsta dagsbelopp eller välj en längre tid.`
  }
}
