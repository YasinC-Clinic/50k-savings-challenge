import { describe, expect, it } from 'vitest'
import {
  CHALLENGE_LIMITS,
  DEFAULT_CHALLENGE_CONFIG,
  confirmDay,
  createChallenge,
  drawToday,
  listChallengeDates,
  recalculateAfterMisses,
  type ChallengeConfig,
} from './challenge'

const config = (overrides: Partial<ChallengeConfig> = {}): ChallengeConfig => ({
  targetSek: 10_000,
  startDate: '2027-01-01',
  endDate: '2027-01-31',
  initialMinimumSek: 50,
  preferredMaximumSek: 500,
  ...overrides,
})

const total = (amounts: number[]) => amounts.reduce((sum, amount) => sum + amount, 0)
const dayNumber = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

describe('default configuration is preserved', () => {
  it('is exactly 50,000 SEK, 2027-01-01 to 2027-06-30, 50-500 SEK', () => {
    expect(DEFAULT_CHALLENGE_CONFIG).toEqual({ targetSek: 50_000, startDate: '2027-01-01', endDate: '2027-06-30', initialMinimumSek: 50, preferredMaximumSek: 500 })
  })

  it('createChallenge without a config equals createChallenge with the explicit default', () => {
    const implicit = createChallenge('same')
    const explicit = createChallenge('same', DEFAULT_CHALLENGE_CONFIG)
    expect(implicit).toEqual(explicit)
    expect(implicit.days).toHaveLength(181)
    expect(total(implicit.days.map((day) => day.amount))).toBe(50_000)
  })

  it('keeps default amounts identical for a given seed (no silent re-roll of existing users)', () => {
    const first = createChallenge('stable-seed').days.slice(0, 5).map((day) => day.amount)
    const second = createChallenge('stable-seed', { ...DEFAULT_CHALLENGE_CONFIG }).days.slice(0, 5).map((day) => day.amount)
    expect(first).toEqual(second)
  })
})

describe('configuration validation', () => {
  const invalid: Array<[string, Partial<ChallengeConfig>]> = [
    ['end equal to start', { endDate: '2027-01-01' }],
    ['end before start', { startDate: '2027-02-01', endDate: '2027-01-01' }],
    ['impossible calendar date', { endDate: '2027-02-30' }],
    ['non-leap Feb 29', { startDate: '2027-02-01', endDate: '2027-02-29' }],
    ['century non-leap Feb 29', { startDate: '2100-02-01', endDate: '2100-02-29' }],
    ['wrong date format', { startDate: '2027/01/01' }],
    ['empty start', { startDate: '' }],
    ['zero target', { targetSek: 0 }],
    ['negative target', { targetSek: -1 }],
    ['fractional target', { targetSek: 10_000.5 }],
    ['zero minimum', { initialMinimumSek: 0 }],
    ['maximum below minimum', { initialMinimumSek: 100, preferredMaximumSek: 99 }],
    ['target below days x minimum', { targetSek: 31 * 50 - 1 }],
    ['target above days x maximum', { targetSek: 31 * 500 + 1 }],
    ['NaN target', { targetSek: Number.NaN }],
  ]

  it.each(invalid)('rejects %s', (_label, overrides) => {
    expect(() => createChallenge('x', config(overrides))).toThrow()
    expect(() => listChallengeDates(config(overrides))).toThrow()
  })

  it('accepts the exact boundaries of an achievable target', () => {
    expect(createChallenge('lo', config({ targetSek: 31 * 50 })).days.every((day) => day.amount === 50)).toBe(true)
    expect(createChallenge('hi', config({ targetSek: 31 * 500 })).days.every((day) => day.amount === 500)).toBe(true)
  })

  it('copies the config so later mutation of the caller object cannot change a challenge', () => {
    const mutable = config()
    const challenge = createChallenge('copy', mutable)
    mutable.endDate = '2030-01-01'
    mutable.targetSek = 1
    expect(challenge.config.endDate).toBe('2027-01-31')
    expect(challenge.config.targetSek).toBe(10_000)
  })

  it('enforces the size limits with specific errors, before doing any work over the date range', () => {
    const started = performance.now()
    expect(() => listChallengeDates(config({ startDate: '1000-01-01', endDate: '9999-12-31', targetSek: 1_000_000 }))).toThrow('longer than the supported maximum')
    expect(() => listChallengeDates(config({ startDate: '2027-01-01', endDate: '2030-06-01', targetSek: 100_000 }))).toThrow('longer than the supported maximum')
    expect(() => listChallengeDates(config({ targetSek: CHALLENGE_LIMITS.maxTargetSek + 1 }))).toThrow('above the supported maximum')
    expect(() => listChallengeDates(config({ preferredMaximumSek: CHALLENGE_LIMITS.maxDailySek + 1 }))).toThrow('above the supported maximum')
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('accepts the longest supported challenge', () => {
    const longest = config({ startDate: '2027-01-01', endDate: '2029-12-31', targetSek: 100_000 })
    // 2027-2029 contains the leap day 2028-02-29, so three calendar years are 1,096 days.
    expect(listChallengeDates(longest)).toHaveLength(1096)
    expect(createChallenge('long', longest).days).toHaveLength(1096)
    expect(1096).toBeLessThanOrEqual(CHALLENGE_LIMITS.maxDays)
  })

  it('uses an explicit id when given and derives a stable id otherwise', () => {
    expect(createChallenge('seed-a', config(), 'my-id').id).toBe('my-id')
    expect(createChallenge('seed-a', config()).id).toBe(createChallenge('seed-a', config()).id)
  })
})

describe('calendar arithmetic, leap years and year boundaries', () => {
  it.each([
    ['non-leap February 2027', '2027-02-01', '2027-02-28', 28],
    ['leap February 2028', '2028-02-01', '2028-02-29', 29],
    ['2000 is a leap year (divisible by 400)', '2000-02-01', '2000-03-01', 30],
    ['2100 is not a leap year (divisible by 100)', '2100-02-01', '2100-03-01', 29],
    ['year boundary', '2027-12-25', '2028-01-05', 12],
    ['single month 30 days', '2027-04-01', '2027-04-30', 30],
  ])('%s', (_label, startDate, endDate, expectedDays) => {
    const dates = listChallengeDates(config({ targetSek: expectedDays * 100, startDate, endDate }))
    expect(dates).toHaveLength(expectedDays)
    expect(dates[0]).toBe(startDate)
    expect(dates.at(-1)).toBe(endDate)
  })

  it('includes 2028-02-29 and excludes 2027-02-29', () => {
    expect(listChallengeDates(config({ targetSek: 5_000, startDate: '2028-02-20', endDate: '2028-03-05' }))).toContain('2028-02-29')
    expect(listChallengeDates(config({ targetSek: 5_000, startDate: '2027-02-20', endDate: '2027-03-05' }))).not.toContain('2027-02-29')
  })

  it('produces strictly consecutive dates with no gaps or duplicates across both 2027 DST changes', () => {
    const dates = listChallengeDates(config({ targetSek: 50_000, startDate: '2027-03-01', endDate: '2027-11-30' }))
    expect(dates).toHaveLength(275)
    expect(dates).toContain('2027-03-28')
    expect(dates).toContain('2027-10-31')
    dates.slice(1).forEach((date, index) => expect(dayNumber(date) - dayNumber(dates[index])).toBe(1))
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('accepts a challenge starting today and ending on the default end date (235 days)', () => {
    const today = config({ targetSek: 50_000, startDate: '2026-11-08', endDate: '2027-06-30' })
    const challenge = createChallenge('today', today)
    expect(challenge.days).toHaveLength(235)
    expect(total(challenge.days.map((day) => day.amount))).toBe(50_000)
    expect(challenge.days.every((day) => day.amount >= 50 && day.amount <= 500)).toBe(true)
  })
})

describe('allocation per configuration', () => {
  it('always totals the target and stays inside bounds for many seeds', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const challenge = createChallenge(`s${seed}`, config())
      expect(total(challenge.days.map((day) => day.amount))).toBe(10_000)
      expect(challenge.days.every((day) => day.amount >= 50 && day.amount <= 500)).toBe(true)
    }
  })

  it('differs between configurations that share a seed', () => {
    const short = createChallenge('shared', config())
    const long = createChallenge('shared', config({ endDate: '2027-02-28', targetSek: 20_000 }))
    expect(short.days.length).not.toBe(long.days.length)
  })
})

describe('drawing and confirming inside a configured range', () => {
  const challenge = createChallenge('range', config())

  it('allows the first and last configured dates', () => {
    expect(drawToday(challenge, '2027-01-01').days[0].status).toBe('drawn')
    expect(drawToday(challenge, '2027-01-31').days.at(-1)?.status).toBe('drawn')
  })

  it.each(['2026-12-31', '2027-02-01', '2027-02-30', 'not-a-date'])('rejects %s', (date) => {
    expect(() => drawToday(challenge, date)).toThrow()
  })

  it('does not accept a default-range date that is outside a custom range', () => {
    expect(() => drawToday(challenge, '2027-03-01')).toThrow('outside the challenge')
  })

  it('cannot confirm an undrawn day or a date outside the range', () => {
    expect(() => confirmDay(challenge, '2027-01-02')).toThrow('Only a drawn amount')
    expect(() => confirmDay(challenge, '2027-02-01')).toThrow('outside the challenge')
  })

  it('marks every earlier unresolved day missed when drawing later', () => {
    const drawn = drawToday(challenge, '2027-01-05')
    expect(drawn.days.slice(0, 4).every((day) => day.status === 'missed')).toBe(true)
    expect(drawn.days[4].status).toBe('drawn')
  })

  it('refuses to draw a missed day', () => {
    const missed = recalculateAfterMisses(challenge, '2027-01-05', 'r').challenge
    expect(() => drawToday(missed, '2027-01-02')).toThrow()
  })
})

describe('missed-day recovery with custom configurations', () => {
  const january = createChallenge('recover', config())

  it('stays within the preferred ceiling when enough days remain', () => {
    const result = recalculateAfterMisses(january, '2027-01-11', 'run')
    expect(result.recovery).toMatchObject({ status: 'ok', ceiling: 500 })
    const live = result.challenge.days.filter((day) => day.status !== 'missed')
    expect(total(live.map((day) => day.amount))).toBe(10_000)
    expect(live.every((day) => day.amount >= 50 && day.amount <= 500)).toBe(true)
    expect(result.challenge.days.filter((day) => day.status === 'missed')).toHaveLength(10)
  })

  it('raises the ceiling only as far as needed', () => {
    const result = recalculateAfterMisses(january, '2027-01-16', 'run')
    expect(result.recovery).toMatchObject({ status: 'needs_higher_ceiling', ceiling: 625 })
    expect(total(result.challenge.days.filter((day) => day.status !== 'missed').map((day) => day.amount))).toBe(10_000)
  })

  it('reports impossible after the configured end date and names that end date and target', () => {
    const result = recalculateAfterMisses(january, '2027-02-01', 'run')
    expect(result.recovery.status).toBe('impossible')
    expect(result.recovery.message).toContain('2027-01-31')
    expect(result.recovery.message).toContain('10000')
  })

  it('is deterministic for identical inputs and varies with the run seed', () => {
    const a = recalculateAfterMisses(january, '2027-01-11', 'run').challenge.days.map((day) => day.amount)
    const b = recalculateAfterMisses(january, '2027-01-11', 'run').challenge.days.map((day) => day.amount)
    const c = recalculateAfterMisses(january, '2027-01-11', 'other').challenge.days.map((day) => day.amount)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('never changes confirmed or already drawn amounts and turns a stale drawn day into missed', () => {
    const confirmed = confirmDay(drawToday(january, '2027-01-01'), '2027-01-01')
    const withStaleDraw = { ...confirmed, days: confirmed.days.map((day, index) => index === 1 ? { ...day, status: 'drawn' as const } : day) }
    const withFutureDraw = { ...withStaleDraw, days: withStaleDraw.days.map((day, index) => index === 20 ? { ...day, status: 'drawn' as const } : day) }
    const result = recalculateAfterMisses(withFutureDraw, '2027-01-10', 'run').challenge
    expect(result.days[0]).toEqual(confirmed.days[0])
    expect(result.days[1].status).toBe('missed')
    expect(result.days[1].amount).toBe(withFutureDraw.days[1].amount)
    expect(result.days[20]).toEqual(withFutureDraw.days[20])
  })

  it('does not mark anything missed or change the target when called before the start date', () => {
    const result = recalculateAfterMisses(january, '2026-12-15', 'run')
    expect(result.challenge.days.every((day) => day.status === 'undrawn')).toBe(true)
    expect(total(result.challenge.days.map((day) => day.amount))).toBe(10_000)
  })

  it('rejects a malformed today value', () => {
    expect(() => recalculateAfterMisses(january, '2027-1-1', 'run')).toThrow()
  })

  it('does not mutate the input challenge', () => {
    const snapshot = JSON.stringify(january)
    recalculateAfterMisses(january, '2027-01-20', 'run')
    expect(JSON.stringify(january)).toBe(snapshot)
  })
})

describe('late starts (challenge started today, nothing drawn for weeks)', () => {
  const startedToday = createChallenge('late', config({ targetSek: 50_000, startDate: '2026-11-08', endDate: '2027-06-30' }))

  it('recovers across the year boundary and keeps the exact target', () => {
    const result = recalculateAfterMisses(startedToday, '2027-01-02', 'run')
    expect(result.challenge.days.filter((day) => day.status === 'missed')).toHaveLength(55)
    expect(total(result.challenge.days.filter((day) => day.status !== 'missed').map((day) => day.amount))).toBe(50_000)
    expect(result.recovery.status).toBe('ok')
  })

  it('needs a higher ceiling when only a few days remain, and the final day carries the rest', () => {
    const result = recalculateAfterMisses(startedToday, '2027-06-28', 'run')
    expect(result.recovery.status).toBe('needs_higher_ceiling')
    expect(result.recovery.ceiling).toBe(Math.ceil(50_000 / 3))
  })

  it('keeps the very last day eligible and then reports impossible the day after', () => {
    expect(recalculateAfterMisses(startedToday, '2027-06-30', 'run').recovery.status).toBe('needs_higher_ceiling')
    expect(recalculateAfterMisses(startedToday, '2027-07-01', 'run').recovery.status).toBe('impossible')
  })

  it('loses nothing for a user who confirmed the first day and then stopped', () => {
    const first = confirmDay(drawToday(startedToday, '2026-11-08'), '2026-11-08')
    const result = recalculateAfterMisses(first, '2026-12-01', 'run').challenge
    expect(result.days[0]).toEqual(first.days[0])
    expect(total(result.days.filter((day) => day.status !== 'missed').map((day) => day.amount))).toBe(50_000)
  })
})
