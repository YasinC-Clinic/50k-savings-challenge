import type { Challenge, DayStatus } from '../domain/challenge'

/** What the plan for the remaining days looks like, derived from stored data (nothing extra is persisted). */
export type PlanStatus =
  | { kind: 'on-track' }
  | { kind: 'completed' }
  /** Recovery needed daily amounts above the preferred maximum. */
  | { kind: 'raised-ceiling'; ceilingSek: number; preferredMaximumSek: number }
  /** The remaining eligible days can no longer reach the target. */
  | { kind: 'unreachable'; unplannedSek: number }
  /** The deadline has passed without reaching the target. */
  | { kind: 'ended-short'; shortfallSek: number }

export interface DashboardView {
  targetSek: number
  startDate: string
  endDate: string
  savedSek: number
  remainingSek: number
  /** Drawn today (or earlier) but not confirmed: it does NOT count as saved. */
  pendingSek: number
  progressPercent: number
  confirmedDays: number
  /** Alias kept for older callers. */
  daysCompleted: number
  missedDays: number
  totalDays: number
  /** 1-based number of today inside the challenge; null before the start or after the end. */
  dayNumber: number | null
  daysRemaining: number
  status: 'upcoming' | 'active' | 'finished'
  plan: PlanStatus
}

export interface HistoryEntry {
  date: string
  status: DayStatus
  amount: number | null
}

export interface MonthlyHistory {
  key: string
  label: string
  confirmedSek: number
  entries: HistoryEntry[]
}

const sumOf = (days: Array<{ amount: number }>) => days.reduce((total, day) => total + day.amount, 0)

export function getChallengeStatus(challenge: Challenge, today: string): DashboardView['status'] {
  if (today < challenge.config.startDate) return 'upcoming'
  if (today > challenge.config.endDate) return 'finished'
  return 'active'
}

export function getDashboard(challenge: Challenge, today: string): DashboardView {
  const { targetSek, startDate, endDate } = challenge.config
  const confirmed = challenge.days.filter((day) => day.status === 'confirmed')
  const savedSek = sumOf(confirmed)
  const status = getChallengeStatus(challenge, today)
  const todayIndex = challenge.days.findIndex((day) => day.date === today)

  return {
    targetSek,
    startDate,
    endDate,
    savedSek,
    remainingSek: Math.max(0, targetSek - savedSek),
    pendingSek: sumOf(challenge.days.filter((day) => day.status === 'drawn')),
    progressPercent: Math.min(100, Math.round((savedSek / targetSek) * 1000) / 10),
    confirmedDays: confirmed.length,
    daysCompleted: confirmed.length,
    missedDays: challenge.days.filter((day) => day.status === 'missed').length,
    totalDays: challenge.days.length,
    dayNumber: todayIndex >= 0 ? todayIndex + 1 : null,
    daysRemaining: remainingDays(challenge, today, status),
    status,
    plan: getPlanStatus(challenge, today, status, savedSek),
  }
}

function remainingDays(challenge: Challenge, today: string, status: DashboardView['status']): number {
  if (status === 'upcoming') return challenge.days.length
  if (status === 'finished') return 0
  return challenge.days.filter((day) => day.date >= today).length
}

function getPlanStatus(challenge: Challenge, today: string, status: DashboardView['status'], savedSek: number): PlanStatus {
  const { targetSek, preferredMaximumSek } = challenge.config
  if (savedSek >= targetSek) return { kind: 'completed' }
  if (status === 'finished') return { kind: 'ended-short', shortfallSek: targetSek - savedSek }

  const livePlanSek = sumOf(challenge.days.filter((day) => day.status !== 'missed'))
  if (livePlanSek < targetSek) return { kind: 'unreachable', unplannedSek: targetSek - livePlanSek }

  const upcomingUndrawn = challenge.days.filter((day) => day.status === 'undrawn' && day.date >= today)
  const highest = Math.max(0, ...upcomingUndrawn.map((day) => day.amount))
  if (highest > preferredMaximumSek) return { kind: 'raised-ceiling', ceilingSek: highest, preferredMaximumSek }
  return { kind: 'on-track' }
}

/** "november 2026". Callers that display the history pass the formatter of the chosen language. */
const swedishMonthLabel = (monthKey: string) =>
  new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${monthKey}-01T12:00:00Z`))

export function getMonthlyHistory(challenge: Challenge, formatMonth: (monthKey: string) => string = swedishMonthLabel): MonthlyHistory[] {
  const months = new Map<string, HistoryEntry[]>()
  challenge.days.forEach((day) => {
    const key = day.date.slice(0, 7)
    const entries = months.get(key) ?? []
    entries.push({ date: day.date, status: day.status, amount: day.status === 'undrawn' ? null : day.amount })
    months.set(key, entries)
  })
  return [...months.entries()].map(([key, entries]) => ({
    key,
    label: formatMonth(key),
    confirmedSek: sumOf(entries.filter((entry) => entry.status === 'confirmed').map((entry) => ({ amount: entry.amount ?? 0 }))),
    entries,
  }))
}

/** Recovery is needed when a day before today is still undrawn or drawn but never confirmed. */
export function shouldRecover(challenge: Challenge, today: string): boolean {
  if (today < challenge.config.startDate) return false
  return challenge.days.some((day) => day.date < today && (day.status === 'undrawn' || day.status === 'drawn'))
}

export function stockholmDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

const HOUR_MS = 3_600_000
const LONGEST_DAY_MS = 26 * HOUR_MS
const TIMER_MARGIN_MS = 100

/**
 * Milliseconds until the Stockholm calendar date changes, plus a small margin.
 * Found by bisection on the date itself rather than by wall-clock arithmetic, because on the two
 * daylight-saving days the Stockholm day is 23 or 25 hours long.
 */
export function millisecondsUntilStockholmMidnight(now = new Date()): number {
  const currentKey = stockholmDateKey(now)
  let sameDay = 0
  let nextDay = LONGEST_DAY_MS
  while (nextDay - sameDay > 1) {
    const middle = Math.floor((sameDay + nextDay) / 2)
    if (stockholmDateKey(new Date(now.getTime() + middle)) === currentKey) sameDay = middle
    else nextDay = middle
  }
  return nextDay + TIMER_MARGIN_MS
}
