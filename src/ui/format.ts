const currency = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 })
const shortDate = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const longDay = new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

/** Swedish singular/plural: plural(1, 'dag', 'dagar') -> "1 dag". */
export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** "50 000 kr". */
export function sek(amount: number): string {
  return currency.format(amount)
}

function toUtcNoon(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12))
}

/** "30 jun. 2027". The date key is a calendar date, so no time zone conversion is involved. */
export function formatDate(dateKey: string): string {
  return shortDate.format(toUtcNoon(dateKey))
}

/** "måndag 8 november". */
export function formatDayLong(dateKey: string): string {
  return longDay.format(toUtcNoon(dateKey))
}

export function formatRange(startDate: string, endDate: string): string {
  return `${formatDate(startDate)} – ${formatDate(endDate)}`
}

/** Monday-first weekday index (0-6) of a calendar date. */
export function weekdayIndex(dateKey: string): number {
  return (toUtcNoon(dateKey).getUTCDay() + 6) % 7
}

export function addDays(dateKey: string, days: number): string {
  const moved = toUtcNoon(dateKey)
  moved.setUTCDate(moved.getUTCDate() + days)
  return moved.toISOString().slice(0, 10)
}

/** Number of calendar days from start to end, both included. */
export function daysInclusive(startDate: string, endDate: string): number {
  return Math.round((toUtcNoon(endDate).getTime() - toUtcNoon(startDate).getTime()) / 86_400_000) + 1
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return toUtcNoon(value).toISOString().slice(0, 10) === value
}
