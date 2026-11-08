import {
  dynamicBounds,
  randomInteger,
  recalculateAfterMisses,
  seededRandom,
  type Challenge,
  type DailyLimits,
} from './challenge'

/**
 * Pure rules for penalties, catch-up savings and Shock Days.
 *
 * Ordinary savings (the challenge target) and the penalty pot are two separate ledgers: nothing in here lets a
 * penalty count towards the target, and nothing counts as saved until it has been explicitly confirmed.
 */

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** 3% penalty for one missed date. Amounts are integer öre (1 SEK = 100 öre): no floating point anywhere. */
export interface PenaltyEntry {
  challengeId: string
  /** The missed scheduled date. A date can carry at most one penalty. */
  date: string
  amountOre: number
  /** The calculation base this penalty was taken from. */
  baseOre: number
  accruedAt: string
}

/** The user confirmed that they paid (manually, outside the app) this part of a challenge's penalties. */
export interface PenaltyPayment {
  id: string
  challengeId: string
  amountOre: number
  paidAt: string
}

/** Saving that makes up one missed day. It counts as saved only once confirmed. */
export interface CatchUpEntry {
  challengeId: string
  /** The missed date being caught up. */
  date: string
  amount: number
  status: 'drawn' | 'confirmed'
  drawnAt: string
  confirmedAt?: string
}

export interface PenaltyTotals {
  accruedOre: number
  paidOre: number
  outstandingOre: number
}

// ---------------------------------------------------------------------------------------------
// Ordinary savings, as seen by the ledger
// ---------------------------------------------------------------------------------------------

const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + amount, 0)

/** Confirmed daily entries plus confirmed catch-ups. Drawn-but-unconfirmed amounts never count. */
export function confirmedSavingsSek(challenge: Challenge, catchUps: CatchUpEntry[]): number {
  const days = sum(challenge.days.filter((day) => day.status === 'confirmed').map((day) => day.amount))
  return days + sum(catchUps.filter((entry) => entry.status === 'confirmed').map((entry) => entry.amount))
}

/** Amounts already fixed for this challenge: confirmed or drawn days, and drawn or confirmed catch-ups. */
export function committedSek(challenge: Challenge, catchUps: CatchUpEntry[]): number {
  const days = sum(challenge.days.filter((day) => day.status === 'confirmed' || day.status === 'drawn').map((day) => day.amount))
  return days + sum(catchUps.map((entry) => entry.amount))
}

export function isCompleted(challenge: Challenge, catchUps: CatchUpEntry[]): boolean {
  return confirmedSavingsSek(challenge, catchUps) >= challenge.config.targetSek
}

/** What is still missing from the ORDINARY target, in öre. */
export function remainingTargetOre(challenge: Challenge, catchUps: CatchUpEntry[]): number {
  return Math.max(0, (challenge.config.targetSek - confirmedSavingsSek(challenge, catchUps)) * 100)
}

// ---------------------------------------------------------------------------------------------
// Penalties: 3% of a base that shrinks by every penalty
// ---------------------------------------------------------------------------------------------

/** 3% of the base, rounded half up to the öre, with integer arithmetic only. 169362 öre gives 5081 (50.81 SEK). */
export function penaltyOreFor(baseOre: number): number {
  return Math.floor((baseOre * 3 + 50) / 100)
}

export interface PenaltyPlanInput {
  challengeId: string
  /** Remaining ordinary target in öre at the moment the missed dates are detected. */
  remainingOre: number
  existing: PenaltyEntry[]
  /** Dates that were missed and should carry a penalty, in any order. Dates that already have one are ignored. */
  missedDates: string[]
  accruedAt: string
}

/**
 * The new penalties, in chronological order.
 *
 * Rule: the first penalty uses the remaining target as its base. Every penalty is subtracted from the base before the
 * next one. If ordinary savings progressed between two calculations, the base never exceeds the remaining target:
 * base = min(previous base - previous penalty, remaining target). Dates that already have a penalty are never
 * charged again, so running this twice, or in two tabs, gives the same result.
 */
export function planPenalties({ challengeId, remainingOre, existing, missedDates, accruedAt }: PenaltyPlanInput): PenaltyEntry[] {
  const charged = new Set(existing.map((entry) => entry.date))
  const dates = [...new Set(missedDates)].filter((date) => !charged.has(date)).sort()
  const previous = [...existing].sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  let base = previous ? Math.min(previous.baseOre - previous.amountOre, remainingOre) : remainingOre

  const entries: PenaltyEntry[] = []
  for (const date of dates) {
    if (base <= 0) break
    const amountOre = penaltyOreFor(base)
    entries.push({ challengeId, date, amountOre, baseOre: base, accruedAt })
    base -= amountOre
  }
  return entries
}

/** Missed dates that should be penalised: only days missed on or after the day the penalty feature started on this device. */
export function penalisableDates(challenge: Challenge, penaltiesStartDate: string): string[] {
  return challenge.days.filter((day) => day.status === 'missed' && day.date >= penaltiesStartDate).map((day) => day.date)
}

/** Accrued, paid and outstanding penalties; for one challenge or (without an id) the permanent pot of all challenges. */
export function penaltyTotals(penalties: PenaltyEntry[], payments: PenaltyPayment[], challengeId?: string): PenaltyTotals {
  const matches = (entry: { challengeId: string }) => challengeId === undefined || entry.challengeId === challengeId
  const accruedOre = sum(penalties.filter(matches).map((entry) => entry.amountOre))
  const paidOre = sum(payments.filter(matches).map((entry) => entry.amountOre))
  return { accruedOre, paidOre, outstandingOre: Math.max(0, accruedOre - paidOre) }
}

// ---------------------------------------------------------------------------------------------
// Catch-up sessions
// ---------------------------------------------------------------------------------------------

/** Missed days that have no confirmed catch-up yet, oldest first. A date is listed once, however often the app opens. */
export function catchUpDates(challenge: Challenge, catchUps: CatchUpEntry[]): string[] {
  const done = new Set(catchUps.filter((entry) => entry.status === 'confirmed').map((entry) => entry.date))
  return challenge.days.filter((day) => day.status === 'missed' && !done.has(day.date)).map((day) => day.date)
}

function upcomingUndrawn(challenge: Challenge, today: string) {
  return challenge.days.filter((day) => day.date >= today && day.status === 'undrawn')
}

/**
 * The range a catch-up amount may have. It follows the challenge's own range, and it is capped so the days that are
 * still to come can each keep at least their minimum: the target stays achievable. Null when there is no room
 * (deadline passed or target nearly reached), because the deadline is never extended.
 */
export function catchUpRange(challenge: Challenge, today: string, catchUps: CatchUpEntry[]): DailyLimits | null {
  const upcoming = upcomingUndrawn(challenge, today).length
  if (upcoming === 0) return null
  const needed = challenge.config.targetSek - committedSek(challenge, catchUps)
  const dynamic = challenge.config.dynamicRange === true
  const base = dynamic ? dynamicBounds(needed, upcoming + 1) : { minimumSek: challenge.config.initialMinimumSek, maximumSek: challenge.config.preferredMaximumSek }
  const cap = needed - upcoming * (dynamic ? 1 : challenge.config.initialMinimumSek)
  const maximumSek = Math.min(base.maximumSek, cap)
  return maximumSek >= base.minimumSek && maximumSek >= 1 ? { minimumSek: base.minimumSek, maximumSek } : null
}

/** A fixed random amount for one missed day; null when there is no room. Never a Shock Day amount. */
export function drawCatchUpAmount(challenge: Challenge, today: string, catchUps: CatchUpEntry[], date: string): number | null {
  const range = catchUpRange(challenge, today, catchUps)
  if (!range) return null
  return randomInteger(range.minimumSek, range.maximumSek, seededRandom(`${challenge.seed}:catch-up:${date}`))
}

/**
 * Re-spreads the undrawn upcoming days so the total stays exactly the target after amounts were fixed outside the
 * daily entries (catch-ups). Only undrawn days change; confirmed and drawn amounts never do.
 */
export function rebalanceUpcoming(challenge: Challenge, today: string, catchUps: CatchUpEntry[], seed: string): Challenge {
  if (upcomingUndrawn(challenge, today).length === 0) return challenge
  const extra = sum(catchUps.map((entry) => entry.amount))
  const result = recalculateAfterMisses(challenge, today, seed, extra)
  return result.recovery.status === 'impossible' ? challenge : result.challenge
}

// ---------------------------------------------------------------------------------------------
// Shock Days
// ---------------------------------------------------------------------------------------------

const SHOCK_CHANCE = 0.1
const SHOCK_MIN_GAP_DAYS = 8
const SHOCK_SAFE_START_DAYS = 2
const SHOCK_SAFE_END_DAYS = 3

/**
 * The dates that are Shock Days: about one day in ten, never closer than eight days to each other, never in the first
 * days or the last days of a challenge. Derived from the challenge seed, so it is stable across reloads and needs no storage.
 */
export function shockDates(challenge: Challenge): Set<string> {
  const random = seededRandom(`${challenge.seed}:shock-days`)
  const dates = new Set<string>()
  let last = -SHOCK_MIN_GAP_DAYS
  challenge.days.forEach((day, index) => {
    const roll = random()
    const inside = index >= SHOCK_SAFE_START_DAYS && index < challenge.days.length - SHOCK_SAFE_END_DAYS
    if (inside && roll < SHOCK_CHANCE && index - last >= SHOCK_MIN_GAP_DAYS) {
      dates.add(day.date)
      last = index
    }
  })
  return dates
}

/**
 * The range of a Shock Day amount for today: noticeably higher than a normal day (125% to 250% of the normal maximum),
 * and capped so every remaining day can still keep its minimum. Null when today is not an offerable Shock Day.
 */
export function shockRange(challenge: Challenge, today: string, catchUps: CatchUpEntry[]): DailyLimits | null {
  if (challenge.config.shockDays !== true) return null
  const day = challenge.days.find((candidate) => candidate.date === today)
  if (!day || day.status !== 'undrawn' || !shockDates(challenge).has(today)) return null
  const others = challenge.days.filter((candidate) => candidate.date > today && candidate.status === 'undrawn').length
  if (others === 0) return null
  const needed = challenge.config.targetSek - committedSek(challenge, catchUps)
  const dynamic = challenge.config.dynamicRange === true
  const normalMaximum = dynamic ? dynamicBounds(needed, others + 1).maximumSek : challenge.config.preferredMaximumSek
  const minimumSek = Math.ceil(normalMaximum * 1.25)
  const maximumSek = Math.min(Math.round(normalMaximum * 2.5), needed - others * (dynamic ? 1 : challenge.config.initialMinimumSek))
  return maximumSek >= minimumSek ? { minimumSek, maximumSek } : null
}

/**
 * A proposal for a Shock Day. It is only a proposal: nothing is stored until the user accepts. When the user asks
 * again, `previous` is excluded so the same amount is not shown twice in a row (whenever another amount exists).
 */
export function proposeShockAmount(range: DailyLimits, previous: number | null, seed: string, attempt: number): number {
  const random = seededRandom(`${seed}:shock-amount:${attempt}`)
  const { minimumSek: low, maximumSek: high } = range
  if (previous === null || previous < low || previous > high || low === high) return randomInteger(low, high, random)
  const pick = randomInteger(low, high - 1, random)
  return pick >= previous ? pick + 1 : pick
}

/**
 * Accepts a Shock Day: today becomes a DRAWN entry with the proposed amount (not saved until confirmed through the
 * normal confirmation) and the other undrawn days are re-spread so the total stays exactly the target.
 */
export function acceptShockDay(challenge: Challenge, today: string, amount: number, catchUps: CatchUpEntry[], seed: string): Challenge {
  const range = shockRange(challenge, today, catchUps)
  if (!range || !Number.isInteger(amount) || amount < range.minimumSek || amount > range.maximumSek) {
    throw new Error('This is not a valid Shock Day amount')
  }
  const drawn: Challenge = {
    ...challenge,
    days: challenge.days.map((day) => (day.date === today ? { ...day, amount, status: 'drawn' as const } : day)),
  }
  return rebalanceUpcoming(drawn, today, catchUps, seed)
}
