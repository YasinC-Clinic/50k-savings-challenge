import Dexie from 'dexie'
import { DEFAULT_CHALLENGE_CONFIG, type Challenge } from '../domain/challenge'
import { InvalidChallengeError, parseChallenge } from './challenge-validation'
import { PersistenceDatabaseError, PersistenceIntegrityError } from './errors'
import { META_KEYS, toEntryRows, type SavingsDatabase } from './savings-database'

/** Stable identity of the challenge that existed in the launched (v1) app. */
export const LEGACY_CHALLENGE_ID = 'legacy-v1-challenge'
export const RAW_RECOVERY_FORMAT = '50k-savings-challenge-raw-recovery'
const LEGACY_ROW_ID = 'active'
const LEGACY_TABLES = ['challenges', 'dailyEntries'] as const

export const RAW_RECOVERY_WARNING =
  'This file is a raw, unvalidated copy of damaged data and may need technical assistance to use. ' +
  'The original data on this device has not been changed or deleted.'

export type LegacyState =
  | { kind: 'none' }
  | { kind: 'empty-marker' }
  | { kind: 'valid'; challenge: Challenge }
  | { kind: 'damaged'; reason: string }

export type LegacyMigrationStatus = 'migrated' | 'empty' | 'skipped'

export interface LegacyMigrationMeta {
  status: LegacyMigrationStatus
  at: string
  challengeId?: string
  reason?: string
}

function allTables(db: SavingsDatabase) {
  return [db.challenges, db.dailyEntries, db.challengeRecords, db.challengeEntries, db.appMeta]
}

/** Classifies what the v1 tables hold. Read-only; call inside a transaction for a consistent view. */
export async function readLegacyState(db: SavingsDatabase): Promise<LegacyState> {
  const marker = await db.challenges.get(LEGACY_ROW_ID)
  const entries = await db.dailyEntries.orderBy('date').toArray()

  if (!marker && entries.length === 0) return { kind: 'none' }
  if (!marker) return { kind: 'damaged', reason: 'Daily entries exist but the challenge record is missing' }
  if (entries.length === 0) return { kind: 'empty-marker' }

  const candidate = { id: LEGACY_CHALLENGE_ID, seed: marker.seed, config: DEFAULT_CHALLENGE_CONFIG, days: entries }
  try {
    return { kind: 'valid', challenge: parseChallenge(candidate, { requireExactTotal: false }) }
  } catch (error) {
    if (error instanceof InvalidChallengeError) return { kind: 'damaged', reason: error.message }
    throw error
  }
}

/**
 * Moves v1 data into the v2 tables inside ONE transaction. It runs at most once (recorded in appMeta),
 * never touches the v1 tables, and writes nothing at all if the legacy data is damaged.
 */
export async function migrateLegacyData(db: SavingsDatabase, now: string): Promise<void> {
  await db.transaction('rw', allTables(db), async () => {
    if (await db.appMeta.get(META_KEYS.legacyMigration)) return

    const state = await readLegacyState(db)
    if (state.kind === 'damaged') {
      throw new PersistenceIntegrityError(
        `Stored data from the previous version is damaged (${state.reason}). Export the raw data before doing anything else.`,
      )
    }
    if (state.kind === 'valid') {
      await writeMigratedChallenge(db, state.challenge, now)
      return
    }
    await recordMigration(db, { status: 'empty', at: now })
  })
}

async function writeMigratedChallenge(db: SavingsDatabase, challenge: Challenge, now: string): Promise<void> {
  await db.challengeRecords.put({
    id: challenge.id,
    seed: challenge.seed,
    config: challenge.config,
    origin: 'legacy-v1-migration',
    createdAt: now,
  })
  await db.challengeEntries.bulkPut(toEntryRows(challenge))
  if (!(await db.appMeta.get(META_KEYS.activeChallengeId))) {
    await db.appMeta.put({ key: META_KEYS.activeChallengeId, value: challenge.id })
  }
  await recordMigration(db, { status: 'migrated', at: now, challengeId: challenge.id })
}

function recordMigration(db: SavingsDatabase, meta: LegacyMigrationMeta): Promise<unknown> {
  return db.appMeta.put({ key: META_KEYS.legacyMigration, value: meta })
}

/**
 * The user chose to continue without the damaged legacy data. Only allowed while it is actually
 * damaged. The v1 tables stay untouched, so a raw export is still possible afterwards.
 */
export async function skipDamagedLegacyData(db: SavingsDatabase, now: string): Promise<void> {
  await db.transaction('rw', allTables(db), async () => {
    if (await db.appMeta.get(META_KEYS.legacyMigration)) {
      throw new PersistenceIntegrityError('There is no damaged legacy data to skip')
    }
    const state = await readLegacyState(db)
    if (state.kind !== 'damaged') throw new PersistenceIntegrityError('There is no damaged legacy data to skip')
    await recordMigration(db, { status: 'skipped', at: now, reason: state.reason })
  })
}

/**
 * Exports the raw v1 tables WITHOUT validating them, so damaged data can still be saved.
 * Opens its own read-only connection in dynamic mode: it never upgrades, creates or writes anything.
 */
export async function exportRawLegacyData(databaseName: string, exportedAt: string): Promise<string> {
  if (!(await Dexie.exists(databaseName))) {
    throw new PersistenceIntegrityError('There is no local database to export')
  }
  const connection = new Dexie(databaseName)
  try {
    await connection.open()
    const tables: Record<string, unknown[]> = {}
    for (const name of LEGACY_TABLES) {
      const present = connection.tables.some((table) => table.name === name)
      tables[name] = present ? await connection.table(name).toArray() : []
    }
    return JSON.stringify({ format: RAW_RECOVERY_FORMAT, version: 1, exportedAt, warning: RAW_RECOVERY_WARNING, database: databaseName, tables })
  } catch (error) {
    throw new PersistenceDatabaseError('Unable to read the local database for export', { cause: error })
  } finally {
    connection.close()
  }
}
