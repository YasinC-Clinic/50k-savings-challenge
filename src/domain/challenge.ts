export const CHALLENGE = {
  targetSek: 50_000,
  startDate: '2027-01-01',
  endDate: '2027-06-30',
  durationDays: 181,
  initialMinimumSek: 50,
  preferredMaximumSek: 500,
} as const

export type DayStatus = 'undrawn' | 'drawn' | 'confirmed' | 'missed'

export interface ChallengeDay {
  date: string
  amount: number
  status: DayStatus
}

export interface Challenge {
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
export function listChallengeDates(): string[] {
  const dates: string[] = []
  let year = 2027
  let month = 1
  let day = 1

  while (true) {
    const key = toDateKey(year, month, day)
    dates.push(key)
    if (key === CHALLENGE.endDate) return dates

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

export function createChallenge(seed: string | number): Challenge {
  const normalizedSeed = String(seed)
  const amounts = allocateExact(
    CHALLENGE.targetSek,
    CHALLENGE.durationDays,
    CHALLENGE.initialMinimumSek,
    CHALLENGE.preferredMaximumSek,
    normalizedSeed,
  )

  return {
    seed: normalizedSeed,
    days: listChallengeDates().map((date, index) => ({ date, amount: amounts[index], status: 'undrawn' })),
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
  assertChallengeDate(currentDate)
  assertChallengeDate(requestedDate)
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
  assertChallengeDate(date)
  const day = findDay(challenge, date)
  if (day.status === 'confirmed') throw new Error('This saving is already confirmed')
  if (day.status !== 'drawn') throw new Error('Only a drawn amount can be confirmed')
  return replaceDay(challenge, date, { ...day, status: 'confirmed' })
}

/**
 * Marks all prior unresolved entries as missed, then redistributes only undrawn
 * current/future amounts. Confirmed and already drawn values are never changed.
 */
export function recalculateAfterMisses(challenge: Challenge, today: string, seed: string | number): RecoveryResult {
  assertCalendarDate(today)
  const advanced = markPastUnconfirmedAsMissed(challenge, today)
  const eligible = advanced.days.filter((day) => day.date >= today && day.status === 'undrawn')
  const committedTotal = advanced.days
    .filter((day) => day.status === 'confirmed' || day.status === 'drawn')
    .reduce((total, day) => total + day.amount, 0)
  const needed = CHALLENGE.targetSek - committedTotal
  const minimumRequired = eligible.length * CHALLENGE.initialMinimumSek

  if (eligible.length === 0 || needed < minimumRequired) {
    return {
      challenge: advanced,
      recovery: { status: 'impossible', ceiling: null, message: 'The 50,000 SEK target cannot be reached by 30 June 2027 with the remaining eligible days.' },
    }
  }

  const ceiling = Math.ceil(needed / eligible.length)
  const maximum = Math.max(CHALLENGE.preferredMaximumSek, ceiling)
  const amounts = allocateExact(needed, eligible.length, CHALLENGE.initialMinimumSek, maximum, `${challenge.seed}:recovery:${today}:${seed}`)
  const replacements = new Map(eligible.map((day, index) => [day.date, amounts[index]]))
  const recovered: Challenge = {
    ...advanced,
    days: advanced.days.map((day) => replacements.has(day.date) ? { ...day, amount: replacements.get(day.date)! } : day),
  }
  const needsHigherCeiling = maximum > CHALLENGE.preferredMaximumSek

  return {
    challenge: recovered,
    recovery: needsHigherCeiling
      ? { status: 'needs_higher_ceiling', ceiling: maximum, message: `Recovery requires future daily amounts up to ${maximum} SEK; this exceeds the preferred 500 SEK ceiling.` }
      : { status: 'ok', ceiling: maximum, message: 'Future undrawn amounts were redistributed within the preferred 500 SEK ceiling.' },
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

function seededRandom(seed: string): () => number {
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

function randomInteger(minimum: number, maximum: number, random: () => number): number {
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

function assertChallengeDate(date: string): void {
  if (!isCalendarDate(date) || date < CHALLENGE.startDate || date > CHALLENGE.endDate) throw new Error('Date is outside the challenge')
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
