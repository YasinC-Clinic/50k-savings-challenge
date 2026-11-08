import { describe, expect, it } from 'vitest'
import {
  CHALLENGE,
  confirmDay,
  createChallenge,
  drawToday,
  getDayPresentation,
  listChallengeDates,
  recalculateAfterMisses,
} from './challenge'

describe('challenge dates', () => {
  it('creates exactly the inclusive Sweden-local challenge dates', () => {
    const dates = listChallengeDates()
    expect(dates).toHaveLength(181)
    expect(dates[0]).toBe('2027-01-01')
    expect(dates.at(-1)).toBe('2027-06-30')
  })
})

describe('initial allocation', () => {
  it('creates 181 integer amounts totalling exactly 50,000 SEK inside the initial range', () => {
    const challenge = createChallenge('same-seed')
    const amounts = challenge.days.map((day) => day.amount)
    expect(amounts).toHaveLength(CHALLENGE.durationDays)
    expect(amounts.reduce((total, amount) => total + amount, 0)).toBe(CHALLENGE.targetSek)
    expect(amounts.every((amount) => Number.isInteger(amount) && amount >= 50 && amount <= 500)).toBe(true)
  })

  it('is deterministic for the same seed and varies for a different seed', () => {
    expect(createChallenge('same-seed').days.map((day) => day.amount)).toEqual(createChallenge('same-seed').days.map((day) => day.amount))
    expect(createChallenge('same-seed').days.map((day) => day.amount)).not.toEqual(createChallenge('other-seed').days.map((day) => day.amount))
  })
})

describe('daily presentation and ledger', () => {
  it('does not disclose a future undrawn amount', () => {
    const challenge = createChallenge('private')
    expect(getDayPresentation(challenge, '2027-01-02')).toEqual({ date: '2027-01-02', status: 'undrawn', amount: null })
  })

  it('keeps a drawn amount fixed and rejects a date outside the challenge', () => {
    const challenge = createChallenge('draw')
    const drawn = drawToday(challenge, '2027-01-01')
    const original = challenge.days[0].amount
    expect(drawn.days[0]).toMatchObject({ date: '2027-01-01', status: 'drawn', amount: original })
    expect(() => drawToday(challenge, '2026-12-31')).toThrow('outside the challenge')
  })

  it('rejects an attempt to reveal a future amount early', () => {
    expect(() => drawToday(createChallenge('future-draw'), '2027-01-01', '2027-01-02')).toThrow('Only the current challenge date')
  })

  it('confirms a drawn amount once and rejects a duplicate confirmation', () => {
    const drawn = drawToday(createChallenge('confirm'), '2027-01-01')
    const confirmed = confirmDay(drawn, '2027-01-01')
    expect(confirmed.days[0].status).toBe('confirmed')
    expect(confirmed.days[0].amount).toBe(drawn.days[0].amount)
    expect(() => confirmDay(confirmed, '2027-01-01')).toThrow('already confirmed')
  })
})

describe('missed-day recovery', () => {
  it('marks earlier unconfirmed days missed and redistributes only future undrawn amounts', () => {
    const original = confirmDay(drawToday(createChallenge('recovery'), '2027-01-01'), '2027-01-01')
    const beforeConfirmed = original.days[0].amount
    const result = recalculateAfterMisses(original, '2027-01-03', 'recovery-run')
    expect(result.challenge.days[0]).toMatchObject({ status: 'confirmed', amount: beforeConfirmed })
    expect(result.challenge.days[1].status).toBe('missed')
    expect(result.recovery.status).toBe('ok')
    expect(result.challenge.days.filter((day) => day.status !== 'missed').reduce((total, day) => total + day.amount, 0)).toBe(CHALLENGE.targetSek)
  })

  it('raises the future ceiling only when the preferred ceiling cannot recover the target', () => {
    const result = recalculateAfterMisses(createChallenge('high-ceiling'), '2027-06-28', 'late-recovery')
    expect(result.recovery).toMatchObject({ status: 'needs_higher_ceiling', ceiling: 16_667 })
    expect(result.challenge.days.filter((day) => day.date >= '2027-06-28').every((day) => day.amount > 500)).toBe(true)
  })

  it('keeps the final date eligible through 30 June', () => {
    const result = recalculateAfterMisses(createChallenge('final-day'), '2027-06-30', 'final-day-recovery')
    expect(result.recovery).toMatchObject({ status: 'needs_higher_ceiling', ceiling: 50_000 })
  })

  it('returns an honest impossible status after the final eligible date', () => {
    const result = recalculateAfterMisses(createChallenge('impossible'), '2027-07-01', 'too-late')
    expect(result.recovery.status).toBe('impossible')
    expect(result.recovery.message).toMatch(/cannot be reached/i)
  })

  it('does not change an already revealed future amount during recalculation', () => {
    const challenge = createChallenge('fixed-draw')
    const withFutureDrawn = { ...challenge, days: challenge.days.map((day, index) => index === 10 ? { ...day, status: 'drawn' as const } : day) }
    const result = recalculateAfterMisses(withFutureDrawn, '2027-01-03', 'fixed-run')
    expect(result.challenge.days[10]).toEqual(withFutureDrawn.days[10])
  })
})
