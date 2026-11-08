import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHALLENGE_CONFIG,
  DEFAULT_DURATION_MONTHS,
  DURATION_MONTH_OPTIONS,
  addMonths,
  configForDuration,
  createChallenge,
  drawToday,
  listChallengeDates,
  recalculateAfterMisses,
} from './challenge'

/** Independent day count (both ends included) using UTC noon, so it cannot share a bug with the code under test. */
function independentDayCount(start: string, end: string): number {
  const noon = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)), 12)
  return Math.round((noon(end) - noon(start)) / 86_400_000) + 1
}

const lastDayOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()
const total = (amounts: number[]) => amounts.reduce((sum, amount) => sum + amount, 0)

describe('duration options', () => {
  it('offers exactly 1, 2, 3, 4, 5, 6, 9 and 12 months with six as the default', () => {
    expect([...DURATION_MONTH_OPTIONS]).toEqual([1, 2, 3, 4, 5, 6, 9, 12])
    expect(DEFAULT_DURATION_MONTHS).toBe(6)
    expect(DURATION_MONTH_OPTIONS).toContain(DEFAULT_DURATION_MONTHS)
  })
})

describe('addMonths: keep the day, clamp to the last day of a shorter month', () => {
  it.each([
    ['the documented example: 8 Nov + 6 months', '2026-11-08', 6, '2027-05-08'],
    ['31 Jan + 1 month is the last day of a normal February', '2027-01-31', 1, '2027-02-28'],
    ['31 Jan + 1 month is 29 Feb in a leap year', '2028-01-31', 1, '2028-02-29'],
    ['31 Mar + 1 month is 30 Apr', '2027-03-31', 1, '2027-04-30'],
    ['31 Aug + 1 month is 30 Sep', '2027-08-31', 1, '2027-09-30'],
    ['31 Oct + 4 months lands on leap day 29 Feb', '2027-10-31', 4, '2028-02-29'],
    ['31 Dec + 2 months lands on leap day 29 Feb', '2027-12-31', 2, '2028-02-29'],
    ['31 May + 9 months lands on leap day 29 Feb', '2027-05-31', 9, '2028-02-29'],
    ['31 Dec + 2 months lands on 28 Feb in a normal year', '2026-12-31', 2, '2027-02-28'],
    ['31 Dec + 1 month stays on the 31st across the new year', '2026-12-31', 1, '2027-01-31'],
    ['29 Feb + 12 months clamps to 28 Feb', '2028-02-29', 12, '2029-02-28'],
    ['29 Feb + 48 months is the next leap day', '2028-02-29', 48, '2032-02-29'],
    ['30 Jan + 1 month clamps to 28 Feb', '2027-01-30', 1, '2027-02-28'],
    ['29 Jan + 1 month is 28 Feb in a normal year', '2027-01-29', 1, '2027-02-28'],
    ['a full year keeps the same date', '2026-11-08', 12, '2027-11-08'],
    ['zero months returns the same date', '2027-04-15', 0, '2027-04-15'],
    ['year 2100 is not a leap year', '2100-01-31', 1, '2100-02-28'],
    ['year 2000 is a leap year', '2000-01-31', 1, '2000-02-29'],
  ])('%s', (_label, start, months, expected) => {
    expect(addMonths(start, months)).toBe(expected)
  })

  it('does not move across daylight-saving changes (pure calendar arithmetic)', () => {
    expect(addMonths('2027-03-27', 1)).toBe('2027-04-27')
    expect(addMonths('2027-03-28', 1)).toBe('2027-04-28')
    expect(addMonths('2027-10-30', 1)).toBe('2027-11-30')
    expect(addMonths('2027-10-31', 1)).toBe('2027-11-30')
    expect(addMonths('2027-03-28', 6)).toBe('2027-09-28')
  })

  it('is correct for EVERY start date in 2027 and 2028 and every offered duration', () => {
    const everyStart = listChallengeDates({ ...DEFAULT_CHALLENGE_CONFIG, targetSek: 366 * 275, startDate: '2027-01-01', endDate: '2027-12-31' }).concat(
      listChallengeDates({ ...DEFAULT_CHALLENGE_CONFIG, targetSek: 366 * 275, startDate: '2028-01-01', endDate: '2028-12-31' }),
    )
    expect(everyStart).toHaveLength(365 + 366)

    for (const start of everyStart) {
      const [year, month, day] = start.split('-').map(Number)
      for (const months of DURATION_MONTH_OPTIONS) {
        const index = year * 12 + (month - 1) + months
        const expectedYear = Math.floor(index / 12)
        const expectedMonth = (index % 12) + 1
        const expectedDay = Math.min(day, lastDayOfMonth(expectedYear, expectedMonth))
        const expected = `${expectedYear}-${String(expectedMonth).padStart(2, '0')}-${String(expectedDay).padStart(2, '0')}`
        expect(addMonths(start, months)).toBe(expected)
        expect(addMonths(start, months) > start).toBe(true)
      }
    }
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 121])('rejects %s months', (months) => {
    expect(() => addMonths('2027-01-01', months)).toThrow('whole number of months')
  })

  it.each(['', '2027-02-30', '2027/01/01', 'idag', '2027-13-01'])('rejects the invalid date %j', (date) => {
    expect(() => addMonths(date, 1)).toThrow('calendar date')
  })
})

describe('configForDuration', () => {
  it('turns a six-month challenge started on 8 November 2026 into 8 November 2026 - 8 May 2027', () => {
    expect(configForDuration('2026-11-08', 6)).toEqual({
      targetSek: 50_000,
      startDate: '2026-11-08',
      endDate: '2027-05-08',
      initialMinimumSek: 50,
      preferredMaximumSek: 500,
    })
  })

  it('keeps the default target of 50,000 SEK and accepts another target', () => {
    expect(configForDuration('2026-11-08', 6).targetSek).toBe(50_000)
    expect(configForDuration('2026-11-08', 6, 20_000).targetSek).toBe(20_000)
  })

  it('rejects less than one month', () => {
    expect(() => configForDuration('2026-11-08', 0)).toThrow('at least one month')
  })

  it.each([
    [1, '2026-12-08', 31],
    [2, '2027-01-08', 62],
    [3, '2027-02-08', 93],
    [4, '2027-03-08', 121],
    [5, '2027-04-08', 152],
    [6, '2027-05-08', 182],
    [9, '2027-08-08', 274],
    [12, '2027-11-08', 366],
  ])('%i months from 8 Nov 2026 ends %s and has exactly %i calendar days (no fixed days per month)', (months, end, days) => {
    const config = configForDuration('2026-11-08', months, days * 275)
    expect(config.endDate).toBe(end)
    expect(listChallengeDates(config)).toHaveLength(days)
    expect(independentDayCount(config.startDate, config.endDate)).toBe(days)
  })
})

describe('savings are allocated over the real number of days', () => {
  it.each(DURATION_MONTH_OPTIONS)('allocates the target exactly for %i months', (months) => {
    const days = independentDayCount('2026-11-08', addMonths('2026-11-08', months))
    const target = days * 275
    const challenge = createChallenge(`alloc-${months}`, configForDuration('2026-11-08', months, target))
    expect(challenge.days).toHaveLength(days)
    expect(total(challenge.days.map((day) => day.amount))).toBe(target)
    expect(challenge.days.every((day) => Number.isInteger(day.amount) && day.amount >= 50 && day.amount <= 500)).toBe(true)
    expect(challenge.days[0].date).toBe('2026-11-08')
    expect(challenge.days.at(-1)?.date).toBe(addMonths('2026-11-08', months))
  })

  it('allocates the default 50,000 SEK exactly over 182 days for the default six months', () => {
    const challenge = createChallenge('default-six', configForDuration('2026-11-08', DEFAULT_DURATION_MONTHS))
    expect(challenge.days).toHaveLength(182)
    expect(total(challenge.days.map((day) => day.amount))).toBe(50_000)
  })

  it.each([
    [1, true],
    [2, true],
    [3, true],
    [4, false],
    [5, false],
    [6, false],
    [9, false],
    [12, false],
  ])('50,000 SEK over %i months is unreachable: %s (daily amounts are limited to 50-500 SEK)', (months, unreachable) => {
    const create = () => createChallenge('limits', configForDuration('2026-11-08', months))
    if (unreachable) expect(create).toThrow('not achievable')
    else expect(create).not.toThrow()
  })

  it('handles a month-end start: 31 Jan + 1 month ends on 28 Feb (29 days)', () => {
    const config = configForDuration('2027-01-31', 1, 8_000)
    expect(config.endDate).toBe('2027-02-28')
    const challenge = createChallenge('jan31', config)
    expect(challenge.days).toHaveLength(29)
    expect(total(challenge.days.map((day) => day.amount))).toBe(8_000)
  })

  it('handles a leap-year February: 31 Jan 2028 + 1 month ends on 29 Feb (30 days)', () => {
    const config = configForDuration('2028-01-31', 1, 8_000)
    expect(config.endDate).toBe('2028-02-29')
    const challenge = createChallenge('leap', config)
    expect(challenge.days).toHaveLength(30)
    expect(challenge.days.some((day) => day.date === '2028-02-29')).toBe(true)
  })

  it('handles 31 Mar + 1 month (ends 30 Apr, 31 days)', () => {
    const config = configForDuration('2027-03-31', 1, 8_000)
    expect(config.endDate).toBe('2027-04-30')
    expect(createChallenge('mar31', config).days).toHaveLength(31)
  })

  it('keeps every calendar date exactly once across the spring and autumn daylight-saving changes', () => {
    const spring = createChallenge('spring', configForDuration('2027-03-27', 6, 49_000))
    const autumn = createChallenge('autumn', configForDuration('2027-10-30', 1, 8_000))
    for (const challenge of [spring, autumn]) {
      const dates = challenge.days.map((day) => day.date)
      expect(new Set(dates).size).toBe(dates.length)
      expect(dates).toHaveLength(independentDayCount(challenge.config.startDate, challenge.config.endDate))
    }
    expect(spring.days.filter((day) => day.date === '2027-03-28')).toHaveLength(1)
    expect(spring.config.endDate).toBe('2027-09-27')
    expect(autumn.days.filter((day) => day.date === '2027-10-31')).toHaveLength(1)
    expect(autumn.config.endDate).toBe('2027-11-30')
  })
})

describe('recovery and deadline use the calculated dates', () => {
  const challenge = createChallenge('deadline', configForDuration('2026-11-08', 6))

  it('allows drawing on the first and last calculated day only', () => {
    expect(drawToday(challenge, '2026-11-08').days[0].status).toBe('drawn')
    expect(drawToday(challenge, '2027-05-08').days.at(-1)?.status).toBe('drawn')
    expect(() => drawToday(challenge, '2027-05-09')).toThrow('outside the challenge')
    expect(() => drawToday(challenge, '2026-11-07')).toThrow('outside the challenge')
  })

  it('keeps the calculated last day eligible and reports impossible the day after, naming the end date', () => {
    expect(recalculateAfterMisses(challenge, '2027-05-08', 'r').recovery.status).toBe('needs_higher_ceiling')
    const after = recalculateAfterMisses(challenge, '2027-05-09', 'r').recovery
    expect(after.status).toBe('impossible')
    expect(after.message).toContain('2027-05-08')
  })

  it('recovers inside the calculated period and keeps the exact target', () => {
    const result = recalculateAfterMisses(challenge, '2027-01-02', 'r')
    expect(result.recovery.status).toBe('ok')
    const live = result.challenge.days.filter((day) => day.status !== 'missed')
    expect(total(live.map((day) => day.amount))).toBe(50_000)
  })
})

describe('existing challenges are not recalculated', () => {
  it('the original default challenge still runs 2027-01-01 to 2027-06-30 (181 days)', () => {
    expect(DEFAULT_CHALLENGE_CONFIG).toMatchObject({ startDate: '2027-01-01', endDate: '2027-06-30', targetSek: 50_000 })
    const original = createChallenge('original')
    expect(original.days).toHaveLength(181)
    expect(original.config.endDate).toBe('2027-06-30')
  })

  it('a stored config is used exactly as stored: the duration helper never rewrites it', () => {
    const stored = createChallenge('stored', { ...DEFAULT_CHALLENGE_CONFIG, endDate: '2027-06-30' })
    const snapshot = JSON.stringify(stored)
    configForDuration(stored.config.startDate, 6)
    addMonths(stored.config.startDate, 6)
    expect(JSON.stringify(stored)).toBe(snapshot)
    expect(stored.config.endDate).toBe('2027-06-30')
  })
})
