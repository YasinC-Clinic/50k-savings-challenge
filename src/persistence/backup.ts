import { DEFAULT_CHALLENGE_CONFIG, type Challenge } from '../domain/challenge'
import { InvalidChallengeError, isIsoTimestamp, isRecord, parseChallenge } from './challenge-validation'
import { BackupValidationError } from './errors'
import { EMPTY_LEDGER, parseLedger, sortLedger, type Ledger } from './ledger'
import { CHALLENGE_ORIGINS, MAX_NAME_LENGTH, type ChallengeOrigin } from './savings-database'

export const BACKUP_FORMAT = '50k-savings-challenge-backup'
export const BACKUP_VERSION = 2
export const MAX_BACKUP_CHALLENGES = 50
/** Upper bound for a backup file; 50 challenges of 1,100 days are about 5 MB. */
export const MAX_BACKUP_CHARACTERS = 20_000_000
/** Placeholder id for the single challenge inside a v1 file; the repository assigns a real one on import. */
export const IMPORTED_V1_PLACEHOLDER_ID = 'imported-v1-backup'

/** Optional descriptive data stored next to a challenge in a v2 backup. */
export interface ChallengeMeta {
  name?: string
  origin?: ChallengeOrigin
}

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
  meta: Record<string, ChallengeMeta>
  /** Penalties, penalty payments and catch-ups. Null for files made before the ledger existed. */
  ledger: Ledger | null
}

export type ParsedBackup = LegacyBackup | CurrentBackup

export interface BackupChallengeSummary {
  name?: string
  targetSek: number
  startDate: string
  endDate: string
  savedSek: number
}

export interface BackupSummary {
  version: 1 | 2
  challengeCount: number
  challenges: BackupChallengeSummary[]
}

export function createBackupJson(
  challenges: Challenge[],
  activeChallengeId: string,
  exportedAt: string,
  meta: Record<string, ChallengeMeta> = {},
  ledger: Ledger = EMPTY_LEDGER,
): string {
  if (!isIsoTimestamp(exportedAt)) throw new BackupValidationError('Backup export timestamp must be a valid ISO timestamp')
  const clean = challenges.map((challenge) => asBackupError(() => parseChallenge(challenge, { requireExactTotal: true })))
  assertUniqueIds(clean)
  if (!clean.some((challenge) => challenge.id === activeChallengeId)) {
    throw new BackupValidationError('Backup active challenge is not part of the backup')
  }
  clean.sort((a, b) => a.id.localeCompare(b.id))
  const serialized = clean.map((challenge) => ({ ...challenge, ...definedMeta(meta[challenge.id]) }))
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, activeChallengeId, challenges: serialized, ledger: sortLedger(ledger) })
}

/** Validates the WHOLE file. Nothing is written anywhere until this returns. */
export function parseBackup(serialized: string): ParsedBackup {
  if (typeof serialized !== 'string' || serialized.length > MAX_BACKUP_CHARACTERS) {
    throw new BackupValidationError('Backup is too large')
  }
  const value = parseJson(serialized)
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) throw new BackupValidationError('Backup format is not supported')
  if (!isIsoTimestamp(value.exportedAt)) throw new BackupValidationError('Backup export timestamp is invalid')

  if (value.version === 1) return parseLegacyBackup(value, value.exportedAt)
  if (value.version === BACKUP_VERSION) return parseCurrentBackup(value, value.exportedAt)
  throw new BackupValidationError('Backup version is not supported')
}

/** Everything a person needs to see before deciding how to import a file. Validates the whole file. */
export function describeBackup(serialized: string): BackupSummary {
  const backup = parseBackup(serialized)
  if (backup.version === 1) {
    return { version: 1, challengeCount: 1, challenges: [summarize(backup.challenge)] }
  }
  const challenges = backup.challenges.map((challenge) => summarize(challenge, backup.meta[challenge.id]?.name))
  return { version: 2, challengeCount: challenges.length, challenges }
}

function summarize(challenge: Challenge, name?: string): BackupChallengeSummary {
  const savedSek = challenge.days.filter((day) => day.status === 'confirmed').reduce((total, day) => total + day.amount, 0)
  const { targetSek, startDate, endDate } = challenge.config
  const summary: BackupChallengeSummary = { targetSek, startDate, endDate, savedSek }
  if (name !== undefined) summary.name = name
  return summary
}

function parseLegacyBackup(value: Record<string, unknown>, exportedAt: string): LegacyBackup {
  if (!isRecord(value.challenge)) throw new BackupValidationError('Backup challenge is missing')
  const candidate = {
    id: IMPORTED_V1_PLACEHOLDER_ID,
    seed: value.challenge.seed,
    config: DEFAULT_CHALLENGE_CONFIG,
    days: value.challenge.days,
  }
  // The launched engine always produced exact totals for a challenge without missed days, so a v1 file that
  // violates that is damaged or edited. Files WITH missed days only need to stay within the target, because
  // missed amounts were legitimately left out of the redistribution.
  const challenge = asBackupError(() => parseChallenge(candidate, { requireExactTotal: true }))
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
  const meta: Record<string, ChallengeMeta> = {}
  challenges.forEach((raw, index) => {
    meta[parsed[index].id] = parseMeta(raw)
  })
  const ledger = parseLedger(value.ledger, new Set(parsed.map((challenge) => challenge.id)))
  return { version: 2, exportedAt, activeChallengeId, challenges: parsed, meta, ledger }
}

function parseMeta(raw: unknown): ChallengeMeta {
  if (!isRecord(raw)) return {}
  const meta: ChallengeMeta = {}
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || raw.name.length > MAX_NAME_LENGTH) throw new BackupValidationError('Challenge name is invalid')
    if (raw.name.trim().length > 0) meta.name = raw.name.trim()
  }
  if (raw.origin !== undefined) {
    if (typeof raw.origin !== 'string' || !CHALLENGE_ORIGINS.includes(raw.origin as ChallengeOrigin)) {
      throw new BackupValidationError('Challenge origin is invalid')
    }
    meta.origin = raw.origin as ChallengeOrigin
  }
  return meta
}

function definedMeta(meta: ChallengeMeta | undefined): ChallengeMeta {
  const result: ChallengeMeta = {}
  if (meta?.name) result.name = meta.name
  if (meta?.origin) result.origin = meta.origin
  return result
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
