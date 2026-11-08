import { describe, expect, it } from 'vitest'
import { CHALLENGE_LIMITS, DEFAULT_DURATION_MONTHS, DURATION_MONTH_OPTIONS } from '../domain/challenge'
import { stockholmDateKey } from '../app/savings-view'
import { defaultForm, durationLabel, parseTarget, planFor, validateForm, type ChallengeForm } from './create-challenge-form'

const TODAY = '2026-11-08'
const form = (overrides: Partial<ChallengeForm> = {}): ChallengeForm => ({ name: 'Min utmaning', target: '50000', months: 6, ...overrides })

describe('defaults', () => {
  it('selects six months and 50,000 SEK', () => {
    expect(defaultForm(0)).toEqual({ name: 'Utmaning 1', target: '50000', months: 6 })
    expect(defaultForm(0).months).toBe(DEFAULT_DURATION_MONTHS)
  })

  it('numbers the default name after the challenges that already exist', () => {
    expect(defaultForm(2).name).toBe('Utmaning 3')
  })
})

describe('duration labels', () => {
  it('uses the Swedish singular for one month and plural otherwise', () => {
    expect(DURATION_MONTH_OPTIONS.map(durationLabel)).toEqual([
      '1 månad',
      '2 månader',
      '3 månader',
      '4 månader',
      '5 månader',
      '6 månader',
      '9 månader',
      '12 månader',
    ])
  })
})

describe('the plan is calculated from today, never typed', () => {
  it('starts today and ends after the chosen number of months', () => {
    expect(planFor(TODAY, 6)).toEqual({ startDate: '2026-11-08', endDate: '2027-05-08', dayCount: 182 })
    expect(planFor(TODAY, 1)).toEqual({ startDate: '2026-11-08', endDate: '2026-12-08', dayCount: 31 })
    expect(planFor(TODAY, 12)).toEqual({ startDate: '2026-11-08', endDate: '2027-11-08', dayCount: 366 })
  })

  it('handles month ends and leap years', () => {
    expect(planFor('2027-01-31', 1)).toEqual({ startDate: '2027-01-31', endDate: '2027-02-28', dayCount: 29 })
    expect(planFor('2028-01-31', 1)).toEqual({ startDate: '2028-01-31', endDate: '2028-02-29', dayCount: 30 })
    expect(planFor('2027-03-31', 1)).toEqual({ startDate: '2027-03-31', endDate: '2027-04-30', dayCount: 31 })
  })

  it('uses the Stockholm date as the start, not the UTC date', () => {
    // 23:30 UTC on 8 November is already 00:30 on 9 November in Stockholm.
    const stockholmToday = stockholmDateKey(new Date('2026-11-08T23:30:00Z'))
    expect(stockholmToday).toBe('2026-11-09')
    expect(planFor(stockholmToday, 6).startDate).toBe('2026-11-09')
    expect(planFor(stockholmToday, 6).endDate).toBe('2027-05-09')
    // And in summer time, 22:30 UTC is already the next day.
    expect(planFor(stockholmDateKey(new Date('2027-06-30T22:30:00Z')), 1).startDate).toBe('2027-07-01')
  })

  it('does not shift dates across the daylight-saving changes', () => {
    expect(planFor('2027-03-28', 1).endDate).toBe('2027-04-28')
    expect(planFor('2027-10-31', 1).endDate).toBe('2027-11-30')
  })
})

describe('a valid form', () => {
  it('creates a config that starts today and lasts six months', () => {
    const result = validateForm(form(), TODAY)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.config).toEqual({ targetSek: 50_000, startDate: TODAY, endDate: '2027-05-08', initialMinimumSek: 50, preferredMaximumSek: 500 })
    expect(result.value.plan.dayCount).toBe(182)
    expect(result.value.averagePerDay).toBe(275)
  })

  it.each([4, 5, 6, 9, 12])('accepts 50,000 SEK over %i months', (months) => {
    expect(validateForm(form({ months }), TODAY).ok).toBe(true)
  })

  it('accepts spaces and a kr suffix in the target, and trims the name', () => {
    const result = validateForm(form({ target: '30 000 kr', name: '  Semester  ' }), TODAY)
    expect(result.ok && result.value.config.targetSek).toBe(30_000)
    expect(result.ok && result.value.name).toBe('Semester')
  })

  it('accepts exactly the lowest and highest reachable targets for the period', () => {
    expect(validateForm(form({ months: 1, target: String(31 * 50) }), TODAY).ok).toBe(true)
    expect(validateForm(form({ months: 1, target: String(31 * 500) }), TODAY).ok).toBe(true)
  })
})

describe('validation messages (Swedish)', () => {
  const errorsOf = (overrides: Partial<ChallengeForm>) => {
    const result = validateForm(form(overrides), TODAY)
    return result.ok ? {} : result.errors
  }

  it.each([1, 2, 3])('explains that 50,000 SEK is too high for %i months and what is possible', (months) => {
    const message = errorsOf({ months }).target ?? ''
    expect(message).toMatch(/för högt/)
    expect(message).toMatch(/Högst/)
    expect(message).toMatch(/längre tid/)
  })

  it('names the duration and the exact maximum for the period', () => {
    expect(errorsOf({ months: 1 }).target).toMatch(/för 1 månad \(31 dagar\)\. Högst 15.500/)
  })

  it('explains a target that is too low for the period', () => {
    expect(errorsOf({ months: 12, target: '5000' }).target).toMatch(/för lågt för 12 månader \(366 dagar\)\. Minst 18.300/)
  })

  it.each(['', 'abc', '12.5', '-100', '1e6'])('rejects the target %j', (target) => {
    expect(errorsOf({ target }).target).toBeTruthy()
  })

  it('rejects a zero target and a target above the maximum', () => {
    expect(errorsOf({ target: '0' }).target).toMatch(/större än noll/)
    expect(errorsOf({ target: String(CHALLENGE_LIMITS.maxTargetSek + 1) }).target).toMatch(/högst/)
  })

  it('rejects a duration that is not offered', () => {
    expect(errorsOf({ months: 7 }).months).toMatch(/Välj hur länge/)
    expect(errorsOf({ months: 0 }).months).toBeTruthy()
  })

  it('rejects a name that is too long', () => {
    expect(errorsOf({ name: 'x'.repeat(61) }).name).toMatch(/högst 60/)
  })
})

describe('parseTarget', () => {
  it('reads whole kronor only', () => {
    expect(parseTarget('50000')).toBe(50_000)
    expect(parseTarget('50 000 kr')).toBe(50_000)
    expect(parseTarget('50,000')).toBeNull()
    expect(parseTarget('')).toBeNull()
  })
})
