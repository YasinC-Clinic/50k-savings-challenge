export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupValidationError'
  }
}

/** Stored data is missing, damaged, or a write would break an integrity rule. */
export class PersistenceIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PersistenceIntegrityError'
  }
}

/**
 * The v1 data of the previous app version is damaged. Normal use is blocked until the user has
 * exported the raw data and explicitly chosen to continue without it.
 */
export class LegacyDataDamagedError extends PersistenceIntegrityError {
  readonly reason: string

  constructor(reason: string) {
    super(
      `Stored data from the previous version is damaged (${reason}). Export the raw data before doing anything else.`,
    )
    this.reason = reason
  }
}

export class PersistenceDatabaseError extends Error {
  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause })
    this.name = 'PersistenceDatabaseError'
  }
}

/** The database was written by a newer version of the app than the one that is running (stale service worker). */
export class PersistenceVersionError extends PersistenceDatabaseError {
  constructor({ cause }: { cause?: unknown } = {}) {
    super('The stored data was created by a newer version of the app. Reload the app to update it.', { cause })
  }
}

/** Keeps our typed errors intact and wraps anything else (quota, aborted transaction, ...). */
export function toPersistenceError(error: unknown): Error {
  if (error instanceof BackupValidationError) return error
  if (error instanceof PersistenceIntegrityError) return error
  if (error instanceof PersistenceDatabaseError) return error
  if (error instanceof Error && error.name === 'VersionError') return new PersistenceVersionError({ cause: error })
  return new PersistenceDatabaseError('Local database operation failed', { cause: error })
}
