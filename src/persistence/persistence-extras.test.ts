/**
 * Edge cases found while finishing the app: names and origin labels in backups, v1 total validation,
 * size limits, typed errors and the raw export of every table.
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CHALLENGE_CONFIG, confirmDay, createChallenge, drawToday } from '../domain/challenge'
import { MAX_BACKUP_CHARACTERS, describeBackup, parseBackup } from './backup'
import { BackupValidationError, LegacyDataDamagedError, PersistenceVersionError, toPersistenceError } from './errors'
import { SavingsDatabase, SavingsRepository } from './savings-repository'
import { exportRawLegacyData } from './legacy-migration'
import { playedChallenge, seedV1Challenge, seedV1Database, uniqueName, v1BackupJson, withDay } from './testing/v1-fixtures'

const REPLACE = { mode: 'replace', confirmReplace: true } as const
const IMPORT = { mode: 'import-as-new' } as const
const opened: SavingsDatabase[] = []
const names: string[] = []

function openRepository(name = uniqueName('extras')): SavingsRepository {
  const database = new SavingsDatabase(name)
  opened.push(database)
  names.push(name)
  return new SavingsRepository(database)
}

afterEach(async () => {
  opened.splice(0).forEach((database) => database.close())
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)))
})

describe('names and origin labels travel with backups', () => {
  it('stores a trimmed name, exports it, and restores it', async () => {
    const source = openRepository()
    await source.saveChallenge(createChallenge('n', DEFAULT_CHALLENGE_CONFIG, 'n'), { name: '  Semesterkassan  ' })
    const backup = await source.exportBackup('2027-01-01T10:00:00.000Z')
    expect(JSON.parse(backup).challenges[0]).toMatchObject({ name: 'Semesterkassan', origin: 'created' })

    const target = openRepository()
    await target.restoreBackup(backup, REPLACE)
    expect(await target.listChallengeSummaries()).toMatchObject([{ id: 'n', name: 'Semesterkassan', origin: 'created' }])
  })

  it('keeps the "migrated from the previous version" label through export and replace-restore', async () => {
    const name = uniqueName('extras-label')
    await seedV1Challenge(name, createChallenge('label-seed'))
    const source = openRepository(name)
    const backup = await source.exportBackup('2027-01-01T10:00:00.000Z')

    const target = openRepository()
    await target.restoreBackup(backup, REPLACE)
    expect((await target.listChallengeSummaries())[0]).toMatchObject({ id: 'legacy-v1-challenge', origin: 'legacy-v1-migration' })
  })

  it('marks challenges added from a file as imports but keeps their names', async () => {
    const source = openRepository()
    await source.saveChallenge(createChallenge('n', DEFAULT_CHALLENGE_CONFIG, 'n'), { name: 'Min kassa' })
    const target = openRepository()
    await target.restoreBackup(await source.exportBackup('2027-01-01T10:00:00.000Z'), IMPORT)
    expect((await target.listChallengeSummaries())[0]).toMatchObject({ name: 'Min kassa', origin: 'backup-import', sourceChallengeId: 'n' })
  })

  it('renames and un-names a challenge without touching its savings', async () => {
    const repository = openRepository()
    const challenge = createChallenge('r', DEFAULT_CHALLENGE_CONFIG, 'r')
    await repository.saveChallenge(challenge, { name: 'Före' })
    await repository.renameChallenge('r', ' Efter ')
    expect((await repository.listChallengeSummaries())[0].name).toBe('Efter')
    await repository.renameChallenge('r', '   ')
    expect((await repository.listChallengeSummaries())[0].name).toBeUndefined()
    expect(await repository.loadChallenge('r')).toEqual(challenge)
  })

  it('rejects names that are too long and renaming a challenge that does not exist', async () => {
    const repository = openRepository()
    await expect(repository.saveChallenge(createChallenge('x', DEFAULT_CHALLENGE_CONFIG, 'x'), { name: 'a'.repeat(61) })).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
    await expect(repository.renameChallenge('ghost', 'Namn')).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
    expect(await repository.listChallenges()).toEqual([])
  })

  it.each([
    ['an unknown origin', { origin: 'made-up' }],
    ['a numeric name', { name: 5 }],
    ['an over-long name', { name: 'x'.repeat(61) }],
  ])('rejects a backup with %s and changes nothing', async (_label, patch) => {
    const source = openRepository()
    await source.saveChallenge(createChallenge('n', DEFAULT_CHALLENGE_CONFIG, 'n'))
    const backup = JSON.parse(await source.exportBackup('2027-01-01T10:00:00.000Z')) as { challenges: Array<Record<string, unknown>> }
    Object.assign(backup.challenges[0], patch)
    const target = openRepository()
    await expect(target.restoreBackup(JSON.stringify(backup), IMPORT)).rejects.toBeInstanceOf(BackupValidationError)
    expect(await target.listChallenges()).toEqual([])
  })
})

describe('v1 backup totals', () => {
  it('rejects a file without missed days whose amounts do not add up (it was edited or damaged)', () => {
    const challenge = createChallenge('edited')
    const edited = { ...challenge, days: withDay(challenge.days, 3, { amount: challenge.days[3].amount - 10 }) }
    expect(() => parseBackup(v1BackupJson(edited as never))).toThrow(BackupValidationError)
  })

  it('accepts a real historical file with missed days, whose redistributed total legitimately differs', () => {
    const played = playedChallenge('historic')
    expect(played.days.some((day) => day.status === 'missed')).toBe(true)
    expect(() => parseBackup(v1BackupJson(played))).not.toThrow()
  })

  it('accepts a file whose live amounts add up to less than the target (recovery was impossible)', () => {
    const challenge = createChallenge('short')
    const lost = { ...challenge, days: challenge.days.map((day, index) => (index === 0 ? { ...day, status: 'missed' as const } : day)) }
    expect(() => parseBackup(v1BackupJson(lost))).not.toThrow()
  })
})

describe('describeBackup', () => {
  it('summarises a v1 file for the import dialog', () => {
    const played = playedChallenge('summary')
    const saved = played.days.filter((day) => day.status === 'confirmed').reduce((total, day) => total + day.amount, 0)
    expect(describeBackup(v1BackupJson(played))).toEqual({
      version: 1,
      challengeCount: 1,
      challenges: [{ targetSek: 50_000, startDate: '2027-01-01', endDate: '2027-06-30', savedSek: saved }],
    })
  })

  it('summarises a v2 file with names', async () => {
    const source = openRepository()
    await source.saveChallenge(createChallenge('a', DEFAULT_CHALLENGE_CONFIG, 'a'), { name: 'Alfa' })
    const summary = describeBackup(await source.exportBackup('2027-01-01T10:00:00.000Z'))
    expect(summary).toMatchObject({ version: 2, challengeCount: 1, challenges: [{ name: 'Alfa', savedSek: 0, targetSek: 50_000 }] })
  })

  it('refuses a file that is far larger than any real backup', () => {
    expect(() => parseBackup('x'.repeat(MAX_BACKUP_CHARACTERS + 1))).toThrow(/too large/)
  })
})

describe('typed errors', () => {
  it('maps a newer-schema VersionError to PersistenceVersionError', () => {
    const versionError = Object.assign(new Error('requested version is less than the existing version'), { name: 'VersionError' })
    const mapped = toPersistenceError(versionError)
    expect(mapped).toBeInstanceOf(PersistenceVersionError)
    expect(mapped).toMatchObject({ name: 'PersistenceDatabaseError' })
    expect((mapped as Error).cause).toBe(versionError)
  })

  it('wraps unknown failures as PersistenceDatabaseError and keeps typed errors unchanged', () => {
    expect(toPersistenceError(new Error('quota'))).toMatchObject({ name: 'PersistenceDatabaseError' })
    const typed = new BackupValidationError('x')
    expect(toPersistenceError(typed)).toBe(typed)
  })

  it('raises LegacyDataDamagedError (an integrity error) for damaged v1 data, carrying the reason', async () => {
    const name = uniqueName('extras-damaged')
    const legacy = playedChallenge()
    await seedV1Database(name, { activeRow: { id: 'active', seed: legacy.seed }, entries: withDay(legacy.days, 4, { amount: 0 }) })
    const error = await openRepository(name).loadChallenge().then(() => null, (cause: unknown) => cause)
    expect(error).toBeInstanceOf(LegacyDataDamagedError)
    expect(error).toMatchObject({ name: 'PersistenceIntegrityError' })
    expect((error as LegacyDataDamagedError).reason).toMatch(/invalid daily entry/)
  })
})

describe('raw export covers every table', () => {
  it('includes the v2 tables once they exist, so damaged v2 data can be saved too', async () => {
    const repository = openRepository()
    await repository.saveChallenge(createChallenge('raw', DEFAULT_CHALLENGE_CONFIG, 'raw'), { name: 'Rå' })
    const raw = JSON.parse(await repository.exportRawLegacyData('2027-01-01T10:00:00.000Z')) as { tables: Record<string, unknown[]> }
    expect(Object.keys(raw.tables).sort()).toEqual(['appMeta', 'challengeEntries', 'challengeRecords', 'challenges', 'dailyEntries'])
    expect(raw.tables.challengeEntries).toHaveLength(181)
    expect(raw.tables.challengeRecords).toHaveLength(1)
  })

  it('exports even when a v2 row has been corrupted', async () => {
    const repository = openRepository()
    await repository.saveChallenge(createChallenge('raw2', DEFAULT_CHALLENGE_CONFIG, 'raw2'))
    await repository.database.challengeEntries.update(['raw2', '2027-02-01'], { amount: -5 })
    await expect(repository.loadChallenge('raw2')).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
    const raw = await exportRawLegacyData(repository.database.name, '2027-01-01T10:00:00.000Z')
    expect(raw).toContain('-5')
  })
})

describe('daily limits are stored and backed up per challenge', () => {
  const january = { targetSek: 6_000, startDate: '2027-01-01', endDate: '2027-01-31', initialMinimumSek: 100, preferredMaximumSek: 300 }
  const makeCustom = () => createChallenge('limits', january, 'custom')
  const makeDefault = () => createChallenge('plain', { ...DEFAULT_CHALLENGE_CONFIG, startDate: '2027-01-01', endDate: '2027-01-31', targetSek: 8_000 }, 'plain')

  it('keeps challenges with different limits side by side on the same dates and never mixes them', async () => {
    const repository = openRepository()
    await repository.saveChallenge(makeDefault())
    await repository.saveChallenge(makeCustom())
    await repository.saveChallenge(confirmDay(drawToday(makeCustom(), '2027-01-01'), '2027-01-01'))

    const plain = (await repository.loadChallenge('plain'))!
    const custom = (await repository.loadChallenge('custom'))!
    expect(plain.config).toMatchObject({ initialMinimumSek: 50, preferredMaximumSek: 500 })
    expect(custom.config).toMatchObject({ initialMinimumSek: 100, preferredMaximumSek: 300 })
    expect(plain).toEqual(makeDefault())
    expect(custom.days[0].status).toBe('confirmed')
    expect(custom.days.every((day) => day.amount >= 100 && day.amount <= 300)).toBe(true)
  })

  it('exports each challenge with its own limits and restores them unchanged (replace)', async () => {
    const source = openRepository()
    await source.saveChallenge(makeDefault())
    await source.saveChallenge(makeCustom())
    const backup = await source.exportBackup('2027-01-01T10:00:00.000Z')
    const parsed = JSON.parse(backup) as { challenges: Array<{ id: string; config: Record<string, number> }> }
    expect(parsed.challenges.find((challenge) => challenge.id === 'custom')?.config).toMatchObject({ initialMinimumSek: 100, preferredMaximumSek: 300 })
    expect(parsed.challenges.find((challenge) => challenge.id === 'plain')?.config).toMatchObject({ initialMinimumSek: 50, preferredMaximumSek: 500 })

    const target = openRepository()
    await target.restoreBackup(backup, REPLACE)
    expect(await target.loadChallenge('custom')).toEqual(makeCustom())
    expect(await target.loadChallenge('plain')).toEqual(makeDefault())
  })

  it('imports as new challenges that keep their own limits', async () => {
    const source = openRepository()
    await source.saveChallenge(makeCustom())
    const target = openRepository()
    await target.saveChallenge(makeDefault())
    const result = await target.restoreBackup(await source.exportBackup('2027-01-01T10:00:00.000Z'), IMPORT)
    const imported = (await target.loadChallenge(result.importedChallengeIds[0]))!
    expect(imported.config).toEqual(makeCustom().config)
    expect(imported.days).toEqual(makeCustom().days)
    expect(await target.loadChallenge('plain')).toEqual(makeDefault())
  })

  it('gives an imported v1 backup the original 50-500 limits', async () => {
    const target = openRepository()
    await target.restoreBackup(v1BackupJson(playedChallenge('old-file')), IMPORT)
    expect((await target.loadChallenge())!.config).toMatchObject({ initialMinimumSek: 50, preferredMaximumSek: 500, targetSek: 50_000 })
  })

  it('migrates a v1 database with the original 50-500 limits and leaves every amount untouched', async () => {
    const name = uniqueName('extras-limits-legacy')
    const legacy = playedChallenge('limits-legacy')
    await seedV1Challenge(name, legacy)
    const migrated = (await openRepository(name).loadChallenge())!
    expect(migrated.config).toMatchObject({ initialMinimumSek: 50, preferredMaximumSek: 500 })
    expect(migrated.days).toEqual(legacy.days)
  })

  it.each([
    ['an amount below the challenge\'s own minimum', (c: { challenges: Array<{ days: Array<{ amount: number }> }> }) => { c.challenges[0].days[3].amount = 99 }],
    ['a minimum above the maximum', (c: { challenges: Array<{ config: Record<string, number> }> }) => { c.challenges[0].config.initialMinimumSek = 400 }],
    ['a maximum above the supported limit', (c: { challenges: Array<{ config: Record<string, number> }> }) => { c.challenges[0].config.preferredMaximumSek = 100_001 }],
    ['a fractional minimum', (c: { challenges: Array<{ config: Record<string, number> }> }) => { c.challenges[0].config.initialMinimumSek = 99.5 }],
  ])('rejects a backup with %s and changes nothing', async (_label, corrupt) => {
    const source = openRepository()
    await source.saveChallenge(makeCustom())
    const backup = JSON.parse(await source.exportBackup('2027-01-01T10:00:00.000Z'))
    corrupt(backup)
    const target = openRepository()
    await target.saveChallenge(makeDefault())
    await expect(target.restoreBackup(JSON.stringify(backup), REPLACE)).rejects.toBeInstanceOf(BackupValidationError)
    await expect(target.restoreBackup(JSON.stringify(backup), IMPORT)).rejects.toBeInstanceOf(BackupValidationError)
    expect(await target.listChallenges()).toEqual([makeDefault()])
  })

  it('never lets the limits of an existing challenge change', async () => {
    const repository = openRepository()
    await repository.saveChallenge(makeCustom())
    const widened = createChallenge('limits', { ...january, preferredMaximumSek: 400 }, 'custom')
    await expect(repository.saveChallenge(widened)).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
    expect(await repository.loadChallenge('custom')).toEqual(makeCustom())
  })
})
