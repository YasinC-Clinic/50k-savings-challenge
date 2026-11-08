import { describe, expect, it } from 'vitest'
import {
  confirmDay,
  createChallenge,
  drawToday,
  recalculateAfterMisses,
  type Challenge,
  type ChallengeConfig,
} from '../domain/challenge'
import { getChallengeStatus, getDashboard, getMonthlyHistory, millisecondsUntilStockholmMidnight, shouldRecover } from './savings-view'

const january: ChallengeConfig = { targetSek: 10_000, startDate: '2027-01-01', endDate: '2027-01-31', initialMinimumSek: 50, preferredMaximumSek: 500 }
const startedToday: ChallengeConfig = { targetSek: 20_000, startDate: '2026-11-08', endDate: '2027-06-30', initialMinimumSek: 50, preferredMaximumSek: 500 }

describe('dashboard uses the configuration of THE challenge, not the 2027 defaults', () => {
  const challenge = createChallenge('view-custom', startedToday)

  it('reports target, dates, length and remaining days from the config', () => {
    const dashboard = getDashboard(challenge, '2026-11-08')
    expect(dashboard).toMatchObject({ targetSek: 20_000, startDate: '2026-11-08', endDate: '2027-06-30', totalDays: 235, dayNumber: 1, status: 'active', daysRemaining: 235 })
    expect(dashboard.remainingSek).toBe(20_000)
  })

  it('counts days relative to the challenge start, not 1 January 2027', () => {
    expect(getDashboard(challenge, '2026-12-01')).toMatchObject({ dayNumber: 24, daysRemaining: 212 })
  })

  it('is upcoming before its own start date and finished after its own end date', () => {
    expect(getDashboard(challenge, '2026-11-07')).toMatchObject({ status: 'upcoming', dayNumber: null, daysRemaining: 235 })
    expect(getDashboard(challenge, '2027-07-01')).toMatchObject({ status: 'finished', dayNumber: null, daysRemaining: 0 })
    expect(getChallengeStatus(challenge, '2027-06-30')).toBe('active')
  })

  it('computes progress and remaining against its own target', () => {
    const confirmed = confirmDay(drawToday(challenge, '2026-11-08'), '2026-11-08')
    const amount = confirmed.days[0].amount
    const dashboard = getDashboard(confirmed, '2026-11-08')
    expect(dashboard.savedSek).toBe(amount)
    expect(dashboard.remainingSek).toBe(20_000 - amount)
    expect(dashboard.progressPercent).toBe(Math.round((amount / 20_000) * 1000) / 10)
  })

  it('never lets progress exceed 100 percent', () => {
    const all = { ...challenge, days: challenge.days.map((day) => ({ ...day, status: 'confirmed' as const })) }
    expect(getDashboard(all, '2027-07-01')).toMatchObject({ progressPercent: 100, remainingSek: 0 })
  })
})

describe('only confirmed savings count', () => {
  it('shows a drawn amount as pending and keeps it out of the saved total', () => {
    const drawn = drawToday(createChallenge('pending', january), '2027-01-05')
    const dashboard = getDashboard(drawn, '2027-01-05')
    expect(dashboard.savedSek).toBe(0)
    expect(dashboard.pendingSek).toBe(drawn.days[4].amount)
    expect(dashboard.missedDays).toBe(4)
  })

  it('does not count missed days as saved and reports them', () => {
    const missed = recalculateAfterMisses(createChallenge('missed', january), '2027-01-11', 'r').challenge
    expect(getDashboard(missed, '2027-01-11')).toMatchObject({ savedSek: 0, missedDays: 10, confirmedDays: 0 })
  })
})

describe('plan status is derived from the stored days', () => {
  const base = createChallenge('plan', january)

  it('is on track for an untouched challenge', () => {
    expect(getDashboard(base, '2027-01-01').plan).toEqual({ kind: 'on-track' })
  })

  it('announces a raised ceiling when recovery needed more than the preferred maximum', () => {
    const recovered = recalculateAfterMisses(base, '2027-01-16', 'run').challenge
    expect(getDashboard(recovered, '2027-01-16').plan).toEqual({ kind: 'raised-ceiling', ceilingSek: 625, preferredMaximumSek: 500 })
  })

  it('reports an unreachable target when the live plan no longer adds up', () => {
    const lost: Challenge = { ...base, days: base.days.map((day, index) => (index === 0 ? { ...day, status: 'missed' as const } : day)) }
    const dashboard = getDashboard(lost, '2027-01-02')
    expect(dashboard.plan).toEqual({ kind: 'unreachable', unplannedSek: base.days[0].amount })
  })

  it('reports an ended challenge that fell short without extending the deadline', () => {
    const dashboard = getDashboard(base, '2027-02-01')
    expect(dashboard.status).toBe('finished')
    expect(dashboard.plan).toEqual({ kind: 'ended-short', shortfallSek: 10_000 })
  })

  it('reports completion once everything is confirmed', () => {
    const done = { ...base, days: base.days.map((day) => ({ ...day, status: 'confirmed' as const })) }
    expect(getDashboard(done, '2027-02-01').plan).toEqual({ kind: 'completed' })
  })
})

describe('monthly history and recovery trigger', () => {
  it('groups a mid-month start by month with Swedish labels and hides undrawn amounts', () => {
    const challenge = createChallenge('history', startedToday)
    const months = getMonthlyHistory(challenge)
    expect(months[0].key).toBe('2026-11')
    expect(months[0].label).toBe('november 2026')
    expect(months[0].entries).toHaveLength(23)
    expect(months.at(-1)?.key).toBe('2027-06')
    expect(months.flatMap((month) => month.entries).every((entry) => entry.amount === null)).toBe(true)
  })

  it('never asks for recovery before the challenge has started', () => {
    expect(shouldRecover(createChallenge('r1', january), '2026-12-31')).toBe(false)
  })

  it('asks for recovery only when an earlier day is unresolved, for any configuration', () => {
    const challenge = createChallenge('r2', startedToday)
    expect(shouldRecover(challenge, '2026-11-08')).toBe(false)
    expect(shouldRecover(challenge, '2026-11-09')).toBe(true)
    const resolved = recalculateAfterMisses(challenge, '2026-11-09', 'x').challenge
    expect(shouldRecover(resolved, '2026-11-09')).toBe(false)
  })
})

describe('time until the Stockholm midnight', () => {
  it('is measured in Stockholm time, not UTC', () => {
    expect(millisecondsUntilStockholmMidnight(new Date('2027-01-01T22:00:00Z'))).toBe(3_600_000 + 100)
    expect(millisecondsUntilStockholmMidnight(new Date('2027-06-30T21:00:00Z'))).toBe(3_600_000 + 100)
  })

  it('is exact to the millisecond, even half a second before midnight', () => {
    expect(millisecondsUntilStockholmMidnight(new Date('2027-01-01T22:59:59.500Z'))).toBe(500 + 100)
  })

  it('handles the 23-hour and 25-hour days around daylight saving', () => {
    expect(millisecondsUntilStockholmMidnight(new Date('2027-03-27T23:00:00Z'))).toBe(23 * 3_600_000 + 100)
    expect(millisecondsUntilStockholmMidnight(new Date('2027-10-30T22:00:00Z'))).toBe(25 * 3_600_000 + 100)
  })
})
