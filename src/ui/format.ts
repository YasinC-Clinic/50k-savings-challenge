/**
 * Calendar helpers that do not depend on the language. Everything that formats a date or an amount for display
 * lives in `src/i18n/formatters.ts`, so switching language can never change a stored value.
 */

function toUtcNoon(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12))
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
