import { describe, expect, it } from 'vitest'
import { confirmDay, createChallenge, drawToday } from '../domain/challenge'
import { getDashboard, getMonthlyHistory, shouldRecover } from './savings-view'

describe('dashboard view model', () => {
  it('counts only confirmed savings and calculates progress', () => {
    const drawn = drawToday(createChallenge('view'), '2027-01-01')
    const confirmed = confirmDay(drawn, '2027-01-01')
    const dashboard = getDashboard(confirmed, '2027-01-01')
    expect(dashboard.savedSek).toBe(confirmed.days[0].amount)
    expect(dashboard.remainingSek).toBe(50_000 - confirmed.days[0].amount)
    expect(dashboard.progressPercent).toBeGreaterThan(0)
    expect(dashboard.daysCompleted).toBe(1)
  })

  it('never includes undrawn future values in monthly history', () => {
    const challenge = confirmDay(drawToday(createChallenge('history'), '2027-01-01'), '2027-01-01')
    const january = getMonthlyHistory(challenge).find((month) => month.key === '2027-01')
    expect(january?.confirmedSek).toBe(challenge.days[0].amount)
    expect(january?.entries.find((entry) => entry.date === '2027-01-02')?.amount).toBeNull()
  })

  it('requests recovery only when a prior entry is unresolved', () => {
    const challenge = createChallenge('recovery-check')
    expect(shouldRecover(challenge, '2027-01-01')).toBe(false)
    expect(shouldRecover(challenge, '2027-01-02')).toBe(true)
  })
})
