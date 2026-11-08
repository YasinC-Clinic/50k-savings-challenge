import type { Challenge } from '../domain/challenge'
import {
  isCompleted,
  penalisableDates,
  penaltyTotals,
  planPenalties,
  remainingTargetOre,
  type CatchUpEntry,
  type PenaltyEntry,
  type PenaltyPayment,
} from '../domain/ledger'
import { sortLedger, type Ledger } from './ledger'
import { BackupValidationError, PersistenceIntegrityError, toPersistenceError } from './errors'
import {
  IMPORTED_V1_PLACEHOLDER_ID,
  createBackupJson,
  parseBackup,
  type ChallengeMeta,
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
  MAX_NAME_LENGTH,
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
export type { BackupChallengeSummary, BackupSummary } from './backup'
export { LegacyDataDamagedError, PersistenceVersionError } from './errors'
export { MAX_NAME_LENGTH } from './savings-database'
export type { ChallengeOrigin } from './savings-database'
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
  name?: string
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

  /** Changes only the display name. An empty name removes it. */
  async renameChallenge(id: string, name: string): Promise<void> {
    const cleaned = cleanName(name)
    return this.run(() =>
      this.database.transaction('rw', this.database.challengeRecords, async () => {
        const record = await this.database.challengeRecords.get(id)
        if (!record) throw new PersistenceIntegrityError('Challenge does not exist')
        const { name: _previous, ...rest } = record
        await this.database.challengeRecords.put(cleaned ? { ...rest, name: cleaned } : rest)
      }),
    )
  }

  /**
   * Creates or updates ONE challenge. Seed and config of an existing challenge never change, entries
   * are never removed, and confirmed or drawn entries are immutable. Other challenges are never touched.
   */
  async saveChallenge(challenge: Challenge, options: { name?: string } = {}): Promise<void> {
    const clean = parseForWrite(challenge)
    const name = cleanName(options.name)
    return this.run(() =>
      this.database.transaction('rw', this.writeTables(), () => this.writeChallenge(clean, name)),
    )
  }

  // ---------------------------------------------------------------------------------------------
  // Ledger: penalties, penalty payments and catch-up savings (kept apart from the ordinary savings)
  // ---------------------------------------------------------------------------------------------

  /** Penalties, payments and catch-ups of every challenge: the permanent penalty pot lives here. */
  async readLedger(): Promise<Ledger> {
    return this.run(() => this.loadLedger())
  }

  /**
   * Writes the 3% penalty of every missed date that has none yet, in one transaction. Safe to call any number of times,
   * from any number of tabs: a date that already has a penalty is skipped. No penalties once the target is reached.
   */
  async accruePenalties(challengeId: string, today: string): Promise<PenaltyEntry[]> {
    return this.run(() =>
      this.database.transaction('rw', this.writeTables(), async () => {
        const start = await this.ensurePenaltiesStart(today)
        const record = await this.database.challengeRecords.get(challengeId)
        if (!record) return []
        const challenge = await this.readChallenge(record)
        const catchUps = await this.database.catchUpsOf(challengeId).toArray()
        if (isCompleted(challenge, catchUps)) return []
        const entries = planPenalties({
          challengeId,
          remainingOre: remainingTargetOre(challenge, catchUps),
          existing: await this.database.penaltiesOf(challengeId).toArray(),
          missedDates: penalisableDates(challenge, start),
          accruedAt: this.now(),
        })
        if (entries.length > 0) await this.database.penalties.bulkAdd(entries)
        return entries
      }),
    )
  }

  /** The user confirms that they paid part of a challenge's penalties themselves. Never more than what is outstanding. */
  async recordPenaltyPayment(challengeId: string, amountOre: number): Promise<PenaltyPayment> {
    return this.run(() =>
      this.database.transaction('rw', this.writeTables(), async () => {
        const penalties = await this.database.penaltiesOf(challengeId).toArray()
        const payments = (await this.database.penaltyPayments.toArray()).filter((payment) => payment.challengeId === challengeId)
        const { outstandingOre } = penaltyTotals(penalties, payments)
        if (!Number.isSafeInteger(amountOre) || amountOre < 1 || amountOre > outstandingOre) {
          throw new PersistenceIntegrityError('A payment must be between 1 öre and the outstanding penalty')
        }
        const payment: PenaltyPayment = { id: this.createId(), challengeId, amountOre, paidAt: this.now() }
        await this.database.penaltyPayments.add(payment)
        return payment
      }),
    )
  }

  /**
   * Saves one catch-up step together with the re-spread upcoming days, atomically. A catch-up is drawn first (fixed
   * amount) and confirmed later; a confirmed one never changes. Only a missed day can be caught up.
   */
  async saveChallengeWithCatchUp(challenge: Challenge, entry: CatchUpEntry): Promise<void> {
    const clean = parseForWrite(challenge)
    return this.run(() =>
      this.database.transaction('rw', this.writeTables(), async () => {
        const day = clean.days.find((candidate) => candidate.date === entry.date)
        if (entry.challengeId !== clean.id || day?.status !== 'missed') throw new PersistenceIntegrityError('Only a missed day can be caught up')
        if (!Number.isSafeInteger(entry.amount) || entry.amount < 1) throw new PersistenceIntegrityError('A catch-up amount must be a positive whole number')
        const stored = await this.database.catchUps.get([entry.challengeId, entry.date])
        if (stored?.status === 'confirmed') throw new PersistenceIntegrityError('Confirmed catch-ups are immutable')
        if (stored && stored.amount !== entry.amount) throw new PersistenceIntegrityError('A drawn catch-up amount is fixed')
        if (!stored && entry.status !== 'drawn') throw new PersistenceIntegrityError('A catch-up must be drawn before it is confirmed')
        await this.database.catchUps.put(entry)
        await this.writeChallenge(clean)
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
      const meta: Record<string, ChallengeMeta> = {}
      for (const record of await this.database.challengeRecords.toArray()) {
        meta[record.id] = { name: record.name, origin: record.origin }
      }
      return createBackupJson(challenges, active, exportedAt, meta, await this.loadLedger())
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
    const db = this.database
    return [db.challengeRecords, db.challengeEntries, db.appMeta, db.penalties, db.penaltyPayments, db.catchUps]
  }

  private async loadLedger(): Promise<Ledger> {
    const db = this.database
    return sortLedger({ penalties: await db.penalties.toArray(), payments: await db.penaltyPayments.toArray(), catchUps: await db.catchUps.toArray() })
  }

  private async writeChallenge(clean: Challenge, name?: string): Promise<void> {
    const existing = await this.database.challengeRecords.get(clean.id)
    if (existing) await this.assertCompatibleWithStored(existing, clean)
    assertTotalsForWrite(clean)
    if (!existing) await this.database.challengeRecords.put(this.newRecord(clean, 'created', { name }))
    await this.database.challengeEntries.bulkPut(toEntryRows(clean))
    await this.activateIfNone(clean.id)
  }

  /** The day the penalty feature first ran on this device. Days missed earlier are never penalised retroactively. */
  private async ensurePenaltiesStart(today: string): Promise<string> {
    const row = await this.database.appMeta.get(META_KEYS.penaltiesStartDate)
    if (typeof row?.value === 'string') return row.value
    await this.database.appMeta.put({ key: META_KEYS.penaltiesStartDate, value: today })
    return today
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

  private newRecord(
    challenge: Challenge,
    origin: ChallengeOrigin,
    extras: { name?: string; sourceChallengeId?: string } = {},
  ): ChallengeRecord {
    const record: ChallengeRecord = {
      id: challenge.id,
      seed: challenge.seed,
      config: challenge.config,
      origin,
      createdAt: this.now(),
    }
    if (extras.name) record.name = extras.name
    if (extras.sourceChallengeId !== undefined) record.sourceChallengeId = extras.sourceChallengeId
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
      const meta = backup.meta[challenge.id]
      await this.database.challengeRecords.put(this.newRecord(challenge, meta?.origin ?? 'backup-restore', { name: meta?.name }))
      await this.database.challengeEntries.bulkAdd(toEntryRows(challenge))
    }
    // A file with a ledger is a complete snapshot of it; an older file has none, so the device's own ledger is left alone.
    if (backup.ledger) {
      await Promise.all([this.database.penalties.clear(), this.database.penaltyPayments.clear(), this.database.catchUps.clear()])
      await this.database.penalties.bulkAdd(backup.ledger.penalties)
      await this.database.penaltyPayments.bulkAdd(backup.ledger.payments)
      await this.database.catchUps.bulkAdd(backup.ledger.catchUps)
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
    const idMap = new Map<string, string>()

    for (const source of sources) {
      const id = await this.freshChallengeId(importedIds)
      const imported: Challenge = { ...source, id }
      const sourceChallengeId = source.id === IMPORTED_V1_PLACEHOLDER_ID ? undefined : source.id
      const name = backup.version === 2 ? backup.meta[source.id]?.name : undefined
      await this.database.challengeRecords.put(this.newRecord(imported, origin, { name, sourceChallengeId }))
      await this.database.challengeEntries.bulkAdd(toEntryRows(imported))
      importedIds.push(id)
      idMap.set(source.id, id)
    }

    if (backup.version === 2 && backup.ledger) {
      const mapped = (challengeId: string) => idMap.get(challengeId) ?? challengeId
      await this.database.penalties.bulkAdd(backup.ledger.penalties.map((entry) => ({ ...entry, challengeId: mapped(entry.challengeId) })))
      await this.database.catchUps.bulkAdd(backup.ledger.catchUps.map((entry) => ({ ...entry, challengeId: mapped(entry.challengeId) })))
      await this.database.penaltyPayments.bulkAdd(
        backup.ledger.payments.map((payment) => ({ ...payment, id: this.createId(), challengeId: mapped(payment.challengeId) })),
      )
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

function cleanName(name: string | undefined): string | undefined {
  const trimmed = name?.trim()
  if (!trimmed) return undefined
  if (trimmed.length > MAX_NAME_LENGTH) throw new PersistenceIntegrityError('Challenge name is too long')
  return trimmed
}

function toSummary(record: ChallengeRecord): ChallengeSummary {
  const summary: ChallengeSummary = { id: record.id, origin: record.origin, createdAt: record.createdAt }
  if (record.name) summary.name = record.name
  if (record.sourceChallengeId !== undefined) summary.sourceChallengeId = record.sourceChallengeId
  return summary
}
