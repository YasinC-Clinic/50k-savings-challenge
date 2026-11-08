import Dexie, { type Table } from 'dexie'
import { CHALLENGE, type Challenge, type ChallengeDay, type DayStatus, listChallengeDates } from '../domain/challenge'

const ACTIVE_CHALLENGE_ID = 'active'
const BACKUP_FORMAT = '50k-savings-challenge-backup'
const BACKUP_VERSION = 1
const statuses: ReadonlySet<string> = new Set(['undrawn', 'drawn', 'confirmed', 'missed'])

interface StoredChallenge {
  id: typeof ACTIVE_CHALLENGE_ID
  seed: string
}

interface BackupDocument {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  challenge: Challenge
}

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupValidationError'
  }
}

export class PersistenceIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PersistenceIntegrityError'
  }
}

export class PersistenceDatabaseError extends Error {
  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause })
    this.name = 'PersistenceDatabaseError'
  }
}

export class SavingsDatabase extends Dexie {
  challenges!: Table<StoredChallenge, string>
  dailyEntries!: Table<ChallengeDay, string>

  constructor(name = '50k-savings-challenge') {
    super(name)
    this.version(1).stores({
      challenges: 'id',
      dailyEntries: 'date',
    })
  }
}

export class SavingsRepository {
  readonly database: SavingsDatabase

  constructor(database: SavingsDatabase) {
    this.database = database
  }

  async saveChallenge(challenge: Challenge): Promise<void> {
    validateChallenge(challenge)
    try {
      await this.database.transaction('rw', this.database.challenges, this.database.dailyEntries, async () => {
        const existing = await this.database.dailyEntries.toArray()
        assertImmutableEntries(existing, challenge.days)
        await this.database.challenges.put({ id: ACTIVE_CHALLENGE_ID, seed: challenge.seed })
        await this.database.dailyEntries.bulkPut(challenge.days)
      })
    } catch (error) {
      rethrowPersistenceError(error)
    }
  }

  async loadChallenge(): Promise<Challenge | null> {
    try {
      const stored = await this.database.challenges.get(ACTIVE_CHALLENGE_ID)
      if (!stored) return null
      const days = await this.database.dailyEntries.orderBy('date').toArray()
      const challenge = { seed: stored.seed, days }
      validateChallenge(challenge)
      return challenge
    } catch (error) {
      rethrowPersistenceError(error)
    }
  }

  async entryCount(): Promise<number> {
    try {
      return await this.database.dailyEntries.count()
    } catch (error) {
      rethrowPersistenceError(error)
    }
  }

  async exportBackup(exportedAt = new Date().toISOString()): Promise<string> {
    const challenge = await this.loadChallenge()
    if (!challenge) throw new PersistenceIntegrityError('No challenge exists to export')
    return createBackupJson(challenge, exportedAt)
  }

  /** Replaces the single local challenge atomically; it never merges backup rows. */
  async restoreBackup(serializedBackup: string): Promise<void> {
    const backup = parseBackupJson(serializedBackup)
    try {
      await this.database.transaction('rw', this.database.challenges, this.database.dailyEntries, async () => {
        await this.database.dailyEntries.clear()
        await this.database.challenges.clear()
        await this.database.challenges.put({ id: ACTIVE_CHALLENGE_ID, seed: backup.challenge.seed })
        await this.database.dailyEntries.bulkAdd(backup.challenge.days)
      })
    } catch (error) {
      rethrowPersistenceError(error)
    }
  }
}

export function createBackupJson(challenge: Challenge, exportedAt: string): string {
  validateChallenge(challenge)
  if (!isIsoTimestamp(exportedAt)) throw new BackupValidationError('Backup export timestamp must be a valid ISO timestamp')
  const backup: BackupDocument = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, challenge }
  return JSON.stringify(backup)
}

function parseBackupJson(serializedBackup: string): BackupDocument {
  let candidate: unknown
  try {
    candidate = JSON.parse(serializedBackup)
  } catch {
    throw new BackupValidationError('Backup is not valid JSON')
  }
  if (!isRecord(candidate)) throw new BackupValidationError('Backup must be a JSON object')
  if (candidate.format !== BACKUP_FORMAT) throw new BackupValidationError('Backup format is not supported')
  if (candidate.version !== BACKUP_VERSION) throw new BackupValidationError('Backup version is not supported')
  if (typeof candidate.exportedAt !== 'string' || !isIsoTimestamp(candidate.exportedAt)) throw new BackupValidationError('Backup export timestamp is invalid')
  validateChallenge(candidate.challenge)
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: candidate.exportedAt, challenge: candidate.challenge }
}

function validateChallenge(candidate: unknown): asserts candidate is Challenge {
  if (!isRecord(candidate) || typeof candidate.seed !== 'string' || !Array.isArray(candidate.days)) throw new BackupValidationError('Challenge structure is invalid')
  const expectedDates = listChallengeDates()
  if (candidate.days.length !== expectedDates.length) throw new BackupValidationError('Challenge must contain exactly 181 daily entries')
  candidate.days.forEach((day, index) => {
    if (!isRecord(day) || day.date !== expectedDates[index] || !isValidAmount(day.amount) || !isDayStatus(day.status)) {
      throw new BackupValidationError('Challenge contains an invalid daily entry')
    }
  })
}

function assertImmutableEntries(existing: ChallengeDay[], incoming: ChallengeDay[]): void {
  const byDate = new Map(incoming.map((day) => [day.date, day]))
  existing.forEach((stored) => {
    const next = byDate.get(stored.date)
    if (!next) throw new PersistenceIntegrityError('A persisted daily entry cannot be removed')
    if (stored.status === 'confirmed' && (next.status !== 'confirmed' || next.amount !== stored.amount)) {
      throw new PersistenceIntegrityError('Confirmed entries are immutable')
    }
    if (stored.status === 'drawn' && (next.amount !== stored.amount || next.status === 'undrawn')) {
      throw new PersistenceIntegrityError('Drawn entries are immutable')
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= CHALLENGE.initialMinimumSek
}

function isDayStatus(value: unknown): value is DayStatus {
  return typeof value === 'string' && statuses.has(value)
}

function isIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && value.endsWith('Z')
}

function rethrowPersistenceError(error: unknown): never {
  if (error instanceof BackupValidationError || error instanceof PersistenceIntegrityError || error instanceof PersistenceDatabaseError) throw error
  throw new PersistenceDatabaseError('Local database operation failed', { cause: error })
}
