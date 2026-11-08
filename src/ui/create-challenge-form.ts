import {
  CHALLENGE_LIMITS,
  DEFAULT_CHALLENGE_CONFIG,
  DEFAULT_DURATION_MONTHS,
  DURATION_MONTH_OPTIONS,
  configForDuration,
  type ChallengeConfig,
} from '../domain/challenge'
import { MAX_NAME_LENGTH } from '../persistence/savings-repository'
import { daysInclusive, sek } from './format'

export interface ChallengeForm {
  name: string
  target: string
  /** Chosen duration in calendar months; one of DURATION_MONTH_OPTIONS. */
  months: number
}

export type FormField = 'name' | 'target' | 'months'

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

const { initialMinimumSek, preferredMaximumSek } = DEFAULT_CHALLENGE_CONFIG

/** "1 månad", "2 månader", ... */
export function durationLabel(months: number): string {
  return months === 1 ? '1 månad' : `${months} månader`
}

/** Six months, 50,000 SEK. The name continues the numbering of existing challenges. */
export function defaultForm(existingCount: number): ChallengeForm {
  return { name: `Utmaning ${existingCount + 1}`, target: String(DEFAULT_CHALLENGE_CONFIG.targetSek), months: DEFAULT_DURATION_MONTHS }
}

/**
 * Start = `today` (the Stockholm calendar date), end = start plus `months` calendar months.
 * The day count is the exact number of calendar days from start to end, both included.
 */
export function planFor(today: string, months: number): ChallengePlan {
  const { startDate, endDate } = configForDuration(today, months)
  return { startDate, endDate, dayCount: daysInclusive(startDate, endDate) }
}

export function parseTarget(text: string): number | null {
  const digits = text.replace(/[\s ]/g, '').replace(/kr$/i, '')
  return /^\d+$/.test(digits) ? Number(digits) : null
}

export function validateForm(form: ChallengeForm, today: string): FormValidation {
  const errors: Partial<Record<FormField, string>> = {}
  const target = parseTarget(form.target)
  const knownDuration = (DURATION_MONTH_OPTIONS as readonly number[]).includes(form.months)

  if (form.name.trim().length > MAX_NAME_LENGTH) errors.name = `Namnet kan vara högst ${MAX_NAME_LENGTH} tecken.`
  if (!knownDuration) errors.months = 'Välj hur länge du vill spara.'
  checkTarget(target, errors)

  const plan = knownDuration ? planFor(today, form.months) : null
  if (plan && target !== null && !errors.target) checkPeriod(plan.dayCount, target, form.months, errors)

  if (Object.keys(errors).length > 0 || target === null || plan === null) return { ok: false, errors }
  const config = configForDuration(today, form.months, target)
  return { ok: true, value: { config, name: form.name.trim(), plan, averagePerDay: Math.round(target / plan.dayCount) } }
}

function checkTarget(target: number | null, errors: Partial<Record<FormField, string>>): void {
  if (target === null) errors.target = 'Ange målet i hela kronor, till exempel 50000.'
  else if (target < 1) errors.target = 'Målet måste vara större än noll.'
  else if (target > CHALLENGE_LIMITS.maxTargetSek) errors.target = `Målet kan vara högst ${sek(CHALLENGE_LIMITS.maxTargetSek)}.`
}

/** The daily amounts are limited to 50-500 kr, so a period can only hold a target inside that range. */
function checkPeriod(dayCount: number, target: number, months: number, errors: Partial<Record<FormField, string>>): void {
  const lowest = dayCount * initialMinimumSek
  const highest = dayCount * preferredMaximumSek
  const period = durationLabel(months)
  if (target < lowest) {
    errors.target = `Målet är för lågt för ${period} (${dayCount} dagar). Minst ${sek(lowest)} krävs (${sek(initialMinimumSek)} per dag). Höj målet eller välj en kortare tid.`
  } else if (target > highest) {
    errors.target = `Målet är för högt för ${period} (${dayCount} dagar). Högst ${sek(highest)} går att spara (${sek(preferredMaximumSek)} per dag). Sänk målet eller välj en längre tid.`
  }
}
