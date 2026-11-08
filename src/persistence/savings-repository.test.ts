import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { confirmDay, createChallenge, drawToday } from '../domain/challenge'
import {
  BackupValidationError,
  SavingsDatabase,
  SavingsRepository,
  createBackupJson,
} from './savings-repository'

const databases: SavingsDatabase[] = []

function createRepository(): SavingsRepository {
  const database = new SavingsDatabase(`savings-test-${crypto.randomUUID()}`)
  databases.push(database)
  return new SavingsRepository(database)
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => {
    await database.delete()
    database.close()
  }))
})

describe('local challenge persistence', () => {
  it('returns no challenge for a new database', async () => {
    expect(await createRepository().loadChallenge()).toBeNull()
  })

  it('saves and retrieves every challenge day without duplicates', async () => {
    const repository = createRepository()
    const challenge = createChallenge('persist')
    await repository.saveChallenge(challenge)
    await repository.saveChallenge(challenge)

    expect(await repository.loadChallenge()).toEqual(challenge)
    expect(await repository.entryCount()).toBe(181)
  })

  it('retains a challenge after a repository and database reinitialization', async () => {
    const repository = createRepository()
    const challenge = createChallenge('restart')
    await repository.saveChallenge(challenge)
    const databaseName = repository.database.name
    repository.database.close()

    const restarted = new SavingsDatabase(databaseName)
    databases.push(restarted)
    expect(await new SavingsRepository(restarted).loadChallenge()).toEqual(challenge)
  })

  it('does not allow confirmed or drawn amounts to change during an update', async () => {
    const repository = createRepository()
    const confirmed = confirmDay(drawToday(createChallenge('immutable'), '2027-01-01'), '2027-01-01')
    await repository.saveChallenge(confirmed)
    const alteredConfirmed = { ...confirmed, days: confirmed.days.map((day, index) => index === 0 ? { ...day, amount: day.amount + 1 } : day) }
    const alteredDrawn = { ...confirmed, days: confirmed.days.map((day, index) => index === 1 ? { ...day, status: 'drawn' as const } : day) }
    await expect(repository.saveChallenge(alteredConfirmed)).rejects.toThrow('immutable')
    await expect(repository.saveChallenge(alteredDrawn)).resolves.toBeUndefined()

    const drawnRepository = createRepository()
    const drawn = drawToday(createChallenge('drawn-immutable'), '2027-01-01')
    await drawnRepository.saveChallenge(drawn)
    const alteredDrawnAmount = { ...drawn, days: drawn.days.map((day, index) => index === 0 ? { ...day, amount: day.amount + 1 } : day) }
    await expect(drawnRepository.saveChallenge(alteredDrawnAmount)).rejects.toThrow('immutable')
  })
})

describe('backup export and restoration', () => {
  it('round-trips an exact versioned backup', async () => {
    const source = createRepository()
    const challenge = confirmDay(drawToday(createChallenge('round-trip'), '2027-01-01'), '2027-01-01')
    await source.saveChallenge(challenge)
    const backup = await source.exportBackup('2027-01-01T09:00:00.000Z')
    const target = createRepository()

    await target.restoreBackup(backup)
    expect(await target.loadChallenge()).toEqual(challenge)
    expect(JSON.parse(backup)).toMatchObject({ format: '50k-savings-challenge-backup', version: 2, exportedAt: '2027-01-01T09:00:00.000Z' })
  })

  it('rejects corrupt and incompatible backups before changing existing data', async () => {
    const repository = createRepository()
    const original = createChallenge('original')
    await repository.saveChallenge(original)
    await expect(repository.restoreBackup('{not json')).rejects.toBeInstanceOf(BackupValidationError)
    await expect(repository.restoreBackup(JSON.stringify({ format: 'wrong-format', version: 1 }))).rejects.toBeInstanceOf(BackupValidationError)
    await expect(repository.restoreBackup(JSON.stringify({ format: '50k-savings-challenge-backup', version: 2 }))).rejects.toBeInstanceOf(BackupValidationError)
    expect(await repository.loadChallenge()).toEqual(original)
  })

  it('replaces data atomically rather than merging daily entries', async () => {
    const repository = createRepository()
    const existing = createChallenge('existing')
    const restored = confirmDay(drawToday(createChallenge('restored'), '2027-01-01'), '2027-01-01')
    await repository.saveChallenge(existing)
    await repository.restoreBackup(createBackupJson(restored, '2027-01-02T09:00:00.000Z'))

    expect(await repository.loadChallenge()).toEqual(restored)
    expect(await repository.entryCount()).toBe(181)
  })

  it('rejects a structurally valid but invalid backup without partial overwrite', async () => {
    const repository = createRepository()
    const original = createChallenge('atomic-original')
    await repository.saveChallenge(original)
    const invalid = JSON.parse(createBackupJson(createChallenge('invalid'), '2027-01-02T09:00:00.000Z')) as { challenges: Array<{ days: Array<{ amount: number }> }> }
    invalid.challenges[0].days[0].amount = 0
    await expect(repository.restoreBackup(JSON.stringify(invalid))).rejects.toBeInstanceOf(BackupValidationError)
    expect(await repository.loadChallenge()).toEqual(original)
  })

  it('rejects invalid export timestamps and exports only existing challenges', async () => {
    const repository = createRepository()
    await expect(repository.exportBackup()).rejects.toThrow('No challenge exists')
    expect(() => createBackupJson(createChallenge('timestamp'), 'not-a-date')).toThrow(BackupValidationError)
  })
})
