export const CHALLENGE = {
  targetSek: 50_000,
  startDate: '2027-01-01',
  endDate: '2027-06-30',
  durationDays: 181,
  initialMinimumSek: 50,
  preferredMaximumSek: 500,
} as const

/** Hard bounds for user-supplied or imported configurations. The default challenge is far inside them. */
export const CHALLENGE_LIMITS = {
  maxDays: 1100,
  maxTargetSek: 10_000_000,
  maxDailySek: 100_000,
} as const

export interface ChallengeConfig {
  targetSek: number
  startDate: string
  endDate: string
  initialMinimumSek: number
  preferredMaximumSek: number
  /**
   * When true the daily range is derived from what is left (see dynamicBounds) instead of staying fixed. Only new
   * challenges set it; every existing challenge has no such field and keeps its original behaviour.
   */
  dynamicRange?: boolean
  /** Opt-in: occasional Shock Days with a clearly higher amount that the user may accept or draw again. */
  shockDays?: boolean
}

export const DEFAULT_CHALLENGE_CONFIG: ChallengeConfig = {
  targetSek: CHALLENGE.targetSek,
  startDate: CHALLENGE.startDate,
  endDate: CHALLENGE.endDate,
  initialMinimumSek: CHALLENGE.initialMinimumSek,
  preferredMaximumSek: CHALLENGE.preferredMaximumSek,
}

export type DayStatus = 'undrawn' | 'drawn' | 'confirmed' | 'missed'

export interface ChallengeDay {
  date: string
  amount: number
  status: DayStatus
}

export interface Challenge {
  id: string
  config: ChallengeConfig
  seed: string
  days: ChallengeDay[]
}

export interface DayPresentation {
  date: string
  status: DayStatus
  amount: number | null
}

export type Recovery =
  | { status: 'ok'; ceiling: number; message: string }
  | { status: 'needs_higher_ceiling'; ceiling: number; message: string }
  | { status: 'impossible'; ceiling: null; message: string }

export interface RecoveryResult {
  challenge: Challenge
  recovery: Recovery
}

/** Builds calendar dates without converting through UTC, so Stockholm DST is irrelevant. */
export function listChallengeDates(config: ChallengeConfig = DEFAULT_CHALLENGE_CONFIG): string[] {
  assertConfiguration(config)
  const dates: string[] = []
  let [year, month, day] = config.startDate.split('-').map(Number)

  while (true) {
    const key = toDateKey(year, month, day)
    dates.push(key)
    if (key === config.endDate) return dates

    day += 1
    if (day > daysInMonth(year, month)) {
      day = 1
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
    }
  }
}

export function createChallenge(seed: string | number, config: ChallengeConfig = DEFAULT_CHALLENGE_CONFIG, id = `challenge-${String(seed)}`): Challenge {
  assertConfiguration(config)
  const normalizedSeed = String(seed)
  const amounts = allocateExact(
    config.targetSek,
    listChallengeDates(config).length,
    config.initialMinimumSek,
    config.preferredMaximumSek,
    normalizedSeed,
  )

  return {
    id,
    config: { ...config },
    seed: normalizedSeed,
    days: listChallengeDates(config).map((date, index) => ({ date, amount: amounts[index], status: 'undrawn' })),
  }
}

/** This is the only presentation function for a daily amount; undrawn values stay private. */
export function getDayPresentation(challenge: Challenge, date: string): DayPresentation {
  const day = findDay(challenge, date)
  return {
    date: day.date,
    status: day.status,
    amount: day.status === 'undrawn' ? null : day.amount,
  }
}

/**
 * Draws exactly the authoritative current Sweden-local date. A requested date is
 * accepted only to let a caller prove it is not trying to reveal a future value.
 */
export function drawToday(challenge: Challenge, currentDate: string, requestedDate = currentDate): Challenge {
  assertChallengeDate(challenge.config, currentDate)
  assertChallengeDate(challenge.config, requestedDate)
  if (requestedDate !== currentDate) throw new Error('Only the current challenge date can be drawn')
  const advanced = markPastUnconfirmedAsMissed(challenge, currentDate)
  const day = findDay(advanced, currentDate)

  if (day.status === 'drawn' || day.status === 'confirmed') {
    throw new Error('A current-day draw already exists')
  }
  if (day.status === 'missed') {
    throw new Error('A missed day cannot be drawn')
  }

  return replaceDay(advanced, currentDate, { ...day, status: 'drawn' })
}

export function confirmDay(challenge: Challenge, date: string): Challenge {
  assertChallengeDate(challenge.config, date)
  const day = findDay(challenge, date)
  if (day.status === 'confirmed') throw new Error('This saving is already confirmed')
  if (day.status !== 'drawn') throw new Error('Only a drawn amount can be confirmed')
  return replaceDay(challenge, date, { ...day, status: 'confirmed' })
}

/**
 * Marks all prior unresolved entries as missed, then redistributes only undrawn
 * current/future amounts. Confirmed and already drawn values are never changed.
 */
export function recalculateAfterMisses(challenge: Challenge, today: string, seed: string | number, extraCommittedSek = 0): RecoveryResult {
  assertCalendarDate(today)
  const advanced = markPastUnconfirmedAsMissed(challenge, today)
  const eligible = advanced.days.filter((day) => day.date >= today && day.status === 'undrawn')
  // extraCommittedSek: amounts that count towards the target but live outside the daily entries (catch-up savings).
  const committedTotal =
    advanced.days.filter((day) => day.status === 'confirmed' || day.status === 'drawn').reduce((total, day) => total + day.amount, 0) +
    extraCommittedSek
  const needed = challenge.config.targetSek - committedTotal
  const dynamic = challenge.config.dynamicRange === true
  const minimumRequired = eligible.length * (dynamic ? 1 : challenge.config.initialMinimumSek)

  if (eligible.length === 0 || needed < minimumRequired) {
    return {
      challenge: advanced,
      recovery: { status: 'impossible', ceiling: null, message: `The ${challenge.config.targetSek} SEK target cannot be reached by ${challenge.config.endDate} with the remaining eligible days.` },
    }
  }

  // A dynamic-range challenge re-derives its range from what is left; a fixed-range one keeps its own limits.
  const bounds = dynamic
    ? dynamicBounds(needed, eligible.length)
    : { minimumSek: challenge.config.initialMinimumSek, maximumSek: Math.max(challenge.config.preferredMaximumSek, Math.ceil(needed / eligible.length)) }
  const maximum = bounds.maximumSek
  const amounts = allocateExact(needed, eligible.length, bounds.minimumSek, maximum, `${challenge.seed}:recovery:${today}:${seed}`)
  const replacements = new Map(eligible.map((day, index) => [day.date, amounts[index]]))
  const recovered: Challenge = {
    ...advanced,
    days: advanced.days.map((day) => replacements.has(day.date) ? { ...day, amount: replacements.get(day.date)! } : day),
  }
  const needsHigherCeiling = !dynamic && maximum > challenge.config.preferredMaximumSek

  return {
    challenge: recovered,
    recovery: needsHigherCeiling
      ? { status: 'needs_higher_ceiling', ceiling: maximum, message: `Recovery requires future daily amounts up to ${maximum} SEK; this exceeds the preferred ${challenge.config.preferredMaximumSek} SEK ceiling.` }
      : { status: 'ok', ceiling: maximum, message: `Future undrawn amounts were redistributed within the preferred ${challenge.config.preferredMaximumSek} SEK ceiling.` },
  }
}

function markPastUnconfirmedAsMissed(challenge: Challenge, today: string): Challenge {
  return {
    ...challenge,
    days: challenge.days.map((day) => day.date < today && (day.status === 'undrawn' || day.status === 'drawn') ? { ...day, status: 'missed' } : day),
  }
}

/** Randomly assigns bounded integer amounts. Shuffling slots first removes date-order bias. */
function allocateExact(total: number, count: number, minimum: number, maximum: number, seed: string): number[] {
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum)) throw new Error('Amounts must be safe integer SEK values')
  if (total < count * minimum || total > count * maximum) throw new Error('The requested allocation is mathematically impossible')

  const random = seededRandom(seed)
  const slots = shuffledIndices(count, random)
  const allocated = Array<number>(count).fill(minimum)
  let remaining = total - count * minimum
  const capacity = maximum - minimum

  slots.forEach((slot, order) => {
    const slotsAfter = count - order - 1
    const lower = Math.max(0, remaining - slotsAfter * capacity)
    const upper = Math.min(capacity, remaining)
    const extra = randomInteger(lower, upper, random)
    allocated[slot] += extra
    remaining -= extra
  })

  return allocated
}

/**
 * A sensible daily range for what is still to be saved: it always contains the average (so the target stays achievable),
 * varies around it (40% to 180% of the average) and never exceeds a bounded multiple, so amounts stay reasonable.
 * 10,000 SEK over 182 days gives 21-99 SEK; 100,000 SEK gives 218-990 SEK.
 */
export function dynamicBounds(neededSek: number, days: number): DailyLimits {
  const average = neededSek / days
  const minimumSek = Math.max(1, Math.floor(average * 0.4))
  return { minimumSek, maximumSek: Math.max(minimumSek, Math.ceil(average * 1.8)) }
}

export function seededRandom(seed: string): () => number {
  let state = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index)
    state = Math.imul(state, 16777619)
  }
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function shuffledIndices(count: number, random: () => number): number[] {
  const indices = Array.from({ length: count }, (_, index) => index)
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]]
  }
  return indices
}

export function randomInteger(minimum: number, maximum: number, random: () => number): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1))
}

function replaceDay(challenge: Challenge, date: string, replacement: ChallengeDay): Challenge {
  return { ...challenge, days: challenge.days.map((day) => day.date === date ? replacement : day) }
}

function findDay(challenge: Challenge, date: string): ChallengeDay {
  const day = challenge.days.find((candidate) => candidate.date === date)
  if (!day) throw new Error('Date is outside the challenge')
  return day
}

function assertChallengeDate(config: ChallengeConfig, date: string): void {
  if (!isCalendarDate(date) || date < config.startDate || date > config.endDate) throw new Error('Date is outside the challenge')
}

function assertConfiguration(config: ChallengeConfig): void {
  assertConfigurationFields(config)
  assertWithinLimits(config)
  const days = countDays(config.startDate, config.endDate)
  if (days > CHALLENGE_LIMITS.maxDays) throw new Error('Challenge is longer than the supported maximum')
  if (config.targetSek < days * config.initialMinimumSek || config.targetSek > days * config.preferredMaximumSek) throw new Error('Challenge target is not achievable in the selected dates and range')
}

function assertConfigurationFields(config: ChallengeConfig): void {
  const amounts = [config.targetSek, config.initialMinimumSek, config.preferredMaximumSek]
  if (!amounts.every((amount) => Number.isSafeInteger(amount))) throw new Error('Challenge configuration is invalid')
  if (config.targetSek <= 0 || config.initialMinimumSek <= 0) throw new Error('Challenge configuration is invalid')
  if (config.preferredMaximumSek < config.initialMinimumSek) throw new Error('Challenge configuration is invalid')
  if (!isCalendarDate(config.startDate) || !isCalendarDate(config.endDate)) throw new Error('Challenge configuration is invalid')
  if (config.endDate <= config.startDate) throw new Error('Challenge configuration is invalid')
}

/** Cheap checks that run before any loop over the date range, so hostile input cannot cause long work. */
function assertWithinLimits(config: ChallengeConfig): void {
  const yearSpan = Number(config.endDate.slice(0, 4)) - Number(config.startDate.slice(0, 4))
  if (yearSpan > Math.ceil(CHALLENGE_LIMITS.maxDays / 365)) throw new Error('Challenge is longer than the supported maximum')
  if (config.targetSek > CHALLENGE_LIMITS.maxTargetSek) throw new Error('Challenge target is above the supported maximum')
  if (config.preferredMaximumSek > CHALLENGE_LIMITS.maxDailySek) throw new Error('Daily maximum is above the supported maximum')
}

function countDays(startDate: string, endDate: string): number {
  let count = 0
  let cursor = startDate
  while (cursor <= endDate) {
    count += 1
    const [year, month, day] = cursor.split('-').map(Number)
    if (day < daysInMonth(year, month)) cursor = toDateKey(year, month, day + 1)
    else if (month < 12) cursor = toDateKey(year, month + 1, 1)
    else cursor = toDateKey(year + 1, 1, 1)
  }
  return count
}

/** Durations offered when creating a challenge, in whole calendar months. */
export const DURATION_MONTH_OPTIONS = [1, 2, 3, 4, 5, 6, 9, 12] as const
export const DEFAULT_DURATION_MONTHS = 6
const MAX_ADDED_MONTHS = 120

/**
 * Adds whole calendar months to a calendar date (`YYYY-MM-DD`).
 *
 * The rule: keep the day of the month; if the resulting month is shorter, use its last day.
 *   2026-11-08 + 6 = 2027-05-08     2027-01-31 + 1 = 2027-02-28     2028-01-31 + 1 = 2028-02-29
 *   2027-03-31 + 1 = 2027-04-30     2028-02-29 + 12 = 2029-02-28
 *
 * Pure calendar arithmetic on year/month/day numbers. No `Date`, no UTC and no time zone are involved, so
 * daylight-saving changes cannot move a date.
 */
export function addMonths(date: string, months: number): string {
  if (!isCalendarDate(date)) throw new Error('Date must be a calendar date')
  if (!Number.isInteger(months) || months < 0 || months > MAX_ADDED_MONTHS) throw new Error('Months must be a whole number of months')
  const [year, month, day] = date.split('-').map(Number)
  const monthIndex = year * 12 + (month - 1) + months
  const targetYear = Math.floor(monthIndex / 12)
  const targetMonth = (monthIndex % 12) + 1
  return toDateKey(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)))
}

/** The special duration "Till nyår": from today until 31 December. */
export const NEW_YEAR_DURATION = 'new-year' as const

export type DurationChoice = (typeof DURATION_MONTH_OPTIONS)[number] | typeof NEW_YEAR_DURATION

/** Every duration offered in the creation form, "Till nyår" last. */
export const DURATION_OPTIONS: readonly DurationChoice[] = [...DURATION_MONTH_OPTIONS, NEW_YEAR_DURATION]

/**
 * The end date of "Till nyår" for a challenge that starts on `date`: 31 December of the same year.
 * If that date is not after the start (the challenge would start ON 31 December), the next 31 December is used
 * instead, so the option never produces an empty or invalid challenge.
 */
export function newYearEnd(date: string): string {
  if (!isCalendarDate(date)) throw new Error('Date must be a calendar date')
  const year = Number(date.slice(0, 4))
  const thisYearEnd = `${year}-12-31`
  return thisYearEnd > date ? thisYearEnd : `${year + 1}-12-31`
}

export function endDateForDuration(startDate: string, duration: number | typeof NEW_YEAR_DURATION): string {
  return duration === NEW_YEAR_DURATION ? newYearEnd(startDate) : addMonths(startDate, duration)
}

/** The allowed range of a single day's amount, chosen per challenge. */
export interface DailyLimits {
  minimumSek: number
  maximumSek: number
}

export const DEFAULT_DAILY_LIMITS: DailyLimits = {
  minimumSek: DEFAULT_CHALLENGE_CONFIG.initialMinimumSek,
  maximumSek: DEFAULT_CHALLENGE_CONFIG.preferredMaximumSek,
}

/**
 * The configuration of a challenge that starts on `startDate` and lasts the chosen duration.
 * Start date, end date and both daily limits are stored in the config; this only calculates them.
 */
export function configForDuration(
  startDate: string,
  duration: number | typeof NEW_YEAR_DURATION,
  targetSek: number = DEFAULT_CHALLENGE_CONFIG.targetSek,
  limits: DailyLimits = DEFAULT_DAILY_LIMITS,
): ChallengeConfig {
  if (typeof duration === 'number' && duration < 1) throw new Error('A challenge lasts at least one month')
  return {
    targetSek,
    startDate,
    endDate: endDateForDuration(startDate, duration),
    initialMinimumSek: limits.minimumSek,
    preferredMaximumSek: limits.maximumSek,
  }
}

function assertCalendarDate(date: string): void {
  if (!isCalendarDate(date)) throw new Error('Date must be a Sweden-local calendar date')
}

function isCalendarDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

function daysInMonth(year: number, month: number): number {
  return [4, 6, 9, 11].includes(month) ? 30 : month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : 31
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
