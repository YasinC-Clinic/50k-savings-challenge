import { CHALLENGE, type Challenge, type DayStatus } from '../domain/challenge'

export interface DashboardView {
  savedSek: number
  remainingSek: number
  progressPercent: number
  daysCompleted: number
  daysRemaining: number
  status: 'upcoming' | 'active' | 'finished'
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

export function getDashboard(challenge: Challenge, today: string): DashboardView {
  const savedSek = challenge.days.filter((day) => day.status === 'confirmed').reduce((sum, day) => sum + day.amount, 0)
  const daysCompleted = challenge.days.filter((day) => day.status === 'confirmed').length
  const status = today < CHALLENGE.startDate ? 'upcoming' : today > CHALLENGE.endDate ? 'finished' : 'active'
  const daysRemaining = status === 'upcoming' ? CHALLENGE.durationDays : status === 'finished' ? 0 : challenge.days.filter((day) => day.date >= today).length
  return {
    savedSek,
    remainingSek: Math.max(0, CHALLENGE.targetSek - savedSek),
    progressPercent: Math.min(100, Math.round((savedSek / CHALLENGE.targetSek) * 1000) / 10),
    daysCompleted,
    daysRemaining,
    status,
  }
}

export function getMonthlyHistory(challenge: Challenge): MonthlyHistory[] {
  const months = new Map<string, HistoryEntry[]>()
  challenge.days.forEach((day) => {
    const key = day.date.slice(0, 7)
    const entries = months.get(key) ?? []
    entries.push({ date: day.date, status: day.status, amount: day.status === 'undrawn' ? null : day.amount })
    months.set(key, entries)
  })
  return [...months.entries()].map(([key, entries]) => ({
    key,
    label: new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/Stockholm' }).format(new Date(`${key}-01T12:00:00Z`)),
    confirmedSek: entries.filter((entry) => entry.status === 'confirmed').reduce((sum, entry) => sum + (entry.amount ?? 0), 0),
    entries,
  }))
}

export function shouldRecover(challenge: Challenge, today: string): boolean {
  return today >= CHALLENGE.startDate && challenge.days.some((day) => day.date < today && (day.status === 'undrawn' || day.status === 'drawn'))
}

export function stockholmDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}
