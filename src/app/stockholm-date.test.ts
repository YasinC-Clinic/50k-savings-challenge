import { describe, expect, it } from 'vitest'
import { stockholmDateKey } from './savings-view'

describe('Europe/Stockholm calendar date', () => {
  it.each([
    ['winter: 22:59:59 UTC is still the 31st', '2026-12-31T22:59:59Z', '2026-12-31'],
    ['winter: 23:00 UTC is already New Year', '2026-12-31T23:00:00Z', '2027-01-01'],
    ['summer: 21:59:59 UTC is still 30 June', '2027-06-30T21:59:59Z', '2027-06-30'],
    ['summer: 22:00 UTC is already 1 July', '2027-06-30T22:00:00Z', '2027-07-01'],
    ['UTC evening is still the same day in Stockholm', '2027-01-01T22:30:00Z', '2027-01-01'],
    ['UTC evening is already tomorrow in Stockholm', '2027-01-01T23:30:00Z', '2027-01-02'],
    ['spring DST: last second of CET', '2027-03-28T00:59:59Z', '2027-03-28'],
    ['spring DST: first second of CEST', '2027-03-28T01:00:00Z', '2027-03-28'],
    ['spring DST day ends 22:00 UTC', '2027-03-28T21:59:59Z', '2027-03-28'],
    ['spring DST day rolls over', '2027-03-28T22:00:00Z', '2027-03-29'],
    ['autumn DST: midnight in CEST', '2027-10-30T22:00:00Z', '2027-10-31'],
    ['autumn DST: repeated hour stays on the 31st', '2027-10-31T00:30:00Z', '2027-10-31'],
    ['autumn DST day ends 23:00 UTC', '2027-10-31T22:59:59Z', '2027-10-31'],
    ['autumn DST day rolls over', '2027-10-31T23:00:00Z', '2027-11-01'],
    ['leap day in Stockholm', '2028-02-28T23:00:00Z', '2028-02-29'],
  ])('%s', (_label, instant, expected) => {
    expect(stockholmDateKey(new Date(instant))).toBe(expected)
  })

  function keysByHour(fromIso: string, toIso: string): string[] {
    const keys: string[] = []
    for (let time = Date.parse(fromIso); time <= Date.parse(toIso); time += 3_600_000) keys.push(stockholmDateKey(new Date(time)))
    return keys
  }

  it('never skips or repeats a calendar date around the spring DST change', () => {
    const keys = keysByHour('2027-03-26T00:00:00Z', '2027-03-30T00:00:00Z')
    expect([...new Set(keys)]).toEqual(['2027-03-26', '2027-03-27', '2027-03-28', '2027-03-29', '2027-03-30'])
    expect([...keys].sort()).toEqual(keys)
  })

  it('never skips or repeats a calendar date around the autumn DST change', () => {
    const keys = keysByHour('2027-10-29T00:00:00Z', '2027-11-02T00:00:00Z')
    expect([...new Set(keys)]).toEqual(['2027-10-29', '2027-10-30', '2027-10-31', '2027-11-01', '2027-11-02'])
    expect([...keys].sort()).toEqual(keys)
  })

  it('returns zero-padded ISO keys', () => {
    expect(stockholmDateKey(new Date('2027-01-05T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
