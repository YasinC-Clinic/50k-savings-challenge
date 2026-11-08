import Dexie from 'dexie'
import {
  confirmDay,
  createChallenge,
  drawToday,
  recalculateAfterMisses,
  type Challenge,
  type ChallengeDay,
} from '../../domain/challenge'

/**
 * Fixtures that reproduce EXACTLY what the launched v1 app (commit 60360ef) wrote.
 * They deliberately use raw Dexie with schema version 1, never SavingsDatabase, so a
 * future schema bump in production code cannot hide a migration bug.
 *
 * v1 database : challenges  (primary key id)   -> one row { id: 'active', seed }
 *               dailyEntries (primary key date) -> 181 rows { date, amount, status }
 * v1 backup   : { format, version: 1, exportedAt, challenge: { seed, days } }
 */

export const BACKUP_FORMAT = '50k-savings-challenge-backup'
export const EXPORTED_AT = '2027-01-06T09:00:00.000Z'

export interface LegacySeed {
  activeRow: Record<string, unknown> | null
  entries: unknown[]
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export async function seedV1Database(name: string, { activeRow, entries }: LegacySeed): Promise<void> {
  const db = new Dexie(name)
  db.version(1).stores({ challenges: 'id', dailyEntries: 'date' })
  await db.open()
  try {
    if (activeRow) await db.table('challenges').put(activeRow)
    if (entries.length) await db.table('dailyEntries').bulkPut(entries)
  } finally {
    db.close()
  }
}

export function seedV1Challenge(name: string, challenge: Pick<Challenge, 'seed' | 'days'>): Promise<void> {
  return seedV1Database(name, { activeRow: { id: 'active', seed: challenge.seed }, entries: challenge.days })
}

/** Dumps every table of an existing database without declaring a schema version. */
export async function snapshotRawTables(name: string): Promise<Record<string, unknown[]>> {
  const db = new Dexie(name)
  await db.open()
  try {
    const snapshot: Record<string, unknown[]> = {}
    for (const table of db.tables) snapshot[table.name] = await table.toArray()
    return snapshot
  } finally {
    db.close()
  }
}

/** The two v1 tables only; what must survive any migration untouched for rollback. */
export async function snapshotLegacyTables(name: string): Promise<{ active: unknown; entries: unknown[] }> {
  const raw = await snapshotRawTables(name)
  return {
    active: (raw.challenges ?? []).find((row) => (row as { id?: string }).id === 'active'),
    entries: raw.dailyEntries ?? [],
  }
}

/**
 * A realistic mid-flight v1 challenge:
 * 01-01 and 01-02 confirmed, 01-03 drawn but never confirmed, 01-03..01-05 therefore missed
 * after a recovery run on 01-06, 01-06 drawn today, later days re-allocated and undrawn.
 */
export function playedChallenge(seed = 'played-seed'): Challenge {
  let challenge = createChallenge(seed)
  challenge = confirmDay(drawToday(challenge, '2027-01-01'), '2027-01-01')
  challenge = confirmDay(drawToday(challenge, '2027-01-02'), '2027-01-02')
  challenge = drawToday(challenge, '2027-01-03')
  challenge = recalculateAfterMisses(challenge, '2027-01-06', 'run-1').challenge
  return drawToday(challenge, '2027-01-06')
}

export function v1BackupJson(challenge: Pick<Challenge, 'seed' | 'days'>, exportedAt = EXPORTED_AT): string {
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt, challenge: { seed: challenge.seed, days: challenge.days } })
}

export function withDay(days: ChallengeDay[], index: number, patch: Record<string, unknown>): unknown[] {
  return days.map((day, position) => (position === index ? { ...day, ...patch } : day))
}

export const sum = (days: Array<{ amount: number }>) => days.reduce((total, day) => total + day.amount, 0)
