/**
 * MIGRATION CONTRACT, v1 (single challenge) -> multi-challenge.   (Phase 3: written BEFORE the real migration)
 *
 * Expected behaviour pinned by these tests:
 *  1. Existing v1 data is carried over losslessly: seed, every amount, every status, confirmations.
 *  2. The migrated challenge gets a stable non-empty id and the DEFAULT config
 *     (50,000 SEK, 2027-01-01..2027-06-30) and becomes the active challenge.
 *  3. The v1 tables (challenges.active row, dailyEntries) are left untouched so a rollback is possible.
 *  4. Migration runs once: later edits are never overwritten by re-importing legacy rows.
 *  5. Incomplete or corrupt v1 data NEVER silently disappears and never produces a half-migrated state:
 *     the call fails with PersistenceIntegrityError and nothing is written.
 *  6. All databases are isolated, randomly named, with fake data.
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CHALLENGE_CONFIG, createChallenge, type ChallengeDay } from '../domain/challenge'
import { SavingsDatabase, SavingsRepository } from './savings-repository'
import {
  playedChallenge,
  seedV1Challenge,
  seedV1Database,
  snapshotLegacyTables,
  sum,
  uniqueName,
  withDay,
} from './testing/v1-fixtures'

const opened: SavingsDatabase[] = []
const names: string[] = []

function openRepository(name: string): SavingsRepository {
  const database = new SavingsDatabase(name)
  opened.push(database)
  names.push(name)
  return new SavingsRepository(database)
}

afterEach(async () => {
  opened.splice(0).forEach((database) => database.close())
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)))
})

const integrityError = { name: 'PersistenceIntegrityError' }

describe('A. complete, untouched v1 database', () => {
  it('migrates to exactly one challenge with the default config, same seed and identical days', async () => {
    const name = uniqueName('v1-complete')
    const original = createChallenge('complete-seed')
    await seedV1Challenge(name, original)
    const repository = openRepository(name)

    const challenges = await repository.listChallenges()
    expect(challenges).toHaveLength(1)
    const [migrated] = challenges
    expect(migrated.seed).toBe('complete-seed')
    expect(migrated.config).toEqual(DEFAULT_CHALLENGE_CONFIG)
    expect(migrated.days).toEqual(original.days)
    expect(sum(migrated.days)).toBe(50_000)
    expect(typeof migrated.id).toBe('string')
    expect(migrated.id.length).toBeGreaterThan(0)
  })

  it('makes the migrated challenge the active one and loads it without an id', async () => {
    const name = uniqueName('v1-active')
    await seedV1Challenge(name, createChallenge('active-seed'))
    const repository = openRepository(name)
    const [migrated] = await repository.listChallenges()
    expect(await repository.activeChallengeId()).toBe(migrated.id)
    expect(await repository.loadChallenge()).toEqual(migrated)
  })

  it('keeps the same id after the database is closed and reopened', async () => {
    const name = uniqueName('v1-stable-id')
    await seedV1Challenge(name, createChallenge('stable-id-seed'))
    const first = openRepository(name)
    const id = (await first.loadChallenge())?.id
    first.database.close()
    const second = openRepository(name)
    expect((await second.loadChallenge())?.id).toBe(id)
    expect(await second.listChallenges()).toHaveLength(1)
  })

  it('is idempotent under repeated and concurrent first access (React StrictMode, two tabs)', async () => {
    const name = uniqueName('v1-concurrent')
    await seedV1Challenge(name, createChallenge('concurrent-seed'))
    const repositories = [openRepository(name), openRepository(name), openRepository(name)]
    await Promise.all(repositories.flatMap((repository) => [repository.loadChallenge(), repository.listChallenges(), repository.activeChallengeId()]))
    const lists = await Promise.all(repositories.map((repository) => repository.listChallenges()))
    lists.forEach((list) => expect(list).toHaveLength(1))
    expect(new Set(lists.map((list) => list[0].id)).size).toBe(1)
  })

  it('leaves the v1 tables byte-for-byte untouched so a rollback stays possible', async () => {
    const name = uniqueName('v1-rollback')
    await seedV1Challenge(name, createChallenge('rollback-seed'))
    const before = await snapshotLegacyTables(name)
    const repository = openRepository(name)
    await repository.loadChallenge()
    await repository.listChallenges()
    repository.database.close()
    const after = await snapshotLegacyTables(name)
    expect(after.entries).toHaveLength(181)
    expect(after).toEqual(before)
    expect(after.active).toEqual({ id: 'active', seed: 'rollback-seed' })
  })

  it('never re-imports legacy rows over newer data after the first migration', async () => {
    const name = uniqueName('v1-no-reimport')
    await seedV1Challenge(name, createChallenge('no-reimport-seed'))
    const first = openRepository(name)
    const migrated = (await first.loadChallenge())!
    const progressed = { ...migrated, days: migrated.days.map((day, index) => (index === 0 ? { ...day, status: 'drawn' as const } : day)) }
    await first.saveChallenge(progressed)
    first.database.close()

    const second = openRepository(name)
    expect((await second.loadChallenge())?.days[0].status).toBe('drawn')
  })
})

describe('B. v1 database with real progress', () => {
  it('preserves seed, every amount, every status and the confirmed total', async () => {
    const name = uniqueName('v1-played')
    const original = playedChallenge()
    expect(original.days.filter((day) => day.status === 'confirmed')).toHaveLength(2)
    expect(original.days.filter((day) => day.status === 'missed')).toHaveLength(3)
    await seedV1Challenge(name, original)
    const repository = openRepository(name)

    const migrated = (await repository.loadChallenge())!
    expect(migrated.seed).toBe('played-seed')
    expect(migrated.days).toEqual(original.days)
    expect(migrated.days.map((day) => day.status)).toEqual(original.days.map((day) => day.status))
    expect(sum(migrated.days.filter((day) => day.status === 'confirmed'))).toBe(sum(original.days.filter((day) => day.status === 'confirmed')))
  })

  it.each(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'])('preserves everything for seed %s', async (seed) => {
    const name = uniqueName('v1-matrix')
    const original = playedChallenge(seed)
    await seedV1Challenge(name, original)
    const migrated = (await openRepository(name).loadChallenge())!
    expect(migrated.seed).toBe(seed)
    expect(migrated.days).toEqual(original.days)
  })

  it('still protects confirmed and drawn entries after migration', async () => {
    const name = uniqueName('v1-immutable')
    await seedV1Challenge(name, playedChallenge())
    const repository = openRepository(name)
    const migrated = (await repository.loadChallenge())!
    const tamperedConfirmed = { ...migrated, days: migrated.days.map((day, index) => (index === 0 ? { ...day, amount: day.amount + 1 } : day)) }
    const tamperedDrawn = { ...migrated, days: migrated.days.map((day, index) => (index === 5 ? { ...day, amount: day.amount + 1 } : day)) }
    await expect(repository.saveChallenge(tamperedConfirmed)).rejects.toMatchObject(integrityError)
    await expect(repository.saveChallenge(tamperedDrawn)).rejects.toMatchObject(integrityError)
    expect(await repository.loadChallenge()).toEqual(migrated)
  })

  it('lets the user keep playing: confirming today persists after migration', async () => {
    const name = uniqueName('v1-continue')
    await seedV1Challenge(name, playedChallenge())
    const repository = openRepository(name)
    const migrated = (await repository.loadChallenge())!
    const confirmedToday = { ...migrated, days: migrated.days.map((day) => (day.date === '2027-01-06' ? { ...day, status: 'confirmed' as const } : day)) }
    await repository.saveChallenge(confirmedToday)
    expect((await repository.loadChallenge())?.days.find((day) => day.date === '2027-01-06')?.status).toBe('confirmed')
  })
})

describe('C. empty databases', () => {
  it('a brand-new database has no challenge, no active id, and cannot export', async () => {
    const repository = openRepository(uniqueName('empty-new'))
    expect(await repository.loadChallenge()).toBeNull()
    expect(await repository.listChallenges()).toEqual([])
    expect(await repository.activeChallengeId()).toBeNull()
    await expect(repository.exportBackup()).rejects.toMatchObject(integrityError)
  })

  it('a v1-schema database with zero rows behaves the same and invents no challenge', async () => {
    const name = uniqueName('empty-v1')
    await seedV1Database(name, { activeRow: null, entries: [] })
    const repository = openRepository(name)
    expect(await repository.loadChallenge()).toBeNull()
    expect(await repository.listChallenges()).toEqual([])
  })

  it('treats a lone legacy marker row with zero entries as "no data", not as an error', async () => {
    const name = uniqueName('empty-marker')
    await seedV1Database(name, { activeRow: { id: 'active', seed: 'orphan-marker' }, entries: [] })
    const repository = openRepository(name)
    expect(await repository.loadChallenge()).toBeNull()
    expect(await repository.listChallenges()).toEqual([])
  })

  it('a new challenge can be created and persisted in an empty database', async () => {
    const repository = openRepository(uniqueName('empty-create'))
    const created = createChallenge('fresh', DEFAULT_CHALLENGE_CONFIG, 'fresh-id')
    await repository.saveChallenge(created)
    expect(await repository.loadChallenge()).toEqual(created)
    expect(await repository.activeChallengeId()).toBe('fresh-id')
  })
})

describe('D. partially populated v1 databases', () => {
  it('refuses to migrate 100 of 181 entries, writes nothing, and keeps legacy rows intact', async () => {
    const name = uniqueName('partial-100')
    const original = playedChallenge()
    await seedV1Database(name, { activeRow: { id: 'active', seed: original.seed }, entries: original.days.slice(0, 100) })
    const before = await snapshotLegacyTables(name)
    const repository = openRepository(name)

    await expect(repository.loadChallenge()).rejects.toMatchObject(integrityError)
    await expect(repository.loadChallenge()).rejects.toMatchObject(integrityError)
    await expect(repository.listChallenges()).rejects.toMatchObject(integrityError)
    repository.database.close()
    expect(await snapshotLegacyTables(name)).toEqual(before)
  })

  it('refuses a single missing day in the middle (180 of 181) and keeps the confirmations safe', async () => {
    const name = uniqueName('partial-180')
    const original = playedChallenge()
    await seedV1Database(name, { activeRow: { id: 'active', seed: original.seed }, entries: original.days.filter((day) => day.date !== '2027-03-01') })
    const before = await snapshotLegacyTables(name)
    await expect(openRepository(name).loadChallenge()).rejects.toMatchObject(integrityError)
    expect(await snapshotLegacyTables(name)).toEqual(before)
    expect((before.entries as ChallengeDay[]).filter((day) => day.status === 'confirmed')).toHaveLength(2)
  })

  it('never deletes orphan entries that have no active challenge row (they may hold confirmed savings)', async () => {
    const name = uniqueName('orphans')
    const original = playedChallenge()
    await seedV1Database(name, { activeRow: null, entries: original.days })
    const before = await snapshotLegacyTables(name)
    const repository = openRepository(name)
    await repository.loadChallenge().catch(() => null)
    await repository.listChallenges().catch(() => null)
    repository.database.close()
    expect(await snapshotLegacyTables(name)).toEqual(before)
  })
})

describe('E. corrupt v1 databases', () => {
  const corruptions: Array<[string, (days: ChallengeDay[]) => unknown[]]> = [
    ['an amount of zero', (days) => withDay(days, 10, { amount: 0 })],
    ['a negative amount', (days) => withDay(days, 10, { amount: -50 })],
    ['a fractional amount', (days) => withDay(days, 10, { amount: 150.5 })],
    ['an amount stored as a string', (days) => withDay(days, 10, { amount: '150' })],
    ['an amount below the 50 SEK minimum', (days) => withDay(days, 10, { amount: 49 })],
    ['an unknown status', (days) => withDay(days, 10, { status: 'bogus' })],
    ['a missing status', (days) => withDay(days, 10, { status: undefined })],
    ['an extra entry after the end date', (days) => [...days, { date: '2027-07-01', amount: 100, status: 'undrawn' }]],
    ['an entry dated before the start', (days) => withDay(days, 0, { date: '2026-12-31' })],
    ['an impossible calendar date', (days) => withDay(days, 40, { date: '2027-02-30' })],
  ]

  for (const [label, corrupt] of corruptions) {
    it(`fails safely, writes nothing and keeps the rows when there is ${label}`, async () => {
      const name = uniqueName('corrupt')
      const original = playedChallenge()
      await seedV1Database(name, { activeRow: { id: 'active', seed: original.seed }, entries: corrupt(original.days) })
      const before = await snapshotLegacyTables(name)
      const repository = openRepository(name)

      await expect(repository.loadChallenge()).rejects.toMatchObject(integrityError)
      await expect(repository.listChallenges()).rejects.toMatchObject(integrityError)
      repository.database.close()
      expect(await snapshotLegacyTables(name)).toEqual(before)
    })
  }

  it.each([
    ['a missing seed', { id: 'active' }],
    ['a numeric seed', { id: 'active', seed: 42 }],
    ['a null seed', { id: 'active', seed: null }],
  ])('fails safely when the legacy row has %s', async (_label, activeRow) => {
    const name = uniqueName('corrupt-seed')
    await seedV1Database(name, { activeRow, entries: createChallenge('whatever').days })
    const before = await snapshotLegacyTables(name)
    const repository = openRepository(name)
    await expect(repository.loadChallenge()).rejects.toMatchObject(integrityError)
    repository.database.close()
    expect(await snapshotLegacyTables(name)).toEqual(before)
  })

  it('does not report corruption as an empty database (a silent reset would lose savings)', async () => {
    const name = uniqueName('corrupt-not-empty')
    const original = playedChallenge()
    await seedV1Database(name, { activeRow: { id: 'active', seed: original.seed }, entries: withDay(original.days, 3, { status: 'bogus' }) })
    const result = await openRepository(name).loadChallenge().then(() => 'resolved', () => 'rejected')
    expect(result).toBe('rejected')
  })
})
