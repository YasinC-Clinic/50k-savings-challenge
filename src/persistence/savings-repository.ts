import Dexie, { type Table } from 'dexie'
import { DEFAULT_CHALLENGE_CONFIG, type Challenge, type ChallengeConfig, type ChallengeDay, type DayStatus, listChallengeDates } from '../domain/challenge'

const LEGACY_ACTIVE_ID = 'active'
const APP_ID = '__challenge_app__'
const BACKUP_FORMAT = '50k-savings-challenge-backup'
const BACKUP_VERSION = 2
const statuses: ReadonlySet<string> = new Set(['undrawn', 'drawn', 'confirmed', 'missed'])
interface StoredChallenge { id: string; seed: string; challengeId?: string; config?: ChallengeConfig; days?: ChallengeDay[]; activeChallengeId?: string | null }
interface BackupV2 { format: typeof BACKUP_FORMAT; version: typeof BACKUP_VERSION; exportedAt: string; activeChallengeId: string; challenges: Challenge[] }
export class BackupValidationError extends Error { constructor(message: string) { super(message); this.name = 'BackupValidationError' } }
export class PersistenceIntegrityError extends Error { constructor(message: string) { super(message); this.name = 'PersistenceIntegrityError' } }
export class PersistenceDatabaseError extends Error { constructor(message: string, { cause }: { cause?: unknown } = {}) { super(message, { cause }); this.name = 'PersistenceDatabaseError' } }
export class SavingsDatabase extends Dexie { challenges!: Table<StoredChallenge, string>; dailyEntries!: Table<ChallengeDay, string>; constructor(name = '50k-savings-challenge') { super(name); this.version(1).stores({ challenges: 'id', dailyEntries: 'date' }) } }

export class SavingsRepository {
  readonly database: SavingsDatabase
  constructor(database: SavingsDatabase) { this.database = database }
  async listChallenges(): Promise<Challenge[]> { await this.migrateLegacy(); return this.readChallenges() }
  async activeChallengeId(): Promise<string | null> { await this.migrateLegacy(); return (await this.database.challenges.get(APP_ID))?.activeChallengeId ?? null }
  async setActiveChallenge(id: string): Promise<void> { await this.migrateLegacy(); if (!await this.loadChallenge(id)) throw new PersistenceIntegrityError('Challenge does not exist'); await this.database.challenges.put({ id: APP_ID, seed: '', activeChallengeId: id }) }
  async saveChallenge(challenge: Challenge): Promise<void> {
    validateChallenge(challenge); await this.migrateLegacy()
    try { await this.database.transaction('rw', this.database.challenges, async () => {
      const current = await this.database.challenges.get(challenge.id); if (current?.days) assertImmutableEntries(current.days, challenge.days)
      await this.database.challenges.put({ id: challenge.id, challengeId: challenge.id, seed: challenge.seed, config: challenge.config, days: challenge.days })
      const app = await this.database.challenges.get(APP_ID); if (!app?.activeChallengeId) await this.database.challenges.put({ id: APP_ID, seed: '', activeChallengeId: challenge.id })
    }) } catch (error) { rethrow(error) }
  }
  async loadChallenge(id?: string): Promise<Challenge | null> {
    await this.migrateLegacy()
    try { const selected = id ?? (await this.database.challenges.get(APP_ID))?.activeChallengeId; if (!selected) return null; const stored = await this.database.challenges.get(selected); if (!stored?.days || !stored.config || !stored.challengeId) return null; const challenge: Challenge = { id: stored.challengeId, seed: stored.seed, config: stored.config, days: stored.days }; validateChallenge(challenge); return challenge } catch (error) { rethrow(error) }
  }
  async entryCount(): Promise<number> { return (await this.loadChallenge())?.days.length ?? 0 }
  async exportBackup(exportedAt = new Date().toISOString()): Promise<string> { const challenges = await this.listChallenges(); const active = await this.activeChallengeId(); if (!active || !challenges.length) throw new PersistenceIntegrityError('No challenge exists to export'); return createBackupJson(challenges, active, exportedAt) }
  async restoreBackup(serialized: string): Promise<void> {
    const backup = parseBackup(serialized)
    try { await this.database.transaction('rw', this.database.challenges, async () => {
      const records = await this.database.challenges.toArray(); for (const item of records.filter((item) => item.id !== LEGACY_ACTIVE_ID)) await this.database.challenges.delete(item.id)
      for (const challenge of backup.challenges) await this.database.challenges.put({ id: challenge.id, challengeId: challenge.id, seed: challenge.seed, config: challenge.config, days: challenge.days })
      await this.database.challenges.put({ id: APP_ID, seed: '', activeChallengeId: backup.activeChallengeId })
    }) } catch (error) { rethrow(error) }
  }
  private async readChallenges(): Promise<Challenge[]> { const records = await this.database.challenges.toArray(); return records.filter((item) => item.id !== APP_ID && item.days && item.config && item.challengeId).map((item) => ({ id: item.challengeId!, seed: item.seed, config: item.config!, days: item.days! })) }
  private async migrateLegacy(): Promise<void> {
    if (await this.database.challenges.get(APP_ID)) return
    const legacy = await this.database.challenges.get(LEGACY_ACTIVE_ID)
    if (legacy && !legacy.days) { const days = await this.database.dailyEntries.orderBy('date').toArray(); if (days.length) { const id = legacy.challengeId ?? 'legacy-default-challenge'; const challenge: Challenge = { id, seed: legacy.seed, config: legacy.config ?? DEFAULT_CHALLENGE_CONFIG, days }; validateChallenge(challenge); await this.database.transaction('rw', this.database.challenges, async () => { await this.database.challenges.put({ id, challengeId: id, seed: challenge.seed, config: challenge.config, days: challenge.days }); await this.database.challenges.put({ id: APP_ID, seed: '', activeChallengeId: id }) }); return } }
    await this.database.challenges.put({ id: APP_ID, seed: '', activeChallengeId: null })
  }
}

export function createBackupJson(challenges: Challenge[] | Challenge, activeOrTimestamp: string, timestamp?: string): string { const all = Array.isArray(challenges) ? challenges : [challenges]; const activeChallengeId = Array.isArray(challenges) ? activeOrTimestamp : challenges.id; const exportedAt = Array.isArray(challenges) ? timestamp : activeOrTimestamp; if (!exportedAt || !isIso(exportedAt) || !all.some((challenge) => challenge.id === activeChallengeId)) throw new BackupValidationError('Backup metadata is invalid'); all.forEach(validateChallenge); return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, activeChallengeId, challenges: all } satisfies BackupV2) }
function parseBackup(serialized: string): BackupV2 { let value: unknown; try { value = JSON.parse(serialized) } catch { throw new BackupValidationError('Backup is not valid JSON') } if (!record(value) || value.format !== BACKUP_FORMAT || typeof value.exportedAt !== 'string' || !isIso(value.exportedAt)) throw new BackupValidationError('Backup is invalid'); if (value.version === 1 && record(value.challenge)) { validateChallenge(value.challenge); return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: value.exportedAt, activeChallengeId: value.challenge.id, challenges: [value.challenge] } } if (value.version !== BACKUP_VERSION || typeof value.activeChallengeId !== 'string' || !Array.isArray(value.challenges) || !value.challenges.length) throw new BackupValidationError('Backup version is not supported'); value.challenges.forEach(validateChallenge); const ids = new Set(value.challenges.map((challenge) => challenge.id)); if (ids.size !== value.challenges.length || !ids.has(value.activeChallengeId)) throw new BackupValidationError('Backup challenge identities are invalid'); return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: value.exportedAt, activeChallengeId: value.activeChallengeId, challenges: value.challenges } }
function validateChallenge(value: unknown): asserts value is Challenge { if (!record(value) || typeof value.id !== 'string' || !value.id || typeof value.seed !== 'string' || !record(value.config) || !Array.isArray(value.days)) throw new BackupValidationError('Challenge structure is invalid'); const config = value.config as unknown as ChallengeConfig; const expected = listChallengeDates(config); if (value.days.length !== expected.length) throw new BackupValidationError('Challenge contains an invalid number of daily entries'); value.days.forEach((day, index) => { if (!record(day) || day.date !== expected[index] || typeof day.amount !== 'number' || !Number.isSafeInteger(day.amount) || day.amount < config.initialMinimumSek || !isStatus(day.status)) throw new BackupValidationError('Challenge contains an invalid daily entry') }) }
function assertImmutableEntries(before: ChallengeDay[], after: ChallengeDay[]): void { const next = new Map(after.map((day) => [day.date, day])); before.forEach((day) => { const replacement = next.get(day.date); if (!replacement || (day.status === 'confirmed' && (replacement.status !== 'confirmed' || replacement.amount !== day.amount)) || (day.status === 'drawn' && (replacement.amount !== day.amount || replacement.status === 'undrawn'))) throw new PersistenceIntegrityError('Confirmed and drawn entries are immutable') }) }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isStatus(value: unknown): value is DayStatus { return typeof value === 'string' && statuses.has(value) }
function isIso(value: string): boolean { return !Number.isNaN(Date.parse(value)) && value.endsWith('Z') }
function rethrow(error: unknown): never { if (error instanceof Error) throw error; throw new PersistenceDatabaseError('Local database operation failed', { cause: error }) }
