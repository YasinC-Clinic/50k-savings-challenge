import type { Challenge } from '../domain/challenge'
import { BackupValidationError, PersistenceIntegrityError, toPersistenceError } from './errors'
import {
  IMPORTED_V1_PLACEHOLDER_ID,
  createBackupJson,
  parseBackup,
  type CurrentBackup,
  type LegacyBackup,
} from './backup'
import {
  InvalidChallengeError,
  assertImmutableEntries,
  assertTotals,
  parseChallenge,
  sameConfig,
} from './challenge-validation'
import {
  exportRawLegacyData,
  migrateLegacyData,
  skipDamagedLegacyData,
} from './legacy-migration'
import {
  META_KEYS,
  toChallengeDay,
  toEntryRows,
  type ChallengeOrigin,
  type ChallengeRecord,
  type SavingsDatabase,
} from './savings-database'

export { BackupValidationError, PersistenceDatabaseError, PersistenceIntegrityError } from './errors'
export { SavingsDatabase } from './savings-database'
export { createBackupJson, describeBackup } from './backup'
export { RAW_RECOVERY_FORMAT, RAW_RECOVERY_WARNING, LEGACY_CHALLENGE_ID } from './legacy-migration'

export interface RepositoryOptions {
  /** Id generator for imported challenges. Injectable for tests. */
  createId?: () => string
  /** Clock for createdAt stamps. Injectable for tests. */
  now?: () => string
}

/**
 * v2 backups must say what to do. Replacing needs an explicit confirmation flag.
 * v1 backups can only ever be imported as a new challenge.
 */
export type RestoreOptions = { mode: 'import-as-new' } | { mode: 'replace'; confirmReplace: true }

export interface RestoreResult {
  mode: RestoreOptions['mode']
  importedChallengeIds: string[]
  activeChallengeId: string | null
}

export interface ChallengeSummary {
  id: string
  origin: ChallengeOrigin
  createdAt: string
  sourceChallengeId?: string
}

const MAX_ID_ATTEMPTS = 5

function defaultCreateId(): string {
  return globalThis.crypto.randomUUID()
}

function defaultNow(): string {
  return new Date().toISOString()
}

export class SavingsRepository {
  readonly database: SavingsDatabase
  private readonly createId: () => string
  private readonly now: () => string
  private migration: Promise<void> | null = null

  constructor(database: SavingsDatabase, options: RepositoryOptions = {}) {
    this.database = database
    this.createId = options.createId ?? defaultCreateId
    this.now = options.now ?? defaultNow
  }

  // ---------------------------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------------------------

  /** All challenges, ordered by id. */
  async listChallenges(): Promise<Challenge[]> {
    return this.run(() => this.readAllChallenges())
  }

  /** Lightweight list for pickers: origin and creation time, oldest first. */
  async listChallengeSummaries(): Promise<ChallengeSummary[]> {
    return this.run(async () => {
      const records = await this.database.challengeRecords.toArray()
      return records
        .map(toSummary)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    })
  }

  async activeChallengeId(): Promise<string | null> {
    return this.run(() => this.readActiveId())
  }

  /** Loads one challenge. Without an id, loads the active one. Unknown ids return null. */
  async loadChallenge(id?: string): Promise<Challenge | null> {
    return this.run(async () => {
      const selected = id ?? (await this.readActiveId())
      if (!selected) return null
      const record = await this.database.challengeRecords.get(selected)
      return record ? this.readChallenge(record) : null
    })
  }

  /** Number of daily entries of the active challenge. */
  async entryCount(): Promise<number> {
    return this.run(async () => {
      const active = await this.readActiveId()
      return active ? this.database.entriesOf(active).count() : 0
    })
  }

  // ---------------------------------------------------------------------------------------------
  // Writing
  // ---------------------------------------------------------------------------------------------

  async setActiveChallenge(id: string): Promise<void> {
    return this.run(() =>
      this.database.transaction('rw', [this.database.challengeRecords, this.database.appMeta], async () => {
        if (!(await this.database.challengeRecords.get(id))) {
          throw new PersistenceIntegrityError('Challenge does not exist')
        }
        await this.database.appMeta.put({ key: META_KEYS.activeChallengeId, value: id })
      }),
    )
  }

  /**
   * Creates or updates ONE challenge. Seed and config of an existing challenge never change, entries
   * are never removed, and confirmed or drawn entries are immutable. Other challenges are never touched.
   */
  async saveChallenge(challenge: Challenge): Promise<void> {
    const clean = parseForWrite(challenge)
    return this.run(() =>
      this.database.transaction('rw', this.writeTables(), async () => {
        const existing = await this.database.challengeRecords.get(clean.id)
        if (existing) await this.assertCompatibleWithStored(existing, clean)
        assertTotalsForWrite(clean)
        if (!existing) await this.database.challengeRecords.put(this.newRecord(clean, 'created'))
        await this.database.challengeEntries.bulkPut(toEntryRows(clean))
        await this.activateIfNone(clean.id)
      }),
    )
  }

  // ---------------------------------------------------------------------------------------------
  // Backup
  // ---------------------------------------------------------------------------------------------

  async exportBackup(exportedAt = this.now()): Promise<string> {
    return this.run(async () => {
      const challenges = await this.readAllChallenges()
      const active = await this.readActiveId()
      if (!active || challenges.length === 0) throw new PersistenceIntegrityError('No challenge exists to export')
      return createBackupJson(challenges, active, exportedAt)
    })
  }

  /**
   * Validates the whole file first, then applies it in a single transaction. Any failure leaves the
   * device exactly as it was.
   *  - v1 file: always imported as ONE new independent challenge with a new id.
   *  - v2 file, 'import-as-new': every challenge gets a new id; nothing existing is touched.
   *  - v2 file, 'replace': replaces ALL challenges; requires confirmReplace: true.
   */
  async restoreBackup(serialized: string, options: RestoreOptions): Promise<RestoreResult> {
    const backup = parseBackup(serialized)
    assertRestoreAllowed(backup, options)
    return this.run(() =>
      this.database.transaction('rw', this.writeTables(), async () => {
        if (backup.version === 2 && options.mode === 'replace') return this.replaceEverything(backup)
        return this.importAsNew(backup)
      }),
    )
  }

  // ---------------------------------------------------------------------------------------------
  // Damaged legacy data
  // ---------------------------------------------------------------------------------------------

  /** Raw copy of the v1 tables, even when they fail validation. Read-only; never changes the database. */
  async exportRawLegacyData(exportedAt = this.now()): Promise<string> {
    try {
      return await exportRawLegacyData(this.database.name, exportedAt)
    } catch (error) {
      throw toPersistenceError(error)
    }
  }

  /** Continue without damaged v1 data. The v1 tables are left untouched. */
  async skipDamagedLegacyData(): Promise<void> {
    try {
      await skipDamagedLegacyData(this.database, this.now())
      this.migration = null
    } catch (error) {
      throw toPersistenceError(error)
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  /** Every public operation first makes sure v1 data has been migrated, and maps errors to typed ones. */
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      await this.ensureMigrated()
      return await operation()
    } catch (error) {
      throw toPersistenceError(error)
    }
  }

  private ensureMigrated(): Promise<void> {
    if (!this.migration) {
      this.migration = migrateLegacyData(this.database, this.now()).catch((error: unknown) => {
        this.migration = null
        throw error
      })
    }
    return this.migration
  }

  private writeTables() {
    return [this.database.challengeRecords, this.database.challengeEntries, this.database.appMeta]
  }

  private async readActiveId(): Promise<string | null> {
    const row = await this.database.appMeta.get(META_KEYS.activeChallengeId)
    return typeof row?.value === 'string' ? row.value : null
  }

  private async readAllChallenges(): Promise<Challenge[]> {
    const records = await this.database.challengeRecords.toArray()
    records.sort((a, b) => a.id.localeCompare(b.id))
    const challenges: Challenge[] = []
    for (const record of records) challenges.push(await this.readChallenge(record))
    return challenges
  }

  private async readChallenge(record: ChallengeRecord): Promise<Challenge> {
    const rows = await this.database.entriesOf(record.id).toArray()
    const candidate = { id: record.id, seed: record.seed, config: record.config, days: rows.map(toChallengeDay) }
    try {
      return parseChallenge(candidate, { requireExactTotal: false })
    } catch (error) {
      if (error instanceof InvalidChallengeError) {
        throw new PersistenceIntegrityError(`Stored challenge ${record.id} is damaged: ${error.message}`)
      }
      throw error
    }
  }

  private newRecord(challenge: Challenge, origin: ChallengeOrigin, sourceChallengeId?: string): ChallengeRecord {
    const record: ChallengeRecord = {
      id: challenge.id,
      seed: challenge.seed,
      config: challenge.config,
      origin,
      createdAt: this.now(),
    }
    if (sourceChallengeId !== undefined) record.sourceChallengeId = sourceChallengeId
    return record
  }

  private async assertCompatibleWithStored(record: ChallengeRecord, incoming: Challenge): Promise<void> {
    if (record.seed !== incoming.seed || !sameConfig(record.config, incoming.config)) {
      throw new PersistenceIntegrityError('The seed and configuration of an existing challenge cannot change')
    }
    const stored = (await this.database.entriesOf(record.id).toArray()).map(toChallengeDay)
    try {
      assertImmutableEntries(stored, incoming.days)
    } catch (error) {
      if (error instanceof InvalidChallengeError) throw new PersistenceIntegrityError(error.message)
      throw error
    }
  }

  private async activateIfNone(id: string): Promise<void> {
    if (await this.readActiveId()) return
    await this.database.appMeta.put({ key: META_KEYS.activeChallengeId, value: id })
  }

  private async replaceEverything(backup: CurrentBackup): Promise<RestoreResult> {
    await this.database.challengeEntries.clear()
    await this.database.challengeRecords.clear()
    for (const challenge of backup.challenges) {
      await this.database.challengeRecords.put(this.newRecord(challenge, 'backup-restore'))
      await this.database.challengeEntries.bulkAdd(toEntryRows(challenge))
    }
    await this.database.appMeta.put({ key: META_KEYS.activeChallengeId, value: backup.activeChallengeId })
    return {
      mode: 'replace',
      importedChallengeIds: backup.challenges.map((challenge) => challenge.id),
      activeChallengeId: backup.activeChallengeId,
    }
  }

  private async importAsNew(backup: LegacyBackup | CurrentBackup): Promise<RestoreResult> {
    const sources = backup.version === 1 ? [backup.challenge] : backup.challenges
    const origin: ChallengeOrigin = backup.version === 1 ? 'legacy-v1-backup' : 'backup-import'
    const importedIds: string[] = []

    for (const source of sources) {
      const id = await this.freshChallengeId(importedIds)
      const imported: Challenge = { ...source, id }
      const sourceId = source.id === IMPORTED_V1_PLACEHOLDER_ID ? undefined : source.id
      await this.database.challengeRecords.put(this.newRecord(imported, origin, sourceId))
      await this.database.challengeEntries.bulkAdd(toEntryRows(imported))
      importedIds.push(id)
    }

    await this.activateIfNone(importedIds[0])
    return { mode: 'import-as-new', importedChallengeIds: importedIds, activeChallengeId: await this.readActiveId() }
  }

  private async freshChallengeId(alreadyUsed: string[]): Promise<string> {
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const candidate = this.createId()
      const taken = alreadyUsed.includes(candidate) || (await this.database.challengeRecords.get(candidate))
      if (!taken) return candidate
    }
    throw new PersistenceIntegrityError('Unable to generate a unique challenge id')
  }
}

/** Structure only; totals are checked later, after the immutability rules, so the clearest error wins. */
function parseForWrite(challenge: Challenge): Challenge {
  try {
    return parseChallenge(challenge, { requireExactTotal: true, skipTotals: true })
  } catch (error) {
    if (error instanceof InvalidChallengeError) throw new PersistenceIntegrityError(error.message)
    throw error
  }
}

function assertTotalsForWrite(challenge: Challenge): void {
  try {
    assertTotals(challenge.days, challenge.config, { requireExactTotal: true })
  } catch (error) {
    if (error instanceof InvalidChallengeError) throw new PersistenceIntegrityError(error.message)
    throw error
  }
}

function assertRestoreAllowed(backup: LegacyBackup | CurrentBackup, options: RestoreOptions | undefined): void {
  if (backup.version === 1) {
    if (options?.mode !== 'import-as-new') {
      throw new BackupValidationError('A legacy backup can only be imported as a new challenge')
    }
    return
  }
  if (options?.mode === 'import-as-new') return
  if (options?.mode === 'replace' && options.confirmReplace === true) return
  if (options?.mode === 'replace') throw new BackupValidationError('Replacing all challenges needs explicit confirmation')
  throw new BackupValidationError('Choose whether to replace all challenges or import them as new ones')
}

function toSummary(record: ChallengeRecord): ChallengeSummary {
  const summary: ChallengeSummary = { id: record.id, origin: record.origin, createdAt: record.createdAt }
  if (record.sourceChallengeId !== undefined) summary.sourceChallengeId = record.sourceChallengeId
  return summary
}
