import Dexie, { type Collection, type Table } from 'dexie'
import type { Challenge, ChallengeConfig, ChallengeDay, DayStatus } from '../domain/challenge'
import type { CatchUpEntry, PenaltyEntry, PenaltyPayment } from '../domain/ledger'

/** Where a challenge came from. Lets the UI label migrated and imported challenges later. */
export type ChallengeOrigin = 'created' | 'legacy-v1-migration' | 'legacy-v1-backup' | 'backup-import' | 'backup-restore'

export const CHALLENGE_ORIGINS: readonly ChallengeOrigin[] = [
  'created',
  'legacy-v1-migration',
  'legacy-v1-backup',
  'backup-import',
  'backup-restore',
]

export const MAX_NAME_LENGTH = 60

/** v1 row. The launched app stored exactly one: { id: 'active', seed }. Never written by v2 code. */
export interface LegacyChallengeRow {
  id: string
  seed: unknown
}

export interface ChallengeRecord {
  id: string
  seed: string
  config: ChallengeConfig
  origin: ChallengeOrigin
  createdAt: string
  /** Optional user-visible name (at most MAX_NAME_LENGTH characters). */
  name?: string
  /** For imported challenges: the id the challenge had in the backup it came from. */
  sourceChallengeId?: string
}

export interface ChallengeEntryRow {
  challengeId: string
  date: string
  amount: number
  status: DayStatus
}

export interface AppMetaRow {
  key: string
  value: unknown
}

export const META_KEYS = {
  activeChallengeId: 'activeChallengeId',
  legacyMigration: 'legacyMigration',
  /** The day the penalty feature first ran on this device. Days missed before it are never penalised. */
  penaltiesStartDate: 'penaltiesStartDate',
} as const

/**
 * Version 1 (launched app): `challenges` + `dailyEntries`, one challenge, entries keyed by date alone.
 * Version 2 adds three tables and leaves the v1 tables exactly as they are, so they remain
 * available for rollback and for raw recovery export. Data is moved by migrateLegacyData().
 */
export class SavingsDatabase extends Dexie {
  /** v1, read-only legacy table. */
  challenges!: Table<LegacyChallengeRow, string>
  /** v1, read-only legacy table. */
  dailyEntries!: Table<ChallengeDay, string>
  challengeRecords!: Table<ChallengeRecord, string>
  challengeEntries!: Table<ChallengeEntryRow, [string, string]>
  appMeta!: Table<AppMetaRow, string>
  penalties!: Table<PenaltyEntry, [string, string]>
  penaltyPayments!: Table<PenaltyPayment, string>
  catchUps!: Table<CatchUpEntry, [string, string]>

  constructor(name = '50k-savings-challenge') {
    super(name)
    this.version(1).stores({
      challenges: 'id',
      dailyEntries: 'date',
    })
    this.version(2).stores({
      challengeRecords: 'id',
      challengeEntries: '[challengeId+date]',
      appMeta: 'key',
    })
    // Version 3 only ADDS the ledger tables (penalties, penalty payments, catch-ups). No existing table or row changes.
    this.version(3).stores({
      penalties: '[challengeId+date]',
      penaltyPayments: 'id',
      catchUps: '[challengeId+date]',
    })
  }

  /** Penalties of ONE challenge, oldest first. */
  penaltiesOf(challengeId: string): Collection<PenaltyEntry, [string, string]> {
    return this.penalties.where('[challengeId+date]').between([challengeId, Dexie.minKey], [challengeId, Dexie.maxKey])
  }

  /** Catch-up entries of ONE challenge, oldest first. */
  catchUpsOf(challengeId: string): Collection<CatchUpEntry, [string, string]> {
    return this.catchUps.where('[challengeId+date]').between([challengeId, Dexie.minKey], [challengeId, Dexie.maxKey])
  }

  /** All entries of ONE challenge, ordered by date. Every read goes through here for challengeId isolation. */
  entriesOf(challengeId: string): Collection<ChallengeEntryRow, [string, string]> {
    return this.challengeEntries.where('[challengeId+date]').between([challengeId, Dexie.minKey], [challengeId, Dexie.maxKey])
  }
}

export function toEntryRows(challenge: Challenge): ChallengeEntryRow[] {
  return challenge.days.map((day) => ({
    challengeId: challenge.id,
    date: day.date,
    amount: day.amount,
    status: day.status,
  }))
}

export function toChallengeDay(row: ChallengeEntryRow): ChallengeDay {
  return { date: row.date, amount: row.amount, status: row.status }
}
