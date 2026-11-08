import type { CatchUpEntry, PenaltyEntry, PenaltyPayment } from '../domain/ledger'
import { isIsoTimestamp, isRecord } from './challenge-validation'
import { BackupValidationError } from './errors'

/** Everything outside the ordinary savings: penalties, payments of penalties, and catch-up savings. */
export interface Ledger {
  penalties: PenaltyEntry[]
  payments: PenaltyPayment[]
  catchUps: CatchUpEntry[]
}

export const EMPTY_LEDGER: Ledger = { penalties: [], payments: [], catchUps: [] }

const MAX_ENTRIES = 200_000
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

function fail(message: string): never {
  throw new BackupValidationError(message)
}

function list(value: unknown, name: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) fail(`Backup ${name} are invalid`)
  return value
}

const wholeNumber = (value: unknown, minimum: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum

function challengeIdOf(value: Record<string, unknown>, ids: Set<string>): string {
  if (typeof value.challengeId !== 'string' || !ids.has(value.challengeId)) fail('Backup ledger refers to an unknown challenge')
  return value.challengeId
}

function dateOf(value: Record<string, unknown>): string {
  if (typeof value.date !== 'string' || !DATE_KEY.test(value.date)) fail('Backup ledger contains an invalid date')
  return value.date
}

function parsePenalty(raw: unknown, ids: Set<string>): PenaltyEntry {
  if (!isRecord(raw)) return fail('Backup penalties are invalid')
  const { amountOre, baseOre, accruedAt } = raw
  if (!wholeNumber(amountOre, 0) || !wholeNumber(baseOre, 0) || !isIsoTimestamp(accruedAt)) return fail('Backup penalties are invalid')
  return { challengeId: challengeIdOf(raw, ids), date: dateOf(raw), amountOre, baseOre, accruedAt }
}

function parsePayment(raw: unknown, ids: Set<string>): PenaltyPayment {
  if (!isRecord(raw)) return fail('Backup penalty payments are invalid')
  const { id, amountOre, paidAt } = raw
  if (typeof id !== 'string' || id.length === 0 || id.length > 100 || !wholeNumber(amountOre, 1) || !isIsoTimestamp(paidAt)) {
    return fail('Backup penalty payments are invalid')
  }
  return { id, challengeId: challengeIdOf(raw, ids), amountOre, paidAt }
}

function parseCatchUp(raw: unknown, ids: Set<string>): CatchUpEntry {
  if (!isRecord(raw)) return fail('Backup catch-ups are invalid')
  const { amount, status, drawnAt, confirmedAt } = raw
  if (!wholeNumber(amount, 1) || (status !== 'drawn' && status !== 'confirmed') || !isIsoTimestamp(drawnAt)) return fail('Backup catch-ups are invalid')
  if (status === 'confirmed' && !isIsoTimestamp(confirmedAt)) return fail('Backup catch-ups are invalid')
  const entry: CatchUpEntry = { challengeId: challengeIdOf(raw, ids), date: dateOf(raw), amount, status, drawnAt }
  if (status === 'confirmed') entry.confirmedAt = confirmedAt as string
  return entry
}

function assertUnique(keys: string[], name: string): void {
  if (new Set(keys).size !== keys.length) fail(`Backup ${name} contain duplicates`)
}

/**
 * Validates the ledger section of a backup against the challenges of the same file. Returns null when the file has no
 * ledger (older backups), which tells the restore to leave the device's ledger alone.
 */
export function parseLedger(raw: unknown, challengeIds: Set<string>): Ledger | null {
  if (raw === undefined) return null
  if (!isRecord(raw)) return fail('Backup ledger is invalid')
  const penalties = list(raw.penalties, 'penalties').map((entry) => parsePenalty(entry, challengeIds))
  const payments = list(raw.payments, 'penalty payments').map((entry) => parsePayment(entry, challengeIds))
  const catchUps = list(raw.catchUps, 'catch-ups').map((entry) => parseCatchUp(entry, challengeIds))
  assertUnique(penalties.map((entry) => `${entry.challengeId}|${entry.date}`), 'penalties')
  assertUnique(payments.map((entry) => entry.id), 'penalty payments')
  assertUnique(catchUps.map((entry) => `${entry.challengeId}|${entry.date}`), 'catch-ups')
  for (const id of challengeIds) {
    const accrued = penalties.filter((entry) => entry.challengeId === id).reduce((total, entry) => total + entry.amountOre, 0)
    const paid = payments.filter((entry) => entry.challengeId === id).reduce((total, entry) => total + entry.amountOre, 0)
    if (paid > accrued) fail('Backup penalty payments exceed the penalties')
  }
  return { penalties, payments, catchUps }
}

const byKey = (a: { challengeId: string; date: string }, b: { challengeId: string; date: string }) =>
  a.challengeId.localeCompare(b.challengeId) || a.date.localeCompare(b.date)

/** Canonical order, so exporting twice gives identical files. */
export function sortLedger(ledger: Ledger): Ledger {
  return {
    penalties: [...ledger.penalties].sort(byKey),
    payments: [...ledger.payments].sort((a, b) => a.id.localeCompare(b.id)),
    catchUps: [...ledger.catchUps].sort(byKey),
  }
}

export function isEmptyLedger(ledger: Ledger): boolean {
  return ledger.penalties.length === 0 && ledger.payments.length === 0 && ledger.catchUps.length === 0
}
