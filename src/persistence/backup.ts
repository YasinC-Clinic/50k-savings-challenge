import { DEFAULT_CHALLENGE_CONFIG, type Challenge } from '../domain/challenge'
import { InvalidChallengeError, isIsoTimestamp, isRecord, parseChallenge } from './challenge-validation'
import { BackupValidationError } from './errors'

export const BACKUP_FORMAT = '50k-savings-challenge-backup'
export const BACKUP_VERSION = 2
export const MAX_BACKUP_CHALLENGES = 50
/** Placeholder id for the single challenge inside a v1 file; the repository assigns a real one on import. */
export const IMPORTED_V1_PLACEHOLDER_ID = 'imported-v1-backup'

export interface LegacyBackup {
  version: 1
  exportedAt: string
  /** Default config; its id is IMPORTED_V1_PLACEHOLDER_ID. */
  challenge: Challenge
}

export interface CurrentBackup {
  version: 2
  exportedAt: string
  activeChallengeId: string
  challenges: Challenge[]
}

export type ParsedBackup = LegacyBackup | CurrentBackup

export interface BackupSummary {
  version: 1 | 2
  challengeCount: number
}

export function createBackupJson(challenges: Challenge[], activeChallengeId: string, exportedAt: string): string {
  if (!isIsoTimestamp(exportedAt)) throw new BackupValidationError('Backup export timestamp must be a valid ISO timestamp')
  const clean = challenges.map((challenge) => asBackupError(() => parseChallenge(challenge, { requireExactTotal: true })))
  assertUniqueIds(clean)
  if (!clean.some((challenge) => challenge.id === activeChallengeId)) {
    throw new BackupValidationError('Backup active challenge is not part of the backup')
  }
  clean.sort((a, b) => a.id.localeCompare(b.id))
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, activeChallengeId, challenges: clean })
}

/** Validates the WHOLE file. Nothing is written anywhere until this returns. */
export function parseBackup(serialized: string): ParsedBackup {
  const value = parseJson(serialized)
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) throw new BackupValidationError('Backup format is not supported')
  if (!isIsoTimestamp(value.exportedAt)) throw new BackupValidationError('Backup export timestamp is invalid')

  if (value.version === 1) return parseLegacyBackup(value, value.exportedAt)
  if (value.version === BACKUP_VERSION) return parseCurrentBackup(value, value.exportedAt)
  throw new BackupValidationError('Backup version is not supported')
}

export function describeBackup(serialized: string): BackupSummary {
  const backup = parseBackup(serialized)
  return backup.version === 1 ? { version: 1, challengeCount: 1 } : { version: 2, challengeCount: backup.challenges.length }
}

function parseLegacyBackup(value: Record<string, unknown>, exportedAt: string): LegacyBackup {
  if (!isRecord(value.challenge)) throw new BackupValidationError('Backup challenge is missing')
  const candidate = {
    id: IMPORTED_V1_PLACEHOLDER_ID,
    seed: value.challenge.seed,
    config: DEFAULT_CHALLENGE_CONFIG,
    days: value.challenge.days,
  }
  // Real v1 files come from the launched engine, so only the lenient totals rule is applied.
  const challenge = asBackupError(() => parseChallenge(candidate, { requireExactTotal: false }))
  return { version: 1, exportedAt, challenge }
}

function parseCurrentBackup(value: Record<string, unknown>, exportedAt: string): CurrentBackup {
  const { activeChallengeId, challenges } = value
  if (typeof activeChallengeId !== 'string') throw new BackupValidationError('Backup active challenge is missing')
  if (!Array.isArray(challenges) || challenges.length === 0) throw new BackupValidationError('Backup contains no challenges')
  if (challenges.length > MAX_BACKUP_CHALLENGES) throw new BackupValidationError('Backup contains too many challenges')

  const parsed = challenges.map((challenge) => asBackupError(() => parseChallenge(challenge, { requireExactTotal: true })))
  assertUniqueIds(parsed)
  if (!parsed.some((challenge) => challenge.id === activeChallengeId)) {
    throw new BackupValidationError('Backup active challenge is not part of the backup')
  }
  return { version: 2, exportedAt, activeChallengeId, challenges: parsed }
}

function parseJson(serialized: string): unknown {
  try {
    return JSON.parse(serialized)
  } catch {
    throw new BackupValidationError('Backup is not valid JSON')
  }
}

function assertUniqueIds(challenges: Challenge[]): void {
  const ids = new Set(challenges.map((challenge) => challenge.id))
  if (ids.size !== challenges.length) throw new BackupValidationError('Backup contains duplicate challenge ids')
}

function asBackupError<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof InvalidChallengeError) throw new BackupValidationError(error.message)
    throw error
  }
}
