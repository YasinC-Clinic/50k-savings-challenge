/**
 * RECOVERY AND ATOMICITY CONTRACT.
 *
 *  - Raw legacy export works on damaged data, never validates, never writes, never upgrades the database.
 *  - Damaged legacy data blocks normal use (typed error) until the user exports it and explicitly skips it.
 *  - Skipping never touches the v1 tables.
 *  - A failure during migration leaves NO v2 rows behind and the migration can be retried.
 *  - Stored v2 data is isolated per challengeId and corruption in one challenge does not hide the others.
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CHALLENGE_CONFIG, confirmDay, createChallenge, drawToday } from '../domain/challenge'
import { SavingsDatabase, SavingsRepository } from './savings-repository'
import {
  playedChallenge,
  seedV1Challenge,
  seedV1Database,
  snapshotLegacyTables,
  snapshotRawTables,
  uniqueName,
  v1BackupJson,
  withDay,
} from './testing/v1-fixtures'

const opened: SavingsDatabase[] = []
const names: string[] = []

function openRepository(name: string): SavingsRepository {
  const database = new SavingsDatabase(name)
  opened.push(database)
  names.push(name)
  return new SavingsRepository(database, { now: () => '2027-01-06T09:00:00.000Z' })
}

afterEach(async () => {
  vi.restoreAllMocks()
  opened.splice(0).forEach((database) => database.close())
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)))
  await Promise.all(extraNames.splice(0).map((name) => Dexie.delete(name)))
})

const extraNames: string[] = []

async function storedVersion(name: string): Promise<number | undefined> {
  const databases = await indexedDB.databases()
  return databases.find((database) => database.name === name)?.version
}

interface RawExport {
  format: string
  version: number
  exportedAt: string
  warning: string
  database: string
  tables: { challenges: Array<Record<string, unknown>>; dailyEntries: Array<Record<string, unknown>> }
}

async function seedDamaged(prefix: string): Promise<{ name: string; entries: unknown[] }> {
  const name = uniqueName(prefix)
  extraNames.push(name)
  const original = playedChallenge()
  const entries = withDay(original.days, 10, { amount: 0 })
  await seedV1Database(name, { activeRow: { id: 'active', seed: original.seed }, entries })
  return { name, entries }
}

describe('J. raw export of damaged legacy data', () => {
  it('exports every raw row of a corrupt database, including the invalid one, with a clear warning', async () => {
    const { name, entries } = await seedDamaged('raw-corrupt')
    const raw = JSON.parse(await openRepository(name).exportRawLegacyData('2027-01-06T10:00:00.000Z')) as RawExport

    expect(raw).toMatchObject({ format: '50k-savings-challenge-raw-recovery', version: 1, exportedAt: '2027-01-06T10:00:00.000Z', database: name })
    expect(raw.warning).toContain('technical assistance')
    expect(raw.warning).toContain('has not been changed or deleted')
    expect(raw.tables.challenges).toEqual([{ id: 'active', seed: 'played-seed' }])
    expect(raw.tables.dailyEntries).toHaveLength(181)
    expect(raw.tables.dailyEntries.some((row) => row.amount === 0)).toBe(true)
    expect(raw.tables.dailyEntries).toEqual(JSON.parse(JSON.stringify(entries)))
  })

  it('does not modify the source database: same rows, same tables, same schema version, nothing created', async () => {
    const { name } = await seedDamaged('raw-readonly')
    const rowsBefore = await snapshotRawTables(name)
    const versionBefore = await storedVersion(name)
    expect(versionBefore).toBe(10)

    const { exportRawLegacyData } = await import('./legacy-migration')
    await exportRawLegacyData(name, '2027-01-06T10:00:00.000Z')
    await exportRawLegacyData(name, '2027-01-06T10:00:00.000Z')

    expect(await snapshotRawTables(name)).toEqual(rowsBefore)
    expect(Object.keys(await snapshotRawTables(name)).sort()).toEqual(['challenges', 'dailyEntries'])
    expect(await storedVersion(name)).toBe(versionBefore)
  })

  it('does not modify the legacy tables when the repository exports after a failed load', async () => {
    const { name } = await seedDamaged('raw-after-failure')
    const before = await snapshotLegacyTables(name)
    const repository = openRepository(name)
    await expect(repository.loadChallenge()).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
    const raw = JSON.parse(await repository.exportRawLegacyData()) as RawExport
    expect(raw.tables.dailyEntries).toHaveLength(181)
    repository.database.close()
    expect(await snapshotLegacyTables(name)).toEqual(before)
    const v2 = await snapshotRawTables(name)
    expect(v2.challengeRecords).toEqual([])
    expect(v2.challengeEntries).toEqual([])
    expect(v2.appMeta).toEqual([])
  })

  it('exports partial data exactly as it is', async () => {
    const name = uniqueName('raw-partial')
    extraNames.push(name)
    const original = playedChallenge()
    await seedV1Database(name, { activeRow: { id: 'active', seed: original.seed }, entries: original.days.slice(0, 100) })
    const raw = JSON.parse(await openRepository(name).exportRawLegacyData()) as RawExport
    expect(raw.tables.dailyEntries).toHaveLength(100)
  })

  it('exports orphan entries that have no challenge record', async () => {
    const name = uniqueName('raw-orphans')
    extraNames.push(name)
    await seedV1Database(name, { activeRow: null, entries: playedChallenge().days })
    const raw = JSON.parse(await openRepository(name).exportRawLegacyData()) as RawExport
    expect(raw.tables.challenges).toEqual([])
    expect(raw.tables.dailyEntries).toHaveLength(181)
  })

  it('also exports healthy legacy data and is deterministic for the same timestamp', async () => {
    const name = uniqueName('raw-healthy')
    await seedV1Challenge(name, createChallenge('healthy-raw'))
    const repository = openRepository(name)
    const first = await repository.exportRawLegacyData('2027-01-06T10:00:00.000Z')
    expect(await repository.exportRawLegacyData('2027-01-06T10:00:00.000Z')).toBe(first)
    expect((JSON.parse(first) as RawExport).tables.dailyEntries).toHaveLength(181)
  })

  it('refuses to export when no database exists, and does not create one', async () => {
    const name = uniqueName('raw-missing')
    extraNames.push(name)
    const { exportRawLegacyData } = await import('./legacy-migration')
    await expect(exportRawLegacyData(name, '2027-01-06T10:00:00.000Z')).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
    expect(await Dexie.exists(name)).toBe(false)
  })
})

describe('K. damaged legacy data blocks use until explicitly skipped', () => {
  it('blocks every operation with a typed error, including saving and restoring', async () => {
    const { name } = await seedDamaged('blocked')
    const repository = openRepository(name)
    const integrity = { name: 'PersistenceIntegrityError' }
    await expect(repository.loadChallenge()).rejects.toMatchObject(integrity)
    await expect(repository.listChallenges()).rejects.toMatchObject(integrity)
    await expect(repository.activeChallengeId()).rejects.toMatchObject(integrity)
    await expect(repository.saveChallenge(createChallenge('new'))).rejects.toMatchObject(integrity)
    await expect(repository.restoreBackup(v1BackupJson(createChallenge('b')), { mode: 'import-as-new' })).rejects.toMatchObject(integrity)
  })

  it('the error message tells the user to export the raw data first', async () => {
    const { name } = await seedDamaged('message')
    await expect(openRepository(name).loadChallenge()).rejects.toThrow(/Export the raw data/)
  })

  it('after skipping, the app works again, and the damaged rows stay untouched and exportable', async () => {
    const { name } = await seedDamaged('skip')
    const before = await snapshotLegacyTables(name)
    const repository = openRepository(name)
    await expect(repository.loadChallenge()).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })

    await repository.skipDamagedLegacyData()
    expect(await repository.loadChallenge()).toBeNull()
    expect(await repository.listChallenges()).toEqual([])

    const fresh = createChallenge('fresh-start', DEFAULT_CHALLENGE_CONFIG, 'fresh-start')
    await repository.saveChallenge(fresh)
    expect(await repository.loadChallenge()).toEqual(fresh)
    const raw = JSON.parse(await repository.exportRawLegacyData()) as RawExport
    expect(raw.tables.dailyEntries).toHaveLength(181)
    repository.database.close()
    expect(await snapshotLegacyTables(name)).toEqual(before)
  })

  it('stays skipped after reopening and never re-imports the damaged data', async () => {
    const { name } = await seedDamaged('skip-persist')
    const first = openRepository(name)
    await first.skipDamagedLegacyData()
    first.database.close()
    const second = openRepository(name)
    expect(await second.listChallenges()).toEqual([])
  })

  it('can import a v1 backup after skipping', async () => {
    const { name } = await seedDamaged('skip-then-import')
    const repository = openRepository(name)
    await repository.skipDamagedLegacyData()
    await repository.restoreBackup(v1BackupJson(playedChallenge('after-skip')), { mode: 'import-as-new' })
    expect((await repository.loadChallenge())?.seed).toBe('after-skip')
  })

  it.each([
    ['healthy legacy data', async (name: string) => seedV1Challenge(name, createChallenge('fine'))],
    ['an empty database', async (name: string) => seedV1Database(name, { activeRow: null, entries: [] })],
  ])('refuses to skip %s', async (_label, seed) => {
    const name = uniqueName('skip-refused')
    extraNames.push(name)
    await seed(name)
    await expect(openRepository(name).skipDamagedLegacyData()).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
  })

  it('refuses to skip twice', async () => {
    const { name } = await seedDamaged('skip-twice')
    const repository = openRepository(name)
    await repository.skipDamagedLegacyData()
    await expect(repository.skipDamagedLegacyData()).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
  })
})

describe('L. migration identity, schema and atomic rollback', () => {
  it('uses the stable legacy challenge id and records origin and migration status', async () => {
    const name = uniqueName('identity')
    await seedV1Challenge(name, playedChallenge('identity-seed'))
    const repository = openRepository(name)
    expect((await repository.loadChallenge())?.id).toBe('legacy-v1-challenge')
    expect(await repository.listChallengeSummaries()).toEqual([
      { id: 'legacy-v1-challenge', origin: 'legacy-v1-migration', createdAt: '2027-01-06T09:00:00.000Z' },
    ])
    const meta = await repository.database.appMeta.get('legacyMigration')
    expect(meta?.value).toMatchObject({ status: 'migrated', challengeId: 'legacy-v1-challenge' })
  })

  it('records an empty migration for a brand-new database', async () => {
    const repository = openRepository(uniqueName('identity-empty'))
    await repository.loadChallenge()
    const meta = await repository.database.appMeta.get('legacyMigration')
    expect(meta?.value).toMatchObject({ status: 'empty' })
  })

  it('opens at schema version 2 with v1 tables kept and the three new tables added', async () => {
    const name = uniqueName('schema')
    await seedV1Challenge(name, createChallenge('schema-seed'))
    expect(await storedVersion(name)).toBe(10)
    const repository = openRepository(name)
    await repository.loadChallenge()
    repository.database.close()
    // Schema version 3 (IndexedDB version 30) only ADDS the three ledger tables; the v1 and v2 tables are all still here.
    expect(await storedVersion(name)).toBe(30)
    expect(Object.keys(await snapshotRawTables(name)).sort()).toEqual([
      'appMeta',
      'catchUps',
      'challengeEntries',
      'challengeRecords',
      'challenges',
      'dailyEntries',
      'penalties',
      'penaltyPayments',
    ])
  })

  it('stores one set of entries per challenge, keyed by challenge id and date', async () => {
    const repository = openRepository(uniqueName('storage'))
    await repository.saveChallenge(createChallenge('s1', DEFAULT_CHALLENGE_CONFIG, 'one'))
    await repository.saveChallenge(createChallenge('s2', DEFAULT_CHALLENGE_CONFIG, 'two'))
    expect(await repository.database.challengeEntries.count()).toBe(362)
    expect(await repository.database.entriesOf('one').count()).toBe(181)
    expect((await repository.database.entriesOf('two').toArray()).every((row) => row.challengeId === 'two')).toBe(true)
  })

  it('a failure while migrating writes nothing, leaves v1 untouched, and the retry succeeds', async () => {
    const name = uniqueName('atomic-migration')
    const original = playedChallenge('atomic-seed')
    await seedV1Challenge(name, original)
    const before = await snapshotLegacyTables(name)
    const repository = openRepository(name)

    vi.spyOn(repository.database.challengeEntries, 'bulkPut').mockImplementationOnce((() => Promise.reject(new Error('disk full'))) as never)
    await expect(repository.loadChallenge()).rejects.toMatchObject({ name: 'PersistenceDatabaseError' })

    const afterFailure = await snapshotRawTables(name)
    expect(afterFailure.challengeRecords).toEqual([])
    expect(afterFailure.challengeEntries).toEqual([])
    expect(afterFailure.appMeta).toEqual([])
    expect(await snapshotLegacyTables(name)).toEqual(before)

    vi.restoreAllMocks()
    expect((await repository.loadChallenge())?.days).toEqual(original.days)
  })

  it('a failed save changes nothing for any challenge', async () => {
    const repository = openRepository(uniqueName('atomic-save'))
    const a = createChallenge('a', DEFAULT_CHALLENGE_CONFIG, 'a')
    const b = createChallenge('b', DEFAULT_CHALLENGE_CONFIG, 'b')
    await repository.saveChallenge(a)
    await repository.saveChallenge(b)
    const progressed = drawToday(a, '2027-01-01')

    vi.spyOn(repository.database.challengeEntries, 'bulkPut').mockImplementationOnce((() => Promise.reject(new Error('disk full'))) as never)
    await expect(repository.saveChallenge(progressed)).rejects.toMatchObject({ name: 'PersistenceDatabaseError' })
    vi.restoreAllMocks()
    expect(await repository.loadChallenge('a')).toEqual(a)
    expect(await repository.loadChallenge('b')).toEqual(b)
  })
})

describe('M. save rules and stored-data integrity', () => {
  it('protects confirmed amounts even when the total still adds up (a sum-preserving tamper)', async () => {
    const repository = openRepository(uniqueName('immutable'))
    const confirmed = confirmDay(drawToday(createChallenge('imm', DEFAULT_CHALLENGE_CONFIG, 'imm'), '2027-01-01'), '2027-01-01')
    await repository.saveChallenge(confirmed)
    const tampered = {
      ...confirmed,
      days: confirmed.days.map((day, index) => {
        if (index === 0) return { ...day, amount: day.amount + 1 }
        if (index === 5) return { ...day, amount: day.amount - 1 }
        return day
      }),
    }
    await expect(repository.saveChallenge(tampered)).rejects.toThrow(/immutable/)
    expect(await repository.loadChallenge('imm')).toEqual(confirmed)
  })

  it('rejects amounts that no longer add up to the target and writes nothing', async () => {
    const repository = openRepository(uniqueName('totals'))
    const original = createChallenge('totals', DEFAULT_CHALLENGE_CONFIG, 'totals')
    await repository.saveChallenge(original)
    const inflated = { ...original, days: original.days.map((day, index) => (index === 9 ? { ...day, amount: day.amount + 1 } : day)) }
    await expect(repository.saveChallenge(inflated)).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
    expect(await repository.loadChallenge('totals')).toEqual(original)
  })

  it('never lets an existing challenge change its seed or configuration', async () => {
    const repository = openRepository(uniqueName('identity-lock'))
    const original = createChallenge('lock', DEFAULT_CHALLENGE_CONFIG, 'lock')
    await repository.saveChallenge(original)
    const otherSeed = createChallenge('different-seed', DEFAULT_CHALLENGE_CONFIG, 'lock')
    const otherConfig = createChallenge('lock', { ...DEFAULT_CHALLENGE_CONFIG, targetSek: 40_000 }, 'lock')
    await expect(repository.saveChallenge(otherSeed)).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
    await expect(repository.saveChallenge(otherConfig)).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
    expect(await repository.loadChallenge('lock')).toEqual(original)
  })

  it('reports damaged stored rows of one challenge without hiding the healthy ones', async () => {
    const repository = openRepository(uniqueName('damaged-v2'))
    await repository.saveChallenge(createChallenge('good', DEFAULT_CHALLENGE_CONFIG, 'good'))
    await repository.saveChallenge(createChallenge('bad', DEFAULT_CHALLENGE_CONFIG, 'bad'))
    await repository.database.challengeEntries.update(['bad', '2027-03-01'], { amount: 0 })

    await expect(repository.loadChallenge('bad')).rejects.toThrow(/bad.*damaged/)
    await expect(repository.listChallenges()).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
    expect((await repository.loadChallenge('good'))?.id).toBe('good')
  })
})
