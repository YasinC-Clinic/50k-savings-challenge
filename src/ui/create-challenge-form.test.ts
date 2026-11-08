import { describe, expect, it } from 'vitest'
import { CHALLENGE_LIMITS } from '../domain/challenge'
import { defaultForm, previewDays, standardForm, validateForm, type ChallengeForm } from './create-challenge-form'

const TODAY = '2026-11-08'
const form = (overrides: Partial<ChallengeForm> = {}): ChallengeForm => ({
  name: 'Min utmaning',
  target: '50000',
  startDate: TODAY,
  endDate: '2027-06-30',
  ...overrides,
})

describe('defaults', () => {
  it('starts today with 50,000 SEK and ends on 2027-06-30', () => {
    expect(defaultForm(TODAY, 0)).toEqual({ name: 'Utmaning 1', target: '50000', startDate: TODAY, endDate: '2027-06-30' })
  })

  it('numbers the default name after the challenges that already exist', () => {
    expect(defaultForm(TODAY, 2).name).toBe('Utmaning 3')
  })

  it('falls back to 180 days when the default end date has already passed', () => {
    expect(defaultForm('2027-08-01', 0).endDate).toBe('2028-01-28')
  })

  it('offers the original challenge as a preset', () => {
    expect(standardForm(0)).toMatchObject({ target: '50000', startDate: '2027-01-01', endDate: '2027-06-30' })
  })
})

describe('a valid form', () => {
  it('produces a config for a challenge that starts today', () => {
    const result = validateForm(form(), TODAY)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.value.config).toEqual({ targetSek: 50_000, startDate: TODAY, endDate: '2027-06-30', initialMinimumSek: 50, preferredMaximumSek: 500 })
    expect(result.value.dayCount).toBe(235)
    expect(result.value.averagePerDay).toBe(213)
  })

  it('accepts a future start, spaces and a kr suffix in the target', () => {
    const result = validateForm(form({ target: '50 000 kr', startDate: '2027-01-01' }), TODAY)
    expect(result.ok && result.value.config.targetSek).toBe(50_000)
  })

  it('accepts exactly the lowest and highest reachable targets', () => {
    expect(validateForm(form({ startDate: '2027-01-01', endDate: '2027-01-10', target: '500' }), TODAY).ok).toBe(true)
    expect(validateForm(form({ startDate: '2027-01-01', endDate: '2027-01-10', target: '5000' }), TODAY).ok).toBe(true)
  })

  it('trims the name', () => {
    const result = validateForm(form({ name: '  Semester  ' }), TODAY)
    expect(result.ok && result.value.name).toBe('Semester')
  })
})

describe('validation messages (Swedish)', () => {
  const errorsOf = (overrides: Partial<ChallengeForm>) => {
    const result = validateForm(form(overrides), TODAY)
    return result.ok ? {} : result.errors
  }

  it.each(['', 'abc', '12.5', '-100', '1e6'])('rejects the target %j', (target) => {
    expect(errorsOf({ target }).target).toBeTruthy()
  })

  it('rejects a zero target', () => {
    expect(errorsOf({ target: '0' }).target).toMatch(/större än noll/)
  })

  it('rejects a target above the maximum', () => {
    expect(errorsOf({ target: String(CHALLENGE_LIMITS.maxTargetSek + 1) }).target).toMatch(/högst/)
  })

  it('rejects a start date before today', () => {
    expect(errorsOf({ startDate: '2026-11-07' }).startDate).toMatch(/före idag/)
  })

  it.each(['', '2027-02-30', '2027/01/01', 'imorgon'])('rejects the invalid date %j', (value) => {
    expect(errorsOf({ endDate: value }).endDate).toMatch(/giltigt/)
    expect(errorsOf({ startDate: value }).startDate).toMatch(/giltigt/)
  })

  it('rejects an end date on or before the start date', () => {
    expect(errorsOf({ endDate: TODAY }).endDate).toMatch(/efter startdatumet/)
    expect(errorsOf({ endDate: '2026-11-01' }).endDate).toMatch(/efter startdatumet/)
  })

  it('rejects a period longer than the maximum', () => {
    expect(errorsOf({ endDate: '2031-01-01', target: '100000' }).endDate).toMatch(/högst 1.100 dagar/)
  })

  it('explains a target that is too low for the period and how much is needed', () => {
    expect(errorsOf({ target: '1000' }).target).toMatch(/för lågt för 235 dagar.*Minst 11.750/)
  })

  it('explains a target that is too high for the period and how much is possible', () => {
    expect(errorsOf({ startDate: '2027-01-01', endDate: '2027-01-10', target: '6000' }).target).toMatch(/för högt för 10 dagar.*Högst 5.000/)
  })

  it('rejects a name that is too long', () => {
    expect(errorsOf({ name: 'x'.repeat(61) }).name).toMatch(/högst 60/)
  })

  it('reports several problems at once', () => {
    expect(Object.keys(errorsOf({ target: 'abc', startDate: '2020-01-01' })).sort()).toEqual(['startDate', 'target'])
  })
})

describe('previewDays', () => {
  it('counts both ends and returns null for unusable input', () => {
    expect(previewDays('2027-01-01', '2027-06-30')).toBe(181)
    expect(previewDays('2027-01-01', '2027-01-01')).toBeNull()
    expect(previewDays('', '2027-01-01')).toBeNull()
    expect(previewDays('2027-02-30', '2027-03-01')).toBeNull()
  })
})
