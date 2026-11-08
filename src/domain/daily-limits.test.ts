import { describe, expect, it } from 'vitest'
import {
  CHALLENGE_LIMITS,
  DEFAULT_CHALLENGE_CONFIG,
  DEFAULT_DAILY_LIMITS,
  confirmDay,
  configForDuration,
  createChallenge,
  drawToday,
  recalculateAfterMisses,
  type ChallengeConfig,
} from './challenge'

const january = (overrides: Partial<ChallengeConfig> = {}): ChallengeConfig => ({
  targetSek: 6_000,
  startDate: '2027-01-01',
  endDate: '2027-01-31',
  initialMinimumSek: 100,
  preferredMaximumSek: 300,
  ...overrides,
})

const total = (amounts: number[]) => amounts.reduce((sum, amount) => sum + amount, 0)
const amountsOf = (challenge: { days: Array<{ amount: number }> }) => challenge.days.map((day) => day.amount)

describe('the default limits are 50-500 SEK', () => {
  it('are exposed as DEFAULT_DAILY_LIMITS and used when none are given', () => {
    expect(DEFAULT_DAILY_LIMITS).toEqual({ minimumSek: 50, maximumSek: 500 })
    const config = configForDuration('2026-11-08', 6)
    expect(config).toMatchObject({ initialMinimumSek: 50, preferredMaximumSek: 500 })
  })

  it('are stored in the config per challenge when custom limits are chosen', () => {
    const config = configForDuration('2026-11-08', 1, 6_000, { minimumSek: 100, maximumSek: 300 })
    expect(config).toEqual({ targetSek: 6_000, startDate: '2026-11-08', endDate: '2026-12-08', initialMinimumSek: 100, preferredMaximumSek: 300 })
    expect(createChallenge('stored', config).config).toEqual(config)
  })
})

describe('custom minimum and maximum', () => {
  // 31 days (January). target must lie between 31 x minimum and 31 x maximum.
  it.each([
    [1, 2, 50],
    [10, 20, 400],
    [200, 300, 7_750],
    [50, 500, 8_000],
    [7, 7, 217],
    [500, 500, 15_500],
    [1_000, 5_000, 100_000],
    [1, CHALLENGE_LIMITS.maxDailySek, 1_000_000],
  ])('limits %i-%i with target %i: every amount is a whole number inside the range and the total is exact', (minimum, maximum, target) => {
    for (let seed = 0; seed < 25; seed += 1) {
      const challenge = createChallenge(`limits-${seed}`, january({ targetSek: target, initialMinimumSek: minimum, preferredMaximumSek: maximum }))
      const amounts = amountsOf(challenge)
      expect(amounts).toHaveLength(31)
      expect(total(amounts)).toBe(target)
      expect(amounts.every((amount) => Number.isInteger(amount) && amount >= minimum && amount <= maximum)).toBe(true)
    }
  })

  it('gives every day the same amount when minimum equals maximum', () => {
    const amounts = amountsOf(createChallenge('flat', january({ targetSek: 31 * 120, initialMinimumSek: 120, preferredMaximumSek: 120 })))
    expect(new Set(amounts)).toEqual(new Set([120]))
  })

  it('uses the minimum every day when the target equals days x minimum, and the maximum every day when it equals days x maximum', () => {
    expect(new Set(amountsOf(createChallenge('lo', january({ targetSek: 31 * 100 }))))).toEqual(new Set([100]))
    expect(new Set(amountsOf(createChallenge('hi', january({ targetSek: 31 * 300 }))))).toEqual(new Set([300]))
  })

  it('actually uses the range: a wide range produces varied amounts', () => {
    const amounts = amountsOf(createChallenge('varied', january({ targetSek: 31 * 1_050, initialMinimumSek: 100, preferredMaximumSek: 2_000 })))
    expect(new Set(amounts).size).toBeGreaterThan(15)
  })

  it('is deterministic for a seed and different for different limits', () => {
    const a = amountsOf(createChallenge('same', january()))
    expect(amountsOf(createChallenge('same', january()))).toEqual(a)
    expect(amountsOf(createChallenge('same', january({ preferredMaximumSek: 400 })))).not.toEqual(a)
  })

  it('does not mutate the config it was given', () => {
    const config = january()
    const snapshot = JSON.stringify(config)
    createChallenge('pure', config)
    expect(JSON.stringify(config)).toBe(snapshot)
  })
})

describe('invalid limits are rejected', () => {
  const cases: Array<[string, Partial<ChallengeConfig>, string]> = [
    ['a minimum of zero', { initialMinimumSek: 0 }, 'configuration is invalid'],
    ['a negative minimum', { initialMinimumSek: -50 }, 'configuration is invalid'],
    ['a fractional minimum', { initialMinimumSek: 50.5 }, 'configuration is invalid'],
    ['a NaN minimum', { initialMinimumSek: Number.NaN }, 'configuration is invalid'],
    ['a maximum below the minimum', { preferredMaximumSek: 99 }, 'configuration is invalid'],
    ['a fractional maximum', { preferredMaximumSek: 300.5 }, 'configuration is invalid'],
    ['a minimum above the maximum', { initialMinimumSek: 600, preferredMaximumSek: 500 }, 'configuration is invalid'],
    ['a maximum above the supported limit', { preferredMaximumSek: CHALLENGE_LIMITS.maxDailySek + 1, targetSek: 300_000 }, 'above the supported maximum'],
    ['a target below days x minimum', { targetSek: 31 * 100 - 1 }, 'not achievable'],
    ['a target above days x maximum', { targetSek: 31 * 300 + 1 }, 'not achievable'],
  ]

  it.each(cases)('rejects %s', (_label, overrides, message) => {
    expect(() => createChallenge('bad', january(overrides))).toThrow(message)
  })
})

describe('recovery respects the challenge\'s own limits', () => {
  const challenge = createChallenge('recovery-limits', january())

  it('keeps every redistributed amount inside the chosen range and the total exact when enough days remain', () => {
    const result = recalculateAfterMisses(challenge, '2027-01-11', 'run')
    expect(result.recovery).toMatchObject({ status: 'ok', ceiling: 300 })
    const live = result.challenge.days.filter((day) => day.status !== 'missed')
    expect(total(live.map((day) => day.amount))).toBe(6_000)
    expect(live.every((day) => day.amount >= 100 && day.amount <= 300)).toBe(true)
  })

  it('raises the ceiling only as far as needed, says so, and NEVER changes the chosen maximum in the config', () => {
    const result = recalculateAfterMisses(challenge, '2027-01-16', 'run')
    expect(result.recovery).toMatchObject({ status: 'needs_higher_ceiling', ceiling: 375 })
    expect(result.recovery.message).toContain('300')
    expect(result.challenge.config).toEqual(challenge.config)
    expect(result.challenge.config.preferredMaximumSek).toBe(300)
    const recovered = result.challenge.days.filter((day) => day.date >= '2027-01-16')
    expect(recovered.every((day) => day.amount >= 100 && day.amount <= 375)).toBe(true)
    expect(total(recovered.map((day) => day.amount))).toBe(6_000)
  })

  it('never lowers an amount below the chosen minimum', () => {
    for (const today of ['2027-01-03', '2027-01-09', '2027-01-15', '2027-01-20', '2027-01-27']) {
      const result = recalculateAfterMisses(challenge, today, `seed-${today}`)
      const eligible = result.challenge.days.filter((day) => day.date >= today)
      expect(eligible.every((day) => day.amount >= 100)).toBe(true)
    }
  })

  it('reports impossible when the remaining days cannot absorb what is left at the chosen minimum, without touching anything', () => {
    const nearlyDone = {
      ...challenge,
      days: challenge.days.map((day, index) => (index < 20 ? { ...day, amount: 295, status: 'confirmed' as const } : day)),
    }
    const result = recalculateAfterMisses(nearlyDone, '2027-01-21', 'run')
    expect(result.recovery.status).toBe('impossible')
    expect(result.recovery.message).toContain('6000')
    expect(result.recovery.message).toContain('2027-01-31')
    expect(result.challenge.days).toEqual(nearlyDone.days)
  })

  it('reports impossible after the deadline and never extends it', () => {
    const result = recalculateAfterMisses(challenge, '2027-02-01', 'run')
    expect(result.recovery.status).toBe('impossible')
    expect(result.challenge.config.endDate).toBe('2027-01-31')
  })

  it('never changes confirmed or drawn amounts, whatever the limits', () => {
    const confirmed = confirmDay(drawToday(challenge, '2027-01-01'), '2027-01-01')
    const withFutureDraw = { ...confirmed, days: confirmed.days.map((day, index) => (index === 25 ? { ...day, status: 'drawn' as const } : day)) }
    const result = recalculateAfterMisses(withFutureDraw, '2027-01-10', 'run').challenge
    expect(result.days[0]).toEqual(confirmed.days[0])
    expect(result.days[25]).toEqual(withFutureDraw.days[25])
  })
})

describe('challenges with different limits stay independent', () => {
  const cheap = createChallenge('cheap', january({ targetSek: 31 * 55, initialMinimumSek: 50, preferredMaximumSek: 60 }), 'cheap')
  const large = createChallenge('large', january({ targetSek: 31 * 450, initialMinimumSek: 400, preferredMaximumSek: 500 }), 'large')

  it('each keeps its own range and total', () => {
    expect(amountsOf(cheap).every((amount) => amount >= 50 && amount <= 60)).toBe(true)
    expect(amountsOf(large).every((amount) => amount >= 400 && amount <= 500)).toBe(true)
    expect(total(amountsOf(cheap))).toBe(31 * 55)
    expect(total(amountsOf(large))).toBe(31 * 450)
  })

  it('recovering one never changes the other', () => {
    const before = JSON.stringify(large)
    const result = recalculateAfterMisses(cheap, '2027-01-12', 'run').challenge
    expect(result.days.filter((day) => day.date >= '2027-01-12').every((day) => day.amount >= 50)).toBe(true)
    expect(JSON.stringify(large)).toBe(before)
  })
})

describe('existing challenges keep their original behaviour', () => {
  it('produces exactly the amounts the first release produced for the default limits', () => {
    // Golden values captured from the released version (commit 60360ef): the allocation algorithm must never change.
    const golden = {
      'golden-seed': { first: [74, 51, 95, 387, 178, 417, 79, 405], last: [88, 199, 210] },
      'same-seed': { first: [108, 235, 255, 362, 193, 380, 453, 498], last: [156, 498, 475] },
      '2027': { first: [306, 157, 59, 132, 213, 73, 359, 397], last: [261, 383, 326] },
    }
    for (const [seed, expected] of Object.entries(golden)) {
      const amounts = amountsOf(createChallenge(seed))
      expect(amounts.slice(0, 8)).toEqual(expected.first)
      expect(amounts.slice(-3)).toEqual(expected.last)
      expect(total(amounts)).toBe(50_000)
    }
  })

  it('an explicit 50-500 config equals the implicit default', () => {
    expect(amountsOf(createChallenge('same-seed', { ...DEFAULT_CHALLENGE_CONFIG, initialMinimumSek: 50, preferredMaximumSek: 500 }))).toEqual(amountsOf(createChallenge('same-seed')))
  })
})
