import {
  listChallengeDates,
  type Challenge,
  type ChallengeConfig,
  type ChallengeDay,
  type DayStatus,
} from '../domain/challenge'

const DAY_STATUSES: ReadonlySet<string> = new Set(['undrawn', 'drawn', 'confirmed', 'missed'])
export const MAX_ID_LENGTH = 100

/** Thrown by the parsers below. Callers convert it to the error type that fits their context. */
export class InvalidChallengeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidChallengeError'
  }
}

export interface ParseOptions {
  /**
   * When true, a challenge with no missed day must add up to exactly its target.
   * Used for v2 backups and saves. Legacy v1 data is checked less strictly.
   */
  requireExactTotal: boolean
  /** Skip the totals rule so the caller can run it later (saves report immutability violations first). */
  skipTotals?: boolean
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return false
  return !Number.isNaN(Date.parse(value))
}

/**
 * Validates an untrusted challenge and returns a clean copy that contains only known fields.
 * Never mutates its input.
 */
export function parseChallenge(candidate: unknown, options: ParseOptions): Challenge {
  if (!isRecord(candidate)) throw new InvalidChallengeError('Challenge structure is invalid')
  const id = parseId(candidate.id)
  if (typeof candidate.seed !== 'string') throw new InvalidChallengeError('Challenge seed is invalid')
  const config = parseConfig(candidate.config)
  const expectedDates = datesFor(config)
  if (!Array.isArray(candidate.days)) throw new InvalidChallengeError('Challenge days are missing')
  if (candidate.days.length !== expectedDates.length) {
    throw new InvalidChallengeError('Challenge contains an invalid number of daily entries')
  }

  const days = candidate.days.map((day, index) => parseDay(day, expectedDates[index], config))
  if (!options.skipTotals) assertTotals(days, config, options)
  return { id, seed: candidate.seed, config, days }
}

export function parseId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new InvalidChallengeError('Challenge id is invalid')
  }
  return value
}

export function parseConfig(value: unknown): ChallengeConfig {
  if (!isRecord(value)) throw new InvalidChallengeError('Challenge configuration is missing')
  const { targetSek, startDate, endDate, initialMinimumSek, preferredMaximumSek } = value
  if (typeof startDate !== 'string' || typeof endDate !== 'string') {
    throw new InvalidChallengeError('Challenge dates are invalid')
  }
  if (typeof targetSek !== 'number' || typeof initialMinimumSek !== 'number' || typeof preferredMaximumSek !== 'number') {
    throw new InvalidChallengeError('Challenge amounts are invalid')
  }
  const config: ChallengeConfig = { targetSek, startDate, endDate, initialMinimumSek, preferredMaximumSek }
  datesFor(config)
  return config
}

function datesFor(config: ChallengeConfig): string[] {
  try {
    return listChallengeDates(config)
  } catch (cause) {
    throw new InvalidChallengeError(cause instanceof Error ? cause.message : 'Challenge configuration is invalid')
  }
}

function parseDay(value: unknown, expectedDate: string, config: ChallengeConfig): ChallengeDay {
  if (!isRecord(value) || value.date !== expectedDate) {
    throw new InvalidChallengeError('Challenge contains an invalid daily entry')
  }
  const { amount, status } = value
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) {
    throw new InvalidChallengeError('Challenge contains an invalid daily entry')
  }
  if (amount < config.initialMinimumSek || amount > config.targetSek) {
    throw new InvalidChallengeError('Challenge contains an invalid daily entry')
  }
  if (typeof status !== 'string' || !DAY_STATUSES.has(status)) {
    throw new InvalidChallengeError('Challenge contains an invalid daily entry')
  }
  return { date: expectedDate, amount, status: status as DayStatus }
}

/**
 * Totals rule. Recovery can redistribute amounts, and missed days keep their old amount, so the sum of
 * ALL days may exceed the target once something was missed. What always holds:
 *  - days that are not missed never add up to more than the target;
 *  - a challenge with no missed day adds up to exactly the target (strict mode only).
 */
export function assertTotals(days: ChallengeDay[], config: ChallengeConfig, options: ParseOptions): void {
  const live = days.filter((day) => day.status !== 'missed')
  const liveTotal = live.reduce((total, day) => total + day.amount, 0)
  if (liveTotal > config.targetSek) throw new InvalidChallengeError('Challenge amounts exceed the target')
  const hasMissed = live.length !== days.length
  if (options.requireExactTotal && !hasMissed && liveTotal !== config.targetSek) {
    throw new InvalidChallengeError('Challenge amounts do not add up to the target')
  }
}

/** Confirmed and drawn amounts may never change, and entries may never disappear. */
export function assertImmutableEntries(stored: ChallengeDay[], incoming: ChallengeDay[]): void {
  const incomingByDate = new Map(incoming.map((day) => [day.date, day]))
  for (const before of stored) {
    const after = incomingByDate.get(before.date)
    if (!after) throw new InvalidChallengeError('A stored daily entry cannot be removed')
    if (before.status === 'confirmed' && (after.status !== 'confirmed' || after.amount !== before.amount)) {
      throw new InvalidChallengeError('Confirmed entries are immutable')
    }
    if (before.status === 'drawn' && (after.amount !== before.amount || after.status === 'undrawn')) {
      throw new InvalidChallengeError('Drawn entries are immutable')
    }
  }
}

export function sameConfig(a: ChallengeConfig, b: ChallengeConfig): boolean {
  return (
    a.targetSek === b.targetSek &&
    a.startDate === b.startDate &&
    a.endDate === b.endDate &&
    a.initialMinimumSek === b.initialMinimumSek &&
    a.preferredMaximumSek === b.preferredMaximumSek
  )
}
