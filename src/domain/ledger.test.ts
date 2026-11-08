import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHALLENGE_CONFIG,
  createChallenge,
  dynamicBounds,
  recalculateAfterMisses,
  type Challenge,
  type ChallengeConfig,
} from './challenge'
import {
  acceptShockDay,
  catchUpDates,
  catchUpRange,
  confirmedSavingsSek,
  drawCatchUpAmount,
  isCompleted,
  penalisableDates,
  penaltyOreFor,
  penaltyTotals,
  planPenalties,
  proposeShockAmount,
  rebalanceUpcoming,
  remainingTargetOre,
  shockDates,
  shockRange,
  type CatchUpEntry,
  type PenaltyEntry,
  type PenaltyPayment,
} from './ledger'

const NOW = '2027-01-10T10:00:00.000Z'
const total = (amounts: number[]) => amounts.reduce((sum, amount) => sum + amount, 0)
const catchUp = (challengeId: string, date: string, amount: number, status: 'drawn' | 'confirmed'): CatchUpEntry => ({
  challengeId,
  date,
  amount,
  status,
  drawnAt: NOW,
  ...(status === 'confirmed' ? { confirmedAt: NOW } : {}),
})

describe('3% penalty, exact to the öre', () => {
  it('reproduces the mandatory example: target 2,000, saved 200, three missed days = 157.19 SEK', () => {
    const entries = planPenalties({ challengeId: 'c', remainingOre: 180_000, existing: [], missedDates: ['2027-01-03', '2027-01-01', '2027-01-02'], accruedAt: NOW })
    expect(entries.map((entry) => [entry.date, entry.baseOre, entry.amountOre])).toEqual([
      ['2027-01-01', 180_000, 5_400],
      ['2027-01-02', 174_600, 5_238],
      ['2027-01-03', 169_362, 5_081],
    ])
    expect(total(entries.map((entry) => entry.amountOre))).toBe(15_719)
  })

  it('rounds half up to the öre with integer arithmetic', () => {
    expect(penaltyOreFor(169_362)).toBe(5_081)
    expect(penaltyOreFor(50)).toBe(2)
    expect(penaltyOreFor(49)).toBe(1)
    expect(penaltyOreFor(16)).toBe(0)
    for (let base = 0; base < 5_000; base += 7) expect(BigInt(penaltyOreFor(base))).toBe((BigInt(base) * 3n + 50n) / 100n)
  })

  it('charges a date only once, however often it is planned', () => {
    const first = planPenalties({ challengeId: 'c', remainingOre: 180_000, existing: [], missedDates: ['2027-01-01', '2027-01-02'], accruedAt: NOW })
    expect(planPenalties({ challengeId: 'c', remainingOre: 180_000, existing: first, missedDates: ['2027-01-01', '2027-01-02'], accruedAt: NOW })).toEqual([])
    expect(planPenalties({ challengeId: 'c', remainingOre: 180_000, existing: [], missedDates: ['2027-01-01', '2027-01-01'], accruedAt: NOW })).toHaveLength(1)
  })

  it('carries the shrinking base forward when more missed days are found later', () => {
    const first = planPenalties({ challengeId: 'c', remainingOre: 180_000, existing: [], missedDates: ['2027-01-01', '2027-01-02', '2027-01-03'], accruedAt: NOW })
    const later = planPenalties({ challengeId: 'c', remainingOre: 180_000, existing: first, missedDates: ['2027-01-04'], accruedAt: NOW })
    expect(later.map((entry) => [entry.baseOre, entry.amountOre])).toEqual([[164_281, 4_928]])
  })

  it('never lets the base exceed what is still missing from the target (documented edge rule)', () => {
    const first = planPenalties({ challengeId: 'c', remainingOre: 180_000, existing: [], missedDates: ['2027-01-01'], accruedAt: NOW })
    const later = planPenalties({ challengeId: 'c', remainingOre: 100_000, existing: first, missedDates: ['2027-01-02'], accruedAt: NOW })
    expect(later[0]).toMatchObject({ baseOre: 100_000, amountOre: 3_000 })
  })

  it('charges nothing once the target is reached (nothing remaining)', () => {
    expect(planPenalties({ challengeId: 'c', remainingOre: 0, existing: [], missedDates: ['2027-01-01'], accruedAt: NOW })).toEqual([])
  })

  it('only penalises days missed on or after the day the feature started (history is never charged retroactively)', () => {
    const challenge = createChallenge('grandfather', { ...DEFAULT_CHALLENGE_CONFIG, startDate: '2027-01-01', endDate: '2027-01-31', targetSek: 6_000 })
    const missed = recalculateAfterMisses(challenge, '2027-01-06', 'r').challenge
    expect(penalisableDates(missed, '2027-01-01')).toHaveLength(5)
    expect(penalisableDates(missed, '2027-01-04')).toEqual(['2027-01-04', '2027-01-05'])
    expect(penalisableDates(missed, '2027-02-01')).toEqual([])
  })
})

describe('the penalty pot is separate from the ordinary savings', () => {
  const challenge = createChallenge('separate', { ...DEFAULT_CHALLENGE_CONFIG, startDate: '2027-01-01', endDate: '2027-01-31', targetSek: 2_000, initialMinimumSek: 20, preferredMaximumSek: 120 }, 'c1')
  const confirmed: Challenge = { ...challenge, days: challenge.days.map((day, index) => (index === 0 ? { ...day, amount: 200, status: 'confirmed' as const } : day)) }
  const penalty = (id: string, date: string, amountOre: number): PenaltyEntry => ({ challengeId: id, date, amountOre, baseOre: 0, accruedAt: NOW })
  const paid = (id: string, challengeId: string, amountOre: number): PenaltyPayment => ({ id, challengeId, amountOre, paidAt: NOW })

  it('counts only confirmed entries as saved and keeps the target at 1,800 remaining while penalties accrue', () => {
    const penalties = [penalty('c1', '2027-01-02', 5_400), penalty('c1', '2027-01-03', 5_238), penalty('c1', '2027-01-04', 5_081)]
    expect(confirmedSavingsSek(confirmed, [])).toBe(200)
    expect(remainingTargetOre(confirmed, [])).toBe(180_000)
    expect(penaltyTotals(penalties, [], 'c1').accruedOre).toBe(15_719)
    expect(remainingTargetOre(confirmed, [])).toBe(180_000)
    expect(isCompleted(confirmed, [])).toBe(false)
  })

  it('does not count drawn days or drawn catch-ups as saved', () => {
    const drawn = { ...confirmed, days: confirmed.days.map((day, index) => (index === 1 ? { ...day, status: 'drawn' as const } : day)) }
    expect(confirmedSavingsSek(drawn, [catchUp('c1', '2027-01-05', 90, 'drawn')])).toBe(200)
    expect(confirmedSavingsSek(drawn, [catchUp('c1', '2027-01-05', 90, 'confirmed')])).toBe(290)
  })

  it('tracks accrued, paid and outstanding, per challenge and for the permanent pot of all challenges', () => {
    const penalties = [penalty('c1', '2027-01-02', 5_400), penalty('c1', '2027-01-03', 5_238), penalty('c2', '2027-03-02', 1_000)]
    const payments = [paid('p1', 'c1', 5_400)]
    expect(penaltyTotals(penalties, payments, 'c1')).toEqual({ accruedOre: 10_638, paidOre: 5_400, outstandingOre: 5_238 })
    expect(penaltyTotals(penalties, payments, 'c2')).toEqual({ accruedOre: 1_000, paidOre: 0, outstandingOre: 1_000 })
    expect(penaltyTotals(penalties, payments)).toEqual({ accruedOre: 11_638, paidOre: 5_400, outstandingOre: 6_238 })
  })
})

describe('dynamic daily range', () => {
  it.each([
    [10_000, 55, 98],
    [25_000, 137, 247],
    [50_000, 275, 495],
    [100_000, 549, 989],
  ])('target %i over 182 days scales with the actual need (average about %i)', (target, average, maximum) => {
    const { minimumSek, maximumSek } = dynamicBounds(target, 182)
    expect(Math.abs(target / 182 - average)).toBeLessThan(2)
    expect(maximumSek).toBeGreaterThan(maximum - 3)
    expect(maximumSek).toBeLessThan(maximum + 3)
    expect(minimumSek).toBeLessThan(target / 182)
    expect(minimumSek * 182).toBeLessThanOrEqual(target)
    expect(maximumSek * 182).toBeGreaterThanOrEqual(target)
  })

  it('always keeps the target achievable, for short, long and leap-year periods', () => {
    for (const [target, days] of [[500, 5], [1_000, 2], [50_000, 29], [50_000, 30], [123_457, 366], [9_999_999, 1_096], [31, 31]] as const) {
      const { minimumSek, maximumSek } = dynamicBounds(target, days)
      expect(minimumSek).toBeGreaterThanOrEqual(1)
      expect(minimumSek * days).toBeLessThanOrEqual(target)
      expect(maximumSek * days).toBeGreaterThanOrEqual(target)
    }
  })

  const config = (): ChallengeConfig => ({ ...DEFAULT_CHALLENGE_CONFIG, startDate: '2027-01-01', endDate: '2027-06-30', targetSek: 10_000, ...dynamicLimits(), dynamicRange: true })
  function dynamicLimits() {
    const { minimumSek, maximumSek } = dynamicBounds(10_000, 181)
    return { initialMinimumSek: minimumSek, preferredMaximumSek: maximumSek }
  }

  it('re-derives the range from what is left and keeps the total exact', () => {
    const challenge = createChallenge('dynamic', config())
    const result = recalculateAfterMisses(challenge, '2027-03-01', 'run')
    const live = result.challenge.days.filter((day) => day.status !== 'missed')
    expect(total(live.map((day) => day.amount))).toBe(10_000)
    const eligible = result.challenge.days.filter((day) => day.date >= '2027-03-01')
    const { minimumSek, maximumSek } = dynamicBounds(10_000, eligible.length)
    expect(eligible.every((day) => day.amount >= minimumSek && day.amount <= maximumSek)).toBe(true)
    expect(result.recovery.status).toBe('ok')
  })

  it('leaves a fixed-range challenge exactly as before (no dynamic flag, original limits)', () => {
    const fixed = createChallenge('fixed', { ...DEFAULT_CHALLENGE_CONFIG, startDate: '2027-01-01', endDate: '2027-01-31', targetSek: 6_000 })
    const result = recalculateAfterMisses(fixed, '2027-01-11', 'run')
    expect(fixed.config.dynamicRange).toBeUndefined()
    expect(result.challenge.days.filter((day) => day.date >= '2027-01-11').every((day) => day.amount >= 50)).toBe(true)
  })
})

describe('catch-up', () => {
  const base = (): Challenge => {
    const challenge = createChallenge('catch', { ...DEFAULT_CHALLENGE_CONFIG, startDate: '2027-01-01', endDate: '2027-01-31', targetSek: 6_000, initialMinimumSek: 100, preferredMaximumSek: 300 }, 'c')
    return recalculateAfterMisses(challenge, '2027-01-04', 'run').challenge
  }

  it('finds each missed date exactly once, oldest first, whatever the number of app launches', () => {
    const challenge = base()
    expect(catchUpDates(challenge, [])).toEqual(['2027-01-01', '2027-01-02', '2027-01-03'])
    expect(catchUpDates(challenge, [])).toEqual(['2027-01-01', '2027-01-02', '2027-01-03'])
    expect(catchUpDates(challenge, [catchUp('c', '2027-01-01', 150, 'confirmed')])).toEqual(['2027-01-02', '2027-01-03'])
    expect(catchUpDates(challenge, [catchUp('c', '2027-01-01', 150, 'drawn')])).toHaveLength(3)
  })

  it('gives every missed day its own amount inside the challenge range, never a combined one', () => {
    const challenge = base()
    const amounts = ['2027-01-01', '2027-01-02', '2027-01-03'].map((date) => drawCatchUpAmount(challenge, '2027-01-04', [], date))
    expect(amounts.every((amount) => amount !== null && amount >= 100 && amount <= 300)).toBe(true)
    expect(drawCatchUpAmount(challenge, '2027-01-04', [], '2027-01-01')).toBe(amounts[0])
  })

  it('keeps the target achievable after each confirmed catch-up (upcoming days re-spread to the exact total)', () => {
    let challenge = base()
    const entries: CatchUpEntry[] = []
    for (const date of catchUpDates(challenge, [])) {
      const amount = drawCatchUpAmount(challenge, '2027-01-04', entries, date)!
      entries.push(catchUp('c', date, amount, 'confirmed'))
      challenge = rebalanceUpcoming(challenge, '2027-01-04', entries, 'seed')
    }
    const live = challenge.days.filter((day) => day.status !== 'missed')
    expect(total(live.map((day) => day.amount)) + total(entries.map((entry) => entry.amount))).toBe(6_000)
    expect(live.filter((day) => day.date >= '2027-01-04').every((day) => day.amount >= 100)).toBe(true)
  })

  it('has no room after the deadline: it never extends the challenge', () => {
    expect(catchUpRange(base(), '2027-02-01', [])).toBeNull()
    expect(drawCatchUpAmount(base(), '2027-02-01', [], '2027-01-01')).toBeNull()
  })
})

describe('Shock Days', () => {
  const challenge = (seed = 'shock-seed') =>
    createChallenge(seed, { ...DEFAULT_CHALLENGE_CONFIG, startDate: '2027-01-01', endDate: '2027-06-30', targetSek: 50_000, shockDays: true }, 'c')

  it('are off unless the challenge opted in', () => {
    const optedOut = createChallenge('shock-seed', { ...DEFAULT_CHALLENGE_CONFIG, startDate: '2027-01-01', endDate: '2027-06-30', targetSek: 50_000 }, 'c')
    const [shock] = [...shockDates(optedOut)].sort()
    expect(shockRange(optedOut, shock, [])).toBeNull()
  })

  it('are occasional, deterministic, spread out, and never at the very start or end', () => {
    const c = challenge()
    const dates = [...shockDates(c)].sort()
    expect(dates.length).toBeGreaterThan(5)
    expect(dates.length).toBeLessThan(40)
    expect([...shockDates(c)].sort()).toEqual(dates)
    const indexes = dates.map((date) => c.days.findIndex((day) => day.date === date))
    indexes.slice(1).forEach((index, position) => expect(index - indexes[position]).toBeGreaterThanOrEqual(8))
    expect(indexes[0]).toBeGreaterThanOrEqual(2)
    expect(indexes.at(-1)!).toBeLessThan(c.days.length - 3)
  })

  it('offer a clearly higher, feasible range only on a Shock Day', () => {
    const c = challenge()
    const [shock] = [...shockDates(c)].sort()
    const range = shockRange(c, shock, [])!
    expect(range.minimumSek).toBeGreaterThanOrEqual(Math.ceil(500 * 1.25))
    expect(range.maximumSek).toBeLessThanOrEqual(1_250)
    const normal = c.days.find((day) => !shockDates(c).has(day.date))!.date
    expect(shockRange(c, normal, [])).toBeNull()
  })

  it('rerolls without ever repeating the previous amount, and stays inside the range', () => {
    const range = { minimumSek: 625, maximumSek: 1_250 }
    let previous: number | null = null
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const amount = proposeShockAmount(range, previous, 'seed', attempt)
      expect(amount).toBeGreaterThanOrEqual(625)
      expect(amount).toBeLessThanOrEqual(1_250)
      expect(amount).not.toBe(previous)
      previous = amount
    }
    expect(proposeShockAmount({ minimumSek: 700, maximumSek: 700 }, 700, 'seed', 1)).toBe(700)
    expect(proposeShockAmount({ minimumSek: 700, maximumSek: 701 }, 700, 'seed', 1)).toBe(701)
  })

  it('declining changes nothing; accepting draws today (not saved) and keeps the exact total', () => {
    const c = challenge()
    const [shock] = [...shockDates(c)].sort()
    const before = JSON.stringify(c)
    const amount = proposeShockAmount(shockRange(c, shock, [])!, null, 'seed', 0)
    expect(JSON.stringify(c)).toBe(before)

    const accepted = acceptShockDay(c, shock, amount, [], 'seed')
    const day = accepted.days.find((entry) => entry.date === shock)!
    expect(day).toMatchObject({ status: 'drawn', amount })
    expect(confirmedSavingsSek(accepted, [])).toBe(0)
    // Days before the Shock Day that were never drawn count as missed; everything else still adds up exactly.
    expect(total(accepted.days.filter((entry) => entry.status !== 'missed').map((entry) => entry.amount))).toBe(50_000)
  })

  it('rejects an amount outside the offered range', () => {
    const c = challenge()
    const [shock] = [...shockDates(c)].sort()
    expect(() => acceptShockDay(c, shock, 51, [], 'seed')).toThrow('not a valid Shock Day')
    expect(() => acceptShockDay(c, shock, 99_999, [], 'seed')).toThrow('not a valid Shock Day')
  })
})
