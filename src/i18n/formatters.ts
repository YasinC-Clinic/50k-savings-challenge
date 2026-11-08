export type Locale = 'sv-SE' | 'en-GB'

export interface Formatters {
  /** Swedish "50 000 kr", English "SEK 50,000". The currency is SEK in both languages. */
  sek: (amount: number) => string
  /** Swedish "8 nov. 2026", English "8 Nov 2026". */
  date: (dateKey: string) => string
  /** Swedish "söndag 8 november", English "Sunday 8 November". */
  dayLong: (dateKey: string) => string
  range: (startDate: string, endDate: string) => string
  /** Swedish "november 2026", English "November 2026". Takes "YYYY-MM". */
  monthYear: (monthKey: string) => string
  /** Swedish "12,5 %", English "12.5%". */
  percent: (value: number) => string
}

/** A calendar date key as a Date at 12:00 UTC, so formatting in UTC can never move it to another day. */
function toUtcNoon(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12))
}

/** Formatting only. Stored dates and amounts are never converted, so switching language cannot change any data. */
export function createFormatters(locale: Locale): Formatters {
  const currency = new Intl.NumberFormat(locale, { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 })
  const shortDate = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const longDay = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const percentSign = locale === 'sv-SE' ? ' %' : '%'

  const date = (dateKey: string) => shortDate.format(toUtcNoon(dateKey))
  return {
    sek: (amount) => currency.format(amount),
    date,
    dayLong: (dateKey) => longDay.format(toUtcNoon(dateKey)),
    range: (startDate, endDate) => `${date(startDate)} – ${date(endDate)}`,
    monthYear: (monthKey) => monthName.format(toUtcNoon(`${monthKey}-01`)),
    percent: (value) => `${number.format(value)}${percentSign}`,
  }
}
