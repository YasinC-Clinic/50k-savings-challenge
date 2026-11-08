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

export class PersistenceDatabaseError extends Error {
  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause })
    this.name = 'PersistenceDatabaseError'
  }
}

/** Keeps our typed errors intact and wraps anything else (quota, aborted transaction, ...). */
export function toPersistenceError(error: unknown): Error {
  if (error instanceof BackupValidationError) return error
  if (error instanceof PersistenceIntegrityError) return error
  if (error instanceof PersistenceDatabaseError) return error
  return new PersistenceDatabaseError('Local database operation failed', { cause: error })
}
