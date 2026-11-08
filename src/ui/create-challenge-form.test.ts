import { describe, expect, it } from 'vitest'
import { CHALLENGE_LIMITS, DEFAULT_DURATION_MONTHS, DURATION_OPTIONS, NEW_YEAR_DURATION } from '../domain/challenge'
import { stockholmDateKey } from '../app/savings-view'
import { defaultForm, durationLabel, parseAmount, parseTarget, planFor, validateForm, type ChallengeForm } from './create-challenge-form'

const TODAY = '2026-11-08'
const form = (overrides: Partial<ChallengeForm> = {}): ChallengeForm => ({
  name: 'Min utmaning',
  target: '50000',
  duration: 6,
  minDaily: '50',
  maxDaily: '500',
  ...overrides,
})

describe('defaults', () => {
  it('selects six months, 50,000 SEK and 50-500 SEK per day', () => {
    expect(defaultForm(0)).toEqual({ name: 'Utmaning 1', target: '50000', duration: 6, minDaily: '50', maxDaily: '500' })
    expect(defaultForm(0).duration).toBe(DEFAULT_DURATION_MONTHS)
  })

  it('numbers the default name after the challenges that already exist', () => {
    expect(defaultForm(2).name).toBe('Utmaning 3')
  })
})

describe('duration labels', () => {
  it('uses Swedish singular and plural and ends with "Till nyår"', () => {
    expect(DURATION_OPTIONS.map(durationLabel)).toEqual([
      '1 månad',
      '2 månader',
      '3 månader',
      '4 månader',
      '5 månader',
      '6 månader',
      '9 månader',
      '12 månader',
      'Till nyår',
    ])
  })
})

describe('the plan is calculated from today, never typed', () => {
  it('starts today and ends after the chosen number of months', () => {
    expect(planFor(TODAY, 6)).toEqual({ startDate: '2026-11-08', endDate: '2027-05-08', dayCount: 182 })
    expect(planFor(TODAY, 1)).toEqual({ startDate: '2026-11-08', endDate: '2026-12-08', dayCount: 31 })
    expect(planFor(TODAY, 12)).toEqual({ startDate: '2026-11-08', endDate: '2027-11-08', dayCount: 366 })
  })

  it('"Till nyår" ends on 31 December of the start year with the exact number of days', () => {
    expect(planFor(TODAY, NEW_YEAR_DURATION)).toEqual({ startDate: '2026-11-08', endDate: '2026-12-31', dayCount: 54 })
    expect(planFor('2026-12-30', NEW_YEAR_DURATION)).toEqual({ startDate: '2026-12-30', endDate: '2026-12-31', dayCount: 2 })
  })

  it('"Till nyår" started on 31 December targets the next 31 December instead of an empty challenge', () => {
    expect(planFor('2026-12-31', NEW_YEAR_DURATION)).toEqual({ startDate: '2026-12-31', endDate: '2027-12-31', dayCount: 366 })
  })

  it('"Till nyår" works in a future year', () => {
    expect(planFor('2031-06-15', NEW_YEAR_DURATION).endDate).toBe('2031-12-31')
  })

  it('handles month ends and leap years', () => {
    expect(planFor('2027-01-31', 1)).toEqual({ startDate: '2027-01-31', endDate: '2027-02-28', dayCount: 29 })
    expect(planFor('2028-01-31', 1)).toEqual({ startDate: '2028-01-31', endDate: '2028-02-29', dayCount: 30 })
  })

  it('uses the Stockholm date as the start, not the UTC date', () => {
    const stockholmToday = stockholmDateKey(new Date('2026-11-08T23:30:00Z'))
    expect(stockholmToday).toBe('2026-11-09')
    expect(planFor(stockholmToday, 6).startDate).toBe('2026-11-09')
    expect(planFor(stockholmToday, NEW_YEAR_DURATION).dayCount).toBe(53)
    // 23:30 UTC on 31 December is already 1 January in Stockholm, so "Till nyår" targets the following year.
    const newYearsDay = stockholmDateKey(new Date('2026-12-31T23:30:00Z'))
    expect(newYearsDay).toBe('2027-01-01')
    expect(planFor(newYearsDay, NEW_YEAR_DURATION).endDate).toBe('2027-12-31')
  })
})

describe('a valid form', () => {
  it('creates a config that starts today, lasts six months and keeps the default limits', () => {
    const result = validateForm(form(), TODAY)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.config).toEqual({ targetSek: 50_000, startDate: TODAY, endDate: '2027-05-08', initialMinimumSek: 50, preferredMaximumSek: 500 })
    expect(result.value.plan.dayCount).toBe(182)
    expect(result.value.averagePerDay).toBe(275)
  })

  it('stores the custom daily limits chosen by the user in the config', () => {
    const result = validateForm(form({ duration: 1, target: '6000', minDaily: '100', maxDaily: '300' }), TODAY)
    expect(result.ok && result.value.config).toEqual({ targetSek: 6_000, startDate: TODAY, endDate: '2026-12-08', initialMinimumSek: 100, preferredMaximumSek: 300 })
  })

  it('accepts "Till nyår" when the target fits with a higher maximum', () => {
    const result = validateForm(form({ duration: NEW_YEAR_DURATION, maxDaily: '1000' }), TODAY)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.config).toMatchObject({ startDate: TODAY, endDate: '2026-12-31', preferredMaximumSek: 1_000 })
    expect(result.value.plan.dayCount).toBe(54)
  })

  it.each([4, 5, 6, 9, 12] as const)('accepts 50,000 SEK over %i months at the default limits', (duration) => {
    expect(validateForm(form({ duration }), TODAY).ok).toBe(true)
  })

  it('accepts a minimum equal to the maximum', () => {
    const result = validateForm(form({ duration: 1, target: '3100', minDaily: '100', maxDaily: '100' }), TODAY)
    expect(result.ok && result.value.config).toMatchObject({ initialMinimumSek: 100, preferredMaximumSek: 100 })
  })

  it('accepts spaces and a kr suffix in every amount, and trims the name', () => {
    const result = validateForm(form({ target: '30 000 kr', minDaily: ' 60 kr', maxDaily: '1 000', name: '  Semester  ' }), TODAY)
    expect(result.ok && result.value.config).toMatchObject({ targetSek: 30_000, initialMinimumSek: 60, preferredMaximumSek: 1_000 })
    expect(result.ok && result.value.name).toBe('Semester')
  })

  it('accepts exactly the lowest and highest reachable targets for the period and limits', () => {
    expect(validateForm(form({ duration: 1, target: String(31 * 50) }), TODAY).ok).toBe(true)
    expect(validateForm(form({ duration: 1, target: String(31 * 500) }), TODAY).ok).toBe(true)
    expect(validateForm(form({ duration: 1, target: String(31 * 100), minDaily: '100', maxDaily: '300' }), TODAY).ok).toBe(true)
  })
})

describe('validation messages (Swedish)', () => {
  const errorsOf = (overrides: Partial<ChallengeForm>) => {
    const result = validateForm(form(overrides), TODAY)
    return result.ok ? {} : result.errors
  }

  it.each([1, 2, 3] as const)('explains that 50,000 SEK is too high for %i months at 500 kr per day', (duration) => {
    const message = errorsOf({ duration }).target ?? ''
    expect(message).toMatch(/för högt/)
    expect(message).toMatch(/Högst/)
    expect(message).toMatch(/höj högsta dagsbelopp/)
    expect(message).toMatch(/längre tid/)
  })

  it('explains that 50,000 SEK does not fit "Till nyår" and names the exact maximum', () => {
    expect(errorsOf({ duration: NEW_YEAR_DURATION }).target).toMatch(/för högt för Till nyår \(54 dagar\)\. Högst 27.000/)
  })

  it('uses the chosen limits in the explanation', () => {
    // \s also matches the non-breaking space that Swedish currency formatting puts before "kr".
    expect(errorsOf({ duration: 1, target: '20000', maxDaily: '600' }).target).toMatch(/Högst 18.600\skr går att spara \(600\skr per dag\)/)
    expect(errorsOf({ duration: 12, target: '20000', minDaily: '100' }).target).toMatch(/för lågt för 12 månader \(366 dagar\)\. Minst 36.600\skr krävs \(100\skr per dag\)/)
  })

  it.each(['', 'abc', '12.5', '-100', '1e6'])('rejects the target %j', (target) => {
    expect(errorsOf({ target }).target).toBeTruthy()
  })

  it('rejects a zero target and a target above the maximum', () => {
    expect(errorsOf({ target: '0' }).target).toMatch(/större än noll/)
    expect(errorsOf({ target: String(CHALLENGE_LIMITS.maxTargetSek + 1) }).target).toMatch(/högst/)
  })

  it.each(['', 'abc', '50.5', '-50', '1e2', '0,5'])('rejects the minimum %j as not a whole positive amount', (minDaily) => {
    expect(errorsOf({ minDaily }).minDaily).toMatch(/Ange lägsta dagsbelopp i hela kronor|minst 1 kr/)
  })

  it.each(['', 'abc', '500.5', '-500', '1e3'])('rejects the maximum %j as not a whole positive amount', (maxDaily) => {
    expect(errorsOf({ maxDaily }).maxDaily).toMatch(/Ange högsta dagsbelopp i hela kronor|minst 1 kr/)
  })

  it('rejects a zero minimum and a zero maximum', () => {
    expect(errorsOf({ minDaily: '0' }).minDaily).toMatch(/minst 1 kr/)
    expect(errorsOf({ maxDaily: '0' }).maxDaily).toMatch(/minst 1 kr/)
  })

  it('rejects a minimum above the maximum', () => {
    expect(errorsOf({ minDaily: '600', maxDaily: '500' }).minDaily).toBe('Lägsta dagsbelopp kan inte vara högre än högsta dagsbelopp.')
    expect(validateForm(form({ minDaily: '600', maxDaily: '500' }), TODAY).ok).toBe(false)
  })

  it('rejects a maximum above the supported limit', () => {
    expect(errorsOf({ maxDaily: String(CHALLENGE_LIMITS.maxDailySek + 1) }).maxDaily).toMatch(/högst 100.000\skr/)
  })

  it('rejects a duration that is not offered', () => {
    expect(errorsOf({ duration: 7 as never }).duration).toMatch(/Välj hur länge/)
    expect(errorsOf({ duration: 0 as never }).duration).toBeTruthy()
  })

  it('rejects a name that is too long', () => {
    expect(errorsOf({ name: 'x'.repeat(61) }).name).toMatch(/högst 60/)
  })

  it('reports several problems at once', () => {
    expect(Object.keys(errorsOf({ target: 'abc', minDaily: 'x' })).sort()).toEqual(['minDaily', 'target'])
  })
})

describe('parseAmount', () => {
  it('reads whole kronor only', () => {
    expect(parseAmount('50000')).toBe(50_000)
    expect(parseAmount('50 000 kr')).toBe(50_000)
    expect(parseAmount('50,000')).toBeNull()
    expect(parseAmount('')).toBeNull()
    expect(parseTarget).toBe(parseAmount)
  })
})
